import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// P6-2: the one-liner, hermetically — PATH-shimmed brew/npm record every
// invocation; git/node are real (the installer's real work is a clone + npm).
// Since the P6-6 direction change the installer NEVER installs or signs in AI
// agents — it detects what's already on the machine and reports honestly.
// The REAL run happens once, at the P6-6 gate, on the fresh macOS account.

const REPO = join(import.meta.dirname, "..", "..");
const SCRIPT = join(REPO, "installer", "get-crate.sh");

function makeSandbox(opts: { brew: boolean; pi?: boolean; gitRefusesSource?: string }): {
  home: string;
  log: string;
  path: string;
} {
  const box = mkdtempSync(join(tmpdir(), "crate2-inst-"));
  const home = join(box, "home");
  const bin = join(box, "shims");
  const log = join(box, "calls.log");
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(log, "");
  const shim = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >> ${log}\n${body}`);
    chmodSync(join(bin, name), 0o755);
  };
  if (opts.brew) {
    // `brew list --cask cmux` says NOT installed the first time; install succeeds.
    shim(
      "brew",
      `case "$1 $2" in
  "list --cask") test -f ${box}/cask-installed ;;
  "install --cask") touch ${box}/cask-installed ;;
  *) : ;;
esac`,
    );
  }
  // the user's own pi, when the scenario has one (the installer only DETECTS it)
  if (opts.pi) shim("pi", `exit 0`);
  // npm shim: a plain `npm install` in the clone links the REAL core deps
  // (tsc must exist for the delegated REAL dist-check to run).
  shim(
    "npm",
    `if [ "$1" = "install" ] && [ ! -e node_modules ]; then ln -s ${join(REPO, "core", "node_modules")} node_modules; exit 0; fi
if [ "$1" = "run" ]; then PATH="${process.env.PATH}" exec npm "$@"; fi
exit 0`,
  );
  if (opts.gitRefusesSource) {
    // Gate-day finding #2 simulation: git refuses rev-parse INSIDE the staged
    // source (dubious ownership — it belongs to another user); everything else
    // (the clone itself, config) delegates to the real git.
    shim(
      "git",
      `if [ "$1 $2 $3" = "-C ${opts.gitRefusesSource} rev-parse" ]; then
  echo "fatal: detected dubious ownership in repository at '${opts.gitRefusesSource}/.git'" >&2
  exit 128
