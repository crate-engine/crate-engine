// RUNTIME SMOKE RUNG (2026-07-25; PDR dev/pdr/runtime-smoke-rung.md): shared
// serve resolution (one source of truth with dev-server), the in-box GET-only
// static server, Critical-Paths route extraction, and the three per-route
// checks with the grill's severity lines (404/5xx/redirect-loop FAIL, 401/403
// auth-gated skip, console allowlist, mobile fatal-only). Drives the REAL bin/
// scripts; the browser integration test skips honestly when no chromium exists.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = join(ROOT, "bin");
const CORE_NM = join(ROOT, "core", "node_modules");
const scratch = mkdtempSync(join(tmpdir(), "crate2-smoke-"));

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  try {
    return {
      ok: true,
      out: execFileSync(cmd, args, {
        cwd: opts.cwd, encoding: "utf8",
        env: { ...process.env, NODE_PATH: CORE_NM, ...(opts.env ?? {}) },
      }),
      code: 0,
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? ""), code: err.status ?? 1 };
  }
}

function resolveServe(kind: string, proj: string, conf?: string) {
  const r = sh("bash", [join(BIN, "serve-resolve"), kind, proj, ...(conf ? [conf] : [])]);
  const mode = /MODE=([^\n]*)/.exec(r.out)?.[1] ?? "";
  const cmd = /CMD=([^\n]*)/.exec(r.out)?.[1] ?? "";
  return { mode, cmd };
}

// ── serve-resolve ───────────────────────────────────────────────────────────

test("serve-resolve: GATE_START_CMD override wins, read from a SEPARATE conf root (worktree shape)", () => {
  const wt = join(scratch, "wt"); // bare worktree — no .agents
  const rig = join(scratch, "rig");
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, "index.html"), "<h1>x</h1>");
  mkdirSync(join(rig, ".agents"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), `GATE_START_CMD='my-serve --port $GATE_PORT'\n`);
  const r = resolveServe("gate", wt, rig);
  assert.equal(r.mode, "prod");
  assert.match(r.cmd, /^my-serve --port \$GATE_PORT$/);
});

test("serve-resolve: plain-HTML project falls to the in-box static server (prod artifact = the tree)", () => {
  const p = join(scratch, "static-proj");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "index.html"), "<h1>x</h1>");
  const r = resolveServe("gate", p);
  assert.equal(r.mode, "static");
  assert.match(r.cmd, /static-serve\.js/);
});

test("serve-resolve: vite-shaped project resolves preview; dev mode resolves the dev script; empty = none", () => {
  const p = join(scratch, "vite-proj");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "package.json"), JSON.stringify({ scripts: { preview: "vite preview", dev: "vite" } }));
  assert.equal(resolveServe("gate", p).mode, "prod");
  assert.match(resolveServe("gate", p).cmd, /preview/);
  assert.equal(resolveServe("dev", p).mode, "dev");
  assert.match(resolveServe("dev", p).cmd, /npm run dev/);
  const empty = join(scratch, "empty-proj");
  mkdirSync(empty, { recursive: true });
  assert.equal(resolveServe("gate", empty).mode, "none");
});

test("serve-resolve: gate falls back to DEV resolution marked mode=dev (degraded but honest)", () => {
  const p = join(scratch, "dev-only-proj");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "package.json"), JSON.stringify({ scripts: { dev: "node server.js" } }));
  const r = resolveServe("gate", p);
  assert.equal(r.mode, "dev");
  assert.match(r.cmd, /npm run dev/);
});

// ── static-serve ────────────────────────────────────────────────────────────

test("static-serve: GET works, POST refused (405), traversal refused", async () => {
  const p = join(scratch, "static-live");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "index.html"), "<h1>live</h1>");
  const port = 3910 + Math.floor(Math.random() * 50);
  const child = spawn("node", [join(BIN, "static-serve.js"), String(port), p], { stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 700));
    const ok = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /live/);
    const post = await fetch(`http://127.0.0.1:${port}/`, { method: "POST" });
    assert.equal(post.status, 405, "the rung's server never accepts writes (Rider 4)");
    const trav = await fetch(`http://127.0.0.1:${port}/..%2f..%2fetc%2fpasswd`);
    assert.ok([403, 404].includes(trav.status), `traversal must be refused (got ${trav.status})`);
  } finally {
    child.kill();
  }
});

// ── route extraction (one list, two consumers) ──────────────────────────────

