// Agent detection (the P6-6 direction change, 2026-07-06 — Adam's call after
// runs #1–#5): Crate Engine does NOT install or sign in AI harnesses. The
// product assumption is that the user's agents are ALREADY on the machine and
// already authenticated — the wizard is agent-agnostic and simply offers
// whatever is ready. Detection is honest and two-part: the harness BINARY on
// PATH, plus the same auth markers doctor and up() gate on (marker law:
// pi = provider KEY in ~/.pi/agent/auth.json; claude = oauthAccount AND
// hasCompletedOnboarding in ~/.claude.json — run #3/#5 findings).
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SEATS, type Seat } from "./manifest.js";
import { loadUserDefaults, parseRigConf, resolveSeat } from "./staffing.js";

/** Resolve a binary on PATH (injectable for hermetic tests). */
export function whichBin(name: string, opts: { path?: string } = {}): string | undefined {
  const path = opts.path ?? process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

/** The harness binary a staffable agent runs as (undefined = adapter-specific,
 * not detectable here — treated as the agent's own responsibility). */
export function binaryFor(agent: string): string | undefined {
  if (agent === "pi") return "pi";
  if (agent === "claude" || agent === "claude-code") return "claude";
  if (agent === "codex") return "codex";
  // 2026-07-14 seat expansion: honest install detection (without this, the
  // catalog would show a never-installed agent as ready).
  if (agent === "opencode") return "opencode";
  if (agent === "aider") return "aider";
  if (agent === "gemini") return "gemini";
  if (agent === "agy") return "agy"; // Antigravity CLI (the gemini wire's replacement)
  if (agent === "openclaw") return "openclaw";
  return undefined;
}

export interface AgentProblem {
  agent: string;
  fix: string;
}

/** Providers whose pi sign-in we can verify by KEY NAME in auth.json
 * (gate-day run #3: a mere auth.json EXISTENCE check went green on an
 * aborted/wrong-provider login and the Orchestrator died at runtime;
 * run #11: a deepseek-staffed Coder booted with no API key and died the
 * same way — deepseek's /login-entered key lands in auth.json too). */
const PI_PROVIDER_KEYS = new Set(["openai-codex", "deepseek"]);

/** The auth-marker half of detection (markers only — binary presence is
 * agentProblem's job). Kept verbatim from the run #3/#5 findings. */
export function seatAuthProblem(agent: string, home: string, models: string[] = []): AgentProblem | undefined {
  if (agent === "pi") {
    let authJson: string | undefined;
    try {
      authJson = readFileSync(join(home, ".pi", "agent", "auth.json"), "utf8");
    } catch {
      /* absent */
    }
    if (authJson === undefined) {
      return {
        agent: "pi",
        fix: "pi is installed but not signed in — run `pi` in a terminal, type /login, choose ChatGPT, sign in with your ChatGPT subscription, then quit (Ctrl+C twice)",
      };
    }
    // auth.json is PROVIDER-KEYED — demand the staffed models' providers.
    const needed = [...new Set(models.map((m) => m.split("/")[0]!))].filter((p) => PI_PROVIDER_KEYS.has(p));
    const missing = needed.filter((p) => !authJson!.includes(`"${p}"`));
    if (missing.length > 0) {
      const hints: Record<string, string> = {
        "openai-codex": "choose ChatGPT",
        deepseek: "enter its API key (or export DEEPSEEK_API_KEY)",
      };
      return {
        agent: "pi",
        fix: `pi is signed in, but NOT for ${missing.join(", ")} (your seats run on it) — run \`pi\`, type /login, and ${missing.map((p) => hints[p] ?? `sign into ${p}`).join("; ")}`,
      };
    }
    return undefined;
  }
  if (agent === "claude" || agent === "claude-code") {
    // Run #5 finding #3: a bare token (`claude auth login`) is NOT enough —
    // a seat that starts interactive claude re-runs FIRST-RUN ONBOARDING
    // (login screen included) unless onboarding completed. Demand both.
    try {
      const j = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")) as {
        oauthAccount?: unknown;
        hasCompletedOnboarding?: unknown;
      };
      if (j.oauthAccount && j.hasCompletedOnboarding === true) return undefined;
    } catch {
      /* absent / unreadable */
    }
    return {
      agent: "claude",
      fix: "Claude Code is installed but its one-time setup isn't finished — run `claude` in a terminal, finish its first-run (theme + sign-in with your Claude subscription), then type /exit",
    };
  }
  if (agent === "codex") {
    // Codex CLI records its ChatGPT sign-in at ~/.codex/auth.json.
    if (existsSync(join(home, ".codex", "auth.json"))) return undefined;
    return {
      agent: "codex",
      fix: "Codex CLI is installed but not signed in — run `codex` in a terminal, sign in with your ChatGPT account, then quit",
    };
  }
  if (agent === "opencode") {
    // opencode stores provider credentials at ~/.local/share/opencode/auth.json
    // (`opencode auth login`). Existence check only — providers vary.
    if (existsSync(join(home, ".local", "share", "opencode", "auth.json"))) return undefined;
    return {
      agent: "opencode",
      fix: "OpenCode is installed but has no provider signed in — run `opencode auth login` and connect a provider",
    };
  }
  if (agent === "agy") {
    // Antigravity CLI keeps its credential in the OS KEYRING (Keychain /
    // libsecret) — there is no dotfile to stat the way gemini had
    // oauth_creds.json. The only stat-able signal is the onboarding marker.
    //
    // THIS MARKER MAY NEVER, ON ITS OWN, MEAN READY. It records that someone
    // completed onboarding ONCE — not that the credential is live, not that the
    // tier is eligible. That distinction is the whole CE-048/CE-138 family:
    // claude's hasCompletedOnboarding needed pairing with oauthAccount, and
    // gemini's oauth_creds.json was valid-LOOKING and unservable. So the marker
    // is used in the NEGATIVE direction only — absent means definitely not
    // signed in, and we say so cheaply. The positive proof is the deep probe in
    // agentProblem (`agy models`, which requires auth), run at the moments of
    // truth. Shallow "ready" here is the same optimism claude's markers get,
    // and it carries the same caveat.
    try {
      const j = JSON.parse(
        readFileSync(join(home, ".gemini", "antigravity-cli", "cache", "onboarding.json"), "utf8"),
      ) as { onboardingComplete?: unknown };
      if (j.onboardingComplete === true) return undefined;
    } catch {
      /* absent / unreadable — fall through to the honest problem */
    }
    return {
      agent: "agy",
      fix: "Antigravity CLI is installed but not signed in — run `agy` in a terminal, complete the Google sign-in in the browser it opens (approve the keyring prompt), then /quit",
    };
  }
  if (agent === "gemini") {
    // CE-138 (battle test 2026-08-18): Google KILLED the CLI's free
    // individual tier (IneligibleTierError → "migrate to Antigravity"), so
    // OAuth creds under ~/.gemini are VALID-LOOKING but unservable — counting
    // them was a false-READY that wedged a live seat. Only an API key makes
    // headless -p turns possible now.
    if (process.env.GEMINI_API_KEY) return undefined;
    return {
      agent: "gemini",
      fix:
        "Gemini CLI needs GEMINI_API_KEY — Google retired the free Google-sign-in tier for this CLI " +
        "(2026-08, 'Antigravity'); a Google AI API key (metered) is the only working path: export GEMINI_API_KEY=…",
    };
  }
  return undefined; // other agents (aider, openclaw, …) manage their own auth (adapter-specific)
}

