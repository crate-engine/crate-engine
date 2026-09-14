/** Durable attempt evidence. Receipt is not completion; unknown work is held,
 * never silently replayed or charged against unrelated queued messages. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { acquireConsumerLease } from "./consumer-lease.js";
import { complete, readNew } from "./mailbox.js";

export interface WorkRecord {
  version: 1;
  mode: "headless" | "blended";
  agent?: string;
  phase: "prepared" | "received" | "completed";
  id: string;
  messages: string[];
  at: string;
  sessionId?: string;
  sessionPath?: string;
  logPath?: string;
  pid?: number;
  resumeApproved?: boolean;
  heldReason?: string;
}
function file(root: string, seat: string): string {
  const dir = join(root, ".agents", "state", "turns", seat);
  return join(dir, "work.json");
}
export function readWork(root: string, seat: string): WorkRecord | undefined {
  const path = file(root, seat);
  if (!existsSync(path)) return undefined;
  const d = JSON.parse(readFileSync(path, "utf8")) as WorkRecord;
  if (d.version !== 1 || !["headless", "blended"].includes(d.mode) ||
      !["prepared", "received", "completed"].includes(d.phase) ||
      typeof d.id !== "string" || !Array.isArray(d.messages) ||
      !d.messages.every(n => typeof n === "string" && !n.includes("/") && n.endsWith(".msg"))) {
    throw new Error("Invalid work recovery record; preserve it for inspection");
  }
  return d;
}
export function saveWork(root: string, seat: string, record: WorkRecord): void {
  const path = file(root, seat), tmp = path + ".tmp-" + randomUUID();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmp, JSON.stringify(record) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}
export function holdWork(root: string, seat: string, reason = recoveryMessage(seat)): void {
  const work = readWork(root, seat);
  if (work) saveWork(root, seat, { ...work, heldReason: reason });
}
export function workHoldReason(root: string, seat: string): string | undefined {
  try { return readWork(root, seat)?.heldReason; }
  catch { return "Work record is unreadable; inspection required before restarting"; }
}
export function clearWork(root: string, seat: string): void { rmSync(file(root, seat), { force: true }); }
export function finishRecordedMail(root: string, seat: string, record: WorkRecord): void {
  const inbox = join(root, ".agents", "state", "inbox");
  complete(inbox, seat, readNew(inbox, seat).filter(m => record.messages.includes(m.name)));
}
export function recoveryMessage(seat: string): string {
  return `${seat}: unfinished work needs inspection; automatic replay paused. Stop the team, inspect the session and changes, then use crate recover ${seat} --action resume|retry|complete --reason "what you verified" --project <rig>.`;
}
/** Explicit operator reconciliation while the consumer is stopped. Keeps the
 * original evidence in an append-only audit; never changes project Git state. */
export async function resolveWork(root: string, seat: string, action: string, reason: string): Promise<void> {
  if (!["resume", "retry", "complete"].includes(action) || !reason.trim()) throw new Error("Recovery requires an action and a reason");
  const lease = await acquireConsumerLease(root, seat);
  try {
    const record = readWork(root, seat);
    if (!record) throw new Error("No interrupted work record for this seat");
    if (action === "resume" && (record.mode !== "blended" || !record.sessionId || !record.agent)) throw new Error("Resume requires a known interactive session; inspect before choosing retry or complete");
    if (record.pid) {
      let alive = true;
      try { process.kill(record.pid, 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== "ESRCH"; }
      if (alive) throw new Error(`Previous work process ${record.pid} is still alive; stop and inspect it first`);
    }
    if (action === "resume") {
      const sf = join(root, ".agents", "state", "turns", seat, "session.json");
      const tmp = sf + ".tmp-" + randomUUID();
      writeFileSync(tmp, JSON.stringify({ agent: record.agent, sessionId: record.sessionId, blended: true }));
      renameSync(tmp, sf);
    }
    const audit = join(root, ".agents", "state", "turns", seat, "recovery.log");
    appendFileSync(audit, JSON.stringify({ at: new Date().toISOString(), action, reason, record }) + "\n");
    // Resume means the operator has confirmed receipt and will continue in the
    // preserved session. Retry explicitly permits replay after checking effects.
    if (action !== "retry") finishRecordedMail(root, seat, record);
    else {
      // If reconciliation itself crashes, old receipt/completion evidence
      // must never acknowledge the explicitly requested replay.
      saveWork(root, seat, { ...record, phase: "prepared", id: randomUUID(), resumeApproved: false });
      const box = join(root, ".agents", "state", "inbox", seat);
      mkdirSync(join(box, "new"), { recursive: true });
      for (const name of record.messages) {
        const pending = join(box, "new", name), received = join(box, "cur", name);
        if (existsSync(pending)) continue; // recovery itself may have restarted
        if (!existsSync(received)) throw new Error(`Recorded message ${name} is missing; preserve recovery evidence`);
        renameSync(received, pending);
      }
    }
    if (action === "resume") saveWork(root, seat, { ...record, phase: "received", resumeApproved: true, heldReason: undefined });
    else clearWork(root, seat);
  } finally { await lease.release(); }
}
