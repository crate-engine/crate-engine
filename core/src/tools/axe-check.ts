// axe-check — P7-T3: the QA seat's accessibility pass in one bash call.
// Injects axe-core into each route and reports violations (id, impact, count,
// first target) per route. Routes come from --routes or the project AGENTS.md
// critical paths, like qa-sweep. DEGRADE-DON'T-FAIL: a missing axe-core or
// browser prints an honest "AXE NOT VERIFIED — <why>" and exits 0 — the pass
// being unavailable must never fail a QA run; QA reports the degrade instead.
// Exit: 1 iff violations were found; 0 on clean or degrade.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { findChromium, resolveBase, routesFromAgentsMd } from "./qa-sweep.js";

interface AxeViolation {
  id: string;
  impact: string;
  help: string;
  nodes: number;
  firstTarget: string;
}
interface AxeRouteResult {
  route: string;
  violations: AxeViolation[];
  error?: string;
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main(): Promise<void> {
  const out = arg("--out") ?? "/tmp/axe-check";
  const project = arg("--project") ?? ".";
  const base = await resolveBase(arg("--base"), project, "axe-check");
  if (!base) {
    process.exitCode = 2;
    return;
  }

  let routes = (arg("--routes") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  if (routes.length === 0) {
    const agents = join(project, "AGENTS.md");
    if (existsSync(agents)) routes = routesFromAgentsMd(readFileSync(agents, "utf8"));
    if (routes.length === 0) routes = ["/"];
  }

  // Degrade-don't-fail: resolve the two heavy pieces up front, honestly.
  let axeSource: string;
  try {
    const require = createRequire(import.meta.url);
    axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  } catch (e) {
    console.log(`AXE NOT VERIFIED — axe-core is not installed in the engine's core deps (${e instanceof Error ? e.message.split("\n")[0] : e}). Report this degrade in your verdict; do not fail the run.`);
    return;
  }
  let executablePath: string;
  try {
    executablePath = findChromium();
  } catch (e) {
    console.log(`AXE NOT VERIFIED — ${e instanceof Error ? e.message : e}. Report this degrade in your verdict; do not fail the run.`);
    return;
  }

  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath });
  const results: AxeRouteResult[] = [];

  for (const route of routes) {
    const r: AxeRouteResult = { route, violations: [] };
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(base + route, { waitUntil: "networkidle", timeout: 20000 });
      await page.addScriptTag({ content: axeSource });
      const raw = (await page.evaluate(
        // @ts-expect-error axe is injected above
        () => window.axe.run(document, { resultTypes: ["violations"] }),
      )) as { violations: Array<{ id: string; impact?: string; help: string; nodes: Array<{ target: string[] }> }> };
      r.violations = raw.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? "unknown",
        help: v.help,
        nodes: v.nodes.length,
        firstTarget: v.nodes[0]?.target.join(" ") ?? "",
      }));
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e);
    }
    await page.close();
    results.push(r);
  }
  await browser.close();

  writeFileSync(join(out, "axe-check.json"), JSON.stringify({ base, routes, results }, null, 2));
  let total = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`${r.route} LOAD-ERROR: ${r.error}`);
      continue;
    }
    total += r.violations.length;
    if (r.violations.length === 0) {
      console.log(`${r.route} OK (0 violations)`);
    } else {
      console.log(`${r.route} VIOLATIONS: ${r.violations.length}`);
      for (const v of r.violations) {
        console.log(`  [${v.impact}] ${v.id} ×${v.nodes} — ${v.help} (e.g. ${v.firstTarget})`);
      }
    }
  }
  console.log(`AXE SUMMARY: ${results.length} route(s), ${total} violation(s). Evidence: ${join(out, "axe-check.json")}`);
  if (total > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("axe-check.js") || process.argv[1]?.endsWith("axe-check.ts")) {
  await main();
}
