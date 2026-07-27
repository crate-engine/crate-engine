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
