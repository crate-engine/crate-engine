// PHASE-8 T3: the control surface — pending gate detection + "merge go"
// release + chat plumbing, driving the REAL agentctl. Proves the full-loop
// GATE mechanics (approved → held → merge go → deployed) with no token burn.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { foldHumanLines, honorPaneRelease, joinVerdicts, pendingGates, releaseGate, chatHistory, sendToOrchestrator, pendingPreviews, resolvePreview } from "../src/gui/teamctl.js";
import { readNew } from "../src/mailbox.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scratch = mkdtempSync(join(tmpdir(), "crate2-teamctl-"));

function makeRig(name: string, conf = ""): string {
  const rig = join(scratch, name);
  mkdirSync(join(rig, ".agents", "state", "inbox"), { recursive: true });
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  mkdirSync(join(rig, ".agents", "bin"), { recursive: true });
  cpSync(join(ROOT, "bin", "agentctl.py"), join(rig, ".agents", "bin", "agentctl.py"));
  cpSync(join(ROOT, "config", "state-machine.yaml"), join(rig, ".agents", "config", "state-machine.yaml"));
  writeFileSync(join(rig, ".agents", "config", "handoffs.yaml"), "handoffs:\n");
  writeFileSync(join(rig, ".agents", "rig.conf"), `PROJECT="${name}"\n${conf}`);
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
  execFileSync("git", ["init", "-qb", "main"], { cwd: rig });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "root"], { cwd: rig, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  return rig;
}
function emit(rig: string, ...a: string[]): void {
  execFileSync("python3", [join(rig, ".agents", "bin", "agentctl.py"), "emit", ...a], { cwd: rig });
}

