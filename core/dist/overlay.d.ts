export type OverlayMode = "append" | "replace";
export interface OverlayEntry {
    /** Brain-relative path this entry customizes, e.g. "config/reviewer.md". */
    relPath: string;
    mode: OverlayMode;
}
export declare function overlayMode(overlayFileText: string): OverlayMode;
/** Compose one file: brain base text + overlay text per the pinned marker law. */
export declare function composeFile(baseText: string | undefined, overlayText: string): string;
/** Every overlay entry under overlayDir (recursive; machinery + dotfiles skipped). */
export declare function listOverlayEntries(overlayDir: string): OverlayEntry[];
export type BaseHashes = Record<string, string | null>;
export declare function hashFile(absPath: string): string | null;
export declare function readBaseHashes(overlayDir: string): BaseHashes;
export declare function writeBaseHashes(overlayDir: string, hashes: BaseHashes): void;
/**
 * Materialize the composed view: a shadow root where every top-level brain
 * entry is a symlink to the pristine clone, expanded copy-on-write along each
 * overlay entry's path, with the overlay entry itself a REAL composed file.
 * Seats consume only this root. Fast path: no overlay entries → the pristine
 * brainRoot itself is returned (zero cost, nothing materialized).
 *
 * Also records first-seen base hashes for entries that have none yet (the
 * written-against baseline the P4-6 compatibility pass compares to).
 */
export declare function composedBrainRoot(brainRoot: string, overlayDir: string, outDir: string): string;
/** The user's overlay dir for a HOME (single source for callers). */
export declare function overlayDirFor(home: string): string;
