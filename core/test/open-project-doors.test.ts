// PDR open-project-doors (2026-09-13, wave 1): the routes behind the Open
// Project and Add a Computer dialogs, the dialogs' presence in the page, and
// both shells' doors — pinned end to end on a real server with scratch homes.
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { teamPage } from "../src/gui/teampage.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = teamPage({ project: "demo", seats: [] });
const swift = readFileSync(join(ROOT, "apps", "mac-shell", "main.swift"), "utf8");
const py = readFileSync(join(ROOT, "apps", "linux-shell", "main.py"), "utf8");

/** A scratch HOME with an installed-looking engine (~/.crate/engine → this repo's product dirs). */
function scratchHome(): { home: string; engineDir: string } {
  const home = mkdtempSync(join(tmpdir(), "opd-home-"));
  const engineDir = join(home, ".crate", "engine");
  mkdirSync(join(home, ".crate"), { recursive: true });
  symlinkSync(ROOT, engineDir); // the workshop IS an engine (bin/config/templates)
  return { home, engineDir };
}

test("GET /api/ssh-hosts: one chip per machine from ~/.ssh/config, probed through the injected prober, remembered ones marked", async () => {
  const { startGuiServer } = await import("../src/gui/server.js");
  const { home } = scratchHome();
  mkdirSync(join(home, ".ssh"));
  writeFileSync(join(home, ".ssh", "config"), "Host superman 100.64.55.121\n  HostName 192.168.100.218\nHost superman-ts\n  HostName 100.64.55.121\nHost *\n  ServerAliveInterval 30\nHost lab\n  HostName 10.0.0.9\n");
  writeFileSync(join(home, ".crate", "remotes.json"), JSON.stringify([{ host: "superman", addedAt: "x" }]));
  const probed: string[] = [];
  let server: Awaited<ReturnType<typeof startGuiServer>> | undefined;
  try {
    server = await startGuiServer({ home, sshProbe: async (h) => { probed.push(h); return h === "superman"; } });
    const r = await fetch(`http://127.0.0.1:${server.port}/api/ssh-hosts`, { headers: { "X-Crate-Token": server.token } });
    const body = (await r.json()) as { hosts: Array<{ name: string; aliases: string[]; reachable: boolean; remembered: boolean }> };
    assert.deepEqual(body.hosts.map((h) => h.name), ["superman", "lab"], "three names, two machines; the wildcard is no chip");
    const sm = body.hosts[0]!;
    assert.ok(sm.aliases.includes("superman-ts"), "superman-ts folded into superman");
    assert.equal(sm.reachable, true); assert.equal(sm.remembered, true);
    assert.equal(body.hosts[1]!.reachable, false);
    assert.deepEqual(probed.sort(), ["lab", "superman"], "one probe per machine, not per alias");
  } finally {
    server?.server.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("GET /api/projects (this machine) + POST /api/projects/open: the list, then opening a NEW repo attaches + registers it", async () => {
  const { startGuiServer } = await import("../src/gui/server.js");
  const { home, engineDir } = scratchHome();
  const projects = join(home, "Projects");
  mkdirSync(join(projects, "docket", ".git"), { recursive: true });
  mkdirSync(join(projects, "notes"), { recursive: true }); // no .git → not a project
  let server: Awaited<ReturnType<typeof startGuiServer>> | undefined;
  try {
    server = await startGuiServer({ home });
    const h = { headers: { "X-Crate-Token": server.token, "Content-Type": "application/json" } };
    const base = `http://127.0.0.1:${server.port}`;
    let list = (await (await fetch(`${base}/api/projects`, h)).json()) as { computer: string; projects: Array<{ name: string; state: string }> };
    assert.deepEqual(list.projects.map((p) => `${p.name}:${p.state}`), ["docket:new"]);
    const opened = (await (await fetch(`${base}/api/projects/open`, { ...h, method: "POST", body: JSON.stringify({ computer: "local", path: join(projects, "docket") }) })).json()) as { project: string; welcome: boolean; error?: string };
    assert.equal(opened.error, undefined, String(opened.error));
    assert.equal(opened.project, join(projects, "docket"));
    assert.equal(opened.welcome, true, "a repo new to Crate gets the welcome");
    assert.ok(existsSync(join(projects, "docket", ".agents", "rig.conf")), "attached");
    assert.equal(lstatSync(join(projects, "docket", ".agents", "bin")).isSymbolicLink(), true);
    list = (await (await fetch(`${base}/api/projects`, h)).json()) as typeof list;
    assert.deepEqual(list.projects.map((p) => `${p.name}:${p.state}`), ["docket:ready"], "now a recent, ready project");
    const again = (await (await fetch(`${base}/api/projects/open`, { ...h, method: "POST", body: JSON.stringify({ computer: "local", path: join(projects, "docket") }) })).json()) as { welcome: boolean };
    assert.equal(again.welcome, false, "opening a ready project is not a first run");
  } finally {
    server?.server.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a project wired to an OLDER engine reads as heal, and the Workspaces drawer heals it instead of registering it broken", async () => {
  const { startGuiServer } = await import("../src/gui/server.js");
  const { home, engineDir } = scratchHome();
  const p = join(home, "Projects", "old-rig");
  mkdirSync(join(p, ".git"), { recursive: true });
  mkdirSync(join(p, ".agents", "state"), { recursive: true });
  writeFileSync(join(p, ".agents", "rig.conf"), "PROJECT=old\n");
  symlinkSync(join(home, "gone-engine", "bin"), join(p, ".agents", "bin"));
  symlinkSync(join(home, "gone-engine", "config"), join(p, ".agents", "config"));
  let server: Awaited<ReturnType<typeof startGuiServer>> | undefined;
  try {
    server = await startGuiServer({ home });
    const h = { headers: { "X-Crate-Token": server.token, "Content-Type": "application/json" } };
    const base = `http://127.0.0.1:${server.port}`;
    const list = (await (await fetch(`${base}/api/projects`, h)).json()) as { projects: Array<{ name: string; state: string }> };
    assert.deepEqual(list.projects.map((x) => `${x.name}:${x.state}`), ["old-rig:heal"], "the docket case");
    const r = (await (await fetch(`${base}/api/workspaces`, { ...h, method: "POST", body: JSON.stringify({ path: p }) })).json()) as { error?: string };
    assert.equal(r.error, undefined, String(r.error));
    assert.equal(readFileSync(join(p, ".agents", "rig.conf"), "utf8").includes("PROJECT=old"), true, "the rig's own config is kept");
    assert.ok(existsSync(join(p, ".agents", "bin")), "the dangling link now resolves — healed, not registered broken");
  } finally {
    server?.server.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("the page carries both dialogs, the door bridge, and the operator's words", () => {
  assert.ok(html.includes("async function openProjectDialog(pre)"), "Open Project dialog");
  assert.ok(html.includes('api("/api/projects?computer="') && html.includes('api("/api/projects/open")'), "…driven by the routes");
  assert.ok(html.includes("function addComputerDialog(onDone)") && html.includes('api("/api/ssh-hosts")'), "Add a Computer dialog with chips");
  assert.ok(html.includes("Type its name the way you would type it after <b>ssh</b>"), "plain words (CE-176)");
  assert.ok(!html.includes("Point me at an ssh destination"), "the engineer-speak copy is gone");
  assert.ok(html.includes('if(door==="open"){openProjectDialog(computer||"");return;}'), "File › Open Project is a dialog, no navigation");
  assert.ok(html.includes('location.href=j.url+"&card=1";'), "connecting from the card lands on that computer's card, never its last rig");
  for (const t of ["Which computer?", "Which project?", "Choose a folder…", "＋ Add a computer", "Crate adds one small folder for your team"]) assert.ok(html.includes(t), t);
  // install #5 seam: the card leads with the list, and adding a computer from it lands on that list
  assert.ok(html.includes('id="acopen"') && html.includes('document.getElementById("acopen").onclick=()=>openProjectDialog("local");'), "the card's first door is the project list");
  assert.ok(html.includes("function addServer(){addComputerDialog(host=>openProjectDialog(host));}"), "add-a-computer from the card lands on that computer's list, never its card");
  for (const t of ["Which repo?", "Where does the code live?", "Add a server", "pick a repo on"]) assert.ok(!html.includes(t), `gone: ${t}`);
});

test("both shells: File doors say Project/Computer, Open/Add are dialogs over the cockpit, the Computers menu opens a project on a host", () => {
  assert.ok(swift.includes("window.crateOpenDoor(\\(arg))") && swift.includes('door == "open" || door == "computer"'), "mac: dialog doors when the cockpit is ready");
  assert.ok(swift.includes("Open a project on \\(name)…") && swift.includes("openProjectOn(_:)"), "mac: the Computers row");
  assert.ok(py.includes('door in ("open", "computer")') && py.includes("window.crateOpenDoor({arg})"), "linux: same");
  assert.ok(py.includes("Open a project on {host.get('host', '?')}…"), "linux: the Computers row");
});
