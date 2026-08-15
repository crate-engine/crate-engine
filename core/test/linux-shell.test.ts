// The native Linux shell (2026-08-15, Adam: "launch for both macOS and
// Linux as native apps"). Parity pins against the Mac shell's paid-for
// lessons — every feature here exists because a live session on the Mac
// needed it. E2E proof lives on superman (CRATE_SHELL_PROBE=1 under xvfb
// loaded the real cockpit); these pins keep the parity from regressing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "..", "apps", "linux-shell");
const py = readFileSync(join(APP, "main.py"), "utf8");
const installSh = readFileSync(join(APP, "install.sh"), "utf8");
const cli = readFileSync(join(HERE, "..", "src", "cli.ts"), "utf8");

test("main.py parses (python3 ast) and pins its GI versions — the Gdk 3.0 pin was the first live find", () => {
  execFileSync("python3", ["-c", `import ast; ast.parse(open(${JSON.stringify(join(APP, "main.py"))}).read())`]);
  for (const pin of ['gi.require_version("Gtk", "3.0")', 'gi.require_version("Gdk", "3.0")', 'gi.require_version("WebKit2", "4.1")']) {
    assert.ok(py.includes(pin), `${pin} — an unpinned namespace grabs GTK4 and dies on import`);
  }
});

test("the Mac shell's paid-for lessons all cross over", () => {
  assert.ok(py.includes('"window.crateShell=true"') || py.includes("'window.crateShell=true'"), "the page's shell detection");
  assert.ok(py.includes("set_javascript_can_open_windows_automatically(True)"), "non-gesture window.open (the studio menu/watcher bug, learned once)");
  assert.ok(py.includes("crate-retry://") && py.includes("crate-ext://"), "retry + external-browser schemes");
  assert.ok(py.includes("crateOpenPanel") && py.includes("crateOpenStudio"), "View menu drives the same page bridges");
  assert.ok(py.includes("crateCopySelection"), "the copy bridge — WebKit's copy only knows DOM selections, xterm paints its own");
  assert.ok(py.includes("looks_asleep"), "the asleep-server morning screen with Retry");
  assert.ok(py.includes("PROBE OK"), "the headless e2e hook stays — future refactors keep a truth test");
});

test("studio frames are FIXTURES: remembered positions, size-locked mobile with iPhone UA, no focus theft, cmd-4 raises", () => {
  assert.ok(py.includes('"studioMobile"') && py.includes('"studioDesktop"'), "per-frame geometry keys");
  assert.ok(py.includes("set_resizable(False)"), "the mobile frame IS a device — only its position is yours");
  assert.ok(py.includes("IPHONE_UA"), "viewport parity with QA's device profile");
  assert.ok(py.includes("set_focus_on_map(False)"), "auto-deploy never steals the keyboard");
  assert.ok(py.includes('startswith("Crate Studio")') && py.includes("present()"), "the raise-before-open law (a buried studio always surfaces)");
});

test("install.sh: distro parts only, launcher entry, plain-words dep hints — and never sudo on the user's behalf", () => {
  assert.ok(installSh.includes("crate-engine.desktop") && installSh.includes("Exec=python3"), "a real launcher entry");
  assert.ok(installSh.includes("sudo apt install") && installSh.includes("sudo dnf install"), "missing deps are NAMED per distro");
  assert.ok(!/^\s*sudo /m.test(installSh), "the script suggests sudo, never runs it");
  assert.ok(installSh.includes("ast.parse"), "the app is syntax-checked before install");
});

test("crate update refreshes the installed shell when apps/linux-shell changes — updates stay ONE command (the Mac law's twin)", () => {
  assert.ok(cli.includes('process.platform === "linux"') && cli.includes('includes("apps/linux-shell/")'), "the Linux twin of the mac-shell rebuild hook");
  assert.ok(cli.includes('join(HOME, ".local", "lib", "crate-shell", "main.py")'), "gated on the shell actually being installed");
});
