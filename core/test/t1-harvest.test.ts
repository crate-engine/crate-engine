// The remaining P7-T1 live-loop harvest, fixed as one gated pass:
// (1) revive vs a LIVE non-claude harness — the launch line used to be typed
//     INTO the running pi (kill-by-tty silently no-ops when the host denies
//     proc-info). Now: close the pane (PTY teardown kills the harness with no
//     ps/pgrep needed) and recreate it fresh.
// (2) the attach seed wrote DEV_URL=3000 blind — now the dev port is detected
//     from the project's own scripts.
// (3) station state files must describe NOW (stale-concern hygiene, binder law).
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { detectDevPort } from "../src/attach.js";
// T8: the revive-vs-live-pane test was removed with cmux (reviveSeat is gone —
// headless relaunch restarts the runner child via gui/teamproc.ts).

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scratch = mkdtempSync(join(tmpdir(), "crate2-harvest-"));
const HOME = join(scratch, "home");
mkdirSync(HOME, { recursive: true });

// ── DEV_URL seed detects the project's dev port ─────────────────────────────

function projWithPkg(name: string, pkg: object | undefined): string {
  const p = join(scratch, name);
  mkdirSync(p, { recursive: true });
  if (pkg) writeFileSync(join(p, "package.json"), JSON.stringify(pkg));
  return p;
}

test("detectDevPort: explicit ports in the dev script win (the p7 rig's http.server case included)", () => {
  assert.equal(detectDevPort(projWithPkg("d1", { scripts: { dev: "python3 -m http.server 5188" } })), 5188);
  assert.equal(detectDevPort(projWithPkg("d2", { scripts: { dev: "next dev -p 3001" } })), 3001);
  assert.equal(detectDevPort(projWithPkg("d3", { scripts: { dev: "vite --port 5200" } })), 5200);
  assert.equal(detectDevPort(projWithPkg("d4", { scripts: { dev: "npx serve -l 8080 ." } })), 8080);
  assert.equal(detectDevPort(projWithPkg("d5", { scripts: { dev: "PORT=4000 node server.js" } })), 4000);
});

test("detectDevPort: tool defaults (vite/astro), else 3000; no package.json → 3000", () => {
  assert.equal(detectDevPort(projWithPkg("d6", { scripts: { dev: "vite" } })), 5173);
  assert.equal(detectDevPort(projWithPkg("d7", { scripts: { dev: "astro dev" } })), 4321);
  assert.equal(detectDevPort(projWithPkg("d8", { scripts: { dev: "next dev" } })), 3000);
  assert.equal(detectDevPort(projWithPkg("d9", undefined)), 3000);
});

test("the rig.conf seed carries the detected port, not a hardcoded 3000", () => {
  const attachSrc = readFileSync(join(ROOT, "core", "src", "attach.ts"), "utf8");
  assert.match(attachSrc, /DEV_URL="http:\/\/localhost:\{\{DEV_PORT\}\}"/, "RIG_CONF_LOCAL must template the detected port");
});

// ── (3) state-file freshness is binder law ──────────────────────────────────

test("reviewer/tester/designer binders carry the state-file freshness law", () => {
  for (const binder of ["reviewer.md", "tester.md", "designer.md"]) {
    const src = readFileSync(join(ROOT, "config", binder), "utf8");
    assert.match(src, /describe NOW/, `${binder} must state that state files describe NOW (stale-concern hygiene)`);
  }
});
