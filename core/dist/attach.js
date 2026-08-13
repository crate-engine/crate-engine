// P4-2/3/4: attach/create — install.sh's logic rebuilt in TypeScript,
// macOS-native by construction (no sed, no GNU-isms; vision §4.4).
// Split for the disclosing flow: planAttach() says EXACTLY what would be
// written (the disclosure screen renders this), executeAttach() performs it.
// The disclosure can never lie: tests assert plan == the actual file delta.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, symlinkSync, unlinkSync, writeFileSync, } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
export class AttachError extends Error {
}
/**
 * Resolve the target argument: "." / a path (abs, rel, ~/) → that directory;
 * a bare NAME → $PROJECTS_ROOT/<name> (default ~/Projects — local-first).
 */
export function resolveTarget(arg, opts = {}) {
    const cwd = opts.cwd ?? process.cwd();
    const home = opts.home ?? homedir();
    // Gate-day run #3: an EMPTY box quietly resolved to ~/Projects itself and
    // the team attached to the wrong folder. Empty input is a refusal, not a
    // default (an omitted CLI arg still means "here", deliberately).
    if (arg !== undefined && arg.trim() === "") {
        throw new Error("type a project folder — a path like ~/Projects/my-app, or a name to create under ~/Projects");
    }
    const raw = arg ?? ".";
    let projectRoot;
    if (raw === "." || raw === ".." || isAbsolute(raw) || raw.startsWith("./") || raw.startsWith("../") || raw.startsWith("~/") || raw.includes("/")) {
        const expanded = raw.startsWith("~/") ? join(home, raw.slice(2)) : raw;
        projectRoot = resolve(cwd, expanded);
    }
    else {
        const root = opts.projectsRoot ?? process.env.PROJECTS_ROOT ?? join(home, "Projects");
        projectRoot = join(root, raw);
    }
    return { projectRoot, project: basename(projectRoot), exists: existsSync(projectRoot) };
}
/**
 * List the sub-FOLDERS of a path for the attach screen's picker. Jailed to
 * the user's home (the app browses projects, not the system); hidden folders
 * are skipped; a missing/blank path falls back to home.
 */
