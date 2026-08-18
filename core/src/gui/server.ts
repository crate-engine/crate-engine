// P5-1/P5-2: the GUI server — the P0-7 proven shape, productized. Zero-dep
// Node HTTP on 127.0.0.1, random high port, per-launch token on EVERY request
// (403 otherwise). The API layer is a PASS-THROUGH: every endpoint calls the
// same core functions the CLI calls (the thin law) — no business logic here.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as netConnect } from "node:net";
import { stringify } from "yaml";
import { executeAttach, listDirs, makeDir, planAttach, resolveTarget, type AttachPlan } from "../attach.js";
import { agentLabel, agentProblem, agentStatus, binaryFor, whichBin } from "../detect.js";
import { heavyDeps, installHeavyDeps, runDoctor } from "../doctor.js";
import { isBlended } from "../blend.js";
import { autoReviveEnabled, makeAutoReviver, type Liveness, type ReviveNote } from "../health.js";
import { deriveBrainRoot, resolveSeatStaffing} from "../launcher.js";
import { loadLoadout, loadoutPath, SEATS, type Seat } from "../manifest.js";
import { discoverPiModels } from "../pidiscovery.js";
import { loadUserDefaults, orderCatalog, parseRigConf, resolveSeatDetailed, RIG_PREFIX, updateRigStaffing } from "../staffing.js";
import { appUrlPath, seedDefaultsIfAbsent, tierPaths, updateEngine } from "../usertier.js";
import { basename, dirname, join, resolve } from "node:path";

export interface GuiState {
  home: string;
  /** The project the health/boot screens operate on (set by attach, or --project). */
  project?: string;
  /** P7-T5 auto-revive notes (newest last; ring-capped) — shown on the health page. */
  reviveNotes?: ReviveNote[];
  /** T7-3: the dist cli.js this server runs from — used to spawn seat runners. */
  cliPath: string;
  /** Preview proxies (satellites + Launch in Chrome, 2026-08-13; PER
   * WORKSPACE since the lifecycle PDR — singletons followed the last-
   * attached project and lied to everyone else): target origins and proxy
   * ports keyed by project root, pointed by the tokened cockpit call. */
  previewTargets: Map<string, string>;
  previewProxyPorts: Map<string, number>;
  /** Pack 3 (stale-reattach): the engine sha THIS process loaded at boot.
   * /api/version reports it so a reattaching `crate open` can tell a stale
   * survivor from a fresh server — engineVersion()'s own sha is DISK truth
   * at request time, which on a stale server reports the NEW sha and hides
   * exactly the mismatch that matters (live-found 2026-08-12). */
  loadedSha?: string;
}

// ── the staffing catalog (P0-5 EVIDENCE + the ladder-proven verified defaults) ──
// verified = what passed that seat's battle-test ladder (P1–P3). Everything
// else is selectable but labeled "untested for this seat" by the page.
// The P6-6 direction change: the page only OFFERS entries whose agent is
// detected ready on this machine (installed + signed in) — the engine never
// installs or signs in agents.
const MODELS = [
  {
    agent: "pi",
    model: "openai-codex/gpt-5.5",
    display: "GPT-5.5 (Pi)",
    billing: "flat-rate (ChatGPT subscription via Pi)",
    verifiedFor: ["orchestrator", "reviewer", "designer", "tester"] as Seat[],
  },
  // ── 2026-08-10 (Adam, fresh-install battle test): the FULL first-party
  // Claude family, not just Opus — frontier-first (2026-08-11 grouping pass).
  // Same alias mechanism the proven opus entry uses (`claude --model <alias>`,
  // which always resolves to the ACCOUNT'S NEWEST of that family — that's why
  // these carry no version number and never go stale).
  {
    agent: "claude",
    model: "fable",
    display: "Claude Fable 5 (Claude Code) — Anthropic's top tier",
    billing: "flat-rate (Claude subscription that includes Fable — Anthropic's top model tier)",
    verifiedFor: [] as Seat[],
  },
  {
    agent: "claude",
    model: "opus",
    display: "Claude Opus (Claude Code) — always the newest Opus (Opus 5 today)",
    billing: "flat-rate (Claude subscription, first-party harness)",
    verifiedFor: ["coder"] as Seat[],
  },
  {
    agent: "claude",
    model: "sonnet",
    display: "Claude Sonnet (Claude Code)",
    billing: "flat-rate (Claude subscription, first-party harness)",
    verifiedFor: [] as Seat[],
  },
  {
    agent: "claude",
    model: "haiku",
    display: "Claude Haiku (Claude Code) — fastest, lightest",
    billing: "flat-rate (Claude subscription, first-party harness)",
    verifiedFor: [] as Seat[],
  },
  {
    agent: "codex",
    // Empty on purpose: codex uses the ACCOUNT'S default model. Passing a
    // recorded display id as -m 400s (live-proven 2026-07-12: "gpt-5.5-codex"
    // is rejected on ChatGPT accounts) — the default is the robust choice.
    model: "",
    display: "GPT Codex (Codex CLI, account-default model)",
    billing: "flat-rate (ChatGPT subscription, first-party Codex CLI) — runs inside the seat's crate wall (Codex's own approvals bypassed within it, same posture as Claude)",
    // Walled-coder live proof 2026-07-12: real codex inside the rendered
    // standard wall built the asked-for file; its own escape attempt was
    // blocked; TUI boot + enter-submit verified.
    verifiedFor: ["coder"] as Seat[],
  },
  {
    // PHASE-B #4: pi 0.80.6's new default model. Selectable everywhere but
    // verified nowhere yet — the page labels it "not yet battle-tested".
    agent: "pi",
    model: "openai-codex/gpt-5.6-sol",
    display: "GPT-5.6 Sol (Pi)",
    billing: "flat-rate (ChatGPT subscription via Pi)",
    verifiedFor: [] as Seat[],
  },
  {
    agent: "pi",
    model: "deepseek/deepseek-v4-pro",
    display: "DeepSeek V4-Pro (Pi)",
    billing: "provider-billed (API key via Pi)",
    verifiedFor: [] as Seat[],
  },
  // (Removed 2026-08-11, Adam's staffing law: Claude runs FIRST-PARTY ONLY —
  // the "Claude via Pi" metered path is gone from the catalog entirely; see
  // the discovery filter below for the same rule on detected models.)
  // ── 2026-07-14 seat expansion (agent-agnostic = OPTIONS): offered when the
  // CLI is detected installed + signed in; verified nowhere yet, so every seat
  // labels them "not yet battle-tested". Headless wires: turn.ts (flag surfaces
  // verified against the shipping CLIs; first live turn is the remaining
  // confirm). openclaw stays card-only until its run command is confirmed.
  // RETIRED 2026-08-18 (Adam's call, closing CE-033): opencode and aider were
  // WIRED on 2026-07-14 and never earned a live authed turn in the month since —
  // neither is even installed on either machine. The catalog's job is to offer
  // seats the engine can stand behind, and "not yet battle-tested" carried for a
  // month is not a label, it is a promise nobody intends to keep. The wires stay
  // in turn.ts/detect.ts so a hand-edited rig.conf still runs (fail-open: never
  // a dead seat), and adapters/{opencode,aider}/adapter.md keep the recipe back
  // in. Same reasoning that retired the gemini SLICE: stop carrying pending work
  // nobody is going to do.
  {
    agent: "agy",
    model: "",
    // CE-138's correction: `gemini` is a dead HARNESS, not a dead model family.
    // Antigravity CLI is Google's sanctioned replacement and the ONLY route to
    // Gemini models on a consumer Google AI subscription. It is also not
    // Gemini-only — it fronts Claude and GPT-OSS too, so the display must not
    // imply otherwise (a seat staffed agy + claude-opus-4-6-thinking runs Opus
    // billed to Google).
    display: "Antigravity CLI (Google — Gemini 3.x, Claude 4.6, GPT-OSS)",
    billing: "your Google AI subscription (OAuth sign-in) — no API key",
    verifiedFor: [] as Seat[],
  },
  {
    agent: "gemini",
    model: "",
    display: "Gemini CLI (Google, account-default model)",
    // CE-138: Google retired the CLI's free individual tier (2026-08) — the
    // old "free tier" line was false advertising; API key is the only path.
    billing: "GEMINI_API_KEY required (metered, Google AI pricing) — Google retired the CLI's free sign-in tier",
    verifiedFor: [] as Seat[],
  },
];

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/** The engine sha on DISK right now (~/.crate/engine HEAD; dev fallback =
 * this source tree). At server BOOT this is the loaded code's sha (the
 * process was just spawned from that disk); `crate open` calls it later to
 * know what a FRESH server would load. "unknown" on any failure. */
export function diskEngineSha(home: string): string {
  const { engineDir } = tierPaths(home);
  const dir = existsSync(join(engineDir, ".git")) ? engineDir : join(import.meta.dirname, "..", "..", "..");
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Pack 3 (stale-reattach): a reattaching `crate open` keeps the running
 * server ONLY when it provably runs the disk engine. Order matters:
 * an unjudgeable DISK (no git — tarball install) keeps the server (never
 * restart-thrash what we cannot compare), while a server that cannot name
 * its loaded sha (pre-Pack-3 survivor) restarts once onto code that can —
 * a restart costs seconds; a silent stale server broke the update promise
 * (live-found 2026-08-12). */
export function serverIsStale(loadedSha: string | undefined, diskSha: string): boolean {
  if (diskSha === "unknown") return false;
  if (!loadedSha || loadedSha === "unknown") return true;
  return loadedSha !== diskSha;
}

export function engineVersion(home: string): { version: string; updateAvailable: boolean } {
  const { engineDir } = tierPaths(home);
  const root = existsSync(join(engineDir, ".git")) ? engineDir : undefined;
  try {
    const dir = root ?? join(import.meta.dirname, "..", "..", "..");
    const version = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    let updateAvailable = false;
    if (root) {
      try {
        execFileSync("git", ["fetch", "--quiet", "origin"], { cwd: root, timeout: 4000 });
        const behind = execFileSync("git", ["rev-list", "--count", "HEAD..@{u}"], { cwd: root, encoding: "utf8" }).trim();
        updateAvailable = behind !== "0";
      } catch {
        /* offline / slow — best-effort */
      }
    }
    return { version, updateAvailable };
  } catch {
    return { version: "unknown", updateAvailable: false };
  }
}

/** The fresh server's argv for POST /api/restart (runner-deaths fix, FLAWS
 * 2026-08-11). --boot rides along IFF the team was running when restart was
 * pressed — so the relaunched cockpit comes back over a LIVE rig instead of
 * five booted:false seats, while a plain `crate gui` (no flag) never
 * auto-boots anything. Exported pure so the iff is unit-provable. */
export function restartArgv(state: Pick<GuiState, "cliPath" | "project">, urlFile: string): string[] {
  // Lifecycle PDR: the --boot flag is RETIRED — the fresh server resumes
  // every desired-running workspace from the RECORD (restart-resume), so a
  // restart needs no special memory of what was running; the record IS it.
  return [state.cliPath, "gui", "--url-file", urlFile, ...(state.project ? ["--project", state.project] : [])];
}

// Flaw 4 (Adam's battle test, 2026-08-10): a leftover ~/.claude.json from an
// OLD install carries real-looking markers, so the shallow check false-READYs
// a machine whose credential is gone. The staffing page now consults the DEEP
// check (`claude auth status`) too — ONCE per server boot, cached: the deep
// ask is a real CLI invocation, per-poll would be abusive, and a fresh boot
// (the moment sign-ins actually change) re-asks naturally.
// READY caches for the whole boot; a PROBLEM re-asks after 30s so the wizard's
// live "notices your sign-in by itself" behavior survives the cache.
let deepClaudeVerdict: { problem: ReturnType<typeof agentProblem>; at: number } | undefined;
function cachedDeepClaudeProblem(
  agent: string,
  home: string,
  pathOpt: { path?: string },
): ReturnType<typeof agentProblem> {
  if (agent !== "claude") return undefined;
  const now = Date.now();
  if (!deepClaudeVerdict || (deepClaudeVerdict.problem !== undefined && now - deepClaudeVerdict.at > 30_000)) {
    deepClaudeVerdict = { problem: agentProblem("claude", home, [], { ...pathOpt, deep: true }), at: now };
  }
  return deepClaudeVerdict.problem;
}

/** GET /api/staffing — seats with current resolution+provenance, + the catalog
 * with per-entry detection (ready = its agent is installed + signed in for that
 * entry's provider), + a per-agent summary for the page's honest note. */
function staffingCatalog(state: GuiState, detectPath?: string) {
  // Provenance needs a brain: prefer the current project's, else the user tier's clone.
  const brain =
    state.project !== undefined ? deriveBrainRoot(state.project) : tierPaths(state.home).engineDir;
  const confFile = state.project ? join(state.project, ".agents", "rig.conf") : undefined;
  const conf = confFile && existsSync(confFile) ? parseRigConf(readFileSync(confFile, "utf8")) : {};
  const userDefaults = loadUserDefaults(state.home);
  const titles: Record<Seat, string> = {
    orchestrator: "Orchestrator",
    coder: "Coder",
    reviewer: "Reviewer",
    designer: "Designer",
    tester: "QA",
  };
  const seats = SEATS.map((seat) => {
    const loadout = existsSync(loadoutPath(brain, seat)) ? loadLoadout(brain, seat) : undefined;
    const d = resolveSeatDetailed(seat, loadout, { rigConf: conf, userDefaults });
    return {
      seat,
      title: titles[seat],
      // S4: blend is the DEFAULT for an eligible agent; BLEND_<PREFIX>=0 is
      // the hand-edited per-seat opt-out.
      blended: isBlended(conf, seat, d.agent.value),
      current: {
        agent: d.agent.value,
        model: d.model.value,
        agentSource: d.agent.source,
        modelSource: d.model.source,
      },
    };
  });
  const pathOpt = detectPath !== undefined ? { path: detectPath } : {};
  const curated = MODELS.map((m) => {
    const problem = agentProblem(m.agent, state.home, [m.model], pathOpt) ?? cachedDeepClaudeProblem(m.agent, state.home, pathOpt);
    return { ...m, ready: problem === undefined, ...(problem ? { fix: problem.fix } : {}) };
  });
  // Pi model discovery (PDR pi-model-discovery, 2026-07-26): whatever Pi can
  // run TODAY (credentialed providers only) joins the catalog AFTER the
  // curated entries — never battle-tested, metered-honest, curated wins
  // collisions; half-configured providers show blocked with the fix.
  // Collision rule refined (Adam's V4-Pro report, 2026-08-11): curated wins
  // a collision only while it is READY — a curated entry blocked on its key
  // path must never eclipse a working discovered copy of the same model
  // (live case: curated DeepSeek V4-Pro checks auth.json, but the key lives
  // in models.json as a custom provider — the model vanished entirely).
  const discovered = discoverPiModels(state.home, {
    curated: curated.filter((m) => m.ready),
    piInstalled: whichBin("pi", pathOpt) !== undefined,
  }).filter(
    // Adam's staffing law (2026-08-11): Claude runs FIRST-PARTY ONLY — never
    // through Pi. The metered path duplicated every Claude model in the
    // picker, its OAuth rots (live case: an expired anthropic refresh token
    // killed EVERY pi startup on both machines), and first-party is flat-rate
    // for the same brains. Claude Code entries are the only Claude offered.
    (m) => !m.model.startsWith("anthropic/"),
  );
  // Company grouping (Adam, 2026-08-11): lab blocks, frontier-first — the
  // pickers render `company` as group headers in this exact order.
  const models = orderCatalog([...curated, ...discovered]);
  // one honest row per distinct agent: ready = at least one of its entries is
  // offerable; the fix line comes from its first blocked entry (most specific).
  const agents = [...new Set(MODELS.map((m) => m.agent))].map((agent) => {
    const bin = binaryFor(agent);
    const installed = bin === undefined || whichBin(bin, pathOpt) !== undefined;
    const entries = models.filter((m) => m.agent === agent);
    const ready = entries.some((m) => m.ready);
    const blocked = entries.find((m) => !m.ready);
    return {
      agent,
      label: agentLabel(agent),
      installed,
      ready,
      ...(!ready && blocked?.fix ? { fix: blocked.fix } : {}),
    };
  });
  return { seats, models, agents };
}

/** POST /api/defaults — write ~/.crate/defaults.yaml; validate; roll back on invalid. */
function writeDefaults(state: GuiState, seats: Record<string, { agent: string; model: string }>) {
  const { defaultsFile } = tierPaths(state.home);
  const previous = existsSync(defaultsFile) ? readFileSync(defaultsFile, "utf8") : undefined;
  const text =
    `# ~/.crate/defaults.yaml — your global staffing defaults (written by the Crate Engine app).\n` +
    `# Per-repo .agents/rig.conf overrides these; a loadout's default_model is the floor.\n` +
    stringify({ seats });
  writeFileSync(defaultsFile, text);
  try {
    loadUserDefaults(state.home); // the SAME validation the launcher applies
  } catch (e) {
    if (previous !== undefined) writeFileSync(defaultsFile, previous);
    throw new Error(`refused: ${e instanceof Error ? e.message : e}`);
  }
  return { file: defaultsFile };
}

export interface GuiServer {
  server: Server;
  port: number;
  token: string;
  url: string;
  state: GuiState;
  /** The focused workspace's preview-proxy port (back-compat single form). */
  previewProxyPort?: number;
  /** EVERY workspace's preview-proxy port — the &pv= handshake list, so the
   * remote tunnel forwards each workspace's previews (lifecycle PDR d.7). */
  previewProxyPorts: number[];
}

/** Pack 4: per-pane typed-line buffers for the pane-phrase honor (keyed
 * `project|seat`). Server-lifetime state, epsilon-sized (64-char cap each). */
const paneLineBuf = new Map<string, string>();

// The picker's browse roots beyond home: the parents of every registered
// workspace plus the attached project's parent — the engine already knows
// where rigs live; the picker should too (headless-era jail amendment).
export async function pickerRoots(state: Pick<GuiState, "home" | "project">): Promise<string[]> {
  const roots: string[] = [];
  try {
    const { listWorkspaces } = await import("./workspaces.js");
    for (const w of listWorkspaces(state.home)) {
      const p = dirname(w.path);
      if (!roots.includes(p)) roots.push(p);
    }
  } catch {
    /* no registry yet — home alone */
  }
  if (state.project) {
    const p = dirname(state.project);
    if (!roots.includes(p)) roots.push(p);
  }
  return roots;
}

// Design Studio liveness probe (backlog 10): is the slot's target answering?
// Cached briefly — two frames poll every ~4s and must never hammer the rig's
// dev server. ANY http answer counts as alive (an error page is still a
// running server); only a dead socket reads "down" on the glass.
const studioProbes = new Map<string, { at: number; ok: boolean }>(); // keyed by target — two workspaces' slots must not thrash one cache slot
function probePreviewTarget(target: string): Promise<boolean> {
  const hit = studioProbes.get(target);
  if (hit && Date.now() - hit.at < 2500) return Promise.resolve(hit.ok);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      studioProbes.set(target, { at: Date.now(), ok });
      resolve(ok);
    };
    try {
      const rq = httpRequest(target, { method: "HEAD", timeout: 1500 }, (r) => {
        r.resume();
        done(true);
      });
      rq.on("error", () => done(false));
      rq.on("timeout", () => {
        rq.destroy();
        done(false);
      });
      rq.end();
    } catch {
      done(false);
    }
  });
}

/** CE-014 P0 — DETACHED IS NOT CRASHED.
 *
 * One engine per host, so a viewer can ask about a workspace this engine is NOT
 * bound to. Its seats are genuinely not running, but the honest reason is "the
 * engine is serving a different workspace", not "your team died". The system
 * knew this all along (last-project, gui.log) and did not say it: on 2026-08-16
 * the cockpit rendered five empty "staff this seat" panes, visually identical to
 * a crash, and cost the operator a morning of misdiagnosis.
 *
 * Pure on purpose — the endpoint is a one-liner over this, and the WORDING is
 * the whole fix, so it is worth pinning directly. */
// (workspaceDetachment RETIRED — workspace lifecycle, PDR
// dev/pdr/workspace-lifecycle.md: one engine serves N workspaces, so "the
// engine is serving a different workspace" is no longer a state that exists.
// The CE-014 P0 lesson it carried — empty panes must never read as a crash —
// lives on in the Parked/Running record: a workspace with no live seats is
// PARKED by record (calm invitations), while started-then-died seats stay
// the downchip's distress. Nothing is ever "detached" by a neighbour.)

export async function startGuiServer(
  opts: {
    home?: string;
    project?: string;
    detectPath?: string;
    cliPath?: string;
    /** Test seam: replaces the real runner spawner (a boot in a hermetic
     * test must never spawn `node <test-file> runner …`). */
    seatSpawner?: import("./teamproc.js").SeatSpawner;
  } = {},
): Promise<GuiServer> {
  const home = opts.home ?? process.env.HOME ?? "";
  // Run #3: the installer clones the engine without `crate setup`, so a fresh
  // account had NO staffing defaults and every seat fell back to built-in pi.
  // The app seeds the battle-tested staffing on first start — detection-aware
  // since the P6-6 direction change (seats prefer agents that are READY here).
  seedDefaultsIfAbsent(home, opts.detectPath !== undefined ? { path: opts.detectPath } : {});
  // Run #13: a --project that was never attached (typo'd path) used to become
  // app state and wedge every screen with "has no .agents/bin". Validate it
  // here — an unattached path is REFUSED with a note, and the app falls back
  // to the persisted last project instead.
  let requested = opts.project;
  if (requested !== undefined && !existsSync(join(requested, ".agents", "bin"))) {
    console.error(
      `crate2 gui: --project ${requested} has no .agents/bin (not an attached project — typo?) — ` +
        `falling back to the last attached project. Attach it in the app if you meant a new one.`,
    );
    requested = undefined;
  }
  // Workspace lifecycle S1 (PDR workspace-lifecycle): the single global
  // last-project is RETIRED — fold it into the workspace record once
  // (desired=running: it was the auto-booted one), then read the view
  // default from the record's focus stamps.
  const { migrateLastProject, lastFocusedWorkspace } = await import("./workspaces.js");
  migrateLastProject(home);
  const state: GuiState = {
    home,
    // P6-5, lifecycle edition: a VALID --project wins; else the newest-
    // focused workspace (a VIEW default — it decides where a project-less
    // window lands, never what boots).
    project: requested ?? lastFocusedWorkspace(home),
    // T7-3: the dist cli.js this server runs from (spawns seat runners). The
    // caller passes it explicitly; fall back to this process's entry script.
    cliPath: opts.cliPath ?? process.argv[1] ?? "",
    // Pack 3: captured NOW, while disk == the code this process just loaded;
    // /api/version reports it forever after, however the disk moves on.
    loadedSha: diskEngineSha(home),
    previewTargets: new Map(),
    previewProxyPorts: new Map(),
  };
  const token = randomUUID();
  // The hub's own port — captured after listen(); routes (the fleet view's
  // local URLs) read it lazily, so the closure-before-listen order is safe.
  let hubPort = 0;

  // One preview-proxy listener PER WORKSPACE (lifecycle PDR decision 7) —
  // lazily creatable for workspaces registered after boot.
  const previewProxies = new Map<string, Server>();
  const ensureProxyFor = async (project: string): Promise<number> => {
    const got = state.previewProxyPorts.get(project);
    if (got !== undefined) return got;
    const proxy = createServer((req, res) => {
      const target = state.previewTargets.get(project);
      if (!target) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        return res.end("no preview pointed for this workspace — open one from its cockpit's Preview tab first");
      }
      let t: URL;
      try {
        t = new URL(target);
      } catch {
        res.writeHead(502, { "Content-Type": "text/plain" });
        return res.end("bad preview target");
      }
      const preq = httpRequest(
        { hostname: t.hostname, port: t.port || 80, path: req.url, method: req.method, headers: { ...req.headers, host: t.host } },
        (pres) => {
          res.writeHead(pres.statusCode ?? 502, pres.headers);
          pres.pipe(res);
        },
      );
      preq.on("error", () => {
        if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("preview target unreachable — is that dev server still up? Re-register or re-point the preview.");
      });
      req.pipe(preq);
    });
    proxy.on("upgrade", (req, socket, head) => {
      const target = state.previewTargets.get(project);
      if (!target) return socket.destroy();
      let t: URL;
      try {
        t = new URL(target);
      } catch {
        return socket.destroy();
      }
      const up = netConnect(Number(t.port || 80), t.hostname, () => {
        const headerLines = Object.entries({ ...req.headers, host: t.host })
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
          .join("\r\n");
        up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
        if (head && head.length > 0) up.write(head);
        socket.pipe(up);
        up.pipe(socket);
      });
      up.on("error", () => socket.destroy());
      socket.on("error", () => up.destroy());
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    proxy.unref();
    const a = proxy.address();
    const p = typeof a === "object" && a ? a.port : 0;
    previewProxies.set(project, proxy);
    state.previewProxyPorts.set(project, p);
    return p;
  };

  // One spawner truth for every boot/relaunch route (test-injectable).
  const { defaultSeatSpawner } = await import("./teamproc.js");
  const spawnerFor = (): import("./teamproc.js").SeatSpawner =>
    opts.seatSpawner ?? defaultSeatSpawner(state.cliPath, state.home);

  // Backlog 2b, PER WORKSPACE since the lifecycle PDR: one telemetry mirror
  // per running/attached workspace (the retarget-singleton followed the
  // last-attached project and went blind on the others). Mirrors are unref'd
  // and die with the process; a scoped stop stops exactly one.
  const { startTelemetryMirror } = await import("../telemetry.js");
  const mirrors = new Map<string, import("../telemetry.js").TelemetryMirror>();
  const ensureMirror = (projectRoot: string): void => {
    if (!mirrors.has(projectRoot)) mirrors.set(projectRoot, startTelemetryMirror(projectRoot, home));
  };
  const stopMirror = (projectRoot: string): void => {
    mirrors.get(projectRoot)?.stop();
    mirrors.delete(projectRoot);
  };
  if (state.project) ensureMirror(state.project);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/favicon.ico") {
        // browsers request this tokenless; a 204 leaks nothing and keeps the console clean
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname.startsWith("/fonts/")) {
        // W2: self-hosted brand faces (Michroma/Barlow/JetBrains Mono) — a
        // local engine room must not phone Google nor go off-brand offline.
        // Served tokenless like the favicon: CSS url() can't carry the token
        // header, and a font file on loopback leaks nothing. Whitelist only.
        const name = url.pathname.slice("/fonts/".length);
        const file = join(import.meta.dirname, "..", "..", "fonts", name);
        if (!/^[a-z0-9-]+\.woff2$/.test(name) || !existsSync(file)) return json(res, 404, { error: "no such font" });
        res.writeHead(200, { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=86400, immutable" });
        return res.end(readFileSync(file));
      }
      if (url.pathname.startsWith("/assets/")) {
        // Native-seat-access: the terminal renderer, self-hosted from the
        // engine's own node_modules (no CDN — same law as the fonts). Served
        // tokenless like them: static library code leaks nothing. Whitelist only.
        const ASSETS: Record<string, { file: string; type: string }> = {
          "xterm.js": { file: join("@xterm", "xterm", "lib", "xterm.js"), type: "text/javascript" },
          "xterm.css": { file: join("@xterm", "xterm", "css", "xterm.css"), type: "text/css" },
          "addon-fit.js": { file: join("@xterm", "addon-fit", "lib", "addon-fit.js"), type: "text/javascript" },
          "addon-webgl.js": { file: join("@xterm", "addon-webgl", "lib", "addon-webgl.js"), type: "text/javascript" },
        };
        const a = ASSETS[url.pathname.slice("/assets/".length)];
        const file = a ? join(import.meta.dirname, "..", "..", "node_modules", a.file) : undefined;
        if (!a || !file || !existsSync(file)) return json(res, 404, { error: "no such asset" });
        res.writeHead(200, { "Content-Type": a.type, "Cache-Control": "public, max-age=86400" });
        return res.end(readFileSync(file));
      }
      const supplied = url.searchParams.get("token") ?? req.headers["x-crate-token"];
      if (supplied !== token) return json(res, 403, { error: "missing or wrong token" });

      const route = `${req.method} ${url.pathname}`;
      switch (route) {
        // ── pages ──
        case "GET /":
        case "GET /welcome":
        case "GET /staffing":
        case "GET /attach":
        case "GET /start": {
          // Cockpit-first onboarding S3 (PDR): THE PAGES ARE DEAD. The app
          // has exactly one room — every old journey route (and bookmark,
          // and muscle memory) lands in the cockpit. Attach lives on the
          // card, staffing lives in the panes, the start preflight lives in
          // the Team panel.
          res.writeHead(302, { Location: `/team?token=${encodeURIComponent(token)}` });
          return res.end();
        }
        case "GET /studio": {
          // Design Studio glass (backlog 10, PDR dev/pdr/design-studio.md):
          // one page, framed mobile or desktop by query — pure glass, no
          // cockpit chrome. The shell gives it a persistent NSWindow.
          const { studioPage } = await import("./studiopage.js");
          return html(res, studioPage(url.searchParams.get("frame") === "mobile" ? "mobile" : "desktop"));
        }
        case "GET /arm":
        case "GET /check":
        case "GET /health": {
          // W1 retired these into /start; S3 retired /start into the cockpit.
          res.writeHead(302, { Location: `/team?token=${encodeURIComponent(token)}` });
          return res.end();
        }
        case "GET /team": {
          // PHASE-8 T2: the thin viewer. Reads the headless artifacts of the
          // attached project read-only. Cockpit-first S1: no project → the
          // SAME cockpit with the one irreducible card ("What are we
          // building?") front and center — never a redirect out of the room.
          const proj = url.searchParams.get("project") ?? state.project;
          const { teamPage } = await import("./teampage.js");
          // ?card=1 (S3): the Team panel's "New / attach a rig" door — the
          // card is the ONE attach surface, so a working cockpit can summon
          // it center-room to start or join another repo.
          if (!proj || url.searchParams.get("card") === "1") {
            const { hostname, platform } = await import("node:os");
            const machine = platform() === "darwin" ? "This Mac" : hostname();
            // dismissable iff there is a rig to go back to (the summoned form)
            return html(res, teamPage({ project: "", seats: [] }, { attachCard: { machine, dismissable: Boolean(state.project) } }));
          }
          const { readTeamView } = await import("./teamview.js");
          return html(res, teamPage(readTeamView(proj)));
        }

        // ── API (pass-throughs to core) ──
        case "GET /api/team": {
          // PHASE-8 T2: the viewer's poll — current team artifacts as JSON.
          const { readTeamView } = await import("./teamview.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 200, { project: "(none)", seats: [] });
          return json(res, 200, readTeamView(proj));
        }
        case "GET /api/team/status": {
          // T7-3: the GUI-owned team lifecycle — which seats' runners are alive.
          const { teamProcessFor, defaultBlendStarter } = await import("./teamproc.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 200, { booted: false, seats: [] });
          // Workspace lifecycle: the answer is THIS workspace's own truth —
          // no detachment claims (nothing evicts anything; a seat-less
          // workspace is Parked by record, and the record rides along so
          // the glass can say "parked", never "crashed").
          const st = teamProcessFor(proj, spawnerFor(), defaultBlendStarter(state.home), state.home).status();
          const w = (await import("./workspaces.js")).listWorkspaces(state.home).find((x) => x.path === proj);
          return json(res, 200, { ...st, desired: w?.desired ?? "parked" });
        }
        case "POST /api/team/boot": {
          // T7-3: boot the headless team (one supervised runner child per seat).
          const { teamProcessFor, defaultBlendStarter } = await import("./teamproc.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project attached" });
          try {
            const st = teamProcessFor(proj, spawnerFor(), defaultBlendStarter(state.home), state.home).boot();
            // lifecycle record (PDR workspace-lifecycle): booting IS the intent
            (await import("./workspaces.js")).setWorkspaceDesired(state.home, proj, "running");
            ensureMirror(proj); // telemetry rides the workspace, not the server
            return json(res, 200, st);
          } catch (e) {
            return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
          }
        }
        case "POST /api/team/stop": {
          const { teamProcessFor, defaultBlendStarter } = await import("./teamproc.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          const st = teamProcessFor(proj, spawnerFor(), defaultBlendStarter(state.home), state.home).stop();
          // a scoped stop parks exactly THIS workspace on the record
          (await import("./workspaces.js")).setWorkspaceDesired(state.home, proj, "parked");
          stopMirror(proj);
          return json(res, 200, st);
        }
        case "POST /api/team/relaunch": {
          // T7-3: restart exactly one seat's runner (headless per-seat relaunch).
          const { teamProcessFor, defaultBlendStarter } = await import("./teamproc.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          const body = await readBody(req);
          const seat = String(body.seat ?? "") as Seat;
          if (!(SEATS as readonly string[]).includes(seat)) return json(res, 400, { error: "unknown seat" });
          return json(res, 200, teamProcessFor(proj, spawnerFor(), defaultBlendStarter(state.home), state.home).relaunch(seat));
        }
        case "POST /api/team/abandon": {
          // T7-2 Team menu: drop a mid-flight loop back to idle (agentctl emit
          // abandon — the P4-13 operator verb). task= for a concurrent loop.
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          const body = await readBody(req);
          const task = String(body.task ?? "").trim();
          try {
            const args = [join(proj, ".agents", "bin", "agentctl.py"), "emit", "abandon", "--actor", "operator"];
            if (task) args.push(`task=${task}`);
            const out = execFileSync("python3", args, { cwd: proj, encoding: "utf8" });
            return json(res, 200, { ok: true, out });
          } catch (e) {
            const err = e as { stdout?: string; stderr?: string };
            return json(res, 200, { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") });
          }
        }
        case "GET /api/workspaces": {
          // T7-1: the rail's list — every registered team + the active one.
          // Lifecycle S1: each row carries its desired state + LIVE seat
          // count (peeked, never instantiated), so the glass can tell
          // Running from Parked without touching lifecycle.
          const { listWorkspaces } = await import("./workspaces.js");
          const { peekTeam } = await import("./teamproc.js");
          const active = url.searchParams.get("project") ?? state.project ?? null;
          const workspaces = listWorkspaces(state.home).map((w) => {
            const st = peekTeam(w.path);
            return { ...w, liveSeats: st ? st.seats.filter((s) => s.alive).length : 0 };
          });
          return json(res, 200, { workspaces, active });
        }
        case "POST /api/workspaces/open": {
          // Lifecycle S1 (PDR decision 4): THE open door — register + focus +
          // desired=running + boot-if-not-live. Touches NOTHING else: no
          // rebind, no restart, no other workspace's seats. `crate open
          // <path>` and the rail both land here.
          const { registerWorkspace, setWorkspaceDesired, setWorkspaceFocused } = await import("./workspaces.js");
          const { teamProcessFor, defaultBlendStarter } = await import("./teamproc.js");
          const body = await readBody(req);
          const p = String(body.path ?? "").trim();
          if (!p) return json(res, 400, { error: "path required" });
          if (!existsSync(join(p, ".agents", "rig.conf")))
            return json(res, 400, { error: `not a crate rig (no .agents/rig.conf): ${p} — attach it first (the card)` });
          registerWorkspace(state.home, p);
          setWorkspaceFocused(state.home, p);
          setWorkspaceDesired(state.home, p, "running");
          if (!state.project) state.project = p; // a project-less server adopts a view default; never a rebind
          try {
            const st = teamProcessFor(p, spawnerFor(), defaultBlendStarter(state.home), state.home).boot(); // idempotent — live seats are left alone
            ensureMirror(p);
            await ensureProxyFor(p);
            return json(res, 200, { ok: true, booted: st.booted, alive: st.seats.filter((s) => s.alive).length });
          } catch (e) {
            return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
          }
        }
        case "POST /api/workspaces": {
          // T7-1: register a project as a workspace (the rail's "add"). The
          // path must be an existing crate rig — a bare dir is refused plainly.
          const { registerWorkspace } = await import("./workspaces.js");
          const body = await readBody(req);
          const p = String(body.path ?? "").trim();
          if (!p) return json(res, 400, { error: "path required" });
          if (!existsSync(join(p, ".agents", "rig.conf")))
            return json(res, 400, { error: `not a crate rig (no .agents/rig.conf): ${p}` });
          return json(res, 200, { workspaces: registerWorkspace(state.home, p) });
        }
        case "POST /api/workspaces/remove": {
          // T7-1: drop a workspace from the rail (never touches the repo).
          const { removeWorkspace, lastFocusedWorkspace } = await import("./workspaces.js");
          const body = await readBody(req);
          const p = String(body.path ?? "").trim();
          if (!p) return json(res, 400, { error: "path required" });
          const remaining = removeWorkspace(state.home, p);
          // CE-142: removing the workspace you are LOOKING AT left the server
          // pointed at it — every route that defaults to state.project (team
          // status, preview, chat, loop) then worked a path that is no longer
          // registered, and a chat send would re-create a maildir under it.
          // Repoint to the last-focused survivor — falling back to ANY
          // survivor, because a workspace can be on the rail without ever
          // having been focused and rendering the attach card over a
          // non-empty rail would be its own lie. Empty rail = null, which is
          // the truthful "no project" the page already draws.
          if (state.project === p) {
            state.project = lastFocusedWorkspace(state.home) ?? remaining[0]?.path;
          }
          return json(res, 200, { workspaces: remaining });
        }
        case "GET /api/preview": {
          // PHASE-8 T5: pending previews (pages flagged for review) — proxy
          // port + target are THIS workspace's own (lifecycle PDR d.7).
          const { pendingPreviews } = await import("./teamctl.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 200, { previews: [], proxyPort: null });
          return json(res, 200, {
            previews: pendingPreviews(proj),
            proxyPort: await ensureProxyFor(proj),
            target: state.previewTargets.get(proj) ?? null,
          });
        }
        case "GET /api/studio/state": {
          // Design Studio (backlog 10): the slot, DERIVED + probed, PER
          // WORKSPACE. Reading this also AIMS this workspace's proxy at the
          // slot's http target (idempotent) — the glass never holds a raw
          // dev URL (the routing law); it renders through the proxy or waits.
          const { pendingPreviews, deriveStudioState } = await import("./teamctl.js");
          const proj = url.searchParams.get("project") ?? state.project;
          const previews = proj ? pendingPreviews(proj) : [];
          const first = previews[previews.length - 1]; // newest wins the slot (LESSONS #7)
          let probeOk = false;
          if (first && proj) {
            if (first.url.startsWith("http://")) state.previewTargets.set(proj, first.url);
            probeOk = first.url.startsWith("http") ? await probePreviewTarget(first.url) : true;
          }
          return json(res, 200, deriveStudioState(previews, probeOk, proj ? await ensureProxyFor(proj) : undefined));
        }
        case "POST /api/preview/point": {
          // Satellites + Launch in Chrome (2026-08-13): aim THIS workspace's
          // preview proxy at a registered target. Pointing requires the
          // token; the proxy then forwards for any window that can reach the
          // tunneled port. http-only: an https target is already reachable.
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          const body = await readBody(req);
          const target = String(body.url ?? "").replace(/\/+$/, "");
          if (!/^http:\/\//.test(target)) return json(res, 400, { error: "only http:// targets proxy — https targets open direct" });
          state.previewTargets.set(proj, target);
          return json(res, 200, { ok: true, proxyPort: await ensureProxyFor(proj) });
        }
        case "GET /api/servers": {
          // Backlog 13: the Servers panel — every visible dev server, honest.
          // Registered previews (state/servers.json) ∪ read-only discovery;
          // standing rig.conf infra tagged system-service, never killable.
          const { serversView, nagUnregistered } = await import("./servers.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 200, { servers: [], orphans: 0, lsofAvailable: false });
          const view = serversView(proj);
          // Engine assist (design-previews belt): an unregistered mid-task
          // listener earns ONE dedup'd nudge to the orchestrator, riding the
          // panel's own poll. Fail-open inside — never blocks the read.
          nagUnregistered(proj, view);
          return json(res, 200, view);
        }
        case "POST /api/servers/kill": {
          // NOTHING DIES WITHOUT THE OPERATOR'S CLICK (the grill's law). Only
          // a row the CURRENT view marks killable can die: system services
          // 409, stale pids 409 — the payload can't reach arbitrary processes.
          const { serversView, confirmedKill } = await import("./servers.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          const body = await readBody(req);
          const port = Number(body.port);
          const pid = Number(body.pid);
          const row = serversView(proj).servers.find((s) => s.port === port && s.pid === pid);
          if (!row) return json(res, 409, { error: "stale row — no such listener now (the panel refreshes)" });
          if (!row.killable) return json(res, 409, { error: "system service — kill disabled (visible, untouchable)" });
          return json(res, 200, await confirmedKill(port, pid));
        }
        case "POST /api/servers/sweep": {
          // The optional one-click sweep — still the operator's click; each
          // orphan gets the same confirmed kill, results reported per row.
          const { sweepOrphans } = await import("./servers.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          return json(res, 200, { results: await sweepOrphans(proj) });
        }
        case "POST /api/preview/resolve": {
          const { resolvePreview } = await import("./teamctl.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          const body = await readBody(req);
          return json(res, 200, resolvePreview(proj, Boolean(body.approve), body.note ? String(body.note) : undefined));
        }
        case "GET /api/gates": {
          // PHASE-8 T3: pending merge gates (tasks at approved awaiting "merge go").
          const { pendingGates } = await import("./teamctl.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 200, { gates: [] });
          return json(res, 200, { gates: pendingGates(proj) });
        }
        case "POST /api/gates/release": {
          // the operator types "merge go" — validated here AND by agentctl.
          const { releaseGate } = await import("./teamctl.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          const body = await readBody(req);
          const r = releaseGate(proj, String(body.task ?? ""), String(body.phrase ?? ""));
          return json(res, r.ok ? 200 : 400, r);
        }
        case "POST /api/context/checkpoint": {
          // PHASE-8 T4 (D12): snapshot the team's state (agentctl emit checkpoint).
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          try {
            const { execFileSync } = await import("node:child_process");
            const out = execFileSync("python3", [join(proj, ".agents", "bin", "agentctl.py"), "emit", "checkpoint", "--actor", "operator"], { cwd: proj, encoding: "utf8" });
            return json(res, 200, { ok: true, out });
          } catch (e) {
            const err = e as { stdout?: string; stderr?: string };
            return json(res, 200, { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") });
          }
        }
        case "POST /api/context/refresh": {
          // PHASE-8 T4 (D12): drop a seat's session so its next turn re-orients
          // fresh — REFUSED on stale state unless force (the impeccable-context law).
          const { refreshSeat } = await import("../refresh.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          const body = await readBody(req);
          const seat = String(body.seat ?? "");
          if (!seat) return json(res, 400, { error: "seat required" });
          // Blended pane (PDR S2): for a live blended seat, refresh IS a
          // visible restart of the pane (refused mid-response). Falls through
          // to the headless session-drop path for everything else.
          const { teamProcessFor, defaultBlendStarter } = await import("./teamproc.js");
          const rb = teamProcessFor(proj, spawnerFor(), defaultBlendStarter(state.home), state.home)
            .refreshBlended(seat as Seat, { force: Boolean(body.force) });
          if (rb.handled) return json(res, rb.ok ? 200 : 409, { ok: Boolean(rb.ok), ...(rb.reason ? { reason: rb.reason } : {}) });
          const r = refreshSeat(proj, seat, { force: Boolean(body.force) });
          return json(res, r.ok ? 200 : 409, r);
        }
        case "GET /api/stream": {
          // 2c LIVE seat readout (PDR live-seat-readout): the SSE push
          // channel. The token rides the query string (EventSource cannot
          // set headers) and was already checked above. On connect the
          // client gets a backlog batch (it REPLACES its feed — reconnects
          // never duplicate), then policy-filtered stream events as the
          // runner appends them. The page's 2s poll stays alive underneath
          // as the fallback floor — push shortens the wait, polling carries
          // the loop.
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project attached yet" });
          const { hubFor } = await import("./turntail.js");
          const hub = hubFor(proj);
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write("retry: 2000\n\n");
          res.write(`data: ${JSON.stringify({ backlog: hub.backlog() })}\n\n`);
          const unsub = hub.subscribe((ev) => {
            try {
              res.write(`data: ${JSON.stringify(ev)}\n\n`);
            } catch {
              /* client went away mid-write; close handles cleanup */
            }
          });
          const hb = setInterval(() => {
            try {
              res.write(": hb\n\n");
            } catch {
              /* ignore */
            }
          }, 15_000);
          hb.unref();
          req.on("close", () => {
            clearInterval(hb);
            unsub();
          });
          return;
        }
        // ── Native seat access (PDR native-seat-access): the second door —
        // the seat's REAL agent TUI in a server-side PTY, inside its wall. ──
        case "POST /api/tty/start": {
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project attached" });
          const body = await readBody(req);
          const seat = String(body.seat ?? "");
          if (!(SEATS as readonly string[]).includes(seat)) return json(res, 400, { error: "unknown seat" });
          const confFile = join(proj, ".agents", "rig.conf");
          if (!existsSync(confFile)) return json(res, 400, { error: "no rig.conf — attach the project first" });
          const conf = parseRigConf(readFileSync(confFile, "utf8"));
          const agentKey = `${RIG_PREFIX[seat as Seat]}_AGENT`; // rig.conf keys use ORCH, not ORCHESTRATOR
          // S4 (wheel retired from blended seats): a blended seat's pane IS
          // its live session — a second interactive door would be two writers
          // on one session. The wheel survives only for the headless fallback.
          const ttyStaffed = resolveSeatStaffing(proj, seat as Seat, state.home, conf); // CE-141
          if (isBlended(conf, seat as Seat, ttyStaffed.agent)) {
            return json(res, 409, {
              error: `${seat} is blended — its pane IS the live session; type into the pane itself. ` +
                `(The wheel door exists only for headless-fallback seats; opt out with BLEND_${RIG_PREFIX[seat as Seat]}=0 if you truly need it.)`,
            });
          }
          const { startSeatTty } = await import("../ptyseat.js");
          const r = await startSeatTty({
            projectRoot: proj,
            seat,
            agent: ttyStaffed.agent,
            model: ttyStaffed.model,
            cols: Number(body.cols) || undefined,
            rows: Number(body.rows) || undefined,
            home: state.home,
          });
          if (!r.ok) return json(res, "busy" in r && r.busy ? 409 : 400, r);
          return json(res, 200, { ok: true, reattached: r.reattached, agent: r.tty.agent });
        }
        case "POST /api/staffing/seat": {
          // Restaff a seat ON THE FLY (Adam, 2026-08-10): write the RIG's own
          // staffing line (project-scoped — user defaults untouched), close
          // any open wheel on the seat, and relaunch its runner if the team
          // is booted. A restaffed agent gets a fresh session by the runner's
          // own agent-mismatch rule — no stale memory crosses agents.
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project attached" });
          const body = await readBody(req);
          const seat = String(body.seat ?? "") as Seat;
          if (!(SEATS as readonly string[]).includes(seat)) return json(res, 400, { error: "unknown seat" });
          const agent = String(body.agent ?? "").trim();
          if (!agent) return json(res, 400, { error: "agent required" });
          const confFile = join(proj, ".agents", "rig.conf");
          if (!existsSync(confFile)) return json(res, 400, { error: "no rig.conf — attach the project first" });
          writeFileSync(confFile, updateRigStaffing(readFileSync(confFile, "utf8"), seat, agent, String(body.model ?? "").trim()));
          const { stopSeatTty } = await import("../ptyseat.js");
          stopSeatTty(proj, seat);
          const { teamProcessFor, defaultBlendStarter } = await import("./teamproc.js");
          const tp = teamProcessFor(proj, spawnerFor(), defaultBlendStarter(state.home), state.home);
          // Cockpit-first S2 (PDR decision 6): STAFFING A SEAT BOOTS IT
          // IMMEDIATELY — no separate start step. The first staffed seat
          // brings the rig live; each subsequent staff joins; a restaff on a
          // running seat is the same relaunch it always was.
          tp.relaunch(seat);
          // lifecycle record: a staffed seat means this workspace is running
          (await import("./workspaces.js")).setWorkspaceDesired(state.home, proj, "running");
          return json(res, 200, { ok: true, relaunched: true, booted: tp.booted });
        }
        case "GET /api/tty/stream-all": {
          // Five-wheels freeze (Adam, 2026-08-11): browsers allow ~6
          // connections per host, and one SSE PER WHEEL + the main stream
          // hit exactly that — every poll and keystroke POST starved behind
          // them, cockpit frozen. ONE multiplexed stream carries every
          // wheel's output ({seat, replay|d|exit}); the client reopens it
          // when the wheel set changes, so connect-time enumeration is
          // always complete. Budget: 1 main SSE + 1 tty SSE, ever.
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          // client = the view's id. This stream IS the view's liveness for
          // the smallest-client-wins size policy (tmux's model, Adam's call
          // 2026-08-14: no heartbeats) — its close releases the view's size
          // proposals immediately, and a (re)opening view re-proposes.
          const viewClient = url.searchParams.get("client") ?? "";
          const { liveTtyList } = await import("../ptyseat.js");
          const ttys = liveTtyList(proj);
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write("retry: 1000\n\n");
          const unsubs = ttys.map((tty) => {
            res.write(`data: ${JSON.stringify({ seat: tty.seat, replay: tty.replay().toString("base64") })}\n\n`);
            return tty.subscribe((ev) => {
              try {
                if (ev.data) res.write(`data: ${JSON.stringify({ seat: tty.seat, d: ev.data.toString("base64") })}\n\n`);
                if (ev.exit) res.write(`data: ${JSON.stringify({ seat: tty.seat, exit: ev.exit.code })}\n\n`);
              } catch {
                /* viewer went away; close cleans up */
              }
            });
          });
          const hbAll = setInterval(() => {
            try { res.write(": hb\n\n"); } catch { /* ignore */ }
          }, 15_000);
          hbAll.unref();
          req.on("close", () => {
            clearInterval(hbAll);
            for (const u of unsubs) u();
            // release this view's size clamps NOW — fresh list, not the
            // connect-time one (the view may have proposed onto ttys born
            // after this stream opened, right before its reopen)
            if (viewClient) for (const t of liveTtyList(proj)) t.dropSizeProposal(viewClient);
          });
          return;
        }
        case "GET /api/tty/stream": {
          const proj = url.searchParams.get("project") ?? state.project;
          const seat = url.searchParams.get("seat") ?? "";
          if (!proj) return json(res, 400, { error: "no project" });
          const { liveTty } = await import("../ptyseat.js");
          const tty = liveTty(proj, seat);
          if (!tty) return json(res, 404, { error: "no live terminal for this seat — start one first" });
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write("retry: 1000\n\n");
          res.write(`data: ${JSON.stringify({ replay: tty.replay().toString("base64") })}\n\n`);
          const unsub = tty.subscribe((ev) => {
            try {
              if (ev.data) res.write(`data: ${JSON.stringify({ d: ev.data.toString("base64") })}\n\n`);
              if (ev.exit) res.write(`data: ${JSON.stringify({ exit: ev.exit.code })}\n\n`);
            } catch {
              /* viewer went away; close cleans up */
            }
          });
          const hb = setInterval(() => {
            try { res.write(": hb\n\n"); } catch { /* ignore */ }
          }, 15_000);
          hb.unref();
          req.on("close", () => {
            clearInterval(hb);
            unsub();
          });
          return;
        }
        case "POST /api/tty/input": {
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          const body = await readBody(req);
          const { liveTty } = await import("../ptyseat.js");
          const tty = liveTty(proj, String(body.seat ?? ""));
          if (!tty) return json(res, 404, { error: "no live terminal" });
          const raw = Buffer.from(String(body.data ?? ""), "base64");
          tty.write(raw);
          // Pack 4 (cockpit truth): the pane-phrase honor. Adam typed "merge
          // go" into the orchestrator pane at BOTH ticket-#4 gates — habit
          // beats the surface, so the engine folds the typed bytes at this
          // one human chokepoint and honors the exact phrase while a gate is
          // armed (same authority as the gate bar: these keystrokes ARE the
          // operator's). Best-effort — the keystrokes already landed above.
          try {
            const { foldHumanLines, honorPaneRelease } = await import("./teamctl.js");
            const key = `${proj}|${String(body.seat ?? "")}`;
            const folded = foldHumanLines(paneLineBuf.get(key) ?? "", raw);
            paneLineBuf.set(key, folded.buf);
            if (folded.lines.length > 0) {
              const h = honorPaneRelease(proj, folded.lines);
              if (h.released) {
                const { guiLog } = await import("./guilog.js");
                guiLog(state.home, `gate released from the ${String(body.seat ?? "")} pane (typed phrase honored) — task ${h.released}`);
              }
            }
          } catch {
            /* the honor is best-effort; the input path must never fail on it */
          }
          return json(res, 200, { ok: true });
        }
        case "POST /api/tty/resize": {
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          const body = await readBody(req);
          const { liveTty } = await import("../ptyseat.js");
          const tty = liveTty(proj, String(body.seat ?? ""));
          if (!tty) return json(res, 404, { error: "no live terminal" });
          const cols = Number(body.cols), rows = Number(body.rows);
          // client = the view's id — smallest-client-wins across live views
          if (cols > 0 && rows > 0) tty.resize(cols, rows, body.client ? String(body.client) : undefined);
          return json(res, 200, { ok: true });
        }
        case "POST /api/tty/stop": {
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          const body = await readBody(req);
          const { stopSeatTty } = await import("../ptyseat.js");
          return json(res, 200, { ok: true, stopped: stopSeatTty(proj, String(body.seat ?? "")) });
        }
        case "GET /api/chat": {
          const { chatHistory } = await import("./teamctl.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 200, { messages: [] });
          return json(res, 200, { messages: chatHistory(proj) });
        }
        case "POST /api/chat": {
          const { sendToOrchestrator } = await import("./teamctl.js");
          const proj = url.searchParams.get("project") ?? state.project;
          if (!proj) return json(res, 400, { error: "no project" });
          const body = await readBody(req);
          const text = String(body.text ?? "").trim();
          if (!text) return json(res, 400, { error: "empty message" });
          return json(res, 200, sendToOrchestrator(proj, text));
        }
        case "GET /api/version":
          // loadedSha = what THIS process runs (boot-captured); version = disk
          // truth (drives the update UI). They disagree exactly when a stale
          // survivor is serving — the reattach probe reads loadedSha.
          // CE-014 P1: `project` is here so a switching `crate open` can ask
          // "what are you bound to, and does it have a live team?" BEFORE it
          // tears that team down. Without it the caller had to guess.
          return json(res, 200, {
            ...engineVersion(state.home),
            loadedSha: state.loadedSha ?? "unknown",
            pid: process.pid,
            project: state.project ?? null,
          });
        case "POST /api/shutdown": {
          // Pack 3 (stale-reattach, cure 2): the CONFIRMED way down — `crate
          // stop` calls this instead of a blind pkill (the incident's kill
          // "landed" on a dead control channel and the survivor kept serving
          // old code). Same clean-kill order as /api/restart (runner-deaths
          // fix): stop the team while we are alive to stamp the exits, drop
          // the standing app-url handshake (a dead server must not leave a
          // live-looking pointer), answer, THEN exit.
          const { handoffStop } = await import("./teamproc.js");
          const { guiLog } = await import("./guilog.js");
          const { rmSync } = await import("node:fs");
          const handoff = handoffStop();
          if (handoff.stopped > 0) guiLog(state.home, `shutdown: stopped ${handoff.stopped} seats`);
          try {
            rmSync(appUrlPath(state.home));
          } catch {
            /* absent already */
          }
          guiLog(state.home, `shutdown requested (/api/shutdown — crate stop) — exiting`);
          json(res, 200, { ok: true, pid: process.pid, stoppedSeats: handoff.stopped });
          setTimeout(() => process.exit(0), 400); // after the response flushes
          return;
        }
        case "POST /api/restart": {
          // W3 (audit K2): "Update now" ends with the app BACK, not homework.
          // Runner-deaths fix (FLAWS 2026-08-11): it also ends with the TEAM
          // back. The old flow spawned the fresh server and process.exit(0)'d —
          // a plain exit fires NONE of installGuiCrashLog's handlers, so the
          // runner children were abandoned to their ppid watchdogs: silent
          // code-0 deaths with no EXIT stamps (the parent that writes them was
          // already gone), and any seat still mid-boot missed the reparent and
          // ran forever for a dead cockpit. Now we stop the team FIRST — the
          // runners die by parent-delivered SIGTERM while we are alive to
          // stamp their exits — and pass --boot so the fresh server brings
          // the team back by itself instead of waiting for a Start press.
          const { spawn } = await import("node:child_process");
          const { mkdtempSync } = await import("node:fs");
          const { tmpdir } = await import("node:os");
          const { handoffStop } = await import("./teamproc.js");
          const { guiLog } = await import("./guilog.js");
          const handoff = handoffStop();
          if (handoff.stopped > 0) guiLog(state.home, `restart: stopped ${handoff.stopped} seats for handoff`);
          const urlFile = join(mkdtempSync(join(tmpdir(), "crate-restart-")), "url");
          const args = restartArgv(state, urlFile); // the record carries what resumes — no --boot memory needed
          void handoff.wasBooted; // (kept in the handoff report for the log line above)
          const child = spawn(process.execPath, args, { detached: true, stdio: "ignore" });
          child.unref();
          const t0 = Date.now();
          let newUrl = "";
          while (Date.now() - t0 < 30000 && !newUrl) {
            await new Promise((r) => setTimeout(r, 300));
            if (existsSync(urlFile)) newUrl = readFileSync(urlFile, "utf8").trim();
          }
          if (!newUrl) return json(res, 500, { error: "the fresh app server did not come up — reopen with: crate open" });
          json(res, 200, { ok: true, url: newUrl });
          setTimeout(() => process.exit(0), 400); // after the response flushes
          return;
        }
        case "POST /api/update":
          // P6-4: the in-app update — the Phase-4 machinery verbatim
          // (ff-only on the pristine clone + the overlay compatibility pass).
          return json(res, 200, updateEngine(state.home));
        case "GET /api/staffing":
          return json(res, 200, staffingCatalog(state, opts.detectPath));
        case "POST /api/crew/terminal": {
          // bring-your-crew sign-in (W0, audit C2): the button ACTS — on macOS
          // it opens Terminal with the agent's sign-in command running; the
          // welcome screen's live detection notices the sign-in by itself.
          const body = await readBody(req);
          const crew: Record<string, string> = { pi: "pi", claude: "claude", codex: "codex" };
          const cmd = crew[String(body.agent ?? "")];
          if (!cmd) return json(res, 400, { error: `unknown agent "${body.agent}"` });
          const { openSignInTerminal } = await import("./terminal.js");
          return json(res, 200, { cmd, ...openSignInTerminal(cmd) });
        }
        case "GET /api/agents":
          // pass-through to core: readiness of the STAFFED agents (detection —
          // the engine never installs or signs in agents; boot refusal backstops)
          return json(
            res,
            200,
            agentStatus({
              home: state.home,
              ...(state.project !== undefined ? { project: state.project } : {}),
              ...(opts.detectPath !== undefined ? { path: opts.detectPath } : {}),
            }),
          );
        case "POST /api/defaults": {
          const body = await readBody(req);
          return json(res, 200, writeDefaults(state, body.seats as Record<string, { agent: string; model: string }>));
        }
        case "GET /api/fs/dirs": {
          // the attach picker. Jail = home + where rigs live (derived from
          // the registered workspaces — the headless-era amendment; Adam's
          // "↑Up does nothing" live find, 2026-08-15).
          return json(res, 200, listDirs(url.searchParams.get("path") ?? undefined, { home: state.home, roots: await pickerRoots(state) }));
        }
        case "POST /api/fs/mkdir": {
          // the picker's New-folder button (same jail; steps into the result)
          const body = await readBody(req);
          return json(res, 200, makeDir(body.path as string | undefined, String(body.name ?? ""), { home: state.home, roots: await pickerRoots(state) }));
        }
        case "POST /api/attach/clone": {
          // Clone from GitHub (backlog 15, absorbed by the attach card): the
          // clone lands inside the picker jail; the card attaches it next.
          const { cloneRepo } = await import("../attach.js");
          const body = await readBody(req);
          const r = await cloneRepo(String(body.url ?? "").trim(), body.dest ? String(body.dest) : undefined, {
            home: state.home,
            roots: await pickerRoots(state),
          });
          return json(res, 200, r);
        }
        // ── remote engines (cockpit-first S1: the "+ Add a server" chips) ──
        // ── THE FLEET RAIL, F1 (PDR fleet-rail): the hub's aggregated view.
        // The shells' native Fleet menu reads this and switches the webview;
        // the read is cache-first and NEVER blocks on ssh (asleep hosts must
        // never hang the menu); connect is the explicit dial. ──
        case "GET /api/fleet": {
          const { fleetView } = await import("./fleet.js");
          const { listWorkspaces } = await import("./workspaces.js");
          const { peekTeam } = await import("./teamproc.js");
          const { hostname, platform } = await import("node:os");
          return json(res, 200, fleetView({
            home: state.home,
            hubSha: state.loadedSha ?? "unknown",
            hubOrigin: `http://127.0.0.1:${hubPort}`,
            hubToken: token,
            hostLabel: platform() === "darwin" ? "This Mac" : hostname(),
            localWorkspaces: listWorkspaces(state.home)
              .filter((w) => w.rig)
              .map((w) => ({
                name: w.name,
                path: w.path,
                desired: w.desired,
                liveSeats: peekTeam(w.path)?.seats.filter((s) => s.alive).length ?? 0,
              })),
          }));
        }
        case "POST /api/fleet/update": {
          // Adam's ask (2026-08-18): crate-update lives IN the app — one
          // click updates the hub + every remembered host. Long call by
          // nature (npm install per host); the shell runs it off-thread.
          const { updateFleet } = await import("./fleet.js");
          const results = await updateFleet(state.home, () => updateEngine(state.home));
          return json(res, 200, { results });
        }
        case "POST /api/fleet/connect": {
          const { connectHost } = await import("./fleet.js");
          const { validRemoteHost } = await import("./remotes.js");
          const body = await readBody(req);
          const host = String(body.host ?? "").trim();
          if (!validRemoteHost(host)) return json(res, 400, { error: "bad ssh destination" });
          return json(res, 200, await connectHost(host, { hubSha: state.loadedSha ?? "unknown", home: state.home }));
        }
        case "GET /api/remotes": {
          const { listRemotes, remoteJob } = await import("./remotes.js");
          const { hostname, platform } = await import("node:os");
          return json(res, 200, {
            machine: platform() === "darwin" ? "This Mac" : hostname(),
            remotes: listRemotes(state.home).map((e) => {
              const j = remoteJob(e.host);
              return { ...e, ...(j ? { phase: j.phase, note: j.note } : {}) };
            }),
          });
        }
        case "POST /api/remotes/probe": {
          // The add flow's FIRST step — before any consent dialog: is the
          // host reachable over the user's own ssh, and is an engine there?
          const { probeRemote, validRemoteHost } = await import("./remotes.js");
          const body = await readBody(req);
          const host = String(body.host ?? "").trim();
          if (!validRemoteHost(host)) return json(res, 400, { error: "give a plain ssh destination — an alias from ~/.ssh/config, or user@host" });
          return json(res, 200, await probeRemote(host));
        }
        case "POST /api/remotes/connect": {
          // An engine is already there — connect with no dialog (Adam's call).
          const { startConnect, validRemoteHost } = await import("./remotes.js");
          const body = await readBody(req);
          const host = String(body.host ?? "").trim();
          if (!validRemoteHost(host)) return json(res, 400, { error: "bad ssh destination" });
          const j = startConnect(state.home, host);
          return json(res, 200, { phase: j.phase, note: j.note });
        }
        case "POST /api/remotes/install": {
          // CONSENT GIVEN — the page's one plain dialog clicked [Install
          // engine]. The server offers no path here without that click.
          const { startInstall, validRemoteHost } = await import("./remotes.js");
          const body = await readBody(req);
          const host = String(body.host ?? "").trim();
          if (!validRemoteHost(host)) return json(res, 400, { error: "bad ssh destination" });
          const j = startInstall(state.home, host);
          return json(res, 200, { phase: j.phase, note: j.note });
        }
        case "GET /api/remotes/status": {
          const { remoteJob } = await import("./remotes.js");
          const j = remoteJob(url.searchParams.get("host") ?? "");
          if (!j) return json(res, 404, { error: "no live connect/install for that host" });
          return json(res, 200, j);
        }
        case "POST /api/remotes/remove": {
          const { removeRemote } = await import("./remotes.js");
          const body = await readBody(req);
          return json(res, 200, { remotes: removeRemote(state.home, String(body.host ?? "")) });
        }
        case "POST /api/attach/plan": {
          const body = await readBody(req);
          const target = resolveTarget(body.target as string, { home: state.home });
          const plan: AttachPlan = planAttach(target, tierPaths(state.home).engineDir, {
            create: Boolean(body.create),
          });
          return json(res, 200, plan);
        }
        case "POST /api/attach/execute": {
          const body = await readBody(req);
          const target = resolveTarget(body.target as string, { home: state.home });
          const plan = planAttach(target, tierPaths(state.home).engineDir, { create: Boolean(body.create) });
          const report = executeAttach(plan, { gitInit: Boolean(body.gitInit), githubRepo: Boolean(body.githubRepo) });
          // Flaw 1: an inherited rig.conf may aim DEV_URL at a FOREIGN server
          // — heal BEFORE the doctor runs so its dev-server row probes truth.
          const { healDevUrl } = await import("../attach.js");
          const devHeal = await healDevUrl(plan.projectRoot);
          state.project = plan.projectRoot; // the view default follows the attach
          ensureMirror(plan.projectRoot); // 2b: a mirror per workspace — attaching adds, never retargets
          const ws = await import("./workspaces.js");
          ws.registerWorkspace(state.home, plan.projectRoot); // T7-1: rail entry
          ws.setWorkspaceFocused(state.home, plan.projectRoot); // lifecycle S1: focus survives restarts (the last-project global is retired)
          const doctor = await runDoctor(plan.projectRoot);
          // P6-1 (G2): heavy seat-deps disclosed with the result; install is its own call
          const heavy = await heavyDeps(plan.projectRoot);
          return json(res, 200, { report, doctor, heavy, project: plan.projectRoot, ...(devHeal ? { devHeal } : {}) });
        }
        case "GET /api/deps": {
          // run #7: the Arm screen lists the project's outstanding heavy deps
          // (own step now, no longer riding the attach result)
          if (!state.project) return json(res, 400, { error: "no project attached yet" });
          return json(res, 200, await heavyDeps(state.project));
        }
        case "POST /api/deps/install": {
          // P6-1: run the DISCLOSED heavy installs (the GUI's confirm button)
          if (!state.project) return json(res, 400, { error: "no project attached yet" });
          const deps = await heavyDeps(state.project);
          return json(res, 200, await installHeavyDeps(deps));
        }
        case "POST /api/deps/install-one": {
          // run #11: the Arm screen installs deps ONE AT A TIME so it can show
          // live per-tool progress instead of a single long silent button
          if (!state.project) return json(res, 400, { error: "no project attached yet" });
          const body = await readBody(req);
          const deps = await heavyDeps(state.project);
          const dep = deps.find((d) => d.name === body.name);
          if (!dep) return json(res, 200, { name: body.name, ok: true, detail: "already installed" });
          return json(res, 200, (await installHeavyDeps([dep]))[0]);
        }
        case "GET /api/doctor": {
          if (!state.project) return json(res, 400, { error: "no project attached yet" });
          return json(res, 200, await runDoctor(state.project));
        }
        case "GET /api/health": {
          if (!state.project) return json(res, 400, { error: "no project attached yet — attach one first" });
          // T8a: health = the GUI-owned team lifecycle (teamproc), not cmux
          // read-screen. A seat with a live runner child is "live"; a child
          // that exited is "dead" (auto-revive can act); a seat never booted is
          // "unknown" (not-booted ≠ provably dead).
          const { teamProcessFor, defaultBlendStarter } = await import("./teamproc.js");
          const st = teamProcessFor(state.project, spawnerFor(), defaultBlendStarter(state.home), state.home).status();
          // CE-143: an ALIVE process is not a usable seat. A blended seat whose
          // model refuses (usage limit) or whose auth went stale keeps its
          // child running and every process-shaped check green, while doing
          // nothing at all — nine silent minutes on Adam's own account, with
          // the cockpit showing five live seats and a verified delivery. So a
          // live seat's pane gets the last word on USABILITY.
          const { paneUsability } = await import("../health.js");
          const { readPaneHistory } = await import("../ptyseat.js");
          const seats = st.seats.map((s) => {
            if (s.alive) {
              let problem: { liveness: string; detail: string } | undefined;
              try {
                problem = paneUsability(readPaneHistory(state.project!, s.seat));
              } catch {
                /* no pane mirror (headless seat, fresh spawn) — stay with the process verdict */
              }
              if (problem) return { seat: s.seat, liveness: problem.liveness, detail: problem.detail };
              return { seat: s.seat, liveness: "live", detail: "runner alive" };
            }
            return {
              seat: s.seat,
              liveness: s.startedAt ? "dead" : "unknown",
              detail: s.startedAt ? "runner exited — relaunch to restart" : "not booted",
            };
          });
          return json(res, 200, {
            project: state.project,
            booted: st.booted,
            seats,
            autoRevive: autoReviveEnabled(state.project),
            reviveNotes: state.reviveNotes ?? [],
          });
        }
        case "GET /api/loop": {
          // The LOOP dashboard (read-only): what the team is doing, from the
          // same ground truth the agents use — events.log is authoritative.
          if (!state.project) return json(res, 400, { error: "no project attached yet" });
          const stateDir = join(state.project, ".agents", "state");
          const read = (f: string): string => {
            try {
              return readFileSync(join(stateDir, f), "utf8");
            } catch {
              return "";
            }
          };
          const lines = read("events.log").split("\n").filter((l) => l.trim() !== "");
          // P7-T6: task= keyed events drive per-task states; un-keyed lines
          // drive the legacy session scalar. Closed (idle) tasks drop off.
          let scalar = "down";
          const tasks: Record<string, string> = {};
          for (const l of lines) {
            const st = l.match(/ state=(\S+)/)?.[1];
            if (!st) continue;
            const task = l.match(/ task=(\S+)/)?.[1];
            if (task) tasks[task] = st;
            else scalar = st;
          }
          for (const t of Object.keys(tasks)) if (tasks[t] === "idle") delete tasks[t];
          const cur = Object.keys(tasks).length
            ? Object.entries(tasks).map(([t, s]) => `${t}=${s}`).join("  ")
            : scalar;
          const pin = read("pin-code_ready").trim();
          const { loopNarration } = await import("./narration.js");
          return json(res, 200, {
            state: cur,
            tasks,
            pinned: pin || null,
            events: lines.slice(-10),
            // PHASE-B #2: the masthead chip's line — round N + whose move it is.
            narration: loopNarration(lines),
          });
        }
        // T8a: /api/up, /api/seat/relaunch, /api/team/refresh REMOVED — the cmux
        // lifecycle. The GUI-owned headless lifecycle replaces them:
        // /api/team/boot (was up), /api/team/relaunch (was seat/relaunch),
        // /api/context/refresh (was team/refresh).
        default:
          return json(res, 404, { error: `no route: ${route}` });
      }
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── P7-T5 auto-revive monitor (STRICTLY OPT-IN: rig.conf AUTO_REVIVE=1;
  // default OFF = this interval no-ops and the button-only behavior stands).
  // The tick is fail-safe end to end: only "dead" seats (never unknown /
  // signed-out), doubling backoff, hard ceiling with an honest stopped note;
  // a monitor error must never crash the server.
  // T8a: auto-revive now acts on the GUI-owned team lifecycle (teamproc) — a
  // dead runner CHILD is relaunched, not a cmux pane. makeAutoReviver stays the
  // generic dead-seat monitor (backoff + ceiling); only its wiring changed.
  const reviver = makeAutoReviver({
    revive: async (seat) => {
      const { teamProcessFor, defaultBlendStarter } = await import("./teamproc.js");
      teamProcessFor(state.project!, spawnerFor(), defaultBlendStarter(state.home), state.home).relaunch(seat);
    },
  });
  const reviveTimer = setInterval(async () => {
    try {
      if (!state.project || !autoReviveEnabled(state.project)) return;
      const { teamProcessFor, defaultBlendStarter } = await import("./teamproc.js");
      const st = teamProcessFor(state.project, spawnerFor(), defaultBlendStarter(state.home), state.home).status();
      if (!st.booted) return; // team not booted — nothing to monitor
      // Map the lifecycle status to the reviver's SeatHealth shape. CE-143:
      // a usage-limited seat reports its real state here too. It is not
      // strictly required — the reviver only ever acts on "dead" — but a
      // monitor that privately believes a stuck seat is "live" is one refactor
      // away from relaunching it, and relaunching cannot fix a spent quota:
      // it would just respawn into the same refusal on a backoff loop.
      const { paneUsability } = await import("../health.js");
      const { readPaneHistory } = await import("../ptyseat.js");
      const seats = st.seats.map((s) => {
        let live: Liveness = s.alive ? "live" : s.startedAt ? "dead" : "unknown";
        let detail = s.alive ? "runner alive" : "runner exited";
        if (s.alive) {
          try {
            const problem = paneUsability(readPaneHistory(state.project!, s.seat));
            if (problem) { live = problem.liveness; detail = problem.detail; }
          } catch {
            /* no pane mirror — keep the process verdict */
          }
        }
        return { seat: s.seat, title: s.seat, agent: "", model: "", liveness: live, detail };
      });
      const notes = await reviver.tick(seats, "headless");
      if (notes.length) {
        state.reviveNotes = [...(state.reviveNotes ?? []), ...notes].slice(-20);
      }
    } catch {
      /* monitor must never crash the GUI server */
    }
  }, 30_000);
  reviveTimer.unref();

  // ── the idle knob (lifecycle PDR decision 6): OFF unless a rig sets
  // IDLE_PARK_MIN — cmux never reaps your idle terminals. When set, WORKER
  // seats in a quiet Running workspace park after N idle minutes with a
  // visible stamp; the orchestrator NEVER parks (it holds the loop's
  // context) and the workspace stays Running on the record. Deliberate,
  // visible, configurable — never cost control by eviction accident. ──
  const idleTimer = setInterval(async () => {
    try {
      const ws = await import("./workspaces.js");
      const { peekTeam, teamProcessFor, defaultBlendStarter, idleParkMinutes, idleParkTargets } = await import("./teamproc.js");
      const { parseRigConf: prc } = await import("../staffing.js");
      const { guiLog } = await import("./guilog.js");
      for (const w of ws.listWorkspaces(home)) {
        const st = peekTeam(w.path);
        if (!st || !st.booted) continue;
        let conf: Record<string, string> = {};
        try {
          conf = prc(readFileSync(join(w.path, ".agents", "rig.conf"), "utf8"));
        } catch {
          continue;
        }
        const min = idleParkMinutes(conf);
        const targets = idleParkTargets(st, min, w.lastActivityMs, Date.now());
        if (targets.length === 0) continue;
        const tp = teamProcessFor(w.path, spawnerFor(), defaultBlendStarter(home), home);
        for (const seat of targets) {
          tp.parkSeat(seat, `idle-parked | quiet ${min}min (IDLE_PARK_MIN, rig.conf — deliberate + visible; never the orchestrator) — staff the seat or Boot/Resume to wake it`);
        }
        guiLog(home, `idle knob: parked ${targets.join(", ")} in ${w.path} after ${min}min quiet (orchestrator kept)`);
      }
    } catch {
      /* the knob must never crash the server */
    }
  }, 60_000);
  idleTimer.unref();

  server.on("close", async () => {
    clearInterval(reviveTimer);
    clearInterval(idleTimer);
    (await import("./fleet.js")).clearFleetLinks(); // owned tunnels die with the hub (fleet PDR d.4)
    for (const m of mirrors.values()) m.stop();
    mirrors.clear();
    for (const p of previewProxies.values()) p.close();
    previewProxies.clear();
    (await import("./teamproc.js")).stopAllTeams(); // T7-3: runners die WITH the GUI
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  hubPort = port;

  // ── RESTART-RESUME (lifecycle PDR decision 5): the server comes back and
  // resumes EVERY workspace whose record says running — cmux's "app relaunch
  // restores your sessions", by record. Never more than the record, never a
  // special restart flag: crash, update, host reboot all read the same
  // truth. A vanished rig is skipped with a log line, never a crash. ──
  {
    const ws = await import("./workspaces.js");
    const { teamProcessFor, defaultBlendStarter } = await import("./teamproc.js");
    const { guiLog } = await import("./guilog.js");
    for (const p of ws.desiredRunning(home)) {
      try {
        const st = teamProcessFor(p, spawnerFor(), defaultBlendStarter(home), home).boot();
        ensureMirror(p);
        guiLog(home, `restart-resume: ${p} — ${st.seats.filter((s) => s.alive).length}/${st.seats.length} seats back (desired=running)`);
      } catch (e) {
        guiLog(home, `restart-resume: ${p} SKIPPED — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // ── the preview proxies (satellite windows + Launch in Chrome, 2026-08-13;
  // PER WORKSPACE since the lifecycle PDR): previews live on THIS host's
  // loopback (a rig dev server) — an address the operator's machine cannot
  // reach. Each workspace gets its OWN forwarding listener reading its OWN
  // pointed target — the singleton that followed the last-attached project
  // is gone. All ports ride the app-url handshake (&pv=p1,p2,…) so the
  // remote tunnel forwards every workspace's previews. Loopback-only and
  // token-free BY POSTURE (the fonts precedent): pointing a target requires
  // the tokened cockpit call; a proxy only forwards to the operator's own
  // dev server. WS upgrades pipe through so HMR stays quiet in satellites.
  // unref'd: they serve while the process lives, never hold it open.
  for (const w of (await import("./workspaces.js")).listWorkspaces(home)) {
    if (w.rig) await ensureProxyFor(w.path);
  }
  if (state.project) await ensureProxyFor(state.project);
  const firstPort = state.project !== undefined ? state.previewProxyPorts.get(state.project) : undefined;
  const previewProxyPort = firstPort ?? [...state.previewProxyPorts.values()][0] ?? 0;
  return {
    server,
    port,
    token,
    url: `http://127.0.0.1:${port}/?token=${token}`,
    state,
    previewProxyPort,
    previewProxyPorts: [...state.previewProxyPorts.values()],
  };
}
