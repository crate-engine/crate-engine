// PHASE-8 T1 — the headless mailbox (D11, maildir refinement).
//
// One FILE per message under <inbox>/<seat>/new/; processing MOVES it
// (atomic rename) to <seat>/cur/. The pressed D11 laws hold structurally:
// lossless (nothing rewrites a shared file — concurrent senders can never
// clobber each other or a rotation), O(new mail) per wake (cur/ is never
// re-read), at-least-once (a message leaves new/ only via complete() after
// a finished turn, or deadLetter() after honest retries — a crashed runner
// re-sees its mail). The single-file `<seat>.md` stays as an append-only
// HUMAN mirror (audit trail; machines never read it, so appends race-free).
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

/** Local ISO seconds WITH the UTC offset (2026-08-12T13:39:05-05:00) — THE
 * one stamp shape every human-visible line shares: events.log, turns.log,
 * mail lines, chat mirrors. Pack 5 (the two-clocks flaw, 2026-08-12):
 * agentctl wrote local-naive while engine writers wrote UTC Z, so every
 * interleaved timeline read required mental TZ math. Local-first because
 * the OPERATOR reads these; the offset keeps them machine-resolvable;
 * agentctl's now() emits the identical shape (python isoformat). Machine
 * DATA fields (session json, turn meta, filenames) stay UTC ISO — this is
 * the display-stamp law, not a data migration. */
export function localIsoOffset(d = new Date()): string {
  const p = (n: number): string => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(off / 60)}:${p(off % 60)}`
  );
}

export interface Message {
  /** Absolute path of the message file in new/. */
  path: string;
  /** Filename (sortable: <epoch-ms>-<seq>-<pid>.msg). */
  name: string;
  /** ISO timestamp recorded at enqueue. */
  at: string;
  from: string;
  body: string;
}

let seq = 0;

function seatDir(inboxRoot: string, seat: string, sub: "new" | "cur"): string {
  const d = join(inboxRoot, seat, sub);
  mkdirSync(d, { recursive: true });
  return d;
}

/** The append-only human-readable mirror for a seat (audit, never machine-
 * read). SAME file the cmux-mode delivery queue has written since P7-T6
 * (`state/inbox/<seat>.md`) — one human trail across both transports. */
export function auditLog(inboxRoot: string, seat: string): string {
  mkdirSync(inboxRoot, { recursive: true });
  return join(inboxRoot, `${seat}.md`);
}

/**
 * Durably enqueue one message. Unique filename (time + in-process seq +
 * pid) makes concurrent senders collision-free by construction; the write
 * is to a temp name in the SAME directory then renamed in (atomic on
 * POSIX), so a reader never sees a half-written message.
 */
export function enqueue(inboxRoot: string, seat: string, from: string, body: string): string {
  const dir = seatDir(inboxRoot, seat, "new");
  const at = localIsoOffset(); // one clock (Pack 5): the same shape agentctl stamps
  const name = `${Date.now()}-${String(seq++).padStart(6, "0")}-${process.pid}.msg`;
  const tmp = join(dir, `.tmp-${name}`);
  const line = `${at} | ${from} | ${body.replaceAll("\n", "\\n")}\n`;
  writeFileSync(tmp, line);
  const final = join(dir, name);
  renameSync(tmp, final);
  // mirror in agentctl's `[iso] (sender) text` shape — ONE audit format
  // across both transports, so the GUI chat parser reads either writer
  appendFileSync(auditLog(inboxRoot, seat), `[${at}] (${from}) ${body.replaceAll("\n", "\\n")}\n`);
  return final;
}

/** All unprocessed messages for a seat, oldest first. Never sees cur/. */
export function readNew(inboxRoot: string, seat: string): Message[] {
  const dir = seatDir(inboxRoot, seat, "new");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".msg"))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      const raw = readFileSync(path, "utf8").trimEnd();
      const [at = "", from = "", ...rest] = raw.split(" | ");
      return { path, name, at, from, body: rest.join(" | ").replaceAll("\\n", "\n") };
    });
}

/** Ack messages AFTER a completed turn: atomic move new/ → cur/. */
export function complete(inboxRoot: string, seat: string, msgs: Message[]): void {
  const cur = seatDir(inboxRoot, seat, "cur");
  for (const m of msgs) renameSync(m.path, join(cur, m.name));
}

/**
 * Dead-letter a poison message after honest retries: moved OUT of new/ so
 * it cannot hot-loop the runner, kept in cur/ with a .failed marker and
 * the reason appended — never silently dropped.
 */
export function deadLetter(inboxRoot: string, seat: string, msg: Message, reason: string): void {
  const cur = seatDir(inboxRoot, seat, "cur");
  const dest = join(cur, `${msg.name}.failed`);
  renameSync(msg.path, dest);
  appendFileSync(dest, `FAILED: ${reason}\n`);
}