fi
exec /usr/bin/git "$@"`,
    );
  }
  // node/git/uname etc. come from the real system path segments we keep;
  // ~/.local/bin FIRST so per-user binaries win (as on a real Mac)
  const path = `${join(home, ".local", "bin")}:${bin}:/usr/bin:/bin:/usr/sbin:/sbin:${join(REPO, "core", "node_modules", ".bin")}`;
  return { home, log, path };
}

function runInstaller(sb: { home: string; path: string }, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      env: {
        HOME: sb.home,
        PATH: sb.path,
        CRATE_CMUX_APP: join(sb.home, "no-such-app.app"), // hermetic: never see the real /Applications
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

test("installer: something to install + no Homebrew → the actionable brew.sh stop (never auto-installs)", () => {
  const sb = makeSandbox({ brew: false }); // cmux absent (env override) and no brew
  const r = runInstaller(sb, ["--no-open"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /requires Homebrew/);
  assert.match(r.out, /raw\.githubusercontent\.com\/Homebrew/);
});

test("installer: fresh run installs the 3 steps + reports agent detection honestly; re-run heals as present", () => {
  const sb = makeSandbox({ brew: true, pi: true });
  const r1 = runInstaller(sb, ["--no-open", "--engine-source", REPO]);
  assert.equal(r1.code, 0, r1.out);
  // artifacts
  assert.ok(existsSync(join(sb.home, ".crate", "engine", ".git")), "engine cloned");
  assert.ok(existsSync(join(sb.home, ".local", "bin", "crate")), "crate shim installed");
  assert.match(r1.out, /dist-sync guard: OK/);
  const calls1 = readFileSync(sb.log, "utf8");
  assert.doesNotMatch(calls1, /cmux/i); // T8: cmux is gone from the installer
  // the direction change: NO agent installs, ever
  assert.doesNotMatch(calls1, /pi-coding-agent/);
  assert.doesNotMatch(calls1, /claude\.ai\/install\.sh/);
  assert.doesNotMatch(r1.out, /\[5\/6\]|\[6\/6\]/);
  // detection report tells the truth: pi present but not signed in; no claude
  assert.match(r1.out, /never installs or signs in agents/);
  assert.match(r1.out, /pi: installed, NOT signed in/);
  assert.match(r1.out, /claude code: not found on this machine/);
  assert.match(r1.out, /no ready agents detected/);
  // PATH persisted, once
  const zprofile = readFileSync(join(sb.home, ".zprofile"), "utf8");
  assert.equal(zprofile.match(/added by crate-engine installer/g)!.length, 1);

  // the user signs into pi + installs/finishes claude THEMSELVES → re-run reports ready
  mkdirSync(join(sb.home, ".pi", "agent"), { recursive: true });
  writeFileSync(join(sb.home, ".pi", "agent", "auth.json"), '{"openai-codex":{}}');
  writeFileSync(
    join(sb.home, ".claude.json"),
    JSON.stringify({ oauthAccount: { email: "x@y" }, hasCompletedOnboarding: true }),
  );
  writeFileSync(join(sb.home, ".local", "bin", "claude"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(sb.home, ".local", "bin", "claude"), 0o755);

  const r2 = runInstaller(sb, ["--no-open", "--engine-source", REPO]);
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /engine: present/);
  assert.match(r2.out, /pi: installed \+ signed in \(ChatGPT\) — ready/);
  assert.match(r2.out, /claude code: installed \+ signed in — ready/);
  assert.doesNotMatch(r2.out, /no ready agents detected/);
  assert.match(r2.out, /crate CLI: installed/); // shim refresh is idempotent-safe
  // .zprofile carries the PATH line once, and NO cmux bootstrap hook (T8)
  const zp = readFileSync(join(sb.home, ".zprofile"), "utf8");
  assert.equal(zp.match(/added by crate-engine installer/g)!.length, 1);
  assert.doesNotMatch(zp, /crate-engine app bootstrap|CMUX_PANEL_ID/);
});

test("installer: a local source git refuses (cross-user dubious ownership) gets trusted, then clones", () => {
  const sb = makeSandbox({ brew: true, gitRefusesSource: REPO });
  const r = runInstaller(sb, ["--no-open", "--engine-source", REPO]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /owned by another user — trusting this one path/);
  assert.ok(existsSync(join(sb.home, ".crate", "engine", ".git")), "engine cloned despite the ownership trip");
  // the trust landed in THIS user's global git config: the source + its .git
  const trusted = execFileSync("/usr/bin/git", ["config", "--global", "--get-all", "safe.directory"], {
    encoding: "utf8",
    env: { HOME: sb.home, PATH: "/usr/bin:/bin" },
  });
  const src = realpathSync(REPO);
  assert.ok(trusted.includes(src), `safe.directory has ${src}:\n${trusted}`);
  assert.ok(trusted.includes(`${src}/.git`), `safe.directory has ${src}/.git:\n${trusted}`);
});

test("installer: an engine dir that is not a clone refuses plainly", () => {
  const sb = makeSandbox({ brew: true });
  mkdirSync(join(sb.home, ".crate", "engine"), { recursive: true });
  writeFileSync(join(sb.home, ".crate", "engine", "junk"), "x");
  const r = runInstaller(sb, ["--no-open", "--engine-source", REPO]);
  assert.equal(r.code, 1);
  assert.match(r.out, /not a git clone/);
});
