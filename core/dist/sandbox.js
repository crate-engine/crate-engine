// P3-0: the Seatbelt profile generator — manifest policy + project path → a
// rendered .sb profile (P0-6 proven shape: allow-default + write-wall + named
// doors). This is the ONLY Seatbelt-aware module: everything else consumes a
// rendered profile path, so the backend stays swappable (P0-6 note 4).
// Profiles land in the launch runtime dir, never committed.
// PHASE-8 T6: the swap happened — the same SandboxSpec renders to a bubblewrap
// argv on Linux (renderBwrapArgs) behind one dispatcher (renderWallPlan).
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
export class SandboxError extends Error {
}
/** Expand one door entry to an absolute path. */
export function expandDoor(door, paths) {
    if (door === "~")
        return paths.home;
    if (door.startsWith("~/"))
        return join(paths.home, door.slice(2));
    if (isAbsolute(door))
        return door;
    return join(paths.projectRoot, door);
}
/** Escape a literal path for embedding inside a Seatbelt regex filter. */
export function regexEscapePath(p) {
    return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * Render one door entry as a Seatbelt filter line. Two forms:
 * - a path (`~/…`, absolute, or project-relative) → `(subpath "…")`
 * - `regex:<pattern>` → `(regex #"<pattern>")`, with `{{PROJECT}}`/`{{HOME}}`/
 *   `{{PARENT}}` tokens substituted as regex-ESCAPED literal paths — the
 *   narrow-door form for tools with genuinely variable-suffix paths. Prefer
 *   subpath doors; reach for regex only when the path truly varies AND the
 *   rig is macOS-only, because the bwrap backend cannot express a regex as a
 *   bind mount (it SKIPS + reports them). No shipped manifest uses one — the
 *   nm-gate worktrees moved to a fixed `../.nmgate-wt` subpath door (T7-0).
 *
 * Project-relative doors expand against the REAL projectRoot (both launchers
 * realpath it first — Seatbelt matches resolved paths, bwrap binds host
 * paths), so the shell side must derive matching paths physically too:
 * precheck.sh/nm-gate `pwd -P` their repo root so the `../.nmgate-wt` parent
 * is the same real-path sibling this expansion opens (nmgate-ro-mount).
 */
export function renderDoor(door, paths) {
    if (door.startsWith("regex:")) {
        const pattern = door
            .slice("regex:".length)
            .replaceAll("{{PROJECT}}", regexEscapePath(paths.projectRoot))
            .replaceAll("{{HOME}}", regexEscapePath(paths.home))
            .replaceAll("{{PARENT}}", regexEscapePath(dirname(paths.projectRoot)));
        return `  (regex #"${pattern}")`;
    }
    return `  (subpath "${expandDoor(door, paths)}")`;
}
/**
 * Harness-state write doors per agent (P3-8): the templates carry pi's
 * `~/.pi` door inline; other harnesses declare theirs here and the launcher
 * merges them into the seat's doors. Claude Code writes its session/config
 * state under `~/.claude` plus the root-level json (+ its backup).
 */
export function stateDoorsFor(agent) {
    if (agent === "claude-code")
        return ["~/.claude", "~/.claude.json", "~/.claude.json.backup"];
    if (agent === "codex")
        return ["~/.codex"]; // auth.json, config.toml, sessions, history
    return []; // pi: the templates already carry {{HOME}}/.pi
}
/**
 * CE-129 (battle test 2026-08-17): pre-seed Claude Code's folder-trust for the
 * attached project so a walled seat never blocks on the interactive dialog.
 *
 * WHY the dialog cannot save its own answer inside the wall — claude v2 writes
 * config as `~/.claude.json.tmp.<pid>.<hash>` then rename()s it over
 * `~/.claude.json` (strace-proven on Superman). The tmp name matches no door,
 * and a rename over a single-file bind mount is impossible on Linux regardless
 * — so every in-wall save silently fails, trust never persists, and each boot
 * re-asks. An unanswered prompt is a dead seat: deliveries queue durably but
 * nothing consumes them.
 *
 * WHY seeding is legitimate: `crate open`/attach is the operator deliberately
 * pointing a team at this repo — that IS the trust decision. The engine writes
 * the same key claude's own dialog writes, atomically, from OUTSIDE the wall.
 *
 * Never blocks a spawn: absent config (agent not signed in) or unparseable
 * JSON → false, untouched. Only ever ADDS `hasTrustDialogAccepted: true` for
 * this one project root.
 */
export function preseedClaudeProjectTrust(home, projectRoot) {
    const cfg = join(home, ".claude.json");
    try {
        const data = JSON.parse(readFileSync(cfg, "utf8"));
        if (typeof data !== "object" || data === null)
            return false;
        const projects = (data.projects ??= {});
        const entry = (projects[projectRoot] ??= {});
        if (entry.hasTrustDialogAccepted === true)
            return false;
        entry.hasTrustDialogAccepted = true;
        const tmp = `${cfg}.tmp-crate-${process.pid}`;
        writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
        renameSync(tmp, cfg);
        return true;
    }
    catch {
        return false; // no config / corrupt config — the seat spawns as before
    }
}
const DOORS_MARKER = /^.*\{\{DOORS\}\}.*$/m;
/**
 * Render a seat's profile text from the brain's template. Returns undefined
 * for `sandbox: none` (no wrap). Doors from the manifest expand at the
 * template's `{{DOORS}}` marker line; a doorless render strips the marker.
 */
export function renderProfile(spec, paths) {
    if (spec.sandbox === "none")
        return undefined;
    const tplFile = join(paths.brainRoot, "config", "sandbox", `${spec.sandbox}.sb.tpl`);
    let text;
    try {
        text = readFileSync(tplFile, "utf8");
    }
    catch {
        throw new SandboxError(`no sandbox template for policy "${spec.sandbox}" (looked for ${tplFile})`);
    }
    if (!DOORS_MARKER.test(text)) {
        throw new SandboxError(`${tplFile} has no {{DOORS}} marker — template and generator are out of sync`);
    }
    const doorBlock = spec.doors.length === 0
        ? ""
        : [
            `; extra write doors from the ${spec.seat} manifest (policy.sandbox_doors)`,
            "(allow file-write*",
            ...spec.doors.map((d) => renderDoor(d, paths)),
            ")",
        ].join("\n");
    return text
        .replace(DOORS_MARKER, doorBlock)
        .replaceAll("{{PROJECT}}", paths.projectRoot)
        .replaceAll("{{HOME}}", paths.home)
        .replace(/\n{3,}/g, "\n\n");
}
/**
 * Missing-door type heuristic (consulted ONLY for a door that does not yet
 * exist — an existing door is stat-known). A basename with an extension after
 * its leading dots is treated as a FILE (`.claude.json`), else a DIR
 * (`.claude`, `.npm`, `.nmgate-wt`). Boundary: an extensionless missing FILE
 * door (e.g. `~/.netrc`) would be misread as a dir, and a dotted missing DIR
 * door (e.g. `foo-2.0/`) as a file — no shipped door hits either, and both
 * outcomes are non-destructive + reported (a mis-made dir is an empty
 * user-owned dir; a mis-skipped file surfaces in absentDoors). Prefer an
 * existing door when a rig cares about the distinction.
 */
function looksLikeFile(p) {
    return basename(p).replace(/^\.+/, "").includes(".");
}
/**
 * Render a seat's wall as bwrap arguments. Returns undefined for sandbox:
 * none. The base UNSHARES the pid/ipc/uts/cgroup namespaces (net stays shared
 * for `network: true` seats) so a walled seat cannot see or signal the
 * supervisor / sibling seats, and the fresh `--proc` reflects only the
 * sandbox — matching Seatbelt's per-process isolation. Missing dir-doors are
 * materialized (a bind mount needs a real source — Seatbelt allowed
 * not-yet-existing paths, bwrap cannot); missing file-doors ride --bind-try
 * (absent → reported in absentDoors, never a hard launch failure).
 */
export function renderBwrapArgs(spec, paths) {
    if (spec.sandbox === "none")
        return undefined;
    const args = [
        "--ro-bind", "/", "/",
        "--dev", "/dev", // fresh minimal /dev: null/zero/tty/random — the template's tty/null allowance
        "--proc", "/proc", // fresh procfs; with --unshare-pid it lists only the sandbox
        // Isolate the sandbox from the host process table + SysV/POSIX IPC + host
        // names. NOT --unshare-net: network stays per-seat at the launcher layer
        // (network: true seats need loopback + the internet). Not a filesystem
        // control (the ro-bind base + userns already contain writes — verified
        // live: /proc/<pid>/root traversal is denied cross-userns), but it stops a
        // walled seat from SIGKILLing the supervisor or a peer seat mid-turn.
        "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--unshare-cgroup",
        "--bind-try", "/tmp", "/tmp", // runtime scratch (TMPDIR), the /private/tmp analog
        "--die-with-parent",
    ];
    const skippedDoors = [];
    const absentDoors = [];
    const bindWritable = (p) => {
        if (!existsSync(p)) {
            if (looksLikeFile(p)) {
                args.push("--bind-try", p, p); // absent optional file: bind if it appears, never fail
                absentDoors.push(p);
                return;
            }
            mkdirSync(p, { recursive: true }); // a bind source must exist; a dir-door we own
        }
        args.push("--bind", p, p);
    };
    // The harness's own state (the templates carry {{HOME}}/.pi inline).
    bindWritable(join(paths.home, ".pi"));
    // The policy zone: readonly opens ONLY the seat's state dir; standard the project.
    if (spec.sandbox === "readonly")
        bindWritable(join(paths.projectRoot, ".agents", "state"));
    else
        bindWritable(paths.projectRoot);
    for (const door of spec.doors) {
        if (door.startsWith("regex:")) {
            skippedDoors.push(door); // no bind-mount equivalent — reported, not silent
            continue;
        }
        bindWritable(expandDoor(door, paths));
    }
    return { args, skippedDoors, absentDoors };
}
/** First `bwrap` on PATH, or undefined (D7: availability is a fail-loud cli_dep). */
export function findBwrap(env = process.env) {
    for (const dir of (env.PATH ?? "").split(delimiter)) {
        if (!dir)
            continue;
        const p = join(dir, "bwrap");
        try {
            if (statSync(p).isFile())
                return p;
        }
        catch {
            /* keep looking */
        }
    }
    return undefined;
}
/**
 * The one platform dispatcher (D7): the same SandboxSpec becomes a Seatbelt
 * profile wrap on macOS and a bwrap wrap on Linux. Returns undefined for
 * sandbox: none; throws SandboxError when the platform has no wall backend
 * (a wall the policy declares but the host cannot render must fail LOUD).
 */
export function renderWallPlan(spec, paths, outDir, opts = {}) {
    if (spec.sandbox === "none")
        return undefined;
    const platform = opts.platform ?? process.platform;
    if (platform === "darwin") {
        const profile = writeProfile(spec, paths, outDir);
        return { backend: "seatbelt", argvPrefix: ["sandbox-exec", "-f", profile], skippedDoors: [], absentDoors: [] };
    }
    if (platform === "linux") {
        const bwrap = "bwrapBin" in opts ? opts.bwrapBin : findBwrap();
        if (!bwrap) {
            throw new SandboxError(`the ${spec.seat} seat's wall needs bubblewrap and it is not installed — install it: sudo apt install bubblewrap`);
        }
        const r = renderBwrapArgs(spec, paths);
        return { backend: "bwrap", argvPrefix: [bwrap, ...r.args], skippedDoors: r.skippedDoors, absentDoors: r.absentDoors };
    }
    throw new SandboxError(`no sandbox backend for platform "${platform}" — walls render on macOS (Seatbelt) and Linux (bubblewrap)`);
}
/** Narrow a full loadout to the generator's input. */
export function specFromLoadout(loadout) {
    return { seat: loadout.seat, sandbox: loadout.policy.sandbox, doors: loadout.policy.sandbox_doors };
}
/**
 * Render + write `<outDir>/<seat>.sb`; returns the profile path, or undefined
 * for `sandbox: none`.
 */
export function writeProfile(spec, paths, outDir) {
    const rendered = renderProfile(spec, paths);
    if (rendered === undefined)
        return undefined;
    const file = join(outDir, `${spec.seat}.sb`);
    writeFileSync(file, rendered);
    return file;
}
//# sourceMappingURL=sandbox.js.map