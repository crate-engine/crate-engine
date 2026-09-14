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
export declare function readWork(root: string, seat: string): WorkRecord | undefined;
export declare function saveWork(root: string, seat: string, record: WorkRecord): void;
export declare function holdWork(root: string, seat: string, reason?: string): void;
export declare function workHoldReason(root: string, seat: string): string | undefined;
export declare function clearWork(root: string, seat: string): void;
export declare function finishRecordedMail(root: string, seat: string, record: WorkRecord): void;
export declare function recoveryMessage(seat: string): string;
/** Explicit operator reconciliation while the consumer is stopped. Keeps the
 * original evidence in an append-only audit; never changes project Git state. */
export declare function resolveWork(root: string, seat: string, action: string, reason: string): Promise<void>;
