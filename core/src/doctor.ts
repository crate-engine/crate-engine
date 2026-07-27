// P4-9: doctor — the preview-chain (and attach-health) checks, cli_deps-style.
// One plain table, one actionable line per failure. Advisory by design: attach
// RUNS it and reports; it never blocks (PREVIEW_PROVIDER=none stays the
// zero-dependency baseline).
import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { agentProblem, type AgentProblem } from "./detect.js";
import { deriveBrainRoot, isUnwalledSeat } from "./launcher.js";
import { loadLoadout, loadoutPath, SEATS } from "./manifest.js";
import { loadUserDefaults, parseRigConf, resolveSeat } from "./staffing.js";

const execFileP = promisify(execFile);

export type CheckStatus = "ok" | "warn" | "info";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  /** The one actionable line shown on a warn. */
  fix?: string;
}

async function run(cmd: string, args: string[], timeoutMs = 8000): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await execFileP(cmd, args, { timeout: timeoutMs });
    return { ok: true, stdout };
  } catch (e) {
    const stdout = (e as { stdout?: string }).stdout ?? "";
    return { ok: false, stdout };
  }
}

async function httpStatus(url: string, timeoutMs = 10000): Promise<string> {
  const r = await run("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", String(timeoutMs / 1000), url]);
  return r.stdout.trim() || "000";
}

