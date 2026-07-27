// smoke-check.js — the runtime smoke rung's checks (PDR dev/pdr/runtime-smoke-rung.md).
//
// Usage:
//   node smoke-check.js --base <url> --agents-md <path> [--allow "s1,s2"] [--out <dir>]
//   node smoke-check.js --agents-md <path> --print-routes     (extraction only, JSON)
//
// Routes come from AGENTS.md "## Critical Paths" — full stop (one list, two
// consumers; QA keeps the behavioral assertions, the rung takes the parseable
// route tokens). Per smokable route, three checks (all GET-only):
//   1. HTTP: 404 + 5xx FAIL; 401/403 = counted advisory skip "auth-gated"
//      (the rung is unauthenticated forever); other 4xx FAIL; redirect loop /
//      cap breach FAIL (the canonical-flip outage class).
//   2. Console: error-severity entries + uncaught page exceptions, filtered
//      through the allowlist (shipped default: favicon). Warnings never count.
//   3. Mobile 390px load: FATAL-ONLY (death fails; overflow = advisory line).
// Output: one line per route, then "SMOKE-RESULT: PASS|FAIL n/m ...".
// Exit: 0 = no failing route, 1 = at least one FAIL, 2 = crash/misuse.
// Enforcement (advisory vs wall) is the CALLER's decision (SMOKE_ENFORCE).

const fs = require('fs');
const path = require('path');
const os = require('os');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(name);

// ── route extraction from "## Critical Paths" ───────────────────────────────
// Tokens: (/path) parens or `path` backticks. `index.html`/plain filenames map
// to "/". Placeholders (REF, :param, <x>, {x}) make a line non-smokable —
// skipped AND counted, never silent.
function extractRoutes(agentsMdText) {
  const lines = [];
  let inSection = false;
  for (const raw of agentsMdText.split('\n')) {
    if (/^## /.test(raw)) {
      inSection = /^## Critical Paths/i.test(raw.trim());
      continue;
    }
    if (inSection && /^\s*(\d+\.|[-*])\s+/.test(raw)) lines.push(raw.trim());
  }
  const routes = [];
  const skipped = [];
  const seen = new Set();
  const PLACEHOLDER = /(:[A-Za-z_]+|<[^>]*>|\{[^}]*\}|\bREF\b|\[[^\]]*\])/;
  for (const line of lines) {
    const tokens = [];
    for (const m of line.matchAll(/\(([^)\s]+)\)|`([^`\s]+)`/g)) {
      tokens.push((m[1] || m[2]).replace(/^`+|`+$/g, '')); // (`x`) captures via the paren arm
    }
    let found = null;
    for (let t of tokens) {
      if (/^https?:\/\//.test(t)) {
        try { t = new URL(t).pathname || '/'; } catch { continue; }
      }
      if (/^[A-Za-z0-9._-]+\.html?$/.test(t)) t = t === 'index.html' ? '/' : `/${t}`;
      if (!t.startsWith('/')) continue;
      if (PLACEHOLDER.test(t)) { found = { placeholder: t }; continue; }
      found = { route: t };
      break;
    }
    if (found && found.route) {
      if (!seen.has(found.route)) { seen.add(found.route); routes.push(found.route); }
    } else {
      skipped.push({
        line: line.slice(0, 90),
        reason: found ? `placeholder route (${found.placeholder})` : 'no concrete route token',
      });
    }
  }
  return { routes, skipped, total: lines.length };
}

// ── AGENTS.md "## Smoke Rung" tunables (exactly two — one-list doctrine) ────
function smokeTunables(agentsMdText) {
  const out = { allow: [], deadline: null };
  let inSection = false;
  for (const raw of agentsMdText.split('\n')) {
    if (/^## /.test(raw)) { inSection = /^## Smoke Rung/i.test(raw.trim()); continue; }
    if (!inSection) continue;
    const s = raw.trim().replace(/^[-*]\s*/, '');
    const mAllow = s.match(/^Console allowlist:\s*(.+)$/i);
    if (mAllow) out.allow.push(...mAllow[1].split(',').map((x) => x.trim()).filter(Boolean));
    const mDeadline = s.match(/^Ready deadline:\s*(\d+)/i);
    if (mDeadline) out.deadline = parseInt(mDeadline[1], 10);
  }
  return out;
}

// ── browser stack (KEEP IN SYNC with mobile-check.js / qa-sweep discovery) ──
function browserStack() {
  let chromium, devices, execPath;
  try {
    ({ chromium, devices } = require('playwright'));
  } catch {
    try {
      ({ chromium, devices } = require('playwright-core'));
    } catch {
      return null; // no playwright stack at all — caller reports an honest skip
    }
    const roots = [
      path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
      path.join(os.homedir(), '.cache', 'ms-playwright'),
    ];
    const candidates = [
      ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
      ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
      ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'],
      ['chrome-headless-shell-mac-x64', 'chrome-headless-shell'],
      ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
      ['chrome-headless-shell-linux', 'chrome-headless-shell'],
      ['chrome-linux64', 'chrome'],
      ['chrome-linux', 'chrome'],
    ];
    outer: for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      const dirs = fs.readdirSync(root).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d)).sort().reverse();
      for (const d of dirs) {
        for (const rel of candidates) {
          const p = path.join(root, d, ...rel);
          if (fs.existsSync(p)) { execPath = p; break outer; }
        }
      }
    }
    if (!execPath) return null;
  }
  return { chromium, devices, execPath };
}

const DEFAULT_ALLOW = ['favicon.ico'];
const REDIRECT_CAP = 10;

(async () => {
  const agentsMdPath = arg('--agents-md', '');
  const agentsMd = agentsMdPath && fs.existsSync(agentsMdPath) ? fs.readFileSync(agentsMdPath, 'utf8') : '';
  const extraction = extractRoutes(agentsMd);

  if (has('--print-routes')) {
    console.log(JSON.stringify({ ...extraction, tunables: smokeTunables(agentsMd) }));
    return;
  }

  const base = arg('--base', '').replace(/\/+$/, '');
  if (!base) { console.error('smoke-check: --base required'); process.exit(2); }
  const allow = [
    ...DEFAULT_ALLOW,
    ...arg('--allow', '').split(',').map((s) => s.trim()).filter(Boolean),
    ...smokeTunables(agentsMd).allow,
  ];
  const outDir = arg('--out', '');

  const { routes, skipped, total } = extraction;
  for (const s of skipped) console.log(`SKIP (${s.reason}): ${s.line}`);
  if (!routes.length) {
    console.log(`SMOKE-RESULT: SKIPPED (0 smokable routes of ${total} critical paths — the rung has nothing deterministic to drive)`);
    return;
  }

  const stack = browserStack();
  if (!stack) {
    console.log('SMOKE-RESULT: SKIPPED (no playwright browser in repo or cache — fix: npx playwright install chromium)');
    return;
  }
  const { chromium, devices, execPath } = stack;
  const browser = await chromium.launch({ headless: true, ...(execPath ? { executablePath: execPath } : {}) });

  let fails = 0, passes = 0, authGated = 0;
  try {
    for (const route of routes) {
      const problems = [];
      const advisories = [];
      let status = null;

      // desktop pass: status + console + exceptions
      let ctx;
      try {
        ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        const consoleErrors = [];
        page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
        page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
        let hops = 0;
        page.on('response', (r) => { if ([301, 302, 303, 307, 308].includes(r.status())) hops++; });
        let resp = null;
        try {
          resp = await page.goto(base + route, { waitUntil: 'load', timeout: 30000 });
        } catch (e) {
          const msg = (e && e.message) || String(e);
          if (/ERR_TOO_MANY_REDIRECTS/i.test(msg) || hops > REDIRECT_CAP) {
            problems.push(`redirect loop/cap (${hops} hops)`);
          } else {
            problems.push(`load failed: ${msg.split('\n')[0].slice(0, 80)}`);
          }
        }
        if (resp) {
          if (hops > REDIRECT_CAP) problems.push(`redirect cap breached (${hops} hops)`);
          status = resp.status();
          if (status === 401 || status === 403) {
            console.log(`ROUTE ${route}: AUTH-GATED (${status} — QA's session territory, not the rung's)`);
            authGated++;
            await ctx.close().catch(() => {});
            continue;
          }
          if (status === 404) problems.push('404 — a listed critical path does not exist');
          else if (status >= 500) problems.push(`${status} server error`);
          else if (status >= 400) problems.push(`${status} on a plain GET`);
        }
        await page.waitForTimeout(300);
        const realErrors = consoleErrors.filter((t) => !allow.some((a) => t.includes(a)));
        if (realErrors.length) {
          problems.push(`console: ${realErrors[0].split('\n')[0].slice(0, 100)}${realErrors.length > 1 ? ` (+${realErrors.length - 1} more)` : ''}`);
        }
        if (outDir) {
          fs.mkdirSync(outDir, { recursive: true });
          const safe = (route.replace(/^\//, '').replace(/[^a-zA-Z0-9._-]+/g, '_') || 'home');
          await page.screenshot({ path: path.join(outDir, `${safe}.png`), fullPage: true }).catch(() => {});
        }
      } catch (e) {
        problems.push(`desktop pass crashed: ${((e && e.message) || String(e)).split('\n')[0].slice(0, 80)}`);
      } finally {
        if (ctx) await ctx.close().catch(() => {});
      }

      // mobile pass: fatal-only; overflow is advisory forever
      let mctx;
      try {
        const device = devices['iPhone 13'] || { viewport: { width: 390, height: 844 } };
        mctx = await browser.newContext({ ...device });
        const mpage = await mctx.newPage();
        await mpage.goto(base + route, { waitUntil: 'load', timeout: 30000 });
        const m = await mpage.evaluate(() => {
          const d = document.documentElement;
          return { sw: d.scrollWidth, cw: d.clientWidth };
        });
        if (m.sw > m.cw) advisories.push(`mobile overflow ${m.sw}px vs ${m.cw}px (advisory — QA judges)`);
      } catch (e) {
        problems.push(`mobile load died: ${((e && e.message) || String(e)).split('\n')[0].slice(0, 80)}`);
      } finally {
        if (mctx) await mctx.close().catch(() => {});
      }

      if (problems.length) {
        fails++;
        console.log(`ROUTE ${route}: FAIL (${problems.join('; ')})`);
      } else {
        passes++;
        console.log(`ROUTE ${route}: PASS${status !== null && status !== 200 ? ` (${status})` : ''}`);
      }
      for (const a of advisories) console.log(`  advisory: ${a}`);
    }
  } finally {
    await browser.close();
  }

  const parts = [`${passes}/${routes.length} routes green`];
  if (authGated) parts.push(`${authGated} auth-gated (QA owns)`);
  if (skipped.length) parts.push(`${skipped.length} skipped of ${total} paths`);
  console.log(`SMOKE-RESULT: ${fails ? 'FAIL' : 'PASS'} — ${parts.join(', ')}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error('smoke-check crash:', (e && e.message) || e);
  process.exit(2);
});