export function listDirs(rawPath, opts = {}) {
    const home = opts.home ?? homedir();
    const expanded = rawPath && rawPath.trim() !== "" ? (rawPath.startsWith("~/") ? join(home, rawPath.slice(2)) : rawPath) : home;
    const candidate = resolve(expanded);
    const realHome = realpathSync(home);
    const real = existsSync(candidate) ? realpathSync(candidate) : realHome;
    if (real !== realHome && !real.startsWith(realHome + sep)) {
        throw new AttachError("the folder browser stays inside your home folder");
    }
    const dirs = readdirSync(real, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => ({ name: d.name, isRepo: existsSync(join(real, d.name, ".git")) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return { path: real, ...(real === realHome ? {} : { parent: dirname(real) }), dirs };
}
/**
 * Create ONE new folder inside a picker path (run #6 finding: making a folder
 * shouldn't require leaving the app for Finder). Same home jail as listDirs;
 * the name must be a single plain component; an existing folder refuses.
 * Returns the created folder's listing so the picker can step into it.
 */
export function makeDir(rawParent, name, opts = {}) {
    const parent = listDirs(rawParent, opts).path; // resolves + enforces the jail
    const clean = name.trim();
    if (clean === "" || clean === "." || clean === ".." || clean.includes("/") || clean.startsWith(".")) {
        throw new AttachError("give the new folder a plain name (no slashes; not hidden)");
    }
    const target = join(parent, clean);
    if (existsSync(target))
        throw new AttachError(`"${clean}" already exists here — pick it in the list instead`);
    mkdirSync(target);
    return listDirs(target, opts);
}
const LINK_PARTS = ["bin", "config", "adapters"];
const DOC_SEEDS = ["AGENTS.md", "PROGRESS.md", "ISSUES.md"];
const GI_BEGIN = "# >>> crate-engine managed (symlinks + live state) - do not edit between markers >>>";
const GI_END = "# <<< crate-engine managed <<<";
const GI_BLOCK = `${GI_BEGIN}
# Symlinks into the machine-local engine clone - committing them hardcodes one
# machine's layout, and a \`git restore\` could silently revert a link.
/bin
/config
/adapters
# Per-rig staffing sheet - machine/env config (hosts, paths, flags), like .env.
/rig.conf
# The local origin mirror (projects with no GitHub remote) - a bare repo the
# build gate diffs against; machine-local plumbing, never content.
/mirror.git
# Per-session live state is scratch - keep the durable FLAWS.md, drop the churn.
/state/*.md
!/state/FLAWS.md
/state/events.log
/state/checkpoints/CHECKPOINT-latest.md
/state/checkpoints/archive/*
${GI_END}
`;
/**
 * The dev port for the rig.conf seed — read from the project's own scripts
 * instead of a blind 3000 (the P7-T1 find: a :5188 static site got a :3000
 * DEV_URL, so QA/preview would aim at a dead port). Explicit port flags win;
 * then well-known tool defaults; else 3000. Best-effort — a wrong guess is
 * still a one-line rig.conf edit, and doctor/dev-server report the drift.
 */
export function detectDevPort(projectRoot) {
    try {
        const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
        const dev = pkg.scripts?.dev ?? pkg.scripts?.start ?? "";
        const explicit = dev.match(/(?:--port|-p|-l)[ =](\d{2,5})/) ??
            dev.match(/http\.server (\d{2,5})/) ??
            dev.match(/\bPORT=(\d{2,5})/);
        if (explicit)
            return Number(explicit[1]);
        if (/\bastro\b/.test(dev))
            return 4321;
        if (/\bvite\b/.test(dev))
            return 5173;
    }
    catch {
        /* no/unparseable package.json → the default */
    }
    return 3000;
}
// The 2.0 rig.conf — LOCAL default shape (the v1 "Superman-shaped" FLAWS fix):
// fully-local values by default; the remote block is commented power-user extra.
// Staffing lives at the user tier; per-project lines here only OVERRIDE it.
const RIG_CONF_LOCAL = `# rig.conf — per-project Crate Engine settings (written by crate2 attach).
# LOCAL is the default shape: team and repo on this machine. Staffing DEFAULTS
# live at ~/.crate/defaults.yaml (set once, used everywhere); uncomment a
# staffing line here only to OVERRIDE for this project (most specific wins).

PROJECT="{{PROJECT}}"
PROJECT_PATH="{{PROJECT_PATH}}"
CTXMAX="1000000"

# --- Seat display names (the app's Team view + seat labels) ------------------
ORCH_TITLE="Orchestrator"
CODER_TITLE="Coder"
REVIEWER_TITLE="Reviewer"
DESIGNER_TITLE="Designer"
TESTER_TITLE="QA"

# --- Per-project staffing OVERRIDES (defaults: ~/.crate/defaults.yaml) -------
# <STATION>_AGENT / <STATION>_MODEL; an EMPTY model means "let /login pick".
# ORCH_AGENT="pi";      ORCH_MODEL="openai-codex/gpt-5.5"
# CODER_AGENT="claude"; CODER_MODEL="opus"
# REVIEWER_AGENT="pi";  REVIEWER_MODEL=""
# DESIGNER_AGENT="pi";  DESIGNER_MODEL=""
# TESTER_AGENT="pi";    TESTER_MODEL=""

# --- Local host (the default) ------------------------------------------------
SUPERMAN_HOST="local"
SUPERMAN_IP="127.0.0.1"
DEV_URL="http://localhost:{{DEV_PORT}}"
# DEV_CMD='npm run dev'   # dev-server serve command override (default: next binary, else the
                          # project's dev script). May reference \$DEV_PORT/\$DEV_BIND —
                          # keep the value SINGLE-quoted so they expand at run time.

# --- Preview transport (docs/design/preview-tunnel.md) ------------------------
PREVIEW_PROVIDER="none"   # none | tailscale | custom
PREVIEW_URL=""
PREVIEW_DEV_PORT=""
PREVIEW_HTTPS_PORT=""
PREVIEW_DB_URL=""

# --- Concurrent loops (P7-T6) --------------------------------------------------
# CONCURRENT_LOOPS="1" makes the state machine PER-TASK (task = git branch):
# task B can build while task A holds at your merge gate. MAX_CONCURRENT_LOOPS
# caps live tasks (default 2). OFF by default: one loop at a time, as always.
CONCURRENT_LOOPS="0"
# MAX_CONCURRENT_LOOPS="2"

# --- Team monitor --------------------------------------------------------------
# AUTO_REVIVE="1" lets the app's health monitor relaunch DEAD seats automatically
# (doubling backoff, hard ceiling 3 per episode, honest "stopping" note). OFF by
# default: the Relaunch button is the only revive path unless you opt in.
AUTO_REVIVE="0"

# --- Build/verify gate (bin/nm-gate + precheck.sh) ----------------------------
NMGATE_ENFORCE="0"        # 1 = agentctl refuses code_ready with no SHA-tied gate_pass
NMGATE_BUILD_FATAL="1"
NMGATE_LINT_DELTA="0"

# --- Review/QA JOIN physics (2026-07-24) ---------------------------------------
# Verifiers RECORD verdicts (agentctl emit verdict); orchestrator-only ownership
# of approved/changes_needed is ALWAYS enforced. JOIN_ENFORCE=1 additionally
# refuses the join until BOTH verdicts are on record (advisory warning when 0).
JOIN_ENFORCE="0"

# --- Workflow tiering (2026-07-25; PDR dev/pdr/workflow-tiering.md) ------------
# The orchestrator may declare tier=chore|bug|feature on start_impl (omitted =
# full loop). Chores skip the review/QA fan-out (the wall + your merge gate
# verify); escalation floors force mis-guesses UP. Tune in AGENTS.md "## Tier
# Floors". No flag — tiering activates when the orchestrator declares.

# --- Runtime smoke rung (in the gate; PDR dev/pdr/runtime-smoke-rung.md) -------
# Boots the built worktree ephemerally, drives AGENTS.md Critical-Path routes
# GET-only (404/5xx/redirect-loop/console errors; 401/403 = auth-gated skip).
SMOKE_ENFORCE="0"         # 1 = a smoke FAIL fails the gate (rung crashes stay advisory)
SMOKE_READY_SECS="60"     # server ready-deadline before an honest advisory skip
# SMOKE_ALLOWLIST=""      # extra console-noise substrings (favicon.ico always allowed)
# GATE_START_CMD='npm run preview -- --port \$GATE_PORT --strictPort'
                          # prod-serve override (SINGLE-quoted; default: detected by shape)

# --- Branding (build-preview card; neutral defaults) --------------------------
BRAND_NAME="Dev Preview"
BRAND_ACCENT="#3b82f6"
BRAND_BG="#0d1117"
BRAND_FG="#ffffff"

# --- Remote host (POWER USER — not the MVP shape; normally leave commented) ---
# SUPERMAN_HOST="user@192.168.x.x"
# SUPERMAN_IP="192.168.x.x"
# PROJECTS_ROOT="/mnt/data/projects"
# HERMES_BIN="/home/user/.local/bin/hermes"
`;
function linkState(agentsDir, part, engineDir) {
    const link = join(agentsDir, part);
    let st;
    try {
        st = lstatSync(link);
    }
    catch {
        return "create";
    }
    if (!st.isSymbolicLink()) {
        throw new AttachError(`${link} exists and is NOT a symlink — migrate or remove it first ` +
            `(refusing to clobber real files; the engine links live here).`);
    }
    const target = readlinkSync(link);
    if (target === join(engineDir, part) && existsSync(link))
        return "keep";
    return "heal"; // points elsewhere or dangles (moved brain) → re-point
}
/**
 * Plan an attach/create against a target. Throws AttachError (plainly) on the
 * junk-path cases; never writes anything.
 */
export function planAttach(target, engineDir, opts = {}) {
    if (!existsSync(engineDir) || !existsSync(join(engineDir, "templates"))) {
        throw new AttachError(`no engine at ${engineDir} — run: crate2 setup (the brain clone must exist before attaching)`);
    }
    const { projectRoot, project } = target;
    const mode = opts.create ? "create" : "attach";
    if (!target.exists && !opts.create) {
        throw new AttachError(`${projectRoot} does not exist. To attach, point at an existing folder; ` +
            `to start a NEW project there, re-run with --create.`);
    }
    if (target.exists) {
        if (!statSync(projectRoot).isDirectory()) {
            throw new AttachError(`${projectRoot} is a file, not a directory — the team attaches to a project folder.`);
        }
        try {
            readdirSync(projectRoot);
        }
        catch {
            throw new AttachError(`${projectRoot} is not readable (permissions) — fix access and re-run.`);
        }
    }
    const agentsDir = join(projectRoot, ".agents");
    const writes = [];
    if (!existsSync(agentsDir)) {
        writes.push({
            rel: ".agents/",
            kind: "local",
            action: "create",
            note: "the team's local wiring folder (everything below lives in it)",
        });
    }
    for (const part of LINK_PARTS) {
        const action = target.exists && existsSync(agentsDir) ? linkState(agentsDir, part, engineDir) : "create";
        writes.push({
            rel: `.agents/${part}`,
            kind: "local",
            action,
            note: action === "heal"
                ? `re-pointed at the engine (${engineDir})`
                : `symlink → the engine (${engineDir}) — the team's shared brain`,
        });
    }
    writes.push({
        rel: ".agents/.gitignore",
        kind: "local",
        action: "create", // managed block is always (re)written — self-healing
        note: "managed ignore block: the wiring above never gets committed",
    });
    const stateExists = existsSync(join(agentsDir, "state"));
    writes.push({
        rel: ".agents/state/",
        kind: "local",
        action: stateExists ? "keep" : "create",
        note: stateExists ? "your live state — never overwritten" : "fresh team state (incl. FLAWS.md)",
    });
    for (const doc of DOC_SEEDS) {
        const docExists = existsSync(join(projectRoot, doc));
        writes.push({
            rel: doc,
            kind: "committed",
            action: docExists ? "keep" : "create",
            note: docExists ? "already yours — kept as-is" : "working doc the team reads (fill me in)",
        });
    }
    const confExists = existsSync(join(agentsDir, "rig.conf"));
    writes.push({
        rel: ".agents/rig.conf",
        kind: "local",
        action: confExists ? "keep" : "create",
        note: confExists ? "already configured — kept as-is" : "per-project settings (local shape)",
    });
    const isGit = existsSync(join(projectRoot, ".git"));
    // PHASE-B #3: local-only is FIRST-CLASS. A repo with no remote gets a local
    // origin mirror (bare, inside .agents, auto-gitignored) so the nm-gate delta
    // (origin/main) and branch resolution work with no GitHub at all — the
    // testuser8 rig's [engine] flaw. Disclosed like every other write. Attach-
    // mode repos that decline git-init are covered by nm-gate's local fallback.
    const hasOrigin = isGit &&
        (() => {
            try {
                execFileSync("git", ["remote", "get-url", "origin"], { cwd: projectRoot, stdio: "pipe" });
                return true;
            }
            catch {
                return false;
            }
        })();
    if (mode === "create" || (isGit && !hasOrigin)) {
        const mirrorExists = existsSync(join(agentsDir, "mirror.git"));
        writes.push({
            rel: ".agents/mirror.git",
            kind: "local",
            action: mirrorExists ? "keep" : "create",
            note: mirrorExists ? "already mirrored — kept as-is" : "local origin mirror — the build gate works with no GitHub remote",
        });
    }
    return {
        projectRoot,
        project,
        engineDir,
        mode,
        createsProjectDir: !target.exists,
        needsGit: !isGit,
        writes,
    };
}
function seedTree(srcDir, destDir, subst) {
    mkdirSync(destDir, { recursive: true });
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
        const src = join(srcDir, entry.name);
        const dest = join(destDir, entry.name);
        if (entry.isDirectory())
            seedTree(src, dest, subst);
        else if (entry.name.endsWith(".md") || entry.name.endsWith(".yaml")) {
            writeFileSync(dest, subst(readFileSync(src, "utf8")));
        }
        else
            copyFileSync(src, dest);
    }
}
/** Rewrite the managed .gitignore block: strip any old block, append the fresh one. */
export function writeManagedGitignore(file) {
    let outside = "";
    if (existsSync(file)) {
        const lines = readFileSync(file, "utf8").split("\n");
        let skip = false;
        const kept = [];
        for (const line of lines) {
            if (line === GI_BEGIN) {
                skip = true;
                continue;
            }
            if (line === GI_END) {
                skip = false;
                continue;
            }
            if (!skip)
                kept.push(line);
        }
        outside = kept.join("\n");
        if (outside !== "" && !outside.endsWith("\n"))
            outside += "\n";
        if (outside === "\n")
            outside = "";
    }
    writeFileSync(file, outside + GI_BLOCK);
}
export function executeAttach(plan, opts = {}) {
    const { projectRoot, project, engineDir } = plan;
    const changed = [];
    const subst = (s) => s.replaceAll("{{PROJECT}}", project).replaceAll("{{PROJECT_PATH}}", projectRoot);
    if (plan.createsProjectDir)
        mkdirSync(projectRoot, { recursive: true });
    let gitInitialized = false;
    if (plan.needsGit && (plan.mode === "create" || opts.gitInit)) {
        execFileSync("git", ["init", "--quiet"], { cwd: projectRoot });
        gitInitialized = true;
    }
    const agentsDir = join(projectRoot, ".agents");
    mkdirSync(agentsDir, { recursive: true });
    for (const w of plan.writes) {
        if (w.action === "keep")
            continue;
        const abs = join(projectRoot, w.rel.replace(/\/$/, ""));
        if (w.rel.startsWith(".agents/") && LINK_PARTS.includes(basename(abs)) && !w.rel.includes("state")) {
            try {
                if (lstatSync(abs).isSymbolicLink())
                    unlinkSync(abs);
            }
            catch {
                /* absent */
            }
            symlinkSync(join(engineDir, basename(abs)), abs);
        }
        else if (w.rel === ".agents/.gitignore") {
            writeManagedGitignore(abs);
        }
        else if (w.rel === ".agents/state/") {
            seedTree(join(engineDir, "templates", "state"), join(agentsDir, "state"), subst);
        }
        else if (DOC_SEEDS.includes(w.rel)) {
            writeFileSync(abs, subst(readFileSync(join(engineDir, "templates", w.rel), "utf8")));
        }
        else if (w.rel === ".agents/rig.conf") {
            writeFileSync(abs, subst(RIG_CONF_LOCAL).replaceAll("{{DEV_PORT}}", String(detectDevPort(projectRoot))));
        }
        else if (w.rel === ".agents/mirror.git") {
            execFileSync("git", ["init", "--bare", "--quiet", join(agentsDir, "mirror.git")]);
        }
        changed.push(w.rel);
    }
    let firstCommit;
    if (plan.mode === "create") {
        execFileSync("git", ["add", "-A"], { cwd: projectRoot });
        const msg = "chore: attach the Crate Engine team";
        try {
            execFileSync("git", ["commit", "--quiet", "-m", msg], { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
        }
        catch {
            // no git identity configured on this account — fall back so create still works
            execFileSync("git", ["-c", "user.email=crate@local", "-c", "user.name=crate2", "commit", "--quiet", "-m", msg], {
                cwd: projectRoot,
            });
        }
        firstCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
    }
    else {
        // FLYWHEEL COMMIT (2026-07-25): attach-mode used to WRITE the working docs
        // but never commit them — "committed with your code" was a promise the code
        // didn't keep, and rigs carried accruals as untracked files forever. Commit
        // exactly the doc seeds this attach created (never a sweep); best-effort —
        // a repo mid-rebase or docless attach must not break attach itself.
        const docSeeds = changed.filter((rel) => DOC_SEEDS.includes(rel));
        if (docSeeds.length) {
            try {
                execFileSync("git", ["add", "--", ...docSeeds], { cwd: projectRoot, stdio: "pipe" });
                const msg = "docs: crate working docs (attach) — the team reads these; accruals land here";
                try {
                    execFileSync("git", ["commit", "--quiet", "-m", msg, "--", ...docSeeds], {
                        cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"],
                    });
                }
                catch {
                    execFileSync("git", ["-c", "user.email=crate@local", "-c", "user.name=crate2", "commit", "--quiet", "-m", msg, "--", ...docSeeds], { cwd: projectRoot, stdio: "pipe" });
                }
                firstCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
            }
            catch {
                /* not a git repo / nothing staged / repo mid-operation — attach still succeeds */
            }
        }
    }
    // PHASE-B #3: point origin at the local mirror and seed it. Runs after the
    // first commit so create-mode pushes something real; a repo with no commits
    // yet is fine — nm-gate re-syncs main into the mirror at every gate.
    let originMirror;
    if (changed.includes(".agents/mirror.git")) {
        const mirror = join(agentsDir, "mirror.git");
        try {
            execFileSync("git", ["remote", "add", "origin", mirror], { cwd: projectRoot, stdio: "pipe" });
        }
        catch {
            /* re-attach — origin already set */
        }
        try {
            execFileSync("git", ["push", "--quiet", "-u", "origin", "HEAD"], { cwd: projectRoot, stdio: "pipe" });
        }
        catch {
            /* unborn HEAD — the first gate-time sync covers it */
        }
        originMirror = mirror;
    }
    // FLAWS (Adam's gate-day run #1 request; pulled forward 2026-08-13): a
    // brand-new project gets offered OFF-BOX backup — an optional GitHub repo,
    // created and pushed in the same breath. gh-CLI only; strictly graceful:
    // no gh, not signed in, or a refused create must NEVER fail the attach.
    // The local mirror keeps `origin`; GitHub rides a separate `github` remote.
    let githubRepo;
    let githubNote;
    if (opts.githubRepo && plan.mode === "create") {
        const run = (cmd, args) => execFileSync(cmd, args, { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        try {
            run("gh", ["auth", "status"]);
        }
        catch (e) {
            const err = e;
            githubNote =
                err.code === "ENOENT"
                    ? "GitHub step skipped — the gh CLI isn't installed (brew install gh, then gh auth login)"
                    : "GitHub step skipped — gh isn't signed in (run: gh auth login)";
        }
        if (!githubNote) {
            try {
                run("gh", ["repo", "create", project, "--private", `--source=${projectRoot}`, "--remote=github", "--push"]);
                githubRepo = run("git", ["remote", "get-url", "github"]).trim();
            }
            catch (e) {
                const err = e;
                const detail = (err.stderr ?? err.message ?? "").toString().trim().split("\n")[0];
                githubNote = `GitHub repo not created — ${detail || "gh repo create failed"}; the project is fine, create it later with: gh repo create ${project} --private --source=. --remote=github --push`;
            }
        }
    }
    return { changed, gitInitialized, firstCommit, originMirror, githubRepo, githubNote };
}
/**
 * Flaw 1 (Adam's battle test, 2026-08-10): an attached repo can carry a
 * rig.conf from another life — its DEV_URL aimed at a server some OTHER rig
 * runs (live case: jdm-rush-crate inherited the LIVE site's dev server; the
 * doctor green-lit it and runtime QA would have tested the wrong code).
 * Attach heals: a non-loopback host, or a loopback port something else
 * already owns, is rewritten to a FREE loopback port — and says so.
 * Probe/picker injectable for tests.
 */
export async function healDevUrl(projectRoot, opts = {}) {
    const confFile = join(projectRoot, ".agents", "rig.conf");
    if (!existsSync(confFile))
        return undefined;
    const text = readFileSync(confFile, "utf8");
    const m = text.match(/^DEV_URL="([^"]+)"/m);
    if (!m)
        return undefined;
    let url;
    try {
        url = new URL(m[1]);
    }
    catch {
        return undefined; // unparseable = hand-crafted; never guess over the operator
    }
    const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
    const port = Number(url.port || "80");
    const net = await import("node:net");
    const probeBusy = opts.probeBusy ??
        ((p) => new Promise((res) => {
            const s = net.connect({ host: "127.0.0.1", port: p, timeout: 1500 });
            s.on("connect", () => { s.destroy(); res(true); });
            s.on("error", () => res(false));
            s.on("timeout", () => { s.destroy(); res(false); });
        }));
    const reason = !loopback
        ? `points off this machine (${url.hostname})`
        : (await probeBusy(port))
            ? `port ${port} is already owned by a running server that is not this rig's`
            : undefined;
    if (!reason)
        return undefined;
    let free = opts.scanFrom ?? 3100;
    while (await probeBusy(free))
        free += 1; // busy-scan: first quiet port wins
    const healed = `http://127.0.0.1:${free}`;
    writeFileSync(confFile, text.replace(/^DEV_URL="[^"]+"/m, `DEV_URL="${healed}"`));
    return `DEV_URL healed: ${m[1]} → ${healed} (${reason} — the team gets its own lane)`;
}
//# sourceMappingURL=attach.js.map