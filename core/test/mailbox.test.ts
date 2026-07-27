import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { enqueue, readNew, complete, deadLetter, auditLog } from "../src/mailbox.js";

// PHASE-8 T1 (D11, maildir refinement): the headless mailbox. One FILE per
// message under inbox/<seat>/new/; processed messages MOVE (atomic rename)
// to cur/; a failed turn leaves them in new/ (at-least-once); dead-letter
// after honest retries. Losslessness is structural: nothing ever rewrites
// a file another process may be appending to.

const scratch = mkdtempSync(join(tmpdir(), "crate2-mailbox-"));

test("enqueue creates one durable message file + the human-readable .md mirror line", () => {
  const box = join(scratch, "a", "inbox");
  const p = enqueue(box, "reviewer", "orchestrator", "please review feature/x");
  assert.ok(existsSync(p) && p.includes(join("reviewer", "new")));
  assert.equal(readFileSync(p, "utf8").trim().split(" | ").slice(1).join(" | "), "orchestrator | please review feature/x");
  const mirror = readFileSync(auditLog(box, "reviewer"), "utf8");
  // ONE audit format across both transports (2d): agentctl's `[iso] (sender) text`
  assert.match(mirror, /^\[[^\]]+\] \(orchestrator\) please review feature\/x/m);
});

test("readNew returns messages oldest-first and NEVER sees processed mail", () => {
  const box = join(scratch, "b", "inbox");
  enqueue(box, "coder", "orchestrator", "first");
  enqueue(box, "coder", "orchestrator", "second");
  let msgs = readNew(box, "coder");
  assert.deepEqual(msgs.map((m) => m.body), ["first", "second"]);
  complete(box, "coder", [msgs[0]!]);
  msgs = readNew(box, "coder");
  assert.deepEqual(msgs.map((m) => m.body), ["second"]); // 'first' moved to cur/, gone forever from new/
});

test("at-least-once: an uncompleted (crashed) turn leaves messages in new/", () => {
  const box = join(scratch, "c", "inbox");
  enqueue(box, "qa", "orchestrator", "verify the thing");
  const before = readNew(box, "qa");
  assert.equal(before.length, 1);
  // simulate a runner crash: readNew happened, complete() never ran
  const after = readNew(box, "qa");
  assert.equal(after.length, 1, "unacked mail must survive a crash");
});

test("concurrent enqueue: 200 senders, zero collisions, zero loss", async () => {
  const box = join(scratch, "d", "inbox");
  await Promise.all(
    Array.from({ length: 200 }, (_, i) => Promise.resolve().then(() => enqueue(box, "orch", "seat", `msg-${i}`))),
  );
  const files = readdirSync(join(box, "orch", "new"));
  assert.equal(files.length, 200);
  const bodies = new Set(readNew(box, "orch").map((m) => m.body));
  assert.equal(bodies.size, 200);
});

test("dead-letter moves a poison message to cur/ with a .failed marker (honest, not silent)", () => {
  const box = join(scratch, "e", "inbox");
  enqueue(box, "designer", "orchestrator", "impossible ask");
  const [msg] = readNew(box, "designer");
  deadLetter(box, "designer", msg!, "turn failed 3x: timeout");
  assert.equal(readNew(box, "designer").length, 0);
  const cur = readdirSync(join(box, "designer", "cur"));
  assert.equal(cur.length, 1);
  assert.match(cur[0]!, /\.failed$/);
  assert.match(readFileSync(join(box, "designer", "cur", cur[0]!), "utf8"), /turn failed 3x: timeout/);
});
