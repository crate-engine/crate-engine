import { readWork, holdWork } from "./work-recovery.js";
// THE BLENDED PANE — S2 supervisor (PDR dev/pdr/blended-pane.md).
//
// S1 (blend.ts) built the delivery physics: verified injection into a live
// TUI session. This module is the thing that OWNS one blended seat for its
// whole life: spawn the engine-owned PTY, discover the session file, run the
// standing delivery loop (blendedLoop), and respawn — for crash recovery
// (resume), for the fresh-per-task reset (fresh eyes), and for a D12 refresh
// (visible restart).
//
// PLACEMENT IS LOAD-BEARING: the PTY registry (ptyseat.ts) is in-process
// state of the GUI server, so a blended seat can NEVER live in a
// `crate runner` child — that child could not reach the pane. The supervisor
// runs inside the engine-server process; teamproc branches flagged seats
// here instead of spawning a runner child.
import { acquireConsumerLease } from "./consumer-lease.js";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { localIsoOffset } from "./mailbox.js";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { blendedLoop, sessionWorkState, reconcileBlendedRestart, blendEligible, claudeTrustHandshake, codexBootModals, createStaleTracker, findBlendSessionCandidates, seatsToReset, verifyDelivered, } from "./blend.js";
import { resolveSeatStaffing } from "./launcher.js";
import { SEATS } from "./manifest.js";
import { evictSeatTty, startSeatTty } from "./ptyseat.js";
import { sessionFile, turnsDir } from "./runner.js";
import { parseRigConf } from "./staffing.js";
const realSleep = (ms) => new Promise((res) => setTimeout(res, ms));
export class BlendedSeat {
    o;
    startedAt = Date.now();
    tty;
    /** PINNED session — set only after a delivery marker proved which
     * candidate file is ours (all-seats coherence: several blended seats
     * share one cwd, so "the newest file" can be another seat's session). */
    session;
    spawnMs = Date.now();
    /** The last spawn resumed a persisted session (sessionFile existed) — an
     * unpinned-but-resumed session is already oriented; a fresh one is not. */
    lastSpawnResumed = false;
    /** Arms blendedTurn's external-drop lever (verify-dispatch fresh-eyes /
     * D12 refreshSeat rm turns/<seat>/session.json). */
    persistRef = { persisted: false };
    ac = new AbortController();
    loopLive = false;
    stopped = false;
    constructor(o) {
        this.o = o;
    }
    /** Fire the standing loop (a floating promise — the supervisor's lifetime
     * IS the loop's; stop() aborts it). Never throws: a dying loop stamps
     * honestly and reads as not-alive, so relaunch can act. */
    start() {
        this.loopLive = true;
        void this.run()
            .catch((e) => {
            this.stamp(`blended loop DIED: ${e instanceof Error ? e.message : String(e)} — relaunch from the Team menu`);
        })
            .finally(() => {
            this.loopLive = false;
        });
    }
    alive() {
        return !this.stopped && this.loopLive;
    }
    responding() {
        // PINNED-ONLY on purpose (all-seats coherence): pre-pin, "the newest
        // candidate" in the shared session dir may be ANOTHER seat's live file —
        // reading it would stall this seat's reset behind a neighbor's response.
        // A durable work record can identify the interrupted session before
        // the resumed pane is pinned again; preserve it until completion.
        const work = readWork(this.o.projectRoot, this.o.seat);
        if (!this.session && work)
            this.pinByMarker(work.id);
        const path = this.session?.path ?? work?.sessionPath;
        if (!path)
            return work !== undefined;
        try {
            return sessionWorkState(readFileSync(path, "utf8"), this.o.cli) !== "idle";
        }
        catch {
            return true;
        }
    }
    stop() {
        this.stopped = true;
        this.ac.abort();
        // EVICT, not just kill (live relaunch lesson, 2026-08-12): refresh stops
        // this supervisor and starts its successor in the same tick — a
        // dying-but-still-registered pane would be REATTACHED by the successor's
        // eager spawn, deferring the visible fresh pane to the next delivery.
        evictSeatTty(this.o.projectRoot, this.o.seat);
        try {
            this.tty?.kill(); // a process the engine spawned — the engine cleans it up
        }
        catch {
            /* already gone */
        }
    }
    stamp(line) {
        try {
            appendFileSync(join(turnsDir(this.o.projectRoot, this.o.seat), "turns.log"), `${localIsoOffset()} | ${line}\n`);
        }
        catch {
            /* the seat matters more than the note */
        }
    }
    async run() {
        const lease = await acquireConsumerLease(this.o.projectRoot, this.o.seat, 9000);
        try {
            if (!this.ac.signal.aborted)
                await this.runOwned(lease);
        }
        finally {
            // Keep ownership until the old PTY has really exited, including refresh.
            if (this.tty && !this.tty.exited)
                await this.killAndAwaitExit(this.tty);
            await lease.release();
        }
    }
    async runOwned(lease) {
        // CE-189 (Adam's docket test, 2026-09-24): the fresh-per-task reset is
        // LAZY — a worker marked stale at a task end respawns fresh only at its
        // NEXT delivery. A seat that got no mail since (crate-engine-site's QA,
        // 9 days) therefore re-opened its OLD conversation at every engine
        // restart, and claude stopped the pane on its "session is 9d old —
        // resume from summary?" picker. Boot IS a spawn: a stale worker with no
        // work in flight starts fresh here, exactly as its next delivery would
        // have. Interrupted work (an unfinished work record, or one we cannot
        // read) still resumes — never trade lost work for clean eyes.
        if (this.o.stale.isStale(this.o.seat) && existsSync(sessionFile(this.o.projectRoot, this.o.seat))) {
            let inFlight = false;
            try {
                const w = readWork(this.o.projectRoot, this.o.seat);
                inFlight = !!w && w.phase !== "completed";
            }
            catch {
                inFlight = true; // unreadable record = preserve for inspection
            }
            if (!inFlight) {
                try {
                    rmSync(sessionFile(this.o.projectRoot, this.o.seat));
                }
                catch {
                    /* already fresh */
                }
                this.o.stale.clear(this.o.seat);
                this.session = undefined;
                this.stamp("boot — a task ended since this seat's last session; starting FRESH instead of resuming the old conversation (CE-189)");
            }
        }
        // Arm the external-drop lever from disk truth: a sessionFile that
        // survived an engine restart was persisted by a verified delivery — if
        // agentctl rm's it later, the drop must still read as fresh-eyes.
        this.persistRef.persisted = existsSync(sessionFile(this.o.projectRoot, this.o.seat));
        // Eager first spawn: the pane is live from day one (a blended seat that
        // only appears at first mail would read as a dead cockpit). A refusal
        // here (wall refusal, missing binary) is not fatal to the SEAT — the
        // loop still runs and the next delivery retries through the respawn seam.
        try {
            await this.spawnPty("blended session boot");
        }
        catch (e) {
            if (this.ac.signal.aborted)
                return;
            holdWork(this.o.projectRoot, this.o.seat);
            this.stamp(`blended boot could not open the pane: ${e instanceof Error ? e.message : String(e)} — retrying at the next delivery`);
        }
        await blendedLoop({
            consumerLease: lease,
            projectRoot: this.o.projectRoot,
            seat: this.o.seat,
            cli: this.o.cli,
            agentArg: this.o.agentArg,
            model: this.o.model,
            contextAutoRefresh: this.o.contextAutoRefresh,
            getTty: () => (this.tty && !this.tty.exited ? this.tty : undefined),
            respawn: (reason) => this.respawn(reason),
            readSession: () => this.readSession(),
            currentSessionId: () => this.session?.sessionId,
            currentSessionPath: () => this.session?.path,
            stale: this.o.stale,
            responding: () => this.responding(),
            persistRef: this.persistRef,
            onVerified: (id) => this.pinByMarker(id),
            needsOrientation: () => this.needsOrientation(),
            signal: this.ac.signal,
            sleep: this.o.sleep,
            spawnSettleMs: this.o.spawnSettleMs,
            pollMs: this.o.pollMs,
        });
    }
    /** The ONE respawn seam (boot aside): serves crash recovery, the fresh-
     * per-task reset, and the D12 refresh path (which drops sessionFile before
     * relaunching). Fresh-vs-resume is decided by the stale tracker: a seat at
     * a task boundary gets clean eyes (sessionFile dropped → no --resume); an
     * unexpectedly dead pane resumes where it was. */
    async respawn(reason) {
        const fresh = this.o.stale.isStale(this.o.seat);
        const cur = this.tty;
        if (cur && !cur.exited)
            await this.killAndAwaitExit(cur);
        if (fresh) {
            try {
                rmSync(sessionFile(this.o.projectRoot, this.o.seat));
            }
            catch {
                /* already fresh */
            }
            // WE dropped the file — disarm the external-drop lever, or a failed
            // first delivery into the fresh pane would read our own drop as yet
            // another fresh-eyes request and respawn on every retry.
            this.persistRef.persisted = false;
            this.session = undefined;
        }
        return this.spawnPty(reason);
    }
    /** Two doors, never two writers: the old PTY must be provably gone before
     * a new one opens on the same seat. */
    async killAndAwaitExit(t) {
        const sleep = this.o.sleep ?? realSleep;
        let un;
        const exited = new Promise((res) => {
            un = t.subscribe((ev) => {
                if (ev.exit)
                    res();
            });
            if (t.exited)
                res();
        });
        t.kill();
        const timeout = sleep(8000).then(() => "timeout");
        const r = await Promise.race([exited.then(() => "exited"), timeout]);
        un?.();
        if (r === "timeout" && !t.exited) {
            throw new Error(`the old ${this.o.seat} pane did not exit within 8s — refusing to open a second session on one seat`);
        }
    }
    async spawnPty(reason) {
        const pidFile = join(turnsDir(this.o.projectRoot, this.o.seat), "pty.json");
        if (existsSync(pidFile)) {
            const old = JSON.parse(readFileSync(pidFile, "utf8"));
            if (old.pid) {
                let alive = true;
                try {
                    process.kill(old.pid, 0);
                }
                catch (e) {
                    alive = e.code !== "ESRCH";
                }
                if (alive)
                    throw new Error(`Previous ${this.o.seat} process ${old.pid} is still alive; inspect it before restarting this seat`);
            }
        }
        reconcileBlendedRestart(this.o.projectRoot, this.o.seat, this.o.cli, this.o.home);
        const startTty = this.o.startTty ?? startSeatTty;
        const sleep = this.o.sleep ?? realSleep;
        let busyNoted = false;
        while (!this.ac.signal.aborted) {
            this.spawnMs = Date.now();
            // Resume truth for orientation: startSeatTty resumes iff the persisted
            // sessionFile is present (ttySessionId) — a resumed session already
            // holds its binder in context; a fresh one needs the visible re-orient.
            const resuming = existsSync(sessionFile(this.o.projectRoot, this.o.seat));
            const r = await startTty({
                projectRoot: this.o.projectRoot,
                seat: this.o.seat,
                agent: this.o.agentArg,
                model: this.o.model,
                home: this.o.home,
                blended: true,
                resumeReason: reason, // CE-167: the banner names the cause of a relaunch
            });
            if (r.ok) {
                this.tty = r.tty;
                // A (re)spawned claude session FORKS a new id on --resume (the wheel
                // lesson) — discovery must re-run from this spawn, never trust the
                // pre-spawn cache. blendedTurn persists the fresh id after the first
                // verified delivery.
                if (!r.reattached) {
                    this.session = undefined;
                    this.lastSpawnResumed = resuming;
                }
                if (this.o.cli === "claude" && !r.reattached) {
                    // claude's folder-trust dialog blocks EVERY fresh spawn in this rig
                    // dir (the accepted flag never persists from inside the wall — live
                    // proof 2026-08-12), and with fresh-per-task workers that is every
                    // task. Answer it before deliveries; a trusted dir just times the
                    // window out overlapping the settle wait.
                    const answered = await claudeTrustHandshake(() => this.tty?.replay().toString("utf8") ?? "", r.tty, {
                        timeoutMs: 4000,
                        sleep,
                    });
                    if (answered)
                        this.stamp(`claude folder-trust dialog answered (fresh spawn in this rig dir)`);
                }
                if (this.o.cli === "codex" && !r.reattached) {
                    // codex puts one or more modals in front of the composer on a fresh
                    // spawn — directory trust, and an "Update available" prompt on its own
                    // schedule (CE-155: the same seat showed a different one on each of two
                    // consecutive boots). Sweep them all; a pending modal eats the first
                    // delivery's CR. A clean boot answers nothing and just costs the window.
                    const answered = await codexBootModals(() => this.tty?.replay().toString("utf8") ?? "", r.tty, {
                        timeoutMs: 8000,
                        sleep,
                    });
                    if (answered > 0)
                        this.stamp(`codex boot modals answered: ${answered} (fresh spawn in this rig dir)`);
                }
                this.stamp(`blended pane ${r.reattached ? "reattached" : "opened"} — ${reason}`);
                return r.tty;
            }
            if ("busy" in r && r.busy) {
                // The transition window: a headless turn is still mid-flight on a
                // just-flagged seat. Wait it out — mail queues losslessly meanwhile.
                if (!busyNoted) {
                    busyNoted = true;
                    this.stamp(`pane held busy — a headless turn is mid-flight; the blended pane opens when it lands`);
                }
                await sleep(this.o.busyPollMs ?? 2000);
                continue;
            }
            throw new Error("error" in r ? r.error : "the PTY spawn was refused");
        }
        throw new Error("blended seat stopped");
    }
    /** Every session file this spawn COULD be (all-seats coherence: seats
     * share one cwd, so the dir holds several seats' sessions — a candidate
     * list, never a pick-and-trust). */
    candidates() {
        return findBlendSessionCandidates(this.o.cli, {
            projectRoot: this.o.projectRoot,
            home: this.o.home,
            sinceMs: this.spawnMs - 2000,
        });
    }
    /** The pinned session when proven, else the newest candidate (best-effort
     * for responding/gauges; the sessionFile persist only ever uses PINNED
     * truth — blendedTurn calls onVerified → pinByMarker first). */
    locateSession() {
        if (this.session && existsSync(this.session.path))
            return this.session;
        return this.candidates()[0];
    }
    /** Delivery-verification text: the pinned file alone once proven; before
     * that, EVERY candidate concatenated — the marker can only ever land in
     * our own session, so verification over the union is exact while the
     * other seats' files are mere inert noise. */
    readSession() {
        if (this.session && existsSync(this.session.path)) {
            try {
                return readFileSync(this.session.path, "utf8");
            }
            catch {
                return undefined;
            }
        }
        const texts = [];
        for (const c of this.candidates()) {
            try {
                texts.push(readFileSync(c.path, "utf8"));
            }
            catch {
                /* raced a rotation */
            }
        }
        return texts.length ? texts.join("\n") : undefined;
    }
    /** Self-verifying discovery: the delivery marker names OUR file — pin it.
     * Called by blendedTurn after on-disk verification, before the
     * sessionFile persist (so gauges/crash-resume only ever see proven ids). */
    pinByMarker(deliveryId) {
        if (this.session && existsSync(this.session.path))
            return;
        for (const c of this.candidates()) {
            try {
                if (verifyDelivered(readFileSync(c.path, "utf8"), `#${deliveryId}`, this.o.cli)) {
                    this.session = c;
                    return;
                }
            }
            catch {
                /* raced */
            }
        }
    }
    /** Fresh session (unpinned, not a resume) = first delivery carries the
     * visible re-orientation; pinned or resumed = already oriented. */
    needsOrientation() {
        return !this.session && !this.lastSpawnResumed;
    }
}
const crews = new Map();
/** Durable per-seat reset generations. The event ledger is checked at delivery
 * time, so CLOSE followed immediately by an engine restart cannot lose intent.
 * Persistence overrides are read fresh; the orchestrator keeps its context. */
