/** Home-relative files worth carrying. Absent files are skipped, honestly. */
export declare const CREW_FILES: readonly [".pi/agent/auth.json", ".pi/agent/models.json", ".pi/agent/models-store.json", ".codex/auth.json", ".codex/config.toml"];
export interface CrewBundle {
    crateCrewBundle: 1;
    exportedAt: string;
    /** home-relative path → base64 file body. */
    files: Record<string, string>;
}
export declare function buildCrewBundle(home: string, now?: () => string): {
    bundle: CrewBundle;
    carried: string[];
    skipped: string[];
};
export declare function writeCrewBundle(path: string, bundle: CrewBundle): void;
/** Apply a bundle to a home. Refuses anything that isn't a real crew bundle
 * or tries to write outside the known crew paths (a hostile file must not
 * become a filesystem write primitive). */
export declare function applyCrewBundle(home: string, raw: string): {
    written: string[];
};
