// CE-144 — `dev-server up` dead-ended inside a walled macOS seat.
//
// ROOT CAUSE, sharper than the original filing: backend() decided it could do a
// WRITE by probing a READ. `launchctl print gui/<uid>` SUCCEEDS inside a seat's
// wall, so the launchd rung was chosen; the plist write to ~/Library/LaunchAgents
// is then denied ("Operation not permitted") and `launchctl bootstrap` fails
// 5: I/O error. Reproduced inside a rendered coder wall on the Mac 2026-08-18.
//
// The asymmetry is what made it nasty: superman's seats get systemd-supervised
// dev servers, Mac seats got a hard error, and every `dev-server restart` runbook
// dead-ended in the one place the coder actually lives.
//
// These tests drive the REAL bash functions out of the shipped script rather
// than reimplementing them, so drift in the script fails here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "bin", "dev-server");

/** Source just the decision functions out of the shipped script and ask them. */
function chooseBackend(env: Record<string, string>, cmd = "up"): { backend: string; note: string } {
  const src = readFileSync(SCRIPT, "utf8");
  const grab = (name: string) => {
    const m = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m").exec(src);
    if (!m) throw new Error(`${name}() not found in bin/dev-server — the fix was refactored away?`);
    return m[0];
  };
  const script = `set -u\nCMD=${cmd}\n${grab("ld_writable")}\n${grab("backend")}\nbackend\n`;
  // spawnSync so stdout and stderr stay SEPARATE — that separation is itself
  // under test (the note must never contaminate $(backend)).
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(r.status, 0, `backend() exited ${r.status}: ${r.stderr}`);
  return { backend: (r.stdout ?? "").trim(), note: (r.stderr ?? "").trim() };
}

/** A HOME whose ~/Library/LaunchAgents cannot be written — the wall, simulated. */
function unwritableHome(): string {
  const home = mkdtempSync(join(tmpdir(), "ce144-home-"));
  const la = join(home, "Library", "LaunchAgents");
  mkdirSync(la, { recursive: true });
  chmodSync(la, 0o500); // r-x: present, listable, NOT writable
  return home;
}

const isDarwin = process.platform === "darwin";

test("a seat that cannot write LaunchAgents falls back to bare, not an error", { skip: !isDarwin }, () => {
  const home = unwritableHome();
  try {
    const { backend } = chooseBackend({ HOME: home });
    assert.equal(backend, "bare", "the launchd rung must not be chosen when its one required write is denied");
  } finally {
    chmodSync(join(home, "Library", "LaunchAgents"), 0o700);
    rmSync(home, { recursive: true, force: true });
  }
});

test("the fallback SAYS so — silence here is how the Linux/Mac asymmetry hides", { skip: !isDarwin }, () => {
  const home = unwritableHome();
  try {
    const { note } = chooseBackend({ HOME: home });
    assert.match(note, /not writable/i);
    assert.match(note, /BARE backend/i);
    assert.match(note, /no auto-restart/i, "the operator must learn what they are NOT getting");
    assert.match(note, /restart` works/i, "…and what still works, so the runbooks are not abandoned");
  } finally {
    chmodSync(join(home, "Library", "LaunchAgents"), 0o700);
    rmSync(home, { recursive: true, force: true });
  }
});

test("the note rides stderr — it must never contaminate $(backend)", { skip: !isDarwin }, () => {
  const home = unwritableHome();
  try {
    const { backend } = chooseBackend({ HOME: home });
    assert.equal(backend, "bare", "stdout is exactly the backend name and nothing else");
    assert.ok(!backend.includes("not writable"));
  } finally {
    chmodSync(join(home, "Library", "LaunchAgents"), 0o700);
    rmSync(home, { recursive: true, force: true });
  }
});

test("read-only commands stay quiet — the note is for the commands that act", { skip: !isDarwin }, () => {
  const home = unwritableHome();
  try {
    const { backend, note } = chooseBackend({ HOME: home }, "status");
    assert.equal(backend, "bare");
    assert.equal(note, "", "`dev-server status` in a loop must not narrate the same demotion forever");
  } finally {
    chmodSync(join(home, "Library", "LaunchAgents"), 0o700);
    rmSync(home, { recursive: true, force: true });
  }
});

test("an UNWALLED mac still gets the supervised launchd backend", { skip: !isDarwin }, () => {
  // The fix must not cost everyone else supervision to help walled seats.
  const { backend } = chooseBackend({});
  assert.equal(backend, "launchd", "a normal operator shell keeps KeepAlive supervision");
});

test("DEV_BACKEND=bare still wins outright", () => {
  assert.equal(chooseBackend({ DEV_BACKEND: "bare" }).backend, "bare");
});

test("the probe is a real WRITE, not a permission-bit check", () => {
  // A sandbox denial does not show up in the mode bits — that is exactly how
  // this hid for a whole probe run. If ld_writable ever becomes `[ -w ]`, the
  // bug comes straight back on a wall that leaves bits intact.
  const src = readFileSync(SCRIPT, "utf8");
  const fn = /^ld_writable\(\) \{[\s\S]*?^\}/m.exec(src)![0];
  assert.ok(!/\[\s*-w\s/.test(fn), "a -w test cannot see a sandbox denial");
  assert.match(fn, /:\s*>\s*"\$probe"/, "it must actually attempt the write");
  assert.match(fn, /rm -f "\$probe"/, "…and clean up after itself");
});