export async function runDoctor(projectRoot: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const agents = join(projectRoot, ".agents");
  const conf = existsSync(join(agents, "rig.conf"))
    ? parseRigConf(readFileSync(join(agents, "rig.conf"), "utf8"))
    : {};

  // 1 — engine wiring (attach health)
  const dangling: string[] = [];
  for (const part of ["bin", "config", "adapters"]) {
    const link = join(agents, part);
    try {
      if (!lstatSync(link).isSymbolicLink() || !existsSync(link)) dangling.push(part);
    } catch {
      dangling.push(part);
    }
  }
  results.push(
    dangling.length === 0
      ? { name: "engine wiring", status: "ok", detail: `symlinks resolve (${readlinkSync(join(agents, "bin"))})` }
      : {
          name: "engine wiring",
          status: "warn",
          detail: `broken/missing: ${dangling.join(", ")} (moved brain?)`,
          fix: "re-run: crate2 attach <project> — it re-points the links at ~/.crate/engine",
        },
  );

  // 1b — engine core deps (a fresh clone ships no node_modules; the Phase-6
  // installer will automate this — until then doctor names the one-time step)
  if (dangling.length === 0) {
    try {
      const brainBin = readlinkSync(join(agents, "bin"));
      const coreNm = join(brainBin, "..", "core", "node_modules");
      results.push(
        existsSync(coreNm)
          ? { name: "engine core deps", status: "ok", detail: "core/node_modules present (seat tools in-box)" }
          : {
              name: "engine core deps",
              status: "warn",
              detail: "core/node_modules missing — seat tools (qa-sweep, agent-browser, rg) cannot run",
              fix: `one-time: cd ${join(brainBin, "..", "core")} && npm install`,
            },
      );
      // W4 finding #2b: the SEAT's view of its tools, not just the host's —
      // the runner prepends <brain>/core/tools to every seat PATH; verify the
      // shim's key bins are actually there and executable.
      const toolsDir = join(brainBin, "..", "core", "tools");
      const wanted = ["qa-sweep", "agent-browser", "axe-check", "rg"];
      const missing = wanted.filter((t) => {
        try {
          accessSync(join(toolsDir, t), fsConstants.X_OK);
          return false;
        } catch {
          return true;
        }
      });
      results.push(
        missing.length === 0
          ? { name: "seat tools shim", status: "ok", detail: "core/tools on every seat PATH — qa-sweep, agent-browser, axe-check, rg reachable" }
          : {
              name: "seat tools shim",
              status: "warn",
              detail: `core/tools is missing ${missing.join(", ")} — the QA/review seats will report partial verification`,
              fix: `one-time: cd ${join(brainBin, "..", "core")} && npm install`,
            },
      );
    } catch {
      /* wiring already warned above */
    }
  }

  // 1c — unwalled claude/codex seats (C-interim visibility; FLAWS Phase-5
  // exit criterion, extended by "codex-seat walling")
  if (dangling.length === 0) {
    try {
      const brainRoot = deriveBrainRoot(projectRoot);
      const userDefaults = loadUserDefaults(process.env.HOME ?? "");
      const flagged = SEATS.filter((seat) => {
        const loadout = existsSync(loadoutPath(brainRoot, seat)) ? loadLoadout(brainRoot, seat) : undefined;
        return isUnwalledSeat(resolveSeat(seat, loadout, { rigConf: conf, userDefaults }).agent, loadout);
      });
      results.push(
        flagged.length === 0
          ? { name: "seat containment", status: "ok", detail: "every claude/codex seat launches behind a rendered wall (P5-0a structural)" }
          : {
              name: "seat containment",
              status: "warn",
              detail: `claude/codex staffed on unwallable seat(s): ${flagged.join(", ")} (no loadout / sandbox: none) — boot will REFUSE`,
              fix: "give the seat a walled loadout or staff a different agent (P5-0a: no engine-launched claude/codex runs unwalled)",
            },
      );
    } catch {
      /* staffing unreadable — wiring/manifest checks carry the failure */
    }
  }

  // 1d — agents ready (detection, not installation: the engine assumes your
  // agents are already on the machine and signed in; boot refuses loudly too)
  if (dangling.length === 0) {
    try {
      const problems = rigAuthProblems(projectRoot, process.env.HOME ?? "");
      results.push(
        problems.length === 0
          ? { name: "agents ready", status: "ok", detail: "every staffed agent is installed and signed in on this machine" }
          : {
              name: "agents ready",
              status: "warn",
              detail: `not ready: ${problems.map((p) => p.agent).join(", ")} — the team cannot boot until every staffed agent is installed and signed in`,
              fix: problems.map((p) => p.fix).join("  ·  "),
            },
      );
    } catch {
      /* staffing unreadable — earlier checks carry it */
    }
  }

  // 2 — dev-server backend for this platform
  if (process.platform === "darwin") {
    const ld = await run("launchctl", ["print", `gui/${process.getuid?.() ?? 501}`]);
    results.push(
      ld.ok
        ? { name: "dev-server backend", status: "ok", detail: "launchd gui domain reachable" }
        : { name: "dev-server backend", status: "warn", detail: "launchctl gui domain unreachable", fix: "log in to the Mac GUI session (launchd user services need it)" },
    );
  } else {
    const sd = await run("systemctl", ["--user", "show-environment"]);
    results.push(
      sd.ok
        ? { name: "dev-server backend", status: "ok", detail: "systemd --user reachable" }
        : { name: "dev-server backend", status: "warn", detail: "systemd --user unreachable", fix: "enable lingering / set XDG_RUNTIME_DIR (see bin/dev-server)" },
    );
  }

  // 3 — dev port sanity
  const port =
    conf.DEV_PORT || (conf.DEV_URL ? (conf.DEV_URL.match(/:(\d+)/g)?.pop() ?? ":3000").slice(1) : "3000");
  const devCode = await httpStatus(`http://localhost:${port}/`, 6000);
  results.push(
    devCode !== "000"
      ? { name: "dev server", status: "ok", detail: `localhost:${port} answers (HTTP ${devCode})` }
      : {
          name: "dev server",
          status: "info",
          detail: `not running yet (normal — nothing to preview until the team builds something)`,
          fix: `your team starts it when it needs previews — or yourself: .agents/bin/dev-server up ${projectRoot}`,
        },
  );

  // 4 — preview provider chain
  const provider = conf.PREVIEW_PROVIDER || "none";
  if (provider === "none") {
    results.push({
      name: "preview transport",
      status: "info",
      detail: "provider=none — LAN baseline (same-network previews only, zero deps)",
      fix: "for previews from anywhere: set PREVIEW_PROVIDER=tailscale in rig.conf",
    });
  } else if (provider === "custom") {
    results.push(
      conf.PREVIEW_URL
        ? { name: "preview transport", status: "ok", detail: `provider=custom → ${conf.PREVIEW_URL}` }
        : { name: "preview transport", status: "warn", detail: "provider=custom but PREVIEW_URL is empty", fix: "set PREVIEW_URL in rig.conf (custom = you manage the transport)" },
    );
  } else if (provider === "tailscale") {
    const bin = await run("tailscale", ["version"], 4000);
    if (!bin.ok) {
      results.push({
        name: "preview transport",
        status: "warn",
        detail: "provider=tailscale but the tailscale CLI is not on PATH",
        fix: "install Tailscale, then: sudo tailscale up && .agents/bin/preview-tunnel up",
      });
    } else {
      const st = await run("tailscale", ["status"], 6000);
      results.push(
        st.ok
          ? { name: "preview transport", status: "ok", detail: "tailscale installed and logged in" }
          : { name: "preview transport", status: "warn", detail: "tailscale installed but not up/logged in", fix: "sudo tailscale up  (then .agents/bin/preview-tunnel up)" },
      );
      // end-to-end: only meaningful when a tunnel URL exists AND tailscale is up
      if (st.ok && conf.PREVIEW_URL) {
        const code = await httpStatus(`${conf.PREVIEW_URL}/`, 15000);
        if (code === "200" || code === "307" || code === "308") {
          results.push({ name: "preview chain", status: "ok", detail: `${conf.PREVIEW_URL} → HTTP ${code} end-to-end` });
        } else if (code === "403") {
          results.push({
            name: "preview chain",
            status: "warn",
            detail: `${conf.PREVIEW_URL} → 403 (the dev server rejected the tunnel's Host header)`,
            fix: "allow the tailnet host in the dev server (vite: server.allowedHosts: ['.ts.net'])",
          });
        } else if (code === "502" || code === "000") {
          results.push({
            name: "preview chain",
            status: "warn",
            detail: `${conf.PREVIEW_URL} → ${code === "000" ? "no answer" : "502"} (tunnel up, dev server not reachable behind it)`,
            fix: `start the dev server (.agents/bin/dev-server up) — and check it listens on localhost:${port}`,
          });
        } else {
          results.push({ name: "preview chain", status: "info", detail: `${conf.PREVIEW_URL} → HTTP ${code}` });
        }
      }
    }
  }

  // 5 — QR path (no external fallback exists anymore — P4-10). A missing segno
  // is offered by the attach screen's one-time tooling box (designer loadout).
  const segno = await run("python3", ["-c", "import segno"], 6000);
  results.push(
    segno.ok
      ? { name: "QR generator", status: "ok", detail: "python3 + segno present (offline QR)" }
      : {
          name: "QR generator",
          status: "warn",
          detail: "the QR maker for phone-preview cards isn't installed yet",
          fix: 'one click: the "One-time seat tooling" box below installs it — or: pip3 install --user segno',
        },
  );

  return results;
}