/** Agents whose credential CANNOT be proven by stat-ing a dotfile — the marker
 * they leave is optimism, and only the deep probe inside `agentProblem` is proof.
 *
 * CE-148 (battle test 2026-08-18) is why this is a LIST and not a hardcoded name
 * in each reader: `agy` grew a deep branch below while the staffing catalog's
 * cache in `gui/server.ts` still read `if (agent !== "claude") return undefined`,
 * so the newest harness — the one whose credential lives in the OS keyring where
 * nothing can stat it — was offered READY on its onboarding marker alone. Adding
 * a deep branch below WITHOUT adding the agent here is that same bug again; the
 * drift guard in `core/test/ce148-deep-probe-enrollment.test.ts` reads this file
 * and fails if the two ever disagree. */
export const DEEP_PROBED: readonly string[] = ["claude", "claude-code", "agy"];

/** Full detection for one agent: not installed beats not signed in; undefined
 * means READY (installed + authenticated for the given models' providers).
 * `deep` (run #10): the ~/.claude.json markers can say "signed in" while the
 * REAL credential (macOS Keychain) is stale — e.g. after claude auto-updates,
 * the keychain ACL no longer matches the new binary and a WALLED seat can't
 * pop the approval prompt, so it boots "Not logged in" despite green markers.
 * Deep asks claude itself (`claude auth status` → loggedIn) — used at the
 * moments of truth (the Check screen's doctor row and the boot refusal),
 * not on every dashboard poll. */
export function agentProblem(
  agent: string,
  home: string,
  models: string[] = [],
  opts: { path?: string; deep?: boolean; deepTimeoutMs?: number } = {},
): AgentProblem | undefined {
  // CE-148: the catalog runs the deep probe on a REQUEST path in a
  // single-threaded server, so it passes a tighter ceiling than the doctor's.
  // `agy models` is a network call (~2s healthy here); 30s of execFileSync would
  // freeze every other route with it. A timeout is a NOT-ready, which is the
  // safe direction.
  const deepTimeout = opts.deepTimeoutMs ?? 30000;
  const bin = binaryFor(agent);
  if (bin && !whichBin(bin, opts)) {
    const fixes: Record<string, string> = {
      pi: "the Pi harness isn't installed on this machine — install it and sign in with your ChatGPT account (run `pi`, type /login), then Refresh",
      claude: "Claude Code isn't installed on this machine — install it and finish its first-run sign-in (run `claude`), then Refresh",
      codex: "Codex CLI isn't installed on this machine — install it and sign in with your ChatGPT account (run `codex`), then Refresh",
    };
    return { agent, fix: fixes[bin] ?? `${bin} isn't installed on this machine — install it and sign in, then Refresh` };
  }
  const marker = seatAuthProblem(agent, home, models);
  if (marker) return marker;
  if (opts.deep && agent === "agy") {
    // The POSITIVE proof the onboarding marker cannot give. `agy models` needs a
    // live credential and returns the model list the picker wants anyway, so it
    // pays twice. Failure is treated as not-ready ON PURPOSE: the safe direction
    // for a wrong answer here is a false NOT-ready (the operator re-checks) —
    // never a false READY, which is what wedged a live seat in CE-138. Deep runs
    // only at the moments of truth (doctor row, boot refusal), not on dashboard
    // polls, so the network cost is bounded.
    try {
      const out = execFileSync(whichBin("agy", opts)!, ["models"], {
        encoding: "utf8",
        timeout: deepTimeout,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (/\S/.test(out.replace(/Fetching available models\.\.\.?/g, ""))) return undefined;
    } catch {
      /* fall through to the honest problem */
    }
    return {
      agent: "agy",
      fix:
        "Antigravity CLI's saved sign-in isn't usable right now (its keyring credential is missing, expired, or unreadable from this account) — " +
        "run `agy` once in a terminal, complete the Google sign-in, approve the keyring prompt, then try again",
    };
  }
  if (opts.deep && (agent === "claude" || agent === "claude-code")) {
    try {
      const out = execFileSync(whichBin("claude", opts)!, ["auth", "status"], {
        encoding: "utf8",
        timeout: Math.min(15000, deepTimeout),
        stdio: ["ignore", "pipe", "pipe"],
      });
      if ((JSON.parse(out) as { loggedIn?: unknown }).loggedIn === true) return undefined;
    } catch {
      /* fall through to the honest problem */
    }
    return {
      agent: "claude",
      fix:
        "Claude Code's saved sign-in isn't usable right now (its token/keychain is out of sync — common after claude updates itself) — " +
        "run `claude` once in a terminal on this account, approve any keychain prompt / re-login, then try again",
    };
  }
  return undefined;
}

// ── staffed-agent detection (the health screen's soft pre-gate) ──────────────

const TITLES: Record<Seat, string> = {
  orchestrator: "Orchestrator",
  coder: "Coder",
  reviewer: "Reviewer",
  designer: "Designer",
  tester: "QA",
};

export interface AgentStatus {
  agent: string;
  /** Human label for the harness. */
  label: string;
  /** Titles of the staffed seats that run on this agent. */
  seats: string[];
  installed: boolean;
  /** installed AND authenticated for every staffed model's provider. */
  ready: boolean;
  /** The honest one-liner when not ready. */
  fix?: string;
}

export function agentLabel(agent: string): string {
  if (agent === "pi") return "Pi";
  if (agent === "claude" || agent === "claude-code") return "Claude Code";
  if (agent === "codex") return "Codex CLI";
  if (agent === "opencode") return "OpenCode";
  if (agent === "aider") return "Aider";
  if (agent === "gemini") return "Gemini CLI";
  if (agent === "openclaw") return "OpenClaw";
  return agent;
}

/**
 * Per-agent readiness for the STAFFED seats. Agent resolution is EXACTLY the
 * boot's (resolveSeat over rig.conf → user defaults → built-in), so what this
 * reports matches what up() will refuse on.
 */
export function agentStatus(opts: { home: string; project?: string; path?: string }): AgentStatus[] {
  const confFile = opts.project ? join(opts.project, ".agents", "rig.conf") : undefined;
  const conf = confFile && existsSync(confFile) ? parseRigConf(readFileSync(confFile, "utf8")) : {};
  const userDefaults = loadUserDefaults(opts.home);
  const seatsByAgent = new Map<string, string[]>();
  const modelsByAgent = new Map<string, string[]>();
  for (const seat of SEATS) {
    // The loadout only floors the MODEL — agent resolution doesn't need it.
    const staffed = resolveSeat(seat, undefined, { rigConf: conf, userDefaults });
    seatsByAgent.set(staffed.agent, [...(seatsByAgent.get(staffed.agent) ?? []), TITLES[seat]]);
    modelsByAgent.set(staffed.agent, [...(modelsByAgent.get(staffed.agent) ?? []), staffed.model]);
  }
  const out: AgentStatus[] = [];
  for (const [agent, seats] of seatsByAgent) {
    const bin = binaryFor(agent);
    const installed = bin === undefined || whichBin(bin, { ...(opts.path !== undefined ? { path: opts.path } : {}) }) !== undefined;
    const problem = agentProblem(agent, opts.home, modelsByAgent.get(agent), {
      ...(opts.path !== undefined ? { path: opts.path } : {}),
    });
    out.push({
      agent,
      label: agentLabel(agent),
      seats,
      installed,
      ready: problem === undefined,
      ...(problem ? { fix: problem.fix } : {}),
    });
  }
  return out;
}
