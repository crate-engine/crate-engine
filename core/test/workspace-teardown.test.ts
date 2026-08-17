// CE-014 P0 + P1 — the two defects that actually cost the operator a morning.
//
// 2026-08-16 09:32: Adam opened the app to five empty seats in JDM-RUSH-NEXT and
// reasonably concluded Superman had died overnight. It had not. Attaching
// crate-engine-site three hours earlier had torn down jdm-rush-crate's live team
// as a SIDE EFFECT — one engine per host, `~/.crate/last-project` a single global
// value — with no prompt and no notice. Nothing was lost only because the team
// was parked at the operator's own instruction; mid-build, that work evaporates.
//
// P1 (the dangerous defect): a switch that would stop a live team must ASK, and
// must NAME the casualties. P0 (the expensive one): "detached" must not render
// identically to "crashed" — the system knew the reason and kept it to itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { workspaceDetachment } from "../src/gui/server.js";
import { teamPage } from "../src/gui/teampage.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

// ── P0: detached is a STATE, not a fault ───────────────────────────────────

test("workspaceDetachment: the bound workspace is never detached (CE-014 P0)", () => {
  assert.deepEqual(workspaceDetachment("/p/site", "/p/site"), { detached: false });
  // Same place reached by a different spelling is still the same place.
  assert.deepEqual(workspaceDetachment("/p/site", "/p/site/"), { detached: false });
  assert.deepEqual(workspaceDetachment("/p/site", "/p/other/../site"), { detached: false });
});

test("workspaceDetachment: an unbound engine claims nothing (CE-014 P0)", () => {
  // No project bound: the seats are not running, but we cannot blame a
  // neighbour for it — asserting "detached" here would be a different lie.
  assert.deepEqual(workspaceDetachment(undefined, "/p/jdm"), { detached: false });
});

test("workspaceDetachment: a foreign workspace is DETACHED, and the note says why (CE-014 P0)", () => {
  const d = workspaceDetachment("/p/crate-engine-site", "/p/jdm-rush-crate");
  assert.equal(d.detached, true);
  assert.equal(d.boundProject, "/p/crate-engine-site");
  const note = d.detachedNote ?? "";
  assert.match(note, /DETACHED/);
  assert.match(note, /Nothing crashed/, "the two words that would have saved the morning");
  assert.match(note, /crate-engine-site/, "it names who holds the engine");
  assert.match(note, /one engine per host/, "with the mechanical reason");
  assert.match(note, /crate open \/p\/jdm-rush-crate/, "and the exact recovery command");
});

test("/api/team/status is a one-liner over that decision (CE-014 P0)", () => {
  const server = src("core/src/gui/server.ts");
  const ep = server.slice(server.indexOf('case "GET /api/team/status"'), server.indexOf('case "POST /api/team/boot"'));
  assert.match(ep, /workspaceDetachment\(state\.project, proj\)/, "the endpoint delegates — the wording lives in one place");
});

test("/api/version exposes the BOUND project, so a switch can be checked first (CE-014 P1)", () => {
  const server = src("core/src/gui/server.ts");
  const ep = server.slice(server.indexOf('case "GET /api/version"'), server.indexOf('case "POST /api/shutdown"'));
  assert.match(ep, /project: state\.project \?\? null/, "without this the CLI had to GUESS what it was about to stop");
});

test("the cockpit renders a DETACHED bar, distinct from the engine-offline bar (CE-014 P0)", () => {
  const html = teamPage({ project: "jdm-rush-crate", seats: [] });
  assert.match(html, /class="detbar" id="detbar"/, "there is a place for the reason to appear");
  assert.match(html, /body\.detached \.detbar\{display:block\}/, "shown only when detached");
  assert.match(html, /THIS WORKSPACE IS DETACHED — nothing crashed/, "and it leads with 'nothing crashed'");
  assert.match(html, /ps&&ps\.detached/, "driven by the server's flag, not a client guess");
  // Amber, not red: a state to explain, not a failure to alarm about.
  const css = /\.detbar\{[^}]*\}/.exec(html)?.[0] ?? "";
  assert.match(css, /var\(--amber\)/);
  assert.doesNotMatch(css, /var\(--bad\)/);
  // The whole page script must still parse.
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]!);
});

// ── P1: the guard, pinned at the source ────────────────────────────────────
// The confirmation runs inside `crate open` before POST /api/attach/execute.
// Driving it headlessly would mean stopping a real team, so these pin the
// properties that make it safe — above all that NO TTY means NO.

test("crate open ASKS before stopping another workspace's live team (CE-014 P1)", () => {
  const cli = src("core/src/cli.ts");
  const guard = cli.slice(cli.indexOf("CE-014 P1"), cli.indexOf("already open — switch it to this project"));
  assert.ok(guard.length > 0, "the guard sits BEFORE the switch, not after it");
  assert.match(guard, /api\/version/, "it asks what the engine is bound to");
  assert.match(guard, /api\/team\/status/, "and which seats are alive");
  assert.match(guard, /live seats: /, "the casualties are NAMED, not vaguely counted");
  assert.match(guard, /--stop-others/, "with a deliberate non-interactive override");
  assert.match(guard, /is untouched/, "and a 'no' leaves the other workspace alone");
  assert.match(guard, /break;/, "a 'no' actually stops the command");
  // Fail-open on a probe error is deliberate: an unreachable engine must not
  // block the operator's own switch. Only a KNOWN live team gates.
  assert.match(guard, /fail open/, "an unreachable probe does not wedge the command");
  // And it tells the truth about what survives: rehydrate saves the session,
  // not the in-flight turn.
  assert.match(guard, /work IN FLIGHT right now is lost/);
});

test("confirmTty refuses without a terminal — a piped switch cannot destroy work (CE-014 P1)", () => {
  const cli = src("core/src/cli.ts");
  const fn = cli.slice(cli.indexOf("async function confirmTty"), cli.indexOf("function defaultEngineSource"));
  assert.match(fn, /!process\.stdin\.isTTY/, "no tty is detected");
  assert.match(fn, /return false;/, "and answered NO");
  assert.match(fn, /--stop-others to confirm/, "pointing at the explicit way to say yes");
  assert.match(fn, /answer === "y" \|\| answer === "yes"/, "and only an explicit yes counts");
});
