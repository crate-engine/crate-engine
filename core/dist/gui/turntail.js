// 2c LIVE seat readout — the tailer (grilled 2026-07-25, PDR
// dev/pdr/live-seat-readout.md). One hub per project watches every seat's
// turns dir (.agents/state/turns/<seat>/) and pushes policy-filtered stream
// events to subscribers the moment the runner appends a line. The runner-
// watcher doctrine applies verbatim: watch the DIRECTORY (never a file),
// ignore the callback args and re-scan, keep a poll floor alive underneath
// (a dead watcher degrades to polling, never crashes), and — because the
// runner appends line-by-line with no atomicity — read from a saved offset
// and emit only up to the last complete newline.
import { closeSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, watch } from "node:fs";
import { join } from "node:path";
import { SEATS } from "../manifest.js";
import { streamEvent, turnStartMs } from "./teamview.js";
function turnFiles(dir) {
    try {
        return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
    }
    catch {
        return [];
    }
}
function seamEvent(seat, file) {
    const ms = turnStartMs(file);
    return { seat, k: "seam", t: ms !== undefined ? new Date(ms).toISOString() : file.replace(".jsonl", "") };
}
export class TurnTailHub {
    projectRoot;
    pollMs;
    seats = new Map();
    watchers = [];
    listeners = new Set();
    timer;
    scanQueued = new Set();
    pokeQueued = false;
    constructor(projectRoot, pollMs = 1500) {
        this.projectRoot = projectRoot;
        this.pollMs = pollMs;
    }
    /** Subscribe a listener; the first subscriber starts the watchers, the
     * last one's unsubscribe stops them (no idle handles for closed pages). */
    subscribe(fn) {
        if (this.listeners.size === 0)
            this.start();
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
            if (this.listeners.size === 0)
                this.stop();
        };
    }
    /** The connect-time replay: the last `maxTurns` turns per seat as seam +
     * policy-filtered events, straight from the files (stateless — a client
     * REPLACES its feed with this, so reconnects can never duplicate). */
    backlog(maxTurns = 2, maxPerSeat = 150) {
        const out = [];
        for (const seat of SEATS) {
            const dir = join(this.projectRoot, ".agents", "state", "turns", seat);
            const files = turnFiles(dir).slice(-maxTurns);
            const seatEvents = [];
            for (const f of files) {
                seatEvents.push(seamEvent(seat, f));
                let text = "";
                try {
                    text = readFileSync(join(dir, f), "utf8");
                }
                catch {
                    continue;
                }
                for (const line of text.split("\n")) {
                    if (!line)
                        continue;
                    const ev = streamEvent(line);
                    if (ev)
                        seatEvents.push({ seat, ...ev });
                }
            }
            // keep the tail, but never orphan it from its turn's seam: if the cap
            // cut mid-turn, re-prepend the seam that governs the cut point
            const cut = Math.max(0, seatEvents.length - maxPerSeat);
            if (cut > 0 && seatEvents[cut]?.k !== "seam") {
                let seamIdx = -1;
                for (let i = 0; i < cut; i++)
                    if (seatEvents[i].k === "seam")
                        seamIdx = i;
                if (seamIdx >= 0)
                    out.push(seatEvents[seamIdx]);
            }
            out.push(...seatEvents.slice(cut));
        }
        return out;
    }
    start() {
        for (const seat of SEATS) {
            const dir = join(this.projectRoot, ".agents", "state", "turns", seat);
            try {
                mkdirSync(dir, { recursive: true });
            }
            catch {
                /* unwritable project — the poll floor will keep trying reads */
            }
            const files = turnFiles(dir);
            const newest = files[files.length - 1];
            const st = { dir, offset: 0, partial: "" };
            if (newest) {
                st.file = newest;
                // start at EOF: history is the backlog's job; the hub streams NEW lines
                try {
                    st.offset = fstatAt(join(dir, newest));
                }
                catch {
                    st.offset = 0;
                }
            }
            this.seats.set(seat, st);
            try {
                const w = watch(dir, () => this.queueScan(seat));
                w.on("error", () => {
                    /* watcher died — the poll floor carries the tail */
                });
                this.watchers.push(w);
            }
            catch {
                /* watch unavailable on this fs — pure polling still works */
            }
        }
        // ── STAGE 2 (quiet-cockpit PDR, Adam 2026-08-14): event-primary. The
        // hub also watches the project STATE the poll used to discover — seat
        // state files + events.log (gates) in state/, the chat mirror in
        // state/inbox/, and every seat's maildir (unread badges) — and emits a
        // coalesced `poke` (no payload: the client's refresh diffs; the poke
        // just says "now"). Same doctrine as the turn watchers: watch the
        // DIRECTORY, ignore args, fail to the poll floor (the client keeps a
        // 12s reconciliation poll — a dead watcher degrades to that, never
        // crashes). turns/ subdirs are excluded by non-recursion: turn lines
        // already stream as their own events.
        const stateDir = join(this.projectRoot, ".agents", "state");
        const stateTargets = [
            stateDir,
            join(stateDir, "inbox"),
            ...SEATS.map((s) => join(stateDir, "inbox", s, "new")),
        ];
        // mkdir EVERYTHING first, then watch: creating inbox dirs under an
        // already-armed state/ watcher would fire a spurious boot poke.
        for (const dir of stateTargets) {
            try {
                mkdirSync(dir, { recursive: true });
            }
            catch {
                /* unwritable — the poll floor covers it */
            }
        }
        for (const dir of stateTargets) {
            try {
                const w = watch(dir, () => this.queuePoke());
                w.on("error", () => {
                    /* watcher died — the client's reconciliation poll carries on */
                });
                this.watchers.push(w);
            }
            catch {
                /* watch unavailable on this fs — the poll floor covers it */
            }
        }
        this.timer = setInterval(() => {
            for (const seat of this.seats.keys())
                this.scan(seat);
        }, this.pollMs);
        this.timer.unref();
    }
    /** Coalesce state-watcher bursts into ONE poke (a close writes several
     * files; the client needs one refresh, not five). */
    queuePoke() {
        if (this.pokeQueued)
            return;
        this.pokeQueued = true;
        setTimeout(() => {
            this.pokeQueued = false;
            this.broadcast({ seat: "", k: "poke", t: new Date().toISOString() });
        }, 300).unref();
    }
    stop() {
        for (const w of this.watchers) {
            try {
                w.close();
            }
            catch {
                /* already closed */
            }
        }
        this.watchers = [];
        if (this.timer)
            clearInterval(this.timer);
        this.timer = undefined;
        this.seats.clear();
        this.scanQueued.clear();
    }
    /** Coalesce watcher bursts (the runner appends one line per fs event). */
    queueScan(seat) {
        if (this.scanQueued.has(seat))
            return;
        this.scanQueued.add(seat);
        setTimeout(() => {
            this.scanQueued.delete(seat);
            this.scan(seat);
        }, 25).unref();
    }
    scan(seat) {
        const st = this.seats.get(seat);
        if (!st || this.listeners.size === 0)
            return;
        const files = turnFiles(st.dir);
        const newest = files[files.length - 1];
        if (!newest)
            return;
        if (newest !== st.file) {
            // rollover: drain the old turn's remaining complete lines, then seam
            if (st.file)
                this.drain(seat, st);
            st.file = newest;
            st.offset = 0;
            st.partial = "";
            this.broadcast(seamEvent(seat, newest));
        }
        this.drain(seat, st);
    }
    drain(seat, st) {
        if (!st.file)
            return;
        const path = join(st.dir, st.file);
        let fd;
        try {
            fd = openSync(path, "r");
            const size = fstatSync(fd).size;
            if (size <= st.offset)
                return;
            const len = size - st.offset;
            const buf = Buffer.alloc(len);
            const read = readSync(fd, buf, 0, len, st.offset);
            st.offset += read;
            const text = st.partial + buf.toString("utf8", 0, read);
            const lines = text.split("\n");
            st.partial = lines.pop() ?? ""; // bytes past the last \n wait for the rest
            for (const line of lines) {
                if (!line)
                    continue;
                const ev = streamEvent(line);
                if (ev)
                    this.broadcast({ seat, ...ev });
            }
        }
        catch {
            /* file vanished mid-read (unlikely; turns are never moved) — next scan recovers */
        }
        finally {
            if (fd !== undefined)
                closeSync(fd);
        }
    }
    broadcast(ev) {
        for (const fn of this.listeners) {
            try {
                fn(ev);
            }
            catch {
                /* one bad listener must never break the others */
            }
        }
    }
}
function fstatAt(path) {
    const fd = openSync(path, "r");
    try {
        return fstatSync(fd).size;
    }
    finally {
        closeSync(fd);
    }
}
// ── the per-project hub registry (the GUI server serves one page per
// project; hubs are cheap — 5 dir watchers — and stop themselves when the
// last SSE client disconnects). ──
const hubs = new Map();
export function hubFor(projectRoot, pollMs) {
    let hub = hubs.get(projectRoot);
    if (!hub) {
        hub = new TurnTailHub(projectRoot, pollMs);
        hubs.set(projectRoot, hub);
    }
    return hub;
}
/** Test/shutdown hook: drop every hub (watchers close via refcount 0). */
export function resetHubs() {
    hubs.clear();
}
//# sourceMappingURL=turntail.js.map