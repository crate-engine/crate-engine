// The gate bar (flaw 2026-08-12): the all-blended cockpit rendered the
// orchestrator tile as a pure terminal — no chat box, so the operator's
// "merge go" had NO surface that carried their identity. The bar was born in
// the masthead; Pack 4 moved it UNDER the orchestrator pane (Adam's
// placement call — the release belongs visually with the seat that holds
// the loop), made its state render from the EVENT RECORD (g.released), and
// taught the pane itself to honor the typed phrase. Client logic is JS
// inside the teampage template → structural assertions (the loopchip
// precedent).
import assert from "node:assert/strict";
import { test } from "node:test";
import { teamPage } from "../src/gui/teampage.js";

const html = teamPage({ project: "demo", seats: [] });

test("the whole page script PARSES — a template-literal slip must fail here, not in the browser", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  assert.ok(scripts.length >= 1, "inline cockpit script present");
  for (const s of scripts) new Function(s); // throws on a syntax error
});

test("the gate bar docks INSIDE the orchestrator tile — the masthead strip is retired", () => {
  assert.ok(html.includes("function gateBarHtml"), "the bar renders as tile HTML");
  const orchBranch = html.slice(html.indexOf("function renderTile"));
  assert.ok(/orchestrator"\?gateBarHtml\(\)/.test(orchBranch), "renderTile docks the bar on the orchestrator tile");
  assert.ok(!/<div id="gatebar" hidden>/.test(html), "the static masthead element is gone");
});

test("the bar's input survives the 2s repaint (the chatbox preservation pattern)", () => {
  assert.ok(/const gbi=document\.getElementById\("gbinput"\);const gbVal=/.test(html), "value captured before the repaint");
  assert.ok(/gbi2\.value=gbVal/.test(html), "…and restored after");
  assert.ok(/gbFocused\)gbi2\.focus\(\)/.test(html), "focus survives too");
});

test("release display needs a recorded release or a matching nonempty SHA", () => {
  const fn = html.slice(html.indexOf("function gateBarHtml"), html.indexOf("function renderGateBar"));
  const render = new Function("GATES", "GATEREL", "esc", fn + ";return gateBarHtml();");
  const g = { task: "task", branch: "feature", deploysTo: "main", released: false };
  assert.match(render([g], {}, String), /merge gate holding/);
  assert.doesNotMatch(render([g], {}, String), /released — the coder/);
  assert.match(render([{ ...g, sha: "new", round: "r2" }], { task: "old" }, String), /merge gate holding/);
  assert.match(render([{ ...g, sha: "new", round: "r2" }], { task: "new:r2" }, String), /released — the coder/);
  assert.match(render([{ ...g, sha: "new", round: "r3" }], { task: "new:r2" }, String), /merge gate holding/);
  assert.match(render([{ ...g, released: true }], {}, String), /released — the coder/);
});

for (const replaced of [true, false]) {
  test(`release response keeps submitted SHA when polling ${replaced ? "replaces" : "removes"} gate`, async () => {
    const fn = html.slice(html.indexOf("async function releaseFromBar"), html.indexOf("function renderTile"));
    const gates = [{ task: "task", sha: "old", round: "r1" }];
    const released: Record<string, string> = {};
    let respond!: (value: unknown) => void;
    let submitted = "";
    const fetch = (_url: string, opts: { body: string }) => {
      submitted = opts.body; return new Promise(resolve => { respond = resolve; });
    };
    const input = { value: "merge go", textContent: "" };
    const run = new Function("GATES", "GATEREL", "document", "fetch", "api", "TOKEN", "renderGateBar", fn + ";return releaseFromBar();");
    const pending = run(gates, released, { getElementById: () => input }, fetch, String, "test", () => {});
    if (replaced) gates[0] = { task: "task", sha: "new", round: "r2" }; else gates.length = 0;
    respond({ json: async () => ({ ok: true }) });
    await pending;
    assert.equal(JSON.parse(submitted).sha, "old");
    assert.equal(JSON.parse(submitted).round, "r1");
    assert.equal(released.task, "old:r1");
  });
}

test("the bar releases through the one shared route and is rewired per repaint", () => {
  const fn = html.slice(html.indexOf("function releaseFromBar"));
  assert.ok(fn.includes("/api/gates/release"), "bar releases via the same endpoint every surface shares");
  const wireFn = html.slice(html.indexOf("function wire()"), html.indexOf("function wire()") + 900);
  assert.ok(/gbinput/.test(wireFn) && /releaseFromBar/.test(wireFn), "wiring lives in wire() — per repaint, not once at boot");
});

test("a hidden bar actually hides — explicit display must not beat the hidden attribute", () => {
  // Adam's catch (2026-08-12): #gatebar{display:flex} overrode the HTML
  // `hidden` attribute, so the ticket-#3 "released" message fossilized on
  // screen 3.5h after DEPLOYED. The [hidden] rule stays as the belt even
  // though the bar now renders conditionally (no gate = no element at all).
  assert.ok(html.includes("#gatebar[hidden]{display:none}"), "the [hidden] display rule ships");
  // the placeholder now lives inside the client JS string (escaped quotes)
  assert.ok(html.includes('type "merge go" to release'), "the bar teaches the phrase in place");
});
