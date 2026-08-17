export declare const OPEN_USAGE: string;
export type OpenArgs = {
    kind: "help";
} | {
    kind: "error";
    message: string;
} | {
    kind: "remote";
    host: string;
    printUrl: boolean;
} | {
    kind: "local";
    project?: string;
    printUrl: boolean;
    stopOthers: boolean;
};
export declare function parseOpenArgs(rest: string[]): OpenArgs;
