// Backlog 2b (Adam, 2026-07-25; shipped 2026-08-14) — the rig telemetry
// mirror: one home-level, always-readable place to watch every rig live.
// The engine mirrors the rig's events.log + turns.log into
// ~/.crate/logs/<project>/ so observation never needs project-folder
// permissions (macOS TCC protects Desktop/Documents — the testuser8 battle
// test needed a sudo chmod just to watch events.log).
//
// Park-time laws, honored verbatim: append-only; ONE writer (the engine
// server process — it owns the project and outlives any cockpit view);
// never a second source of truth — the mirror is a LABELED COPY, the rig's
// file stays canonical. Watcher doctrine from the hub applies: watch the
// DIRECTORY, ignore callback args and re-scan from saved offsets, keep a
// poll floor underneath, and observation must never wound the engine — every
// failure is swallowed and the next tick retries.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, watch, writeFileSync, } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
/** The rig files worth watching from afar: the event ledger and the per-turn
 * summary lines. Gate-output tails were considered and skipped (park note:
 * "if cheap" — they are not: per-seat turn dirs would multiply watchers). */
const SOURCES = ["events.log", "turns.log"];
/** Mirror cap per file; one previous generation kept as <file>.1. */
const MIRROR_CAP = 10 * 1024 * 1024;
/** Where a project's mirror lands: ~/.crate/logs/<project-basename>/. */
export function mirrorDir(projectRoot, home = homedir()) {
    return join(home, ".crate", "logs", basename(projectRoot));
}
export function startTelemetryMirror(projectRoot, home = homedir()) {
    const stateDir = join(projectRoot, ".agents", "state");
    const outDir = mirrorDir(projectRoot, home);
    const offsetsFile = join(outDir, ".mirror-state.json");
    // Durable offsets: an engine restart must never re-append history it
    // already mirrored (append-only means duplicates would stand forever).
    let offsets = {};
    try {
        offsets = JSON.parse(readFileSync(offsetsFile, "utf8"));
    }
    catch {
        offsets = {};
    }
    let queued = false;
    let closed = false;
    const header = (src) => `# CRATE MIRROR — a COPY of ${join(stateDir, src)}\n` +
        `# The rig's file is canonical; this mirror exists for observation only.\n`;
    const sync = () => {
        if (closed)
            return;
        for (const src of SOURCES) {
            const srcPath = join(stateDir, src);
            let size;
            try {
                size = statSync(srcPath).size;
            }
            catch {
                continue; // the rig has not written this file yet
            }
            const dst = join(outDir, src);
            let off = offsets[src] ?? 0;
            try {
                mkdirSync(outDir, { recursive: true });
                if (!existsSync(dst))
                    writeFileSync(dst, header(src));
                if (size < off) {
                    // the rig rotated/distilled its file — say so, then re-mirror
                    appendFileSync(dst, "# source reset (rotation/distillation upstream) — re-mirroring from the start\n");
                    off = 0;
                }
                if (size > off) {
                    const fd = openSync(srcPath, "r");
                    try {
                        const buf = Buffer.alloc(size - off);
                        const n = readSync(fd, buf, 0, buf.length, off);
                        appendFileSync(dst, buf.subarray(0, n));
                        off += n;
                    }
                    finally {
                        closeSync(fd);
                    }
                }
                offsets[src] = off;
                if (statSync(dst).size > MIRROR_CAP) {
                    renameSync(dst, `${dst}.1`); // replaces the old .1 — one generation kept
                    writeFileSync(dst, header(src) + `# rotated at ${MIRROR_CAP} bytes — the previous generation is ${src}.1\n`);
                }
            }
            catch {
                /* observation never wounds the engine — the next tick retries */
            }
        }
        try {
            writeFileSync(offsetsFile, JSON.stringify(offsets));
        }
        catch {
            /* same law */
        }
    };
    // Coalesce watcher bursts (agentctl writes several lines per event).
    const queue = () => {
        if (queued || closed)
            return;
        queued = true;
        setTimeout(() => {
            queued = false;
            sync();
        }, 500).unref();
    };
    let watcher;
    try {
        mkdirSync(stateDir, { recursive: true });
    }
    catch {
        /* unwritable project — the poll floor still reads */
    }
    try {
        watcher = watch(stateDir, queue);
        watcher.on("error", () => {
            /* watcher died — the poll floor carries the mirror */
        });
        watcher.unref(); // the mirror must never keep the process alive on its own
    }
    catch {
        /* watch unavailable on this fs — pure polling still works */
    }
    const floor = setInterval(sync, 30_000);
    floor.unref();
    sync(); // catch up on whatever happened while the engine was down
    return {
        tick: sync,
        stop: () => {
            closed = true;
            try {
                watcher?.close();
            }
            catch {
                /* already closed */
            }
            clearInterval(floor);
        },
    };
}
//# sourceMappingURL=telemetry.js.map