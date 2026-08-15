#!/usr/bin/env node
// crate2 — the 2.0 CLI (Phase 1: up/print/relaunch · Phase 4: setup/update/attach).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLoadout, loadoutPath, SEATS, type Seat } from "./manifest.js";
import { buildInvocation, toShellCommand } from "./invocation.js";
import { deriveBrainRoot, isUnwalledSeat, planSeats, resolveRigSeats, type ResolvedRigSeat } from "./launcher.js";
import { listOverlayEntries, overlayDirFor } from "./overlay.js";
import { loadUserDefaults, parseRigConf, resolveSeatDetailed, RIG_PREFIX } from "./staffing.js";
import { setupTier, tierPaths, updateEngine } from "./usertier.js";

function fail(msg: string): never {
  console.error(`crate2: ${msg}`);
  process.exit(1);
}

async function promptYesNo(question: string): Promise<boolean> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

const HOME = process.env.HOME ?? "";

/** Dev default engine source = this working clone (gate answer Q3); the
 * product default for Phase 6 is PRODUCT_ENGINE_ORIGIN (see usertier.ts). */
function defaultEngineSource(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Staffing table with provenance for ALL five seats (P4-1). */
function printStaffingTable(projectRoot: string): void {
  const brainRoot = deriveBrainRoot(projectRoot);
  const confFile = join(projectRoot, ".agents", "rig.conf");
  const conf = existsSync(confFile) ? parseRigConf(readFileSync(confFile, "utf8")) : {};
  const userDefaults = loadUserDefaults(HOME);
  console.log(`staffing for ${projectRoot}`);
  console.log(`(precedence: rig.conf → user default (~/.crate/defaults.yaml) → loadout floor)`);
  const refusals: [string, string][] = [];
  for (const seat of SEATS) {
    const loadout = existsSync(loadoutPath(brainRoot, seat)) ? loadLoadout(brainRoot, seat) : undefined;
    const d = resolveSeatDetailed(seat, loadout, { rigConf: conf, userDefaults });
    const model = d.model.value === "" ? "(login picks)" : d.model.value;
    const flag = isUnwalledSeat(d.agent.value, loadout);
    if (flag) refusals.push([seat, d.agent.value]);
    console.log(
      `  ${seat.padEnd(13)} agent=${d.agent.value.padEnd(8)} [${d.agent.source}]`.padEnd(46) +
        `  model=${model} [${d.model.source}]${flag ? `  [WILL REFUSE — unwallable ${d.agent.value}]` : ""}`,
    );
  }
  for (const [seat, agent] of refusals) {
    console.error(
      `  NOTE: ${seat} staffs ${agent} on a seat that cannot be walled (no loadout / sandbox: none) — ` +
        `boot will REFUSE (P5-0a: every engine-launched claude/codex seat is walled).`,
    );
  }
  const overlays = listOverlayEntries(overlayDirFor(HOME));
  if (overlays.length > 0) {
    console.log(`active overlays (~/.crate/overlay — composed into the brain at launch):`);
    for (const o of overlays) console.log(`  ${o.relPath} (${o.mode})`);
  }
}

const [, , command, ...rest] = process.argv;

switch (command) {
  case "--version":
  case "version": {
    // P6-0: report the engine clone's HEAD + update availability (shipped surface).
    const { engineVersion } = await import("./gui/server.js");
    const v = engineVersion(HOME);
    console.log(`crate (Crate Engine 2.0) — engine ${v.version}${v.updateAvailable ? "  [update available: crate update]" : ""}`);
    break;
  }
  case "setup": {
    // crate2 setup [--engine-source <path|url>] — create/heal ~/.crate (P4-0).
    const sIdx = rest.indexOf("--engine-source");
    const source = sIdx !== -1 ? (rest[sIdx + 1] ?? fail("--engine-source needs a value")) : defaultEngineSource();
    try {
      const report = setupTier(HOME, { engineSource: source });
      const t = tierPaths(HOME);
      console.log(`crate2 setup — user tier at ${t.root}`);
      for (const a of report.actions) console.log(`  ${a}`);
      console.log(`next: set your global team in ${t.defaultsFile}, then attach a repo: crate2 attach`);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
    break;
  }
  case "update": {
    // crate2 update — fast-forward the pristine engine clone + compat pass (P4-6).
    try {
      const r = updateEngine(HOME);
      if (r.before === r.after) console.log(`crate2 update — already up to date (${r.after.slice(0, 7)})`);
      else console.log(`crate2 update — engine ${r.before.slice(0, 7)} → ${r.after.slice(0, 7)} (fast-forward)`);
      if (r.flagged.length > 0) {
        console.log(`REVIEW — ${r.flagged.length} overlay ${r.flagged.length === 1 ? "entry sits" : "entries sit"} on a changed base:`);
        for (const f of r.flagged) console.log(`  ⚑ ${f.note}`);
      } else {
        console.log(`overlay: all entries compatible (no base changes under your customizations)`);
      }
      // Shim drift (Superman gate, 2026-08-10): update pulled the engine but
      // the ~/.local/bin/crate LAUNCHER stayed whatever the installer laid
      // down — shim fixes never reached installed machines. Refresh it from
      // the updated engine (safe mid-run: the shim already exec'd into node).
      try {
        const { copyFileSync: cpf, chmodSync, existsSync: exs } = await import("node:fs");
        const shimSrc = join(HOME, ".crate", "engine", "installer", "crate");
        const shimDst = join(HOME, ".local", "bin", "crate");
        if (exs(shimSrc) && exs(shimDst)) {
          cpf(shimSrc, shimDst);
          chmodSync(shimDst, 0o755);
        }
      } catch { /* a read-only ~/.local/bin never blocks the engine update */ }
      // Dependency drift (native-seat-access, 2026-08-10): an update can bring
      // NEW npm deps (e.g. the PTY backend) — the overlay copies code but never
      // installed packages, so an updated engine would crash importing them.
      // A real update runs npm install in the engine core (fast when nothing
      // changed; honest note when it fails — the engine still runs, the new
      // feature says what to do).
      if (r.before !== r.after) {
        try {
          const { execFileSync: exf } = await import("node:child_process");
          exf("npm", ["install", "--no-audit", "--no-fund"], {
            cwd: join(HOME, ".crate", "engine", "core"),
            stdio: "pipe",
            timeout: 300_000,
          });
          console.log("deps: engine packages synced (npm install)");
        } catch {
          console.log("deps: npm install FAILED — new features may need it: cd ~/.crate/engine/core && npm install");
        }
      }
      // Native shell drift (native-mac-shell PDR, 2026-08-11): the Swift app
      // is a compiled frame around the web cockpit — engine updates reach it
      // free, but a change to the SHELL's own source needs a rebuild nobody
      // will remember. When an update touched apps/mac-shell and the app is
      // installed (and swiftc exists), rebuild it right here — updates stay
      // ONE command.
      if (r.before !== r.after && process.platform === "darwin") {
        try {
          const { execFileSync: exf2 } = await import("node:child_process");
          const engineDir = join(HOME, ".crate", "engine");
          const touched = exf2("git", ["diff", "--name-only", `${r.before}..${r.after}`], {
            cwd: engineDir, encoding: "utf8", timeout: 15000,
          }).includes("apps/mac-shell/");
          const appInstalled = existsSync("/Applications/Crate Engine.app");
          const buildSh = join(engineDir, "apps", "mac-shell", "build.sh");
          if (touched && appInstalled && existsSync(buildSh)) {
            exf2("bash", [buildSh], { stdio: "pipe", timeout: 180_000 });
            console.log("native shell: Crate Engine.app rebuilt (this update changed the shell) — relaunch it to get the new frame");
          }
        } catch {
          console.log("native shell: rebuild FAILED — run it by hand: bash ~/.crate/engine/apps/mac-shell/build.sh");
        }
      }
      // The Linux twin of the same law (native linux shell, 2026-08-15): the
      // GTK shell is an installed COPY of apps/linux-shell/main.py — engine
      // updates reach the cockpit free, but a shell-source change needs the
      // reinstall nobody will remember. Updates stay ONE command.
      if (r.before !== r.after && process.platform === "linux") {
        try {
          const { execFileSync: exf3 } = await import("node:child_process");
          const engineDir = join(HOME, ".crate", "engine");
          const touched = exf3("git", ["diff", "--name-only", `${r.before}..${r.after}`], {
            cwd: engineDir, encoding: "utf8", timeout: 15000,
          }).includes("apps/linux-shell/");
          const shellInstalled = existsSync(join(HOME, ".local", "lib", "crate-shell", "main.py"));
          const installSh = join(engineDir, "apps", "linux-shell", "install.sh");
          if (touched && shellInstalled && existsSync(installSh)) {
            exf3("bash", [installSh], { stdio: "pipe", timeout: 60_000 });
            console.log("native shell: Crate Engine (GTK) refreshed (this update changed the shell) — relaunch it to get the new frame");
          }
        } catch {
          console.log("native shell: refresh FAILED — run it by hand: bash ~/.crate/engine/apps/linux-shell/install.sh");
        }
      }
      // Run #14 (Adam): he updated mid-session, pressed a button in the STILL-
      // RUNNING app, and got pre-update behavior — a running process keeps the
      // code it loaded at launch (the /login lesson, app edition). Say so.
      if (r.before !== r.after) {
        const { appUrlPath } = await import("./usertier.js");
        const { readFileSync: rf, existsSync: ex } = await import("node:fs");
        const f = appUrlPath(HOME);
        if (ex(f)) {
          const url = rf(f, "utf8").trim();
          const alive = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(() => true).catch(() => false);
          if (alive) {
            console.log(
              `NOTE: a Crate Engine app is RUNNING — it keeps the old engine (${r.before.slice(0, 7)}) until restarted. ` +
                `Run \`crate open\` — it detects the stale server and restarts it onto the new engine automatically ` +
                `(or \`crate stop\` to just bring it down).`,
            );
          }
        }
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
    break;
  }
  case "crew": {
    // Flaw 2 (2026-08-10): crew portability — one 0600 bundle instead of
    // hand-copied files. Claude credentials are NEVER bundled (interactive
    // login only, by doctrine).
    const sub = rest[0];
    const { buildCrewBundle, writeCrewBundle, applyCrewBundle } = await import("./crew.js");
    if (sub === "export") {
      const out = rest[1] ?? "crate-crew.json";
      const { bundle, carried, skipped } = buildCrewBundle(HOME);
      writeCrewBundle(out, bundle);
      console.log(`crate crew export — wrote ${out} (owner-only, holds API keys — treat like a password)`);
      for (const c of carried) console.log(`  carried: ~/${c}`);
      for (const s of skipped) console.log(`  skipped (absent here): ~/${s}`);
      console.log(`claude: never bundled — you sign in interactively on the target (run \`claude\`).`);
      console.log(`next:  scp ${out} <host>:~/  then on the target:  crate crew import ~/${out.split("/").pop()}`);
    } else if (sub === "import") {
      const file = rest[1];
      if (!file) fail("usage: crate crew import <bundle-file>");
      try {
        const { written } = applyCrewBundle(HOME, readFileSync(file!, "utf8"));
        console.log(`crate crew import — ${written.length} file(s) written (owner-only 0600):`);
        for (const w of written) console.log(`  ~/${w}`);
        console.log(`claude: sign in interactively on THIS machine (run \`claude\`) — its login is never carried, by design.`);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    } else {
      fail("usage: crate crew export [file] | crate crew import <file>");
    }
    break;
  }
  case "attach": {
    // crate2 attach [<target>] [--create] [--yes] [--git-init] — the guided
    // disclosing flow (P4-3): plan → disclose → confirm → execute. Nothing silent.
    const { planAttach, executeAttach, resolveTarget, AttachError } = await import("./attach.js");
    const flags = new Set(rest.filter((a) => a.startsWith("--")));
    const targetArg = rest.find((a) => !a.startsWith("--"));
    const assumeYes = flags.has("--yes") || !process.stdin.isTTY;
    try {
      const target = resolveTarget(targetArg);
      const wantsCreate = flags.has("--create") || (!target.exists && !assumeYes);
      if (!target.exists && !flags.has("--create")) {
        if (assumeYes) throw new AttachError(`${target.projectRoot} does not exist — pass --create to start a new project there.`);
        const ok = await promptYesNo(`${target.projectRoot} does not exist. Create a NEW project there?`);
        if (!ok) fail("nothing written.");
      }
      const { engineDir } = tierPaths(HOME);
      const plan = planAttach(target, engineDir, { create: wantsCreate && !target.exists ? true : flags.has("--create") });

      // ── the disclosure screen: exactly what will be added, honestly split ──
      console.log(`\n${plan.mode === "create" ? "Creating a new project" : "Attaching the team"}: ${plan.project} (${plan.projectRoot})`);
      const creates = plan.writes.filter((w) => w.action !== "keep");
      const keeps = plan.writes.filter((w) => w.action === "keep");
      const committed = creates.filter((w) => w.kind === "committed");
      const local = creates.filter((w) => w.kind === "local");
      if (committed.length > 0) {
        console.log(`\nFiles added to YOUR REPO (committed with your code):`);
        for (const w of committed) console.log(`  ${w.rel.padEnd(24)} ${w.note}`);
      }
      if (local.length > 0) {
        console.log(`\nLocal-only wiring (never pushed — auto-gitignored):`);
        for (const w of local) console.log(`  ${w.rel.padEnd(24)} ${w.note}${w.action === "heal" ? "  [repair]" : ""}`);
      }
      if (keeps.length > 0) {
        console.log(`\nAlready present (kept as-is): ${keeps.map((w) => w.rel).join(", ")}`);
      }

      let gitInit = false;
      if (plan.needsGit && plan.mode === "attach") {
        console.log(`\nNote: ${plan.project} is not a git repository.`);
        gitInit = flags.has("--git-init") || (!assumeYes && (await promptYesNo("Initialize git here (recommended)?")));
        if (!gitInit) console.log("  proceeding WITHOUT git — the team works, but there is no history/rollback.");
      }

      if (!assumeYes) {
        const ok = await promptYesNo(`\nProceed?`);
        if (!ok) fail("nothing written.");
      }

      const report = executeAttach(plan, { gitInit });
      console.log(`\ndone — ${report.changed.length} paths written${report.gitInitialized ? ", git initialized" : ""}${report.firstCommit ? `, first commit ${report.firstCommit}` : ""}.`);
      // Flaw 1: heal an inherited DEV_URL aimed at a foreign server, out loud.
      const { healDevUrl } = await import("./attach.js");
      const devHeal = await healDevUrl(plan.projectRoot);
      if (devHeal) console.log(devHeal);

      // P4-9: doctor runs at attach — reports, never blocks.
      const { runDoctor, formatDoctor, heavyDeps, installHeavyDeps } = await import("./doctor.js");
      console.log(`\ndoctor (advisory — nothing here blocks you):`);
      console.log(formatDoctor(await runDoctor(plan.projectRoot)));

      // P6-1 (G2): heavy seat-deps land HERE, disclosed — not at install.
      const heavy = await heavyDeps(plan.projectRoot);
      if (heavy.length > 0) {
        console.log(`\nOne-time seat tooling this rig's loadouts declare (large downloads — that's why they wait until now):`);
        for (const d of heavy) console.log(`  ${d.name.padEnd(20)} (${d.seat})  install: ${d.install}`);
        const yes =
          flags.has("--install-deps") || (!assumeYes && (await promptYesNo("Install them now (recommended)?")));
        if (yes) {
          for (const r of await installHeavyDeps(heavy)) {
            console.log(`  ${r.ok ? "[ok]" : "[!!]"} ${r.name} — ${r.detail}`);
          }
        } else {
          console.log(`  skipped — the seats that need them will refuse to boot until you run the install line(s) above.`);
        }
      }

      console.log(`\nNext: boot the team (the Orchestrator fills AGENTS.md on your first direction):`);
      console.log(`  crate2 up ${plan.projectRoot}`);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
    break;
  }
  case "open": {
    // crate open --remote <ssh-host> — the Mac side of the Linux headless
    // server (PDR dev/pdr/linux-headless-server.md): ensure the app is up on
    // the host (its own `crate open` headless-boots and writes ~/.crate/app-url),
    // tunnel its loopback port here, open the local ⚡ window on the tunnel.
    const rIdx = rest.indexOf("--remote");
    if (rIdx !== -1) {
      const host = rest[rIdx + 1];
      if (!host || host.startsWith("--")) fail("crate open --remote <ssh-host> — the ssh host is missing.");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const sh = promisify(execFile);
      const { parseAppUrl, tunnelPlan } = await import("./gui/remote.js");
      const { openAppWindow: openWin } = await import("./gui/appwindow.js");
      try {
        console.log(`crate open --remote: ensuring the app server is up on ${host} (headless)...`);
        await sh("ssh", ["-o", "BatchMode=yes", host!, '"$HOME/.local/bin/crate" open'], { timeout: 120000 });
        const { stdout } = await sh("ssh", ["-o", "BatchMode=yes", host!, "cat ~/.crate/app-url"], { timeout: 20000 });
        const app = parseAppUrl(stdout);
        if (!app) {
          throw new Error(
            `no app url on ${host} (~/.crate/app-url) — is Crate installed there?\n` +
              `  install: ssh ${host}, then  curl -fsSL https://crate-engine.ai/get | bash`,
          );
        }
        const plan = tunnelPlan(app, host!);
        const { spawn: sp } = await import("node:child_process");
        const tun = sp("ssh", plan.tunnelArgv, { detached: true, stdio: "ignore" });
        tun.unref(); // the tunnel outlives this command — it IS the transport
        let up = false;
        const t0 = Date.now();
        while (Date.now() - t0 < 15000 && !up) {
          await new Promise((r) => setTimeout(r, 500));
          try {
            await fetch(plan.probeUrl, { signal: AbortSignal.timeout(1500) });
            up = true; // any HTTP answer through the tunnel = alive
          } catch {
            /* keep polling */
          }
        }
        if (!up) {
          throw new Error(
            `the tunnel to ${host}:${app.port} did not come up — is local port ${app.port} taken? ` +
              `(stop whatever holds it — a local crate app? — and retry)`,
          );
        }
        // --print-url (native-mac-shell PDR): do everything EXCEPT opening a
        // browser — the native shell loads this URL in its own window.
        if (rest.includes("--print-url")) {
          console.log(plan.teamUrl);
          break;
        }
        const win = openWin(plan.teamUrl, { home: process.env.HOME ?? "" });
        console.log(
          `Crate Engine (on ${host}) is open — ${win.mode === "app" ? "the ⚡ app window" : "your browser"} is loading through the ssh tunnel.`,
        );
        console.log(plan.teamUrl);
        console.log(`(the tunnel runs in the background — close it later with:  pkill -f "127.0.0.1:${app.port}")`);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
      break;
    }
    // crate open [--project <path>] — HEADLESS + app-mode window (2.1). Start
    // the GUI server headless, open the chromeless ⚡ app window, boot the team.
    // cmux was retired in 2.1 (T8) — this is the only boot path.
    const { appUrlPath, projectAt } = await import("./usertier.js");
    const { mkdtempSync, readFileSync: rf, existsSync: ex } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const home = process.env.HOME ?? "";
    const pIdx0 = rest.indexOf("--project");
    // Project resolution (run #13): explicit flag → the project you're
    // STANDING IN (cd my-app && crate open — the multi-rig-safe anchor) →
    // else the gui falls back to the last attached project.
    const project = pIdx0 !== -1 ? resolve(rest[pIdx0 + 1] ?? ".") : projectAt(process.cwd());
    if (project && pIdx0 === -1) console.log(`crate open: opening the project here — ${project}`);
    const appAlive = async (): Promise<string | undefined> => {
      const f = appUrlPath(home);
      if (!ex(f)) return undefined;
      const url = rf(f, "utf8").trim();
      try {
        await fetch(url, { signal: AbortSignal.timeout(2000) });
        return url; // any HTTP answer = the server lives
      } catch {
        return undefined; // stale file from a previous run
      }
    };
    // T8: cmux was retired in 2.1 — headless + the app window is the only path.
    if (rest.includes("--cmux")) {
      console.log("note: --cmux was retired in 2.1 — the app is headless now; opening the app window.");
    }
    {
      try {
        const { openAppWindow, hasDisplay, headlessHandoff } = await import("./gui/appwindow.js");
        const { writeLastProject } = await import("./usertier.js");
        let url = await appAlive();
        if (url) {
          // Pack 3 (stale-reattach, live-found 2026-08-12): NEVER reattach
          // blind — a surviving server may still run the engine it loaded
          // before an update (old code kept serving while `crate update`'s
          // NOTE promised a relaunch would land the new one). Ask what it
          // LOADED, compare with disk, and restart it in place on mismatch
          // via the existing /api/restart handoff (team stops with honest
          // exit stamps and comes back by itself). Probe failures fail OPEN
          // to the old reattach — availability over freshness.
          try {
            const { serverIsStale, diskEngineSha } = await import("./gui/server.js");
            const u0 = new URL(url);
            const tok = u0.searchParams.get("token") ?? "";
            const v = (await (
              await fetch(`${u0.origin}/api/version`, { headers: { "X-Crate-Token": tok }, signal: AbortSignal.timeout(8000) })
            ).json()) as { loadedSha?: string };
            const disk = diskEngineSha(home);
            if (serverIsStale(v.loadedSha, disk)) {
              console.log(
                `crate open: the running app server is on an OLD engine (${v.loadedSha ?? "pre-update"}; disk has ${disk}) — restarting it in place...`,
              );
              const r = (await (
                await fetch(`${u0.origin}/api/restart`, { method: "POST", headers: { "X-Crate-Token": tok }, signal: AbortSignal.timeout(60000) })
              ).json()) as { ok?: boolean; url?: string };
              if (r.ok === true && r.url) {
                url = r.url.trim();
                console.log(`crate open: fresh server is up on ${disk}.`);
              } else {
                console.log(
                  `crate open: the restart did not confirm — continuing with the RUNNING (old-engine) server. ` +
                    `If it misbehaves: crate stop, then crate open.`,
                );
              }
            }
          } catch {
            /* version probe failed — reattach as before */
          }
        }
        if (url && project) {
          // already open — switch it to this project (idempotent attach)
          try {
            const u = new URL(url);
            await fetch(`${u.origin}/api/attach/execute`, {
              method: "POST",
              headers: { "X-Crate-Token": u.searchParams.get("token") ?? "", "Content-Type": "application/json" },
              body: JSON.stringify({ target: project, create: false }),
              signal: AbortSignal.timeout(15000),
            });
          } catch { /* best-effort switch */ }
        }
        if (!url) {
          // start the GUI server headless (its own detached process) and wait
          // for the tokened url handshake it writes to --url-file.
          const { spawn } = await import("node:child_process");
          const urlFile = join(mkdtempSync(join(tmpdir(), "crate-open-")), "url");
          const self = process.argv[1]!;
          const args = ["gui", "--no-pane", "--url-file", urlFile, ...(project ? ["--project", project] : [])];
          // PHASE-B #1: the server's stdout/stderr land in ~/.crate/logs/gui.log
          // (stdio:"ignore" made a mid-run server death undiagnosable).
          const { openGuiLogFd, guiLogPath } = await import("./gui/guilog.js");
          let logFd: number | "ignore" = "ignore";
          try {
            logFd = openGuiLogFd(HOME);
          } catch { /* no log file — still boot */ }
          const srv = spawn(process.execPath, [self, ...args], { detached: true, stdio: ["ignore", logFd, logFd] });
          srv.unref();
          const started = Date.now();
          while (Date.now() - started < 60000 && !url) {
            await new Promise((r) => setTimeout(r, 500));
            if (ex(urlFile)) url = rf(urlFile, "utf8").trim();
          }
          if (!url) throw new Error(`the app server did not come up (headless) — check ${guiLogPath(HOME)} and retry \`crate open\`.`);
        }
        if (project) writeLastProject(home, project);
        // Land the app window on the TEAM cockpit (headless is GUI-primary), not
        // the legacy /health welcome — carry the token + the active project.
        const u = new URL(url);
        const teamUrl = `${u.origin}/team?token=${u.searchParams.get("token") ?? ""}${project ? `&project=${encodeURIComponent(project)}` : ""}`;
        // A display-less host (linux server over ssh) boots the server exactly
        // the same but hands the WINDOW to the operator's laptop instead of
        // dead-ending in xdg-open (PDR linux-headless-server).
        // --print-url (native-mac-shell PDR): the native shell asks for the
        // door, never a browser window.
        const printOnly = rest.includes("--print-url");
        const win = !printOnly && hasDisplay() ? openAppWindow(teamUrl, { home }) : undefined;
        // boot the team (GUI-owned lifecycle) so the operator lands on a live
        // rig. S4 battle-test find (Adam, 2026-08-12): the REMOTE daily drive
        // runs this command from $HOME on the host, so the cwd-resolved
        // `project` was empty and the boot was silently SKIPPED — the app
        // opened to five "opens when the team boots" panes every time, and
        // the operator had to press Boot/Resume by hand. The server already
        // falls back to its last attached project (the page showed the right
        // rig all along) — gate the boot on that same truth, not the cwd.
        const { readLastProject } = await import("./usertier.js");
        if (project ?? readLastProject(home)) {
          try {
            await fetch(`${u.origin}/api/team/boot`, {
              method: "POST",
              headers: { "X-Crate-Token": u.searchParams.get("token") ?? "" },
              signal: AbortSignal.timeout(15000),
            });
          } catch { /* the Team menu can boot it if this misses */ }
        }
        if (printOnly) {
          console.log(teamUrl);
        } else if (win) {
          console.log(`Crate Engine is open — ${win.mode === "app" ? "the ⚡ app window" : "your browser"} is loading${project ? ` (${project})` : ""}.`);
          console.log(teamUrl);
        } else {
          console.log(headlessHandoff(teamUrl).join("\n"));
        }
        break;
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    }
    break;
  }
  case "stop": {
    // crate stop [--remote <ssh-host>] — Pack 3 (stale-reattach, cure 2): the
    // CONFIRMED way to bring the app server down. The incident's blind kill
    // "landed" on a control channel that had died with a network switch and
    // the survivor kept serving old code — so the confirmation here is the
    // server actually STOPPING TO ANSWER, and --remote runs the whole stop ON
    // the host over a fresh ssh exec (confirmed where the network cannot lie).
    const sIdx = rest.indexOf("--remote");
    if (sIdx !== -1) {
      const host = rest[sIdx + 1];
      if (!host || host.startsWith("--")) fail("crate stop --remote <ssh-host> — the ssh host is missing.");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const sh = promisify(execFile);
      try {
        const { stdout, stderr } = await sh("ssh", ["-o", "BatchMode=yes", host!, '"$HOME/.local/bin/crate" stop'], { timeout: 60000 });
        process.stdout.write(stdout);
        process.stderr.write(stderr);
      } catch (e) {
        fail(
          `could not run the stop on ${host} over ssh — the server state there is UNKNOWN (NOT confirmed stopped): ` +
            `${e instanceof Error ? e.message : String(e)}`,
        );
      }
      break;
    }
    const { appUrlPath } = await import("./usertier.js");
    const { rmSync: rmf } = await import("node:fs");
    const f = appUrlPath(HOME);
    if (!existsSync(f)) {
      console.log("crate stop: no app-server handshake here (~/.crate/app-url) — nothing to stop.");
      break;
    }
    const url = readFileSync(f, "utf8").trim();
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      try { rmf(f); } catch { /* best-effort */ }
      console.log("crate stop: the handshake file was junk — cleared; nothing to stop.");
      break;
    }
    let alive = true;
    try {
      await fetch(url, { signal: AbortSignal.timeout(2500) });
    } catch {
      alive = false;
    }
    if (!alive) {
      try { rmf(f); } catch { /* best-effort */ }
      console.log("crate stop: the app server is already down (stale handshake cleared).");
      break;
    }
    const tok = u.searchParams.get("token") ?? "";
    let pid: number | undefined;
    let accepted = false;
    try {
      const res0 = await fetch(`${u.origin}/api/shutdown`, {
        method: "POST",
        headers: { "X-Crate-Token": tok },
        signal: AbortSignal.timeout(15000),
      });
      const body = (await res0.json().catch(() => ({}))) as { ok?: boolean; pid?: number };
      accepted = res0.ok && body.ok === true;
      pid = body.pid;
    } catch {
      /* it may have died mid-response — the poll below is the truth */
    }
    // The CONFIRMATION: the server stops answering. Never report a kill that
    // was merely SENT (the whole point of this command).
    const t0 = Date.now();
    let dead = false;
    while (Date.now() - t0 < 10000 && !dead) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        await fetch(url, { signal: AbortSignal.timeout(1500) });
      } catch {
        dead = true;
      }
    }
    if (dead) {
      console.log(
        `crate stop: the app server is DOWN — confirmed (it stopped answering${pid ? `; pid was ${pid}` : ""}). ` +
          `Its team seats were stopped with it.`,
      );
    } else if (!accepted) {
      fail(
        `crate stop: this server does not know /api/shutdown (it predates crate stop) and is STILL RUNNING — ` +
          `restart it onto the disk engine instead (crate open does this automatically), or kill it by hand.`,
      );
    } else {
      fail(
        `crate stop: the server ACCEPTED the shutdown but is STILL ANSWERING after 10s${pid ? ` (pid ${pid})` : ""} — ` +
          `kill it by hand: kill ${pid ?? "<pid>"}`,
      );
    }
    break;
  }
  case "gui": {
    // crate gui [--project <path>] [--url-file <f>] — the headless app server
    // (tokened loopback). T8: no panes — `crate open` opens the app-mode window
    // and drives this server; the printed/handshake URL is the way in.
    const { startGuiServer } = await import("./gui/server.js");
    const { projectAt: projAt } = await import("./usertier.js");
    // PHASE-B #1: the black box — fatal errors/signals are logged to
    // ~/.crate/logs/gui.log and the runner children are reaped before exit.
    const { installGuiCrashLog, guiLog } = await import("./gui/guilog.js");
    const { stopAllTeams } = await import("./gui/teamproc.js");
    installGuiCrashLog(HOME, stopAllTeams);
    const pIdx = rest.indexOf("--project");
    // Same resolution as `crate open` (run #13): flag → project-you're-in →
    // (inside startGuiServer) the persisted last project.
    const project = pIdx !== -1 ? resolve(rest[pIdx + 1] ?? ".") : projAt(process.cwd());
    try {
      const gui = await startGuiServer({ project });
      guiLog(HOME, `serving on port ${gui.port} (pid ${process.pid}${gui.state.project ? `, project ${gui.state.project}` : ""})`);
      // With a project attached, land on the Start-engine preflight (W1 — the
      // /health boot screen retired); with none, the welcome/attach flow.
      const landing0 = gui.state.project ? gui.url.replace("/?token=", "/start?token=") : gui.url;
      // &pv= rides the handshake (satellite previews, 2026-08-13): the remote
      // open tunnels the preview-proxy port alongside the app port.
      const landing = gui.previewProxyPort ? `${landing0}&pv=${gui.previewProxyPort}` : landing0;
      console.log(`crate gui — serving on ${landing}`);
      const { writeFileSync: wf, mkdirSync: mkd } = await import("node:fs");
      const ufIdx = rest.indexOf("--url-file");
      if (ufIdx !== -1 && rest[ufIdx + 1]) {
        wf(rest[ufIdx + 1]!, landing); // the explicit handshake file
      }
      // the standing handshake: `crate open` (outside) waits on this file
      try {
        const { appUrlPath } = await import("./usertier.js");
        const home0 = process.env.HOME ?? "";
        mkd(join(home0, ".crate"), { recursive: true });
        wf(appUrlPath(home0), landing);
      } catch {
        /* best-effort — the URL is printed above either way */
      }
      // Runner-deaths fix (FLAWS 2026-08-11): --boot = the /api/restart
      // handoff. The old server stopped its team before exiting (so the
      // runners died with EXIT stamps, not as orphans) and passes this flag
      // iff the team WAS running — we bring it back so the relaunched cockpit
      // lands on a live rig, not five booted:false seats. Flag-gated: a plain
      // `crate gui` never auto-boots; boot() is idempotent, so a later
      // crate-open boot POST landing on top of this is harmless.
      if (rest.includes("--boot") && gui.state.project && existsSync(join(gui.state.project, ".agents", "rig.conf"))) {
        try {
          // The blend starter MUST ride this boot (five-dead-seats fix,
          // 2026-08-13): a starter-less boot spawns runner children, and
          // S4's double-consumer refusal kills them on sight — worse, the
          // starter-less TeamProcess used to stick in the registry.
          const { teamProcessFor, defaultSeatSpawner, defaultBlendStarter } = await import("./gui/teamproc.js");
          const st = teamProcessFor(gui.state.project, defaultSeatSpawner(gui.state.cliPath, gui.state.home), defaultBlendStarter(gui.state.home)).boot();
          guiLog(HOME, `restart handoff: team rebooted — ${st.seats.map((s) => `${s.seat}:${s.pid ?? "?"}`).join(" ")}`);
        } catch (e) {
          guiLog(HOME, `restart handoff: team reboot FAILED — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      console.log(`  Ctrl+C stops the app server.`);
      await new Promise(() => {}); // serve until interrupted
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
    break;
  }
  case "doctor": {
    // crate2 doctor [--project <path>] — the P4-9 preview-chain / attach-health table.
    const { runDoctor, formatDoctor } = await import("./doctor.js");
    const pIdx = rest.indexOf("--project");
    const projectRoot = resolve(pIdx !== -1 ? (rest[pIdx + 1] ?? ".") : ".");
    console.log(formatDoctor(await runDoctor(projectRoot)));
    break;
  }
  case "up": {
    // T8: `crate up` (cmux-pane boot) retired in 2.1 — boot the team headless.
    fail("`crate up` was retired in 2.1 (cmux is gone). Boot the team headless with `crate open` (opens the app window), or `crate team` for a headless-only run.");
    break;
  }
  case "runner": {
    // crate runner <seat> [--project <path>] [--once] — PHASE-8 T1: host one
    // seat headless (turn-per-invocation; the pane's replacement). --once
    // processes a single turn and exits (probes/tests); default is the
    // standing loop.
    const seat = rest[0];
    if (!seat || !(SEATS as readonly string[]).includes(seat)) fail(`usage: crate runner <${SEATS.join("|")}> [--project <path>] [--once]`);
    const pIdx = rest.indexOf("--project");
    const projectRoot = resolve(pIdx !== -1 ? (rest[pIdx + 1] ?? ".") : ".");
    const confFile = join(projectRoot, ".agents", "rig.conf");
    if (!existsSync(confFile)) fail(`no rig.conf at ${confFile} — run crate install first`);
    const conf = parseRigConf(readFileSync(confFile, "utf8"));
    // team-defaults fix (FLAWS "crate team ignores ~/.crate/defaults.yaml"):
    // staffing resolves through the ONE
    // canonical chain (rig.conf → ~/.crate/defaults.yaml → loadout floor) —
    // the same resolution `crate print`, doctor, and the GUI staffing screen
    // display. The old hand-rolled `conf[key] || "pi"` meant a fresh rig.conf
    // ran bare pi on the ACCOUNT default model; and since the GUI's team boot
    // spawns `crate runner <seat>` per seat, THIS line is what makes the
    // staffing screen's promise true at runtime.
    let resolvedSeats: ResolvedRigSeat[];
    try {
      resolvedSeats = resolveRigSeats(projectRoot, HOME);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
    const staffed = resolvedSeats.find((s) => s.seat === seat)!;
    const { agent, model } = staffed;
    // S4 (blend = the default): a blended seat's mail is delivered by the
    // engine app straight into its live pane — a headless runner alongside
    // it would DOUBLE-CONSUME the seat's inbox (two readers, one maildir).
    // Refuse in plain words; BLEND_<PREFIX>=0 is the per-seat opt-out.
    {
      const { isBlended } = await import("./blend.js");
      if (isBlended(conf, seat as Seat, agent)) {
        fail(
          `${seat} is BLENDED (the default for ${agent}) — the engine app (crate open) ` +
            `delivers its mail into the live pane, and a second headless runner would double-consume the seat's ` +
            `inbox. Set rig.conf BLEND_${RIG_PREFIX[seat as Seat]}=0 to opt this seat out and run it headless.`,
        );
      }
    }
    const { runTurn, runnerLoop, bootWall } = await import("./runner.js");
    // T6: resolve + cache the wall at boot — a walled-required seat that cannot
    // be walled refuses HERE, in plain words, not on its first turn; the first
    // turn reuses this exact render (no second probe).
    let wallNote = "unwalled";
    try {
      wallNote = bootWall(projectRoot, seat!, agent);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
    console.log(
      `crate runner — ${seat} headless (${agent}${model ? `/${model}` : ""} ` +
        `[agent: ${staffed.agentSource}, model: ${staffed.modelSource}], ${wallNote}) on ${projectRoot}`,
    );
    if (rest.includes("--once")) {
      const r = await runTurn({ projectRoot, seat: seat!, agent, model });
      console.log(r.idle ? "idle (no unread mail)" : r.ok ? `turn ok — log: ${r.logPath}` : `turn FAILED — ${r.error} (mail retained; log: ${r.logPath})`);
      if (!r.ok) process.exitCode = 1;
    } else {
      const autoRefresh = ["1","true","yes","on"].includes((conf.CONTEXT_AUTO_REFRESH||"").toLowerCase());
      // Runner-deaths fix (FLAWS 2026-08-11): a supervisor-spawned runner is
      // told its supervisor's pid up front (env, set before we existed) so the
      // orphan watchdog can't mistake a mid-boot reparent for its real parent.
      // Standalone `crate runner` (no env) keeps the captured-ppid behavior.
      const supPid = Number(process.env.CRATE_SUPERVISOR_PID);
      await runnerLoop({
        projectRoot,
        seat: seat!,
        agent,
        model,
        contextAutoRefresh: autoRefresh,
        ...(Number.isInteger(supPid) && supPid > 0 ? { supervisorPid: supPid } : {}),
      });
    }
    break;
  }
  case "team": {
    // crate team [--project <path>] — PHASE-8 T3: host ALL seats headless in
    // one supervisor process (the pane-less rig). Each seat gets its own
    // runnerLoop; the GUI is the window.
    const pIdx = rest.indexOf("--project");
    const projectRoot = resolve(pIdx !== -1 ? (rest[pIdx + 1] ?? ".") : ".");
    const confFile = join(projectRoot, ".agents", "rig.conf");
    if (!existsSync(confFile)) fail(`no rig.conf at ${confFile} — run crate install first`);
    const conf = parseRigConf(readFileSync(confFile, "utf8"));
    const { runnerLoop, bootWall } = await import("./runner.js");
    console.log(`crate team — ${projectRoot} headless (no cmux). Seats:`);
    const ac = new AbortController();
    process.on("SIGINT", () => { console.log("\ncrate team: stopping seats…"); ac.abort(); });
    const autoRefresh = ["1","true","yes","on"].includes((conf.CONTEXT_AUTO_REFRESH||"").toLowerCase());
    if (autoRefresh) console.log("  context auto-refresh: ON (ceiling)");
    // team-defaults fix (FLAWS "crate team ignores ~/.crate/defaults.yaml"):
    // per-seat staffing goes through the ONE canonical chain (rig.conf →
    // ~/.crate/defaults.yaml → loadout floor) instead of the old hand-rolled
    // `conf[key] || "pi"` — a fresh rig.conf now boots the user's default
    // roster, exactly what `crate print` and the GUI staffing screen promise.
    let resolvedSeats: ResolvedRigSeat[];
    try {
      resolvedSeats = resolveRigSeats(projectRoot, HOME);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
    // T6: resolve + cache every seat's wall at boot — one unwallable
    // walled-required seat refuses the whole boot, in plain words, before any
    // turn runs; each first turn reuses its boot render.
    const staffing = resolvedSeats.map((s) => {
      let wallNote = "unwalled";
      try {
        wallNote = bootWall(projectRoot, s.seat, s.agent);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
      return { ...s, wallNote };
    });
    // S4: blending is an engine-app feature (the pane lives in the GUI
    // server's PTY registry) and the DEFAULT there — a headless-only run
    // keeps every seat on the runner path, and says so once instead of
    // silently downgrading the experience.
    {
      const { isBlended } = await import("./blend.js");
      if (staffing.some((s) => isBlended(conf, s.seat, s.agent))) {
        console.log(`  note: seats blend by default under the engine app (crate open) — this headless-only run keeps them on the runner path.`);
      }
    }
    const loops = staffing.map(({ seat, agent, model, agentSource, modelSource, wallNote }) => {
      console.log(
        `  ${seat.padEnd(13)} ${agent}${model ? `/${model}` : ""} ` +
          `[agent: ${agentSource}, model: ${modelSource}]  [${wallNote}]`,
      );
      return runnerLoop({ projectRoot, seat, agent, model, signal: ac.signal, contextAutoRefresh: autoRefresh });
    });
    await Promise.all(loops);
    break;
  }
  case "print": {
    // crate2 print [<seat>] [--project <path>] — no seat: the staffing table
    // with provenance for all five seats (P4-1); a seat: its exact launch plan.
    const pIdx = rest.indexOf("--project");
    const projectRoot = resolve(pIdx !== -1 ? (rest[pIdx + 1] ?? ".") : ".");
    if (rest[0] === undefined || rest[0].startsWith("--")) {
      try {
        printStaffingTable(projectRoot);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
      break;
    }
    const seat = rest[0] as Seat;
    if (!SEATS.includes(seat)) fail(`unknown seat "${rest[0]}" (expected one of: ${SEATS.join(", ")})`);
    // print never refuses (preflight off): it's the tool you debug a missing dep WITH.
    const { seats, brainRoot } = await planSeats(projectRoot, { preflight: false }).catch((e) =>
      fail(e instanceof Error ? e.message : String(e)),
    );
    const plan = seats.find((s) => s.seat === seat)!;
    const confFile = join(projectRoot, ".agents", "rig.conf");
    const conf = existsSync(confFile) ? parseRigConf(readFileSync(confFile, "utf8")) : {};
    const pristine = deriveBrainRoot(projectRoot);
    const seatLoadout = existsSync(loadoutPath(pristine, seat)) ? loadLoadout(pristine, seat) : undefined;
    const prov = resolveSeatDetailed(seat, seatLoadout, {
      rigConf: conf,
      userDefaults: loadUserDefaults(HOME),
    });
    console.log(`seat:     ${plan.seat} ("${plan.title}")`);
    console.log(
      `staffed:  ${plan.staffed.agent}${plan.staffed.model ? `/${plan.staffed.model}` : " (login picks)"}` +
        `  (agent: ${prov.agent.source}, model: ${prov.model.source})`,
    );
    console.log(`path:     ${plan.manifestDriven ? "manifest-driven (2.0)" : "v1 adapter"}`);
    console.log(`launch:   ${plan.launchCommand}`);
    if (plan.manifestDriven) {
      const loadout = loadLoadout(brainRoot, seat);
      if (loadout.agent === "pi") {
        const inv = buildInvocation(loadout, plan.staffed, { brainRoot, projectRoot });
        console.log(`argv:     ${toShellCommand(inv)}`);
      } else {
        console.log(`agent:    ${loadout.agent} (own toolkit — launch line from the v1 adapter, see the script)`);
      }
      console.log(`sandbox:  ${plan.sandbox}${plan.profilePath ? `  (profile: ${plan.profilePath})` : "  (unwrapped)"}`);
      if (loadout.policy.sandbox_doors.length > 0) {
        console.log(`doors:    ${loadout.policy.sandbox_doors.join("  ")}`);
      }
    }
    if (!plan.manifestDriven && plan.profilePath) {
      console.log(`wall:     ${plan.sandbox} (adapter-launched claude, walled — P5-0a; profile: ${plan.profilePath})`);
    }
    break;
  }
  case "relaunch": {
    // T8: `crate relaunch` (cmux pane revive) retired in 2.1. A headless seat's
    // runner is GUI-owned — relaunch it from the app's Team menu (per-seat
    // Relaunch), which restarts exactly that runner child.
    fail("`crate relaunch` was retired in 2.1 (cmux is gone). Relaunch a seat from the app's Team menu (per-seat Relaunch), or stop/reboot the team with `crate open`.");
    break;
  }
  default:
    fail(`usage: crate <open|stop|setup|attach|crew|gui|doctor|update|up|print|relaunch|version> ...`);
}
