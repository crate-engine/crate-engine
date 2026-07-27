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
import { pendingGates, qaGreen, releaseGate, chatHistory, sendToOrchestrator, pendingPreviews, resolvePreview } from "../src/gui/teamctl.js";
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

// ── W4 finding #3 (2026-07-13, live-caught): the gate light must read ONE
// truth with the orchestrator — a partial verdict is never qa-green. ──
test("qaGreen: the live partial-verification shape is NOT green", () => {
  const live = [
    "updated: 2026-07-13 16:20 UTC",
    "status: partial-verification",
    "Now: Verified the main page over localhost:3000 via a temporary static server fallback.",
    "Concerns: qa-sweep/agent-browser/axe-check are not installed in this environment.",
    "",
    "Log:",
    "- 16:20 UTC — npm test passed (`index.html passes`).",
  ].join("\n");
  assert.equal(qaGreen(live), false, "'Verified …' prose inside a partial verdict must not read green");
});

test("qaGreen: a clean pass IS green; history-log failures don't poison the current status", () => {
  const clean = "updated: now\nstatus: pass\nNow: verified end to end.\n\nLog:\n- earlier — [FAIL] old task failed once.\n";
  assert.equal(qaGreen(clean), true, "a FAIL in the history log must not veto a clean current status");
  assert.equal(qaGreen("Now: [PASS] all checks green.\n"), true, "no status line → explicit PASS marker counts");
  assert.equal(qaGreen("status: pass\nNow: fine.\nConcerns: BUGS_FOUND upstream.\n\nLog:\n"), false, "bug markers in the head veto");
  assert.equal(qaGreen(""), false, "no verdict is not green");
});