export function blendCrewFor(projectRoot) {
    let crew = crews.get(projectRoot);
    if (!crew) {
        // Read the durable task boundary at delivery time, including after a
        // process restart. A watcher starting at EOF cannot provide that guarantee.
        crew = { stale: createStaleTracker(projectRoot, seat => {
                const conf = parseRigConf(readFileSync(join(projectRoot, ".agents/rig.conf"), "utf8"));
                return seatsToReset([...SEATS], conf).includes(seat);
            }) };
        crews.set(projectRoot, crew);
    }
    return crew;
}
/** Test seam: drop the in-memory crew cache; durable generations remain. */
export function resetBlendCrews() {
    crews.clear();
}
/**
 * The real starter teamproc uses for a flagged, eligible seat: staffing through
 * the CANONICAL chain (rig.conf → ~/.crate/defaults.yaml → loadout floor), the
 * project's shared stale tracker, the standing loop fired.
 *
 * CE-141: this read rig.conf alone and fell back to bare pi, so a freshly
 * attached rig ran pi on the account default while every display showed the
 * user's configured seat. resolveSeatStaffing is the one door now.
 */
export function defaultBlendStarter(home) {
    return (seat, projectRoot) => {
        const conf = parseRigConf(readFileSync(join(projectRoot, ".agents", "rig.conf"), "utf8"));
        const staffed = resolveSeatStaffing(projectRoot, seat, home, conf);
        const agentArg = staffed.agent;
        const el = blendEligible(agentArg);
        if (!el.ok)
            throw new Error(el.reason); // teamproc checks first — belt + braces
        const bs = new BlendedSeat({
            projectRoot,
            seat,
            agentArg,
            cli: el.cli,
            model: staffed.model,
            home,
            stale: blendCrewFor(projectRoot).stale,
            // The SAME rig.conf knob the headless runner honors (cli.ts) — in
            // blended form the ceiling-triggered session drop becomes a visible
            // fresh respawn at the next delivery.
            contextAutoRefresh: ["1", "true", "yes", "on"].includes((conf.CONTEXT_AUTO_REFRESH || "").toLowerCase()),
        });
        bs.start();
        return bs;
    };
}
//# sourceMappingURL=blendseat.js.map