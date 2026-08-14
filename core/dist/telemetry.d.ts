export interface TelemetryMirror {
    /** Sync now (tests; callers that just wrote). Normally the watcher drives. */
    tick(): void;
    stop(): void;
}
/** Where a project's mirror lands: ~/.crate/logs/<project-basename>/. */
export declare function mirrorDir(projectRoot: string, home?: string): string;
export declare function startTelemetryMirror(projectRoot: string, home?: string): TelemetryMirror;
