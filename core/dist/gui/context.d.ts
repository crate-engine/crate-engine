export declare function contextWindowFor(model: string | undefined): number;
export interface ContextGauge {
    /** current context tokens (latest turn's input) */
    tokens: number;
    /** model window */
    window: number;
    /** 0..1 fullness */
    pct: number;
    /** advisory band: ok < advisory ≤ warn < ceiling */
    band: "ok" | "advisory" | "high";
}
/** Advisory + hard-ceiling thresholds (fractions of the window). D12's 40%
 * default advisory is Adam's; both are conf-tunable per rig later. */
export declare const ADVISORY = 0.4;
export declare const CEILING = 0.85;
export declare function gaugeFrom(latestInputTokens: number | undefined, model: string | undefined): ContextGauge | undefined;