function extract(agentsMd: string) {
  const f = join(scratch, `agents-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(f, agentsMd);
  const r = sh("node", [join(BIN, "smoke-check.js"), "--agents-md", f, "--print-routes"]);
  return JSON.parse(r.out);
}

test("extraction: parens, backticks-in-parens, dedupe; placeholders + routeless lines skipped AND counted", () => {
  const j = extract([
    "## Critical Paths (QA test list)",
    "",
    "1. Homepage (`index.html`) — loads",
    "2. Browse (/browse) — grid renders, filters work",
    "3. Browse again (/browse) — duplicate token",
    "4. Detail (/browse/REF) — placeholder",
    "5. Param (`/api/items/:id`) — placeholder too",
    "6. Admin dashboard — no route token at all",
    "",
    "## Something Else",
    "1. Not a path (/nope) — outside the section",
  ].join("\n"));
  assert.deepEqual(j.routes, ["/", "/browse"]);
  assert.equal(j.skipped.length, 3);
  assert.equal(j.total, 6);
  assert.match(JSON.stringify(j.skipped), /placeholder/);
});

test("extraction: Smoke Rung tunables parse (exactly two — allowlist + deadline)", () => {
  const j = extract([
    "## Smoke Rung",
    "- Console allowlist: widget-noise, analytics blocked",
    "- Ready deadline: 45",
    "## Critical Paths",
    "1. Home (/) — loads",
  ].join("\n"));
  assert.deepEqual(j.tunables.allow, ["widget-noise", "analytics blocked"]);
  assert.equal(j.tunables.deadline, 45);
});

// ── the checks against a purpose-built failure-mode server ──────────────────

test("smoke-check: severity lines — 404/5xx/redirect-loop/console FAIL; 401 auth-gated; allowlist holds", async (t) => {
  const port = 3970 + Math.floor(Math.random() * 20);
  const server = createServer((req, res) => {
    const u = (req.url || "/").split("?")[0];
    if (u === "/ok") return void res.writeHead(200, { "content-type": "text/html" }).end("<h1>ok</h1>");
    if (u === "/boom") return void res.writeHead(500).end("boom");
    if (u === "/loop") return void res.writeHead(302, { location: "/loop" }).end();
    if (u === "/secret") return void res.writeHead(401).end("auth");
    if (u === "/noisy")
      return void res.writeHead(200, { "content-type": "text/html" }).end("<script>console.error('real bug: undefined thing')</script>ok");
    if (u === "/allowed")
      return void res.writeHead(200, { "content-type": "text/html" }).end("<script>console.error('widget-noise blocked by client')</script>ok");
    res.writeHead(404).end("nope");
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  const agents = join(scratch, "agents-live.md");
  writeFileSync(agents, [
    "## Smoke Rung",
    "- Console allowlist: widget-noise",
    "## Critical Paths",
    "1. OK (/ok) — fine",
    "2. Missing (/gone) — 404 case",
    "3. Boom (/boom) — 500 case",
    "4. Loop (/loop) — redirect loop case",
    "5. Secret (/secret) — auth-gated case",
    "6. Noisy (/noisy) — console error case",
    "7. Allowed (/allowed) — allowlisted noise case",
  ].join("\n"));
  // NOTE: the fixture server lives in THIS process — the checker must run
  // async (a sync exec would block the event loop and starve the server).
  const runAsync = () =>
    new Promise<{ out: string; code: number }>((resolvePromise) => {
      const c = spawn("node", [join(BIN, "smoke-check.js"), "--base", `http://127.0.0.1:${port}`, "--agents-md", agents], {
        env: { ...process.env, NODE_PATH: CORE_NM },
      });
      let out = "";
      c.stdout.on("data", (d) => (out += d));
      c.stderr.on("data", (d) => (out += d));
      c.on("close", (code) => resolvePromise({ out, code: code ?? 1 }));
    });
  try {
    const r = await runAsync();
    if (/SKIPPED \(no playwright browser/.test(r.out)) {
      t.skip("no chromium on this host — honest skip, matches the rung's own behavior");
      return;
    }
    assert.match(r.out, /ROUTE \/ok: PASS/);
    assert.match(r.out, /ROUTE \/gone: FAIL \(404/);
    assert.match(r.out, /ROUTE \/boom: FAIL \(500/);
    assert.match(r.out, /ROUTE \/loop: FAIL \(redirect loop/);
    assert.match(r.out, /ROUTE \/secret: AUTH-GATED \(401/);
    assert.match(r.out, /ROUTE \/noisy: FAIL \(console: real bug/);
    assert.match(r.out, /ROUTE \/allowed: PASS/, "allowlisted console noise must not fail the route");
    assert.match(r.out, /SMOKE-RESULT: FAIL/);
    assert.equal(r.code, 1, "at least one FAIL → exit 1 (the caller maps enforce vs advisory)");
  } finally {
    server.close();
  }
});
