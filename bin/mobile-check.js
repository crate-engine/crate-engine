// mobile-check.js — headless mobile-overflow check + full-page screenshots.
//
// Usage: node mobile-check.js --base <url> --routes <comma-list> --out <dir>
// For each route: loads it at an iPhone-13 viewport, auto-scrolls to trigger
// scroll-based fade-in content, measures horizontal overflow (scrollWidth vs
// clientWidth), and writes a full-page screenshot to <out>/<safe-route>.png.
// Prints one compact line per route, then a SCREENSHOTS: line.
// Overflow is a FINDING (exit 0). Exits non-zero ONLY on a real crash.

const fs = require('fs');
const path = require('path');
const os = require('os');

// P4-11: resolve a browser stack without requiring the TARGET repo to ship
// playwright. Prefer the repo's own `playwright`; fall back to `playwright-core`
// (in-box via the engine core's node_modules on NODE_PATH) plus a chromium
// executable found in the playwright browser cache (macOS + Linux roots).
let chromium, devices, execPath;
try {
  ({ chromium, devices } = require('playwright'));
} catch {
  ({ chromium, devices } = require('playwright-core'));
  const roots = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'), // macOS
    path.join(os.homedir(), '.cache', 'ms-playwright'), // Linux
  ];
  // KEEP IN SYNC with CHROMIUM_CANDIDATES in core/src/tools/qa-sweep.ts (the
  // canonical list; 2026-07-12: added chrome-linux64 + mac-x64 — the current
  // Linux layout is chrome-linux64/, the bare chrome-linux/ is the OLD one).
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
    const dirs = fs
      .readdirSync(root)
      .filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d))
      .sort()
      .reverse();
    for (const d of dirs) {
      for (const rel of candidates) {
        const p = path.join(root, d, ...rel);
        if (fs.existsSync(p)) {
          execPath = p;
          break outer;
        }
      }
    }
  }
  if (!execPath) {
    console.error(
      'mobile-check: no playwright in the repo and no chromium in the playwright cache (fix: npx playwright install chromium)'
    );
    process.exit(2);
  }
}

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const base = arg('--base', 'http://localhost:3000').replace(/\/+$/, '');
const routes = arg('--routes', '/')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);
const out = arg('--out', '/tmp/mobile-shots');

function safeName(route) {
  const s = route.replace(/^\//, '').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return (s || 'home') + '.png';
}

async function autoScroll(page) {
  // Step down the page to trigger scroll-based (fade-in) content, then return to top.
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = 600;
      const timer = setInterval(() => {
        const h = document.body.scrollHeight;
        window.scrollTo(0, y);
        y += step;
        if (y >= h) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
}

(async () => {
  let name = 'iPhone 13';
  if (!devices[name]) {
    const iphones = Object.keys(devices).filter(
      (k) => /^iPhone/.test(k) && !/landscape/i.test(k)
    );
    name = iphones.length ? iphones[iphones.length - 1] : 'iPhone 12';
    console.log(`(device 'iPhone 13' absent; using closest preset '${name}')`);
  }
  const device = devices[name];
  fs.mkdirSync(out, { recursive: true });

  const browser = await chromium.launch({ headless: true, ...(execPath ? { executablePath: execPath } : {}) });
  try {
    for (const route of routes) {
      // Per-route isolation: one bad/timed-out route is reported and skipped, the
      // remaining routes still run. Only a top-level crash (below) exits non-zero.
      let context;
      try {
        context = await browser.newContext({ ...device });
        const page = await context.newPage();
        await page.goto(base + route, { waitUntil: 'load', timeout: 30000 });
        await autoScroll(page);
        const m = await page.evaluate(() => {
          const d = document.documentElement;
          return { sw: d.scrollWidth, cw: d.clientWidth };
        });
        await page.screenshot({ path: path.join(out, safeName(route)), fullPage: true });
        if (m.sw > m.cw) {
          console.log(`${route}: OVERFLOW (${m.sw} vs ${m.cw})`);
        } else {
          console.log(`${route}: OK`);
        }
      } catch (e) {
        const reason = (e && e.message ? e.message : String(e)).split('\n')[0].slice(0, 80);
        console.log(`${route}: ERROR (${reason})`);
      } finally {
        if (context) await context.close().catch(() => {});
      }
    }
    console.log(`SCREENSHOTS: ${out}`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('mobile-check crash:', e && e.message ? e.message : e);
  process.exit(1);
});
