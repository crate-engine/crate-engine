export interface ConsumerLease {
    readonly key: string;
    release(): Promise<void>;
}
export declare function assertConsumerLease(lease: ConsumerLease, root: string, seat: string): void;
export declare function acquireConsumerLease(root: string, seat: string, waitMs?: number): Promise<ConsumerLease>;