// ── agents-ready: detection is a first-class check (P6-6 direction change) ──
// The engine assumes the user's agents are already installed and signed in;
// this check tells the truth when they aren't (binary + markers — detect.ts).

/** Detection problems for the rig's STAFFED agents (dedup by agent). */
export function rigAuthProblems(projectRoot: string, home: string): AgentProblem[] {
  const agents = join(projectRoot, ".agents");
  const conf = existsSync(join(agents, "rig.conf"))
    ? parseRigConf(readFileSync(join(agents, "rig.conf"), "utf8"))
    : {};
  const brainRoot = deriveBrainRoot(projectRoot);
  const userDefaults = loadUserDefaults(home);
  const out: AgentProblem[] = [];
  const seen = new Set<string>();
  const modelsByAgent = new Map<string, string[]>();
  for (const seat of SEATS) {
    const loadout = existsSync(loadoutPath(brainRoot, seat)) ? loadLoadout(brainRoot, seat) : undefined;
    const staffed = resolveSeat(seat, loadout, { rigConf: conf, userDefaults });
    if (seen.has(staffed.agent)) {
      modelsByAgent.get(staffed.agent)!.push(staffed.model);
      continue;
    }
    seen.add(staffed.agent);
    modelsByAgent.set(staffed.agent, [staffed.model]);
  }
  for (const agent of seen) {
    // deep (run #10): ask the harness itself, not just the markers — a stale
    // keychain credential must surface HERE (the Check screen), not at boot
    const p = agentProblem(agent, home, modelsByAgent.get(agent), { deep: true });
    if (p) out.push(p);
  }
  return out;
}

// ── P6-1: heavy seat-deps at first attach (G2) ───────────────────────────────
// The installer keeps install fast; a STAFFED loadout's `cli_deps` entries with
// `heavy: true` (e.g. Playwright's browser download) are offered — disclosed,
// never silent, never blocking — when the seat is actually attached.

export interface HeavyDep {
  seat: string;
  name: string;
  check: string;
  install: string;
  /** Plain-words purpose from the loadout (shown to the user by the box). */
  why?: string;
}

/** Heavy deps declared by the rig's loadouts whose check currently FAILS (dedup by install). */
export async function heavyDeps(projectRoot: string): Promise<HeavyDep[]> {
  const brainRoot = deriveBrainRoot(projectRoot);
  const out: HeavyDep[] = [];
  const seen = new Set<string>();
  for (const seat of SEATS) {
    const loadout = existsSync(loadoutPath(brainRoot, seat)) ? loadLoadout(brainRoot, seat) : undefined;
    if (!loadout) continue;
    // the loadout declares what the seat's JOB needs — harness-independent
    for (const dep of loadout.cli_deps) {
      if (!dep.heavy || !dep.install || seen.has(dep.install)) continue;
      const ok = await run("bash", ["-c", dep.check], 8000);
      if (!ok.ok) {
        seen.add(dep.install);
        out.push({ seat, name: dep.name, check: dep.check, install: dep.install, ...(dep.why ? { why: dep.why } : {}) });
      }
    }
  }
  return out;
}

/** Run the disclosed installs (after user confirmation); re-check each. */
export async function installHeavyDeps(
  deps: HeavyDep[],
): Promise<Array<{ name: string; ok: boolean; detail: string }>> {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  for (const d of deps) {
    try {
      await execFileP("bash", ["-c", d.install], { timeout: 600000 });
      const re = await run("bash", ["-c", d.check], 8000);
      results.push({
        name: d.name,
        ok: re.ok,
        detail: re.ok ? "installed and check green" : "install ran but the check still fails",
      });
    } catch (e) {
      results.push({ name: d.name, ok: false, detail: e instanceof Error ? e.message.split("\n")[0]! : String(e) });
    }
  }
  return results;
}

export function formatDoctor(results: CheckResult[]): string {
  const mark: Record<CheckStatus, string> = { ok: "[ok]", warn: "[!!]", info: "[--]" };
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${mark[r.status]} ${r.name.padEnd(20)} ${r.detail}`);
    if (r.status !== "ok" && r.fix) lines.push(`     fix: ${r.fix}`);
  }
  return lines.join("\n");
}
