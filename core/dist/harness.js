// Harness truth for the staffing picker and the Computers menu (Adam,
// 2026-09-25: "the new Opus 5.5 does not show up in the Crate models").
//
// Crate staffs Claude by ALIAS (`claude --model opus`) on purpose — the alias
// always means the newest model that computer's Claude Code knows, so Crate
// never needs a release when Anthropic ships one. The picker's labels were
// hard-coded though ("the newest Opus (Opus 5 today)"), and what an alias
// resolves to depends on each computer's Claude Code version: on 2026-09-24
// the Mac's 2.1.282 meant Opus 5.5 while Superman's 2.1.270 still meant Opus 5
// — silently, for every seat staffed "Claude Opus" there.
//
// Two facts, per computer:
//   1. harness versions (`claude --version`, `pi --version`, `codex --version`)
//      — the Computers menu flags a computer whose tool is behind another's.
//   2. what each Claude alias resolves to — asked of Claude Code itself ONCE
//      per Claude Code version (four one-line questions), cached in
//      ~/.crate/harness-models.json, so the picker names the real model.
// Crate never installs or updates an agent — it only tells the truth about them.
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { tierPaths } from "./usertier.js";
export const CLAUDE_ALIASES = ["fable", "opus", "sonnet", "haiku"];
/** "2.1.282 (Claude Code)" → "2.1.282"; first dotted number in the output. */
export function parseVersion(out) {
    return /\b(\d+\.\d+(?:\.\d+)?)\b/.exec(out)?.[1];
}
/** Numeric dotted compare: <0 when a is older than b. */
export function compareVersions(a, b) {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d)
            return d;
    }
    return 0;
}
let versionsCache;
/** Each installed harness's version (cached 10 minutes — it shells out). */
export function harnessVersions(pathOpt = {}, now = Date.now()) {
    if (versionsCache && now - versionsCache.at < 10 * 60_000)
        return versionsCache.value;
    const env = pathOpt.path ? { ...process.env, PATH: pathOpt.path } : process.env;
    const read = (bin) => {
        try {
            return parseVersion(execFileSync(bin, ["--version"], { encoding: "utf8", timeout: 5000, env, stdio: ["ignore", "pipe", "pipe"] }));
        }
        catch {
            return undefined;
        }
    };
    const value = {};
    for (const bin of ["claude", "pi", "codex"]) {
        const v = read(bin);
        if (v)
            value[bin] = v;
    }
    versionsCache = { at: now, value };
    return value;
}
/** Test seam / after an update: forget the cached versions. */
export function forgetHarnessVersions() {
    versionsCache = undefined;
}
/** "claude-opus-5-5" → "Opus 5.5"; "claude-haiku-4-5-20251001" → "Haiku 4.5". */
export function friendlyModel(id) {
    const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
    if (!m)
        return id;
    const name = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    return m[3] !== undefined ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`;
}
/** From a `claude -p --output-format json` result, the model that answered for
 * this alias. modelUsage can also list a helper model (Claude Code uses Haiku
 * for side tasks), so the pick is the key naming the alias's family. */
export function modelForAlias(alias, result) {
    const usage = result?.modelUsage ?? {};
    return Object.keys(usage).find((k) => k.startsWith(`claude-${alias}`));
}
export function aliasCachePath(home) {
    return join(tierPaths(home).root, "harness-models.json");
}
/** What each alias means on this computer — only when learned for THIS Claude Code version. */
export function claudeAliasModels(home, claudeVersion) {
    if (!claudeVersion)
        return {};
    try {
        const c = JSON.parse(readFileSync(aliasCachePath(home), "utf8"));
        return c.claudeVersion === claudeVersion ? c.aliases : {};
    }
    catch {
        return {};
    }
}
const defaultAsk = (pathOpt) => async (alias) => {
    const { stdout } = await promisify(execFile)("claude", ["-p", "--model", alias, "--output-format", "json", "Reply with only your exact model id."], {
        cwd: tmpdir(),
        timeout: 90_000,
        encoding: "utf8",
        env: { ...(pathOpt.path ? { ...process.env, PATH: pathOpt.path } : process.env), DISABLE_AUTOUPDATER: "1" },
    });
    return JSON.parse(stdout);
};
let learning;
/** Learn the aliases for this Claude Code version (background; once per
 * version; a failed alias is simply left unnamed — the label degrades to
 * "the newest … your Claude Code knows"). */
export function learnClaudeAliases(home, claudeVersion, ask = defaultAsk({})) {
    if (!claudeVersion || !existsSync(tierPaths(home).root))
        return Promise.resolve();
    const known = claudeAliasModels(home, claudeVersion);
    if (CLAUDE_ALIASES.every((a) => known[a]))
        return Promise.resolve();
    if (learning)
        return learning;
    learning = (async () => {
        const aliases = { ...known };
        for (const alias of CLAUDE_ALIASES) {
            if (aliases[alias])
                continue;
            try {
                const id = modelForAlias(alias, await ask(alias));
                if (id)
                    aliases[alias] = id;
            }
            catch {
                /* this alias stays unnamed (not on the plan, offline) — never fatal */
            }
        }
        writeFileSync(aliasCachePath(home), JSON.stringify({ claudeVersion, aliases }, null, 2) + "\n");
    })().finally(() => {
        learning = undefined;
    });
    return learning;
}
/** The picker label for a Claude alias entry. The picker shows only the NAME
 * (the text before " (" — CE-158), so the real model goes IN the name:
 * "Claude Opus 5.5 (Claude Code)". Unknown yet → the honest family label. */
export function claudeDisplay(alias, resolved, blurb) {
    const family = alias.charAt(0).toUpperCase() + alias.slice(1);
    const id = resolved[alias];
    if (id)
        return `Claude ${friendlyModel(id)} (Claude Code)${blurb ? ` — ${blurb}` : ""}`;
    return `Claude ${family} (Claude Code) — the newest ${family} your Claude Code knows${blurb ? ` · ${blurb}` : ""}`;
}
//# sourceMappingURL=harness.js.map