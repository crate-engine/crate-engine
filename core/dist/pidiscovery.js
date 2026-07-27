// Pi model discovery (PDR dev/pdr/pi-model-discovery.md, grilled 2026-07-26):
// the staffing page sees what Pi sees — models only, agents stay curated
// (an agent needs a hand-built adapter; a model within a known agent is a
// disk read). Three files, no Pi invocation, no network:
//   ~/.pi/agent/auth.json         providers with real credentials
//   ~/.pi/agent/models.json       user-defined custom providers (Kimi lands here)
//   ~/.pi/agent/models-store.json Pi's cached per-provider model catalog
// The locked laws: CREDENTIALED providers only (the page stays honest — if
// it's offered, it runs today); half-configured providers are SHOWN blocked
// with the fix, never hidden; discovered entries are never battle-tested,
// always metered-honest; curated catalog entries win collisions.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
function readJson(path) {
    try {
        if (!existsSync(path))
            return undefined;
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        return typeof parsed === "object" && parsed !== null ? parsed : undefined;
    }
    catch {
        return undefined; // malformed files never break the staffing page
    }
}
/** The P0-5 scar, never diluted: a Claude subscription does NOT run flat
 * through Pi — first-party Claude Code is the flat-rate path. */
const ANTHROPIC_WARNING = "⚠ METERED extra usage — a Claude sub does NOT run flat through Pi (P0-5); use first-party Claude Code for flat-rate Claude";
const GENERIC_BILLING = "provider-billed via your Pi key — METERED per your provider's API pricing (not a subscription)";
function billingFor(provider) {
    return provider === "anthropic" ? ANTHROPIC_WARNING : GENERIC_BILLING;
}
/** A custom provider's key resolves iff it is a literal, or a $ENV_VAR whose
 * variable is set (Q3: unresolvable = blocked WITH the fix, never hidden). */
function keyStatus(provider, apiKey, env) {
    if (typeof apiKey !== "string" || apiKey.trim() === "") {
        return { ok: false, fix: `provider "${provider}" is configured in Pi without an API key — add one in ~/.pi/agent/models.json` };
    }
    if (apiKey.startsWith("$")) {
        const name = apiKey.slice(1);
        if (env[name])
            return { ok: true };
        return {
            ok: false,
            fix: `provider "${provider}" is configured in Pi but ${apiKey} is not set in the app's environment — export it (or put the key directly in ~/.pi/agent/models.json)`,
        };
    }
    return { ok: true };
}
export function discoverPiModels(home, opts = {}) {
    const env = opts.env ?? process.env;
    const piInstalled = opts.piInstalled ?? true;
    const agentDir = join(home, ".pi", "agent");
    const auth = readJson(join(agentDir, "auth.json")) ?? {};
    const store = readJson(join(agentDir, "models-store.json")) ?? {};
    const custom = (readJson(join(agentDir, "models.json"))?.providers ?? {});
    const curatedKeys = new Set((opts.curated ?? []).filter((c) => c.agent === "pi").map((c) => c.model));
    const out = [];
    const seen = new Set();
    const push = (provider, m, ready, fix) => {
        if (!m.id)
            return;
        const model = `${provider}/${m.id}`;
        if (seen.has(model) || curatedKeys.has(model))
            return; // curated wins collisions
        seen.add(model);
        const finalFix = !piInstalled
            ? "Pi is not installed on this machine — install it and Refresh"
            : ready
                ? undefined
                : fix;
        out.push({
            agent: "pi",
            model,
            display: `${m.name ?? m.id} (Pi · detected)`,
            billing: billingFor(provider),
            verifiedFor: [],
            discovered: true,
            ready: piInstalled && ready,
            ...(finalFix !== undefined ? { fix: finalFix } : {}),
        });
    };
    // Custom providers first (models.json defines its own model list; a custom
    // deepseek both here and in the store dedupes in its favor).
    for (const [provider, def] of Object.entries(custom)) {
        if (typeof def !== "object" || def === null)
            continue;
        const models = Array.isArray(def.models) ? def.models : [];
        // a custom provider that ALSO has an auth.json sign-in counts credentialed
        const authed = Object.prototype.hasOwnProperty.call(auth, provider);
        const ks = authed ? { ok: true } : keyStatus(provider, def.apiKey, env);
        for (const m of models)
            push(provider, m, ks.ok, ks.ok ? undefined : ks.fix);
    }
    // Signed-in providers (auth.json) get their model lists from Pi's store.
    for (const provider of Object.keys(auth)) {
        const entry = store[provider];
        for (const m of entry?.models ?? [])
            push(provider, m, true);
    }
    return out;
}
//# sourceMappingURL=pidiscovery.js.map