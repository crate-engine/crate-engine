/** Parse a ~/.crate/app-url payload (one tokened 127.0.0.1 URL). */
export declare function parseAppUrl(text: string): {
    port: string;
    token: string;
    previewPort?: string;
    previewPorts?: string[];
} | undefined;
/** The tunnel + window plan for a parsed remote app. Same ports locally —
 * deterministic, and the token in the URL keeps a collision honest (a
 * different local app on that port won't answer with our token). */
export declare function tunnelPlan(app: {
    port: string;
    token: string;
    previewPort?: string;
    previewPorts?: string[];
}, host: string): {
    tunnelArgv: string[];
    probeUrl: string;
    teamUrl: string;
};
