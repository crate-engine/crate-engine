import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// FLAWS "browser-tooling" (tiering proof 2026-07-25, fixed 2026-08-11): inside
// a seat's wall chromium cannot initialize its OWN sandbox (nested sandbox
// init is refused by the OS), so agent-browser's auto-launch died before CDP
// came up. The shim now injects the pinned binary's documented env contract —
// AGENT_BROWSER_EXECUTABLE_PATH (the cached playwright chromium; the binary's
// own discovery never scans ~/Library/Caches/ms-playwright) and
// AGENT_BROWSER_ARGS (--no-sandbox,--disable-crashpad) — ONLY when the seat is
// walled (CRATE_WALLED=1, or the macOS nested-Seatbelt probe). These tests
// drive the REAL shim bash against a STUB binary that echoes the env it
// received, with `uname`/`sandbox-exec` stubbed on PATH so the wall probe is
// deterministic on every host (including a walled test run).

const scratch = mkdtempSync(join(tmpdir(), "crate2-ab-shim-"));
const realShim = join(dirname(fileURLToPath(import.meta.url)), "..", "tools", "agent-browser");

/** A fake engine core: the real shim + a stub binary that prints its env. */
function makeFakeCore(name: string): { shim: string; home: string } {
  const root = join(scratch, name);
  mkdirSync(join(root, "core", "tools"), { recursive: true });
  mkdirSync(join(root, "core", "node_modules", ".bin"), { recursive: true });
  const stub = join(root, "core", "node_modules", ".bin", "agent-browser");
  writeFileSync(
    stub,
    '#!/usr/bin/env bash\necho "EXEC=${AGENT_BROWSER_EXECUTABLE_PATH:-}"\necho "ARGS=${AGENT_BROWSER_ARGS:-}"\necho "SOCK=${AGENT_BROWSER_SOCKET_DIR:-}"\n',
  );
  chmodSync(stub, 0o755);
  const shim = join(root, "core", "tools", "agent-browser");
  cpSync(realShim, shim);
  chmodSync(shim, 0o755);
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  return { shim, home };
}

/** Plant a playwright-cache chromium under the fake HOME (macOS root shape —
 *  the glob patterns are path-shaped, not platform-gated, so this works on
 *  any test host). */
function plantCachedChromium(home: string): string {
  const dir = join(home, "Library", "Caches", "ms-playwright",
    "chromium_headless_shell-9999", "chrome-headless-shell-mac-arm64");
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, "chrome-headless-shell");
  writeFileSync(exe, "#!/bin/sh\n");
  chmodSync(exe, 0o755);
  return exe;
}

/** Stub `uname` (Darwin) + `sandbox-exec` (exit 0 = unwalled host, 1 = walled)
 *  so the shim's fallback probe behaves identically on every test host. */
function makeProbeStubs(name: string, sandboxExecExit: number): string {
  const dir = join(scratch, `${name}-probe-bin`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "uname"), "#!/bin/sh\necho Darwin\n");
  writeFileSync(join(dir, "sandbox-exec"), `#!/bin/sh\nexit ${sandboxExecExit}\n`);
  chmodSync(join(dir, "uname"), 0o755);
  chmodSync(join(dir, "sandbox-exec"), 0o755);
  return dir;
}

async function runShim(
  shim: string, home: string, probeBin: string, extraEnv: Record<string, string>,
): Promise<{ exec: string; args: string; sock: string }> {
  const { stdout } = await execFileP("bash", [shim], {
    env: { PATH: `${probeBin}:/usr/bin:/bin`, HOME: home, ...extraEnv },
  });
  const exec = stdout.match(/^EXEC=(.*)$/m)?.[1] ?? "";
  const args = stdout.match(/^ARGS=(.*)$/m)?.[1] ?? "";
  const sock = stdout.match(/^SOCK=(.*)$/m)?.[1] ?? "";
  return { exec, args, sock };
}

test("walled (CRATE_WALLED=1): shim points the binary at the cached chromium and injects --no-sandbox", async () => {
  const { shim, home } = makeFakeCore("walled");
  const exe = plantCachedChromium(home);
  const probe = makeProbeStubs("walled", 0); // probe says unwalled — CRATE_WALLED must win alone
  const r = await runShim(shim, home, probe, { CRATE_WALLED: "1" });
  assert.equal(r.exec, exe, "must export the wall-safe playwright chromium");
  assert.equal(r.args, "--no-sandbox,--disable-crashpad");
  // Linux find (Superman bwrap proof): the daemon socket must live in the
  // doored ~/.agent-browser, not read-only XDG_RUNTIME_DIR.
  assert.equal(r.sock, join(home, ".agent-browser"));
});

test("walled: caller-provided AGENT_BROWSER_ARGS survive; already-present flags are not doubled", async () => {
  const { shim, home } = makeFakeCore("merge");
  plantCachedChromium(home);
  const probe = makeProbeStubs("merge", 0);
  const r = await runShim(shim, home, probe, {
    CRATE_WALLED: "1",
    AGENT_BROWSER_ARGS: "--lang=en,--no-sandbox",
  });
  assert.equal(r.args, "--lang=en,--no-sandbox,--disable-crashpad");
});

test("walled: a caller-pinned AGENT_BROWSER_EXECUTABLE_PATH is respected, never overwritten", async () => {
  const { shim, home } = makeFakeCore("pinned");
  plantCachedChromium(home); // present, but the pin must win
  const probe = makeProbeStubs("pinned", 0);
  const r = await runShim(shim, home, probe, {
    CRATE_WALLED: "1",
    AGENT_BROWSER_EXECUTABLE_PATH: "/opt/custom/chrome",
  });
  assert.equal(r.exec, "/opt/custom/chrome");
  assert.equal(r.args, "--no-sandbox,--disable-crashpad");
});

test("walled with NO cached chromium: args still injected, executable left to auto-discovery", async () => {
  const { shim, home } = makeFakeCore("nocache");
  const probe = makeProbeStubs("nocache", 0);
  const r = await runShim(shim, home, probe, { CRATE_WALLED: "1" });
  assert.equal(r.exec, "", "no cache → no pin; the binary's own honest error is the failure mode");
  assert.equal(r.args, "--no-sandbox,--disable-crashpad");
});

test("UNWALLED: nothing injected — chromium keeps its own internal sandbox", async () => {
  const { shim, home } = makeFakeCore("unwalled");
  plantCachedChromium(home);
  const probe = makeProbeStubs("unwalled", 0); // probe succeeds → truly unwalled
  const r = await runShim(shim, home, probe, {});
  assert.equal(r.exec, "");
  assert.equal(r.args, "");
  assert.equal(r.sock, "", "unwalled must not redirect the daemon socket either");
});

test("macOS fallback probe: a hand-run in-wall repro (no CRATE_WALLED, nested Seatbelt refused) still injects", async () => {
  const { shim, home } = makeFakeCore("probe");
  const exe = plantCachedChromium(home);
  const probe = makeProbeStubs("probe", 1); // sandbox-exec fails ONLY inside a wall
  const r = await runShim(shim, home, probe, {});
  assert.equal(r.exec, exe);
  assert.equal(r.args, "--no-sandbox,--disable-crashpad");
});
