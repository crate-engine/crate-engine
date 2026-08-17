export interface DevPorts {
    port: number;
    previewPort: number;
    /** "serve-resolve" | "conf-fallback" — printed by callers that report provenance. */
    origin: "serve-resolve" | "conf-fallback";
}
/** One key from ONE conf file, quotes stripped. */
export declare function fileValue(file: string, key: string): string | undefined;
/** rig.conf then dev.conf, FIRST hit wins (the rig's own sheet is authoritative).
 * For the dev PORT specifically use resolveDevPorts — that resolution is
 * file-major, which this per-key helper cannot express. */
export declare function confValue(projectRoot: string, key: string): string | undefined;
export declare function resolveDevPorts(projectRoot: string): DevPorts;
