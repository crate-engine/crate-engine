export interface RemoteEntry {
    /** The ssh destination (an alias from ~/.ssh/config or user@host). */
    host: string;
    addedAt: string;
}
export declare function remotesFile(home: string): string;
export declare function listRemotes(home: string): RemoteEntry[];
export declare function addRemote(home: string, host: string): RemoteEntry[];
export declare function removeRemote(home: string, host: string): RemoteEntry[];
/** An ssh destination the card may use: an alias or user@host — plain chars
 * only, so a hostile string can never smuggle ssh options or shell syntax. */
export declare function validRemoteHost(host: string): boolean;
/** The probe: is an engine installed there? (One round-trip, keys or nothing.) */
export declare function probeArgv(host: string): string[];
export declare function parseProbe(stdout: string): {
    engine: boolean;
};
/** The consent-gated install — the standard installer, verbatim: ~/.crate on
 * that machine + the crate command in ~/.local/bin, no sudo, nothing
 * system-wide. --no-open: a server process must not try to launch a window. */
export declare function installArgv(host: string): string[];
/** Boot (or find) the app server on the host — the proven `crate open
 * --remote` first leg, verbatim (cli.ts): headless-boots + writes app-url. */
export declare function bootArgv(host: string): string[];
export declare function appUrlArgv(host: string): string[];
export type RemotePhase = "probing" | "installing" | "booting" | "tunneling" | "connected" | "failed";
export interface RemoteJob {
    host: string;
    phase: RemotePhase;
    /** One honest progress line, plain words. */
    note: string;
    /** Set at phase "connected": the tunneled /team URL the window navigates to. */
    url?: string;
    /** Failure evidence, one click away (stderr tails, step names). */
    log: string[];
    startedAt: string;
}
export interface RemoteExec {
    run(cmd: string, args: string[], timeoutMs: number): Promise<{
        stdout: string;
        stderr: string;
    }>;
    spawnDetached(cmd: string, args: string[]): void;
    probeHttp(url: string, timeoutMs: number): Promise<boolean>;
}
export declare function defaultRemoteExec(): RemoteExec;
export declare function remoteJob(host: string): RemoteJob | undefined;
/** Tests only: forget finished jobs so runs stay hermetic. */
export declare function clearRemoteJobs(): void;
/** Probe only (the add flow's first step — BEFORE any consent dialog). */
export declare function probeRemote(host: string, exec?: RemoteExec): Promise<{
    reachable: boolean;
    engine: boolean;
    note?: string;
}>;
/** Connect to a host that already has an engine (a remembered chip's click). */
export declare function startConnect(home: string, host: string, exec?: RemoteExec): RemoteJob;
/** CONSENT GIVEN (the one dialog's [Install engine]): run the standard
 * installer over the user's ssh, then connect. Never called without the
 * page's explicit consent click — the server offers no silent path to it. */
export declare function startInstall(home: string, host: string, exec?: RemoteExec): RemoteJob;
