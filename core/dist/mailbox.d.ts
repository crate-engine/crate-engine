/** Local ISO seconds WITH the UTC offset (2026-08-12T13:39:05-05:00) — THE
 * one stamp shape every human-visible line shares: events.log, turns.log,
 * mail lines, chat mirrors. Pack 5 (the two-clocks flaw, 2026-08-12):
 * agentctl wrote local-naive while engine writers wrote UTC Z, so every
 * interleaved timeline read required mental TZ math. Local-first because
 * the OPERATOR reads these; the offset keeps them machine-resolvable;
 * agentctl's now() emits the identical shape (python isoformat). Machine
 * DATA fields (session json, turn meta, filenames) stay UTC ISO — this is
 * the display-stamp law, not a data migration. */
export declare function localIsoOffset(d?: Date): string;
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
/** The append-only human-readable mirror for a seat (audit, never machine-
 * read). SAME file the cmux-mode delivery queue has written since P7-T6
 * (`state/inbox/<seat>.md`) — one human trail across both transports. */
export declare function auditLog(inboxRoot: string, seat: string): string;
/**
 * Durably enqueue one message. Unique filename (time + in-process seq +
 * pid) makes concurrent senders collision-free by construction; the write
 * is to a temp name in the SAME directory then renamed in (atomic on
 * POSIX), so a reader never sees a half-written message.
 */
export declare function enqueue(inboxRoot: string, seat: string, from: string, body: string): string;
/** All unprocessed messages for a seat, oldest first. Never sees cur/. */
export declare function readNew(inboxRoot: string, seat: string): Message[];
/** Ack messages AFTER a completed turn: atomic move new/ → cur/. */
export declare function complete(inboxRoot: string, seat: string, msgs: Message[]): void;
/**
 * Dead-letter a poison message after honest retries: moved OUT of new/ so
 * it cannot hot-loop the runner, kept in cur/ with a .failed marker and
 * the reason appended — never silently dropped.
 */
export declare function deadLetter(inboxRoot: string, seat: string, msg: Message, reason: string): void;
