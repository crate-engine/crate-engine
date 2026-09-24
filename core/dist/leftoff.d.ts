export declare function leftOffPath(projectRoot: string): string;
/** The seat's own words about NOW: its Now / Next / Blockers sections when it
 * keeps them, else its first few lines. Bounded — a note, not a dump. */
export declare function seatSummary(text: string): string[];
/** Compose the note (pure over what it reads — exported for tests). */
export declare function composeLeftOff(projectRoot: string, now?: Date): string;
/** Write the note (and an archive copy). Best-effort: returns the path, or
 * undefined when the rig has no state dir to write into. */
export declare function writeLeftOff(projectRoot: string, now?: Date): string | undefined;
