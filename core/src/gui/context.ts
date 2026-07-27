// PHASE-8 T4 (D12) — context fullness: how full is each seat's session?
// A headless seat runs a persistent session (runner.ts), so its context
// GROWS turn over turn. The latest turn's INPUT tokens ≈ the current context
// size; divided by the model's window it gives a fullness %. The gauge, the
// 40% advisory, and auto-refresh all read from here.

/** Context window (tokens) per model — the denominator for fullness. Keyed
 * by a loose substring match on the staffed model; a safe default otherwise.
 * Values are the usable input windows; conservative when a model is unknown. */
const WINDOWS: Array<[RegExp, number]> = [
  [/gpt-5|codex/i, 272_000],
  [/opus|sonnet|claude/i, 200_000],
  [/deepseek/i, 128_000],
  [/gemini/i, 1_000_000],
];
const DEFAULT_WINDOW = 128_000;

export function contextWindowFor(model: string | undefined): number {
  if (!model) return DEFAULT_WINDOW;
  for (const [re, w] of WINDOWS) if (re.test(model)) return w;
  return DEFAULT_WINDOW;
}

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
export const ADVISORY = 0.4;
export const CEILING = 0.85;

export function gaugeFrom(latestInputTokens: number | undefined, model: string | undefined): ContextGauge | undefined {
  if (latestInputTokens === undefined || latestInputTokens <= 0) return undefined;
  const window = contextWindowFor(model);
  const pct = Math.min(1, latestInputTokens / window);
  const band: ContextGauge["band"] = pct >= CEILING ? "high" : pct >= ADVISORY ? "advisory" : "ok";
  return { tokens: latestInputTokens, window, pct, band };
}
