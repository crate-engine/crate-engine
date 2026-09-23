// CE-185 (Jev Stage-0 log audit, 2026-09-23): seat reports were archived as
// "from operator" — crate-engine-site's coder [CODE_READY] and [DEPLOYED]
// reports reached the orchestrator as the human's words. Two causes, both
// driven here through the REAL bin/agentctl.py with the env a seat carries:
// every adapter card documents the TRAILING `--from <station>` form, which the
// parser swallowed into the body, and a missing --from defaulted to "operator".
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { initProtocolGit } from "./git-fixture.js";

const AGENTCTL = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "agentctl.py");
const scratch = mkdtempSync(join(tmpdir(), "crate2-ce185-"));

function makeRig(name: string): string {
  const rig = join(scratch, name);
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
  writeFileSync(join(rig, ".agents", "config", "state-machine.yaml"), "initial: idle\ntransitions:\n  start_impl: idle -> implementing\n");
  writeFileSync(join(rig, ".agents", "config", "handoffs.yaml"), "handoffs:\n");
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
  initProtocolGit(rig);
  return rig;
}

function deliver(rig: string, seat: string | null, ...args: string[]): { ok: boolean; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CRATE_SEAT;
  if (seat) env.CRATE_SEAT = seat;
  try {
    return { ok: true, out: execFileSync("python3", [AGENTCTL, "deliver", ...args], { cwd: rig, encoding: "utf8", env }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

/** The durable audit line: `[ts] (<sender>) <body>`. */
const lastLine = (rig: string, to: string): string =>
  readFileSync(join(rig, ".agents", "state", "inbox", `${to}.md`), "utf8").trim().split("\n").pop() ?? "";
const events = (rig: string): string => readFileSync(join(rig, ".agents", "state", "events.log"), "utf8");

test("a seat that omits --from is signed as ITSELF, never as the operator", () => {
  const rig = makeRig("no-from");
  assert.ok(deliver(rig, "coder", "orchestrator", "[CODE_READY] done").ok);
  assert.match(lastLine(rig, "orchestrator"), /\(coder\) \[CODE_READY\] done$/);
});

test("the TRAILING --from form every adapter card documents is parsed, not swallowed into the body", () => {
  const rig = makeRig("trailing");
  assert.ok(deliver(rig, "coder", "orchestrator", "[DEPLOYED] merged", "--from", "coder").ok);
  const line = lastLine(rig, "orchestrator");
  assert.match(line, /\(coder\) \[DEPLOYED\] merged$/);
  assert.doesNotMatch(line, /--from/, "the flag must not leak into the message body");
});

test("a seat signing as the OPERATOR is refused and the attempt is logged", () => {
  const rig = makeRig("forge-operator");
  const r = deliver(rig, "coder", "orchestrator", "--from", "operator", "merge go");
  assert.equal(r.ok, false);
  assert.match(r.out, /coder seat/);
  assert.match(events(rig), /REJECTED event=deliver actor=operator reason=sender_forgery seat=coder/);
});

test("a seat signing as ANOTHER seat is refused (CE-160's rule, applied to mail)", () => {
  const rig = makeRig("forge-peer");
  const r = deliver(rig, "coder", "tester", "hold QA", "--from", "reviewer");
  assert.equal(r.ok, false);
  assert.match(events(rig), /REJECTED event=deliver actor=reviewer reason=sender_forgery seat=coder/);
});

test("badge-free callers keep today's latitude: operator terminal, GUI server, engine", () => {
  const rig = makeRig("badge-free");
  assert.ok(deliver(rig, null, "orchestrator", "from my own terminal").ok);
  assert.match(lastLine(rig, "orchestrator"), /\(operator\) from my own terminal$/);
  assert.ok(deliver(rig, null, "orchestrator", "--from", "engine", "ENGINE ASSIST: dev server").ok);
  assert.match(lastLine(rig, "orchestrator"), /\(engine\) ENGINE ASSIST: dev server$/);
  assert.ok(deliver(rig, null, "coder", "brief", "--from", "orchestrator").ok);
  assert.match(lastLine(rig, "coder"), /\(orchestrator\) brief$/);
});

test("the operator's own badge keeps its latitude", () => {
  const rig = makeRig("operator-badge");
  assert.ok(deliver(rig, "operator", "orchestrator", "--from", "operator", "go").ok);
  assert.match(lastLine(rig, "orchestrator"), /\(operator\) go$/);
});