test("no gate when nothing is at approved; a gate appears at approved", () => {
  const rig = makeRig("gate");
  emit(rig, "boot", "--actor", "orchestrator");
  emit(rig, "start_impl", "--actor", "coder");
  assert.equal(pendingGates(rig).length, 0);
  emit(rig, "code_ready", "--actor", "coder");
  emit(rig, "approved", "--actor", "orchestrator");
  const gates = pendingGates(rig);
  assert.equal(gates.length, 1);
  assert.match(gates[0]!.deploysTo, /main|\//);
});

test("releaseGate rejects a wrong phrase, accepts 'merge go', and the merge then proceeds", () => {
  const rig = makeRig("release");
  emit(rig, "boot", "--actor", "orchestrator");
  emit(rig, "start_impl", "--actor", "coder");
  emit(rig, "code_ready", "--actor", "coder");
  emit(rig, "approved", "--actor", "orchestrator");
  assert.equal(releaseGate(rig, "(single loop)", "merge it").ok, false);
  assert.equal(releaseGate(rig, "(single loop)", "merge go").ok, true);
  // ONE ROUTE (2026-08-11): the emit itself queued EXACTLY ONE [MERGE] to the
  // coder — teamctl no longer hand-delivers a second copy on the GUI surface.
  const mail = readNew(join(rig, ".agents", "state", "inbox"), "coder");
  assert.equal(mail.length, 1, "exactly one mechanical merge order");
  assert.match(mail[0]!.body, /\[MERGE\] the approved branch/);
  // a repeat "merge go" is absorbed (GUI precheck) — still one order on file
  const again = releaseGate(rig, "(single loop)", "merge go");
  assert.equal(again.ok, true);
  assert.equal(again.absorbed, true);
  assert.equal(readNew(join(rig, ".agents", "state", "inbox"), "coder").length, 1);
  // now the machine allows the merge (deployed) — full-loop gate proven headless
  emit(rig, "deployed", "--actor", "orchestrator");
  assert.equal(pendingGates(rig).length, 0); // gate cleared after merge
});

test("chat: operator message reaches the orchestrator inbox and appears in history", () => {
  const rig = makeRig("chat"); // fresh-attach rig.conf — no flags (T8a regression shape)
  const r = sendToOrchestrator(rig, "build me a contact page");
  assert.ok(r.ok, r.out);
  const hist = chatHistory(rig);
  assert.ok(hist.some((m) => m.from === "operator" && m.text.includes("contact page")));
  // the part the runner actually wakes on: the maildir queue entry
  const mail = readNew(join(rig, ".agents", "state", "inbox"), "orchestrator");
  assert.equal(mail.length, 1);
  assert.match(mail[0]!.body, /contact page/);
});

test("preview: agentctl preview queues it; resolve clears it and messages the orchestrator", () => {
  const rig = makeRig("preview");
  assert.equal(pendingPreviews(rig).length, 0);
  execFileSync("python3", [join(rig, ".agents", "bin", "agentctl.py"), "preview", "http://localhost:5188", "--route", "/garage", "--label", "Garage page", "--from", "designer"], { cwd: rig });
  const pv = pendingPreviews(rig);
  assert.equal(pv.length, 1);
  assert.equal(pv[0]!.route, "/garage");
  assert.equal(pv[0]!.label, "Garage page");
  // approve → cleared + orchestrator told
  assert.ok(resolvePreview(rig, true).ok);
  assert.equal(pendingPreviews(rig).length, 0);
});

// ── Pack 4 (cockpit truth, 2026-08-12): the gate lights read the EVENT
// record — the same VERDICT rows the JOIN trusts — never seat-file prose.
// (The prose regexes lied twice: W4 #3's partial-verification read green;
// ticket-#4's blended-era QA report read "·" while QA had APPROVED.) ──
test("gate lights come from recorded VERDICT events; no verdicts on record = honest '·'", () => {
  const rig = makeRig("lights");
  emit(rig, "boot", "--actor", "orchestrator");
  emit(rig, "start_impl", "--actor", "coder");
  emit(rig, "code_ready", "--actor", "coder");
  // seat-file prose says PASS loudly — it must move NOTHING (deleted regexes)
  writeFileSync(join(rig, ".agents", "state", "tester.md"), "status: pass\nNow: [PASS] everything green.\n");
  emit(rig, "verdict", "--actor", "tester", "result=approve", "report=all paths green");
  emit(rig, "approved", "--actor", "orchestrator");
  const one = pendingGates(rig)[0]!;
  assert.equal(one.qaOk, true, "QA's recorded approve lights the lamp");
  assert.equal(one.reviewOk, false, "no reviewer verdict on record = no light, whatever any file says");
});

test("both recorded approves light both lamps; a fresh code_ready VOIDS them (freshness law)", () => {
  const rig = makeRig("lights-void");
  emit(rig, "boot", "--actor", "orchestrator");
  emit(rig, "start_impl", "--actor", "coder");
  emit(rig, "code_ready", "--actor", "coder");
  emit(rig, "verdict", "--actor", "reviewer", "result=approve", "report=clean");
  emit(rig, "verdict", "--actor", "tester", "result=approve", "report=green");
  emit(rig, "approved", "--actor", "orchestrator");
  const g = pendingGates(rig)[0]!;
  assert.equal(g.reviewOk && g.qaOk, true, "both recorded approves = both lamps");
  // a gate-time bug: reopen → rework → NEW code_ready — the old verdicts are void
  emit(rig, "reopen", "--actor", "orchestrator");
  emit(rig, "code_ready", "--actor", "coder");
  emit(rig, "approved", "--actor", "orchestrator");
  const g2 = pendingGates(rig)[0]!;
  assert.equal(g2.reviewOk || g2.qaOk, false, "the rebased/reworked branch RE-EARNS its lights");
});

// ── Pack 4: the pane-phrase honor — habit beats the surface. Adam typed
// "merge go" into the orchestrator pane at BOTH ticket-#4 gates; the human
// chokepoint now folds typed bytes and honors the exact phrase. ──
test("foldHumanLines: CR completes a line; Esc/Ctrl+C clear; backspace pops; CSI arrows are not typing", () => {
  let s = foldHumanLines("", Buffer.from("merge g"));
  assert.deepEqual(s.lines, []);
  s = foldHumanLines(s.buf, Buffer.from("o\r"));
  assert.deepEqual(s.lines, ["merge go"], "the typed line completes on Enter");
  assert.equal(s.buf, "");
  assert.deepEqual(foldHumanLines("half a draft", Buffer.from("\x1b")).buf, "", "Esc cancels the draft");
  assert.deepEqual(foldHumanLines("halt", Buffer.from("\x03")).buf, "", "Ctrl+C clears");
  assert.equal(foldHumanLines("mergee", Buffer.from("\x7f go\r")).lines[0], "merge go", "backspace pops before the fold");
  assert.equal(foldHumanLines("", Buffer.from("\x1b[A\x1b[Bmerge go\r")).lines[0], "merge go", "arrow keys are stripped, never typed");
});

test("the pane-typed phrase RELEASES an armed gate through the one shared route (absorb included)", () => {
  const rig = makeRig("pane-honor");
  emit(rig, "boot", "--actor", "orchestrator");
  emit(rig, "start_impl", "--actor", "coder");
  emit(rig, "code_ready", "--actor", "coder");
  emit(rig, "approved", "--actor", "orchestrator");
  // wrong phrase / small talk typed into the pane: nothing happens
  assert.deepEqual(honorPaneRelease(rig, ["looks good, ship it"]), {});
  assert.equal(readNew(join(rig, ".agents", "state", "inbox"), "coder").length, 0);
  // the exact phrase (case/space-insensitive) releases — one [MERGE] order
  const h = honorPaneRelease(rig, ["  Merge Go  "]);
  assert.equal(h.released, "(single loop)");
  assert.equal(readNew(join(rig, ".agents", "state", "inbox"), "coder").length, 1, "the same mechanical route as the bar");
  assert.equal(pendingGates(rig)[0]!.released, true, "the RECORD now says released — every surface renders it");
  // typed again (the habit repeats): absorbed, never a duplicate order
  const again = honorPaneRelease(rig, ["merge go"]);
  assert.equal(again.released, "(single loop)");
  assert.equal(readNew(join(rig, ".agents", "state", "inbox"), "coder").length, 1, "first release wins on every surface");
});

test("no gate armed: the pane phrase is inert (nothing emitted, nothing mailed)", () => {
  const rig = makeRig("pane-idle");
  emit(rig, "boot", "--actor", "orchestrator");
  assert.deepEqual(honorPaneRelease(rig, ["merge go"]), {});
  assert.equal(readNew(join(rig, ".agents", "state", "inbox"), "coder").length, 0);
});

test("a recorded REJECT is not a light — and joinVerdicts is task-scoped in concurrent mode", () => {
  const rig = makeRig("lights-scope", "CONCURRENT_LOOPS=1\n");
  emit(rig, "boot", "--actor", "orchestrator");
  emit(rig, "start_impl", "--actor", "coder", "task=feat/a");
  emit(rig, "code_ready", "--actor", "coder", "task=feat/a");
  emit(rig, "verdict", "--actor", "tester", "result=reject", "report=broken", "task=feat/a");
  emit(rig, "verdict", "--actor", "reviewer", "result=approve", "report=fine", "task=feat/a");
  const v = joinVerdicts(rig, "feat/a");
  assert.equal(v.tester, "reject");
  assert.equal(v.reviewer, "approve");
  assert.deepEqual(joinVerdicts(rig, "feat/other"), {}, "another task's verdicts never bleed in");
});
