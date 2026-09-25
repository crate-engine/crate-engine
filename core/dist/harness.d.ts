export declare const CLAUDE_ALIASES: readonly ["fable", "opus", "sonnet", "haiku"];
export type ClaudeAlias = (typeof CLAUDE_ALIASES)[number];
export interface HarnessVersions {
    claude?: string;
    pi?: string;
    codex?: string;
}
/** "2.1.282 (Claude Code)" → "2.1.282"; first dotted number in the output. */
export declare function parseVersion(out: string): string | undefined;
/** Numeric dotted compare: <0 when a is older than b. */
export declare function compareVersions(a: string, b: string): number;
/** Each installed harness's version (cached 10 minutes — it shells out). */
export declare function harnessVersions(pathOpt?: {
    path?: string;
}, now?: number): HarnessVersions;
/** Test seam / after an update: forget the cached versions. */
export declare function forgetHarnessVersions(): void;
/** "claude-opus-5-5" → "Opus 5.5"; "claude-haiku-4-5-20251001" → "Haiku 4.5". */
export declare function friendlyModel(id: string): string;
/** From a `claude -p --output-format json` result, the model that answered for
 * this alias. modelUsage can also list a helper model (Claude Code uses Haiku
 * for side tasks), so the pick is the key naming the alias's family. */
export declare function modelForAlias(alias: ClaudeAlias, result: unknown): string | undefined;
export declare function aliasCachePath(home: string): string;
/** What each alias means on this computer — only when learned for THIS Claude Code version. */
export declare function claudeAliasModels(home: string, claudeVersion: string | undefined): Partial<Record<ClaudeAlias, string>>;
export type ClaudeAsk = (alias: ClaudeAlias) => Promise<unknown>;
/** Learn the aliases for this Claude Code version (background; once per
 * version; a failed alias is simply left unnamed — the label degrades to
 * "the newest … your Claude Code knows"). */
export declare function learnClaudeAliases(home: string, claudeVersion: string | undefined, ask?: ClaudeAsk): Promise<void>;
/** The picker label for a Claude alias entry. The picker shows only the NAME
 * (the text before " (" — CE-158), so the real model goes IN the name:
 * "Claude Opus 5.5 (Claude Code)". Unknown yet → the honest family label. */
export declare function claudeDisplay(alias: string, resolved: Partial<Record<ClaudeAlias, string>>, blurb?: string): string;
