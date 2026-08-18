import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { listDirs, planAttach, resolveTarget } from "../src/attach.js";
import { agentStatus } from "../src/detect.js";
import { startGuiServer, type GuiServer } from "../src/gui/server.js";
import { tierPaths } from "../src/usertier.js";

// P5-1/P5-2: token gate + the thin law (API answers == core answers, object-equal)
// + fail-safe health (unknown ≠ dead). All hermetic on a fake HOME.

const scratch = mkdtempSync(join(tmpdir(), "crate2-gui-"));
const HOME = join(scratch, "home");
mkdirSync(HOME, { recursive: true });

// A user tier whose engine/ is a mini brain (attach reads templates/ from it).
function makeTierEngine(): string {
  const { engineDir } = tierPaths(HOME);
  for (const d of ["bin", "config/loadouts", "config/sandbox", "adapters/pi", "adapters/claude", "templates/state"]) {
    mkdirSync(join(engineDir, d), { recursive: true });
  }
  for (const doc of ["AGENTS.md", "PROGRESS.md", "ISSUES.md"]) {
    writeFileSync(join(engineDir, "templates", doc), `# ${doc} — {{PROJECT}}\n`);
  }
  writeFileSync(join(engineDir, "templates", "state", "FLAWS.md"), "# FLAWS — {{PROJECT}}\n");
  // the real brain ships a coder loadout (claude-code, walled) — mirror it so a
  // claude-staffed coder is wallable (P5-0a would otherwise refuse, correctly)
  writeFileSync(join(engineDir, "config", "coder.md"), "# coder binder\n");
  writeFileSync(
    join(engineDir, "config", "loadouts", "coder.yaml"),
    ["seat: coder", "agent: claude-code", "binder: config/coder.md", "policy:", "  tools: native", "  default_model: opus", "  sandbox: standard"].join("\n"),
  );
  for (const tpl of ["readonly", "standard"]) {
    writeFileSync(join(engineDir, "config", "sandbox", `${tpl}.sb.tpl`), `(version 1)\n; ${tpl} {{PROJECT}} {{HOME}}\n; {{DOORS}}\n`);
  }
  for (const agent of ["pi", "claude"]) {
    const f = join(engineDir, "adapters", agent, "launch.sh");
    writeFileSync(f, `#!/usr/bin/env bash\necho "${agent} --model \${1:-x}"\n`);
    chmodSync(f, 0o755);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: engineDir });
  return engineDir;
}
makeTierEngine();

let gui: GuiServer;
const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const r = await fetch(`http://127.0.0.1:${gui.port}${path}`, {
    method,
    headers: { "X-Crate-Token": token ?? gui.token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any, raw: r };
};

after(() => gui?.server.close());

test("server starts loopback with a per-launch token", async () => {
  gui = await startGuiServer({ home: HOME });
  assert.ok(gui.port > 0);
});

test("token gate: no token → 403; wrong token → 403; pages need it too", async () => {
  const bare = await fetch(`http://127.0.0.1:${gui.port}/`);
  assert.equal(bare.status, 403);
  const wrong = await call("GET", "/api/staffing", undefined, "nope");
  assert.equal(wrong.status, 403);
});

test("cockpit-first (S1+S3): THE PAGES ARE DEAD — /, the whole wizard journey, and the W1 relics all land in the cockpit", async () => {
  for (const p of ["/", "/welcome", "/staffing", "/attach", "/start", "/arm", "/check", "/health"]) {
    const r = await fetch(`http://127.0.0.1:${gui.port}${p}?token=${gui.token}`, { redirect: "manual" });
    assert.equal(r.status, 302, p);
    assert.match(r.headers.get("location") ?? "", /^\/team\?token=/, p);
  }
});

test("W2: brand fonts are self-hosted, tokenless, and whitelisted", async () => {
  const ok = await fetch(`http://127.0.0.1:${gui.port}/fonts/michroma-400.woff2`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "font/woff2");
  assert.ok((await ok.arrayBuffer()).byteLength > 1000, "a real font file");
  for (const p of ["/fonts/nope.woff2", "/fonts/x.txt", "/fonts/UPPER.woff2"]) {
    assert.equal((await fetch(`http://127.0.0.1:${gui.port}${p}`)).status, 404, p);
  }
});

test("S3: the card can be SUMMONED over a working cockpit (?card=1), dismissable back to the rig", async () => {
  const t = await (await fetch(`http://127.0.0.1:${gui.port}/team?token=${gui.token}&card=1`)).text();
  assert.match(t, /const CARD=\{"machine":.*"dismissable":/);
});

test("staffing catalog: five seats + the first-party-only Claude law (no Claude-via-Pi, ever)", async () => {
  const r = await call("GET", "/api/staffing");
  assert.equal(r.status, 200);
  assert.equal(r.body.seats.length, 5);
  // Adam's staffing law (2026-08-11): Claude runs FIRST-PARTY ONLY — no
  // anthropic/* model may appear in the catalog from any source.
  assert.equal(
    r.body.models.find((m: any) => m.model.startsWith("anthropic/")),
    undefined,
    "Claude-via-Pi must never be offered",
  );
  const coderDefault = r.body.models.find((m: any) => m.verifiedFor.includes("coder"));
  assert.equal(coderDefault.agent, "claude");
  // PHASE-B #4: pi 0.80.6's default model is offered — verified NOWHERE yet,
  // so every seat labels it "not yet battle-tested".
  const sol = r.body.models.find((m: any) => m.model === "openai-codex/gpt-5.6-sol");
  assert.equal(sol.agent, "pi");
  assert.equal(sol.verifiedFor.length, 0);
});

test("defaults write: valid saves; invalid is refused AND rolled back", async () => {
  const ok = await call("POST", "/api/defaults", { seats: { coder: { agent: "claude", model: "opus" } } });
  assert.equal(ok.status, 200);
  const saved = readFileSync(tierPaths(HOME).defaultsFile, "utf8");
  assert.match(saved, /coder:/);
  const bad = await call("POST", "/api/defaults", { seats: { coder: { agent: 5 } } });
  assert.equal(bad.status, 400);
  assert.equal(readFileSync(tierPaths(HOME).defaultsFile, "utf8"), saved); // rolled back
});

test("thin law: /api/attach/plan is object-equal with core planAttach", async () => {
  const repo = join(scratch, "parity-repo");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  const viaApi = await call("POST", "/api/attach/plan", { target: repo, create: false });
  assert.equal(viaApi.status, 200);
  const direct = planAttach(resolveTarget(repo, { home: HOME }), tierPaths(HOME).engineDir, { create: false });
  assert.deepEqual(viaApi.body, JSON.parse(JSON.stringify(direct)));
});

test("attach/execute: writes the plan, sets the project, doctor rides along", async () => {
  const repo = join(scratch, "exec-repo");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  const r = await call("POST", "/api/attach/execute", { target: repo, create: false });
  assert.equal(r.status, 200);
  assert.ok(existsSync(join(repo, ".agents", "rig.conf")));
  assert.ok(Array.isArray(r.body.doctor));
  assert.equal(r.body.project, repo);
  assert.equal(gui.state.project, repo);
});

test("fail-safe health (T8a headless): a not-booted team is UNKNOWN, never dead", async () => {
  const r = await call("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.booted, false);
  assert.equal(r.body.seats.length, 5);
  for (const s of r.body.seats) {
    assert.equal(s.liveness, "unknown", `${s.seat} must be unknown (not booted ≠ provably dead)`);
    assert.match(s.detail, /not booted/);
  }
});

test("loop dashboard: /api/loop reads state, pin, and event tail from ground truth (read-only)", async () => {
  const stateDir = join(scratch, "exec-repo", ".agents", "state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "events.log"),
    [
      "[2026-07-11T10:00:00] BOOT actor=orchestrator state=initialized",
      "[2026-07-11T10:05:00] START_IMPL actor=orchestrator state=implementing",
      "[2026-07-11T10:20:00] CODE_READY actor=coder sha=abc123def state=code_ready",
    ].join("\n") + "\n",
  );
  writeFileSync(join(stateDir, "pin-code_ready"), "sha=abc123def branch=feature/x at=2026-07-11T10:20:00\n");
  const r = await call("GET", "/api/loop");
  assert.equal(r.status, 200);
  assert.equal(r.body.state, "code_ready");
  assert.match(r.body.pinned, /sha=abc123def/);
  assert.equal(r.body.events.length, 3);
  assert.match(r.body.events[2], /CODE_READY/);
});

test("loop dashboard: an unbooted project reports down with no events (calm, not an error)", async () => {
  const repo = join(scratch, "loop-fresh");
  mkdirSync(join(repo, ".agents", "state"), { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  const prev = gui.state.project;
  gui.state.project = repo;
  try {
    const r = await call("GET", "/api/loop");
    assert.equal(r.status, 200);
    assert.equal(r.body.state, "down");
    assert.equal(r.body.pinned, null);
    assert.deepEqual(r.body.events, []);
  } finally {
    gui.state.project = prev;
  }
});

test("attach errors surface as plain 400s (junk path)", async () => {
  const r = await call("POST", "/api/attach/plan", { target: join(scratch, "does-not-exist"), create: false });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /--create|does not exist/);
});

// ── agent detection (the P6-6 direction change): thin law + honest catalog ──

test("thin law: /api/agents is object-equal with core agentStatus", async () => {
  const viaApi = await call("GET", "/api/agents");
  assert.equal(viaApi.status, 200);
  const direct = agentStatus({
    home: HOME,
    ...(gui.state.project !== undefined ? { project: gui.state.project } : {}),
  });
  assert.deepEqual(viaApi.body, JSON.parse(JSON.stringify(direct)));
});

test("detection gates the catalog: only READY agents' entries are offered; the agents card tells the truth", async () => {
  // a machine with pi installed + signed into ChatGPT, and NO claude
  const home2 = join(scratch, "home-pi-only");
  const bin = join(home2, "fakebin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "pi"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "pi"), 0o755);
  mkdirSync(join(home2, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home2, ".pi", "agent", "auth.json"), '{"openai-codex":{},"deepseek":{}}');
  const g2 = await startGuiServer({ home: home2, detectPath: bin });
  const c2 = async (path: string) => {
    const r = await fetch(`http://127.0.0.1:${g2.port}${path}`, {
      headers: { "X-Crate-Token": g2.token },
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  try {
    const r = await c2("/api/staffing");
    assert.equal(r.status, 200);
    // pi entries ready; the claude entry is NOT (not installed)
    for (const m of r.body.models.filter((m: any) => m.agent === "pi")) {
      assert.equal(m.ready, true, `${m.model} must be offered on a pi-ready machine`);
    }
    const claudeEntry = r.body.models.find((m: any) => m.agent === "claude");
    assert.equal(claudeEntry.ready, false);
    assert.match(claudeEntry.fix, /isn't installed/);
    // the per-agent summary rows match
    const agents = Object.fromEntries(r.body.agents.map((a: any) => [a.agent, a]));
    assert.equal(agents.pi.ready, true);
    assert.equal(agents.claude.ready, false);
    assert.equal(agents.claude.installed, false);
    // detection-aware seed: the Coder was seeded on the DETECTED agent
    const staffed = r.body.seats.find((s: any) => s.seat === "coder");
    assert.equal(staffed.current.agent, "pi");
    // and /api/agents reports the staffed team all-ready (everything runs on pi)
    const ag = await c2("/api/agents");
    assert.ok(ag.body.every((a: any) => a.ready), JSON.stringify(ag.body));
  } finally {
    g2.server.close();
  }
});

test("thin law: /api/fs/dirs is object-equal with core listDirs (the attach picker)", async () => {
  mkdirSync(join(HOME, "Projects", "sample"), { recursive: true });
  const viaApi = await call("GET", `/api/fs/dirs?path=${encodeURIComponent(join(HOME, "Projects"))}`);
  assert.equal(viaApi.status, 200);
  const { pickerRoots } = await import("../src/gui/server.js");
  const direct = listDirs(join(HOME, "Projects"), { home: HOME, roots: await pickerRoots(gui.state) });
  assert.deepEqual(viaApi.body, JSON.parse(JSON.stringify(direct)));
  // the jail refuses plainly through the API too
  const out = await call("GET", "/api/fs/dirs?path=/private/tmp");
  assert.equal(out.status, 400);
  assert.match(out.body.error, /inside your home/);
});

// ── Run #13: day-2 resume — a restart must not read as "starting from scratch",
// and a typo'd --project must never wedge the app ─────────────────────────────

test("a --project that was never attached is REFUSED; the app falls back to the last attached project", async () => {
  const g3 = await startGuiServer({ home: HOME, project: join(scratch, "no-such-project") });
  try {
    assert.equal(g3.state.project, join(scratch, "exec-repo")); // NOT the typo'd path
  } finally {
    g3.server.close();
  }
});

test("day-2 resume (S1): / lands straight in the attached project's cockpit — no wizard detour", async () => {
  const g3 = await startGuiServer({ home: HOME });
  try {
    assert.equal(g3.state.project, join(scratch, "exec-repo")); // persisted across "restarts"
    const t = await (await fetch(`http://127.0.0.1:${g3.port}/?token=${g3.token}`)).text(); // follows the 302
    assert.match(t, /exec-repo/);
    assert.match(t, /const CARD=null;/); // attached = no card
  } finally {
    g3.server.close();
  }
});

test("fresh account (S1): the cockpit opens with the ONE irreducible card — never a redirect out of the room", async () => {
  const home3 = join(scratch, "home3");
  mkdirSync(home3, { recursive: true });
  const g3 = await startGuiServer({ home: home3 });
  try {
    assert.equal(g3.state.project, undefined);
    const r = await fetch(`http://127.0.0.1:${g3.port}/team?token=${g3.token}`);
    assert.equal(r.status, 200);
    const t = await r.text();
    assert.match(t, /const CARD=\{"machine":/); // card mode ON — carries whose disk the picker browses
    assert.match(t, /What are we building\?/);
    assert.match(t, /Where does the code live\?/);
    assert.match(t, /Add a server/);
    assert.match(t, /\.agents\//); // the one-sentence trust disclosure
  } finally {
    g3.server.close();
  }
});

test("projectAt: a folder with attached .agents IS the project anchor; anything else is not", async () => {
  const { projectAt } = await import("../src/usertier.js");
  assert.equal(projectAt(join(scratch, "exec-repo")), join(scratch, "exec-repo"));
  assert.equal(projectAt(scratch), undefined);
});

// ── satellite previews: the proxy (2026-08-13) ──

test("preview proxy: point → forward at ROOT paths (absolute assets + the site's own /api survive)", async () => {
  const { createServer: mkTarget } = await import("node:http");
  const target = mkTarget((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain", "X-Probe": "target" });
    res.end(`served:${req.url}`);
  });
  await new Promise<void>((res) => target.listen(0, "127.0.0.1", res));
  const taddr = target.address() as { port: number };
  try {
    // Lifecycle PDR d.7: the proxy is PER WORKSPACE — /api/preview creates/
    // returns this workspace's own listener (the server-wide singleton died).
    const pv0 = await call("GET", "/api/preview");
    const pxPort = pv0.body.proxyPort as number;
    assert.ok(pxPort > 0, "this workspace's proxy listener is up");
    // un-pointed proxy says so in plain words
    const cold = await fetch(`http://127.0.0.1:${pxPort}/`);
    assert.equal(cold.status, 503);
    assert.match(await cold.text(), /no preview pointed/);
    // pointing requires the token; https targets refuse (they open direct)
    const bad = await call("POST", "/api/preview/point", { url: "https://example.com" });
    assert.equal(bad.status, 400);
    const point = await call("POST", "/api/preview/point", { url: `http://127.0.0.1:${taddr.port}` });
    assert.equal(point.status, 200);
    assert.equal(point.body.proxyPort, pxPort, "point answers with the SAME per-workspace port");
    // root path, deep path, and an absolute asset path all forward
    for (const path of ["/", "/find-my-jdm", "/_next/static/app.js", "/api/leads"]) {
      const pr: Awaited<ReturnType<typeof fetch>> = await fetch(`http://127.0.0.1:${pxPort}${path}`);
      assert.equal(pr.status, 200, path);
      assert.equal(pr.headers.get("x-probe"), "target", "headers pass through");
      assert.equal(await pr.text(), `served:${path}`);
    }
    // GET /api/preview advertises the proxy port to the page
    const pv = await call("GET", "/api/preview");
    assert.equal(pv.body.proxyPort, pxPort);
  } finally {
    target.close();
  }
});

test("preview proxy: a dead target answers 502 in plain words, never a hang", async () => {
  const point = await call("POST", "/api/preview/point", { url: "http://127.0.0.1:1" }); // nothing listens on port 1
  const r = await fetch(`http://127.0.0.1:${point.body.proxyPort}/`);
  assert.equal(r.status, 502);
  assert.match(await r.text(), /unreachable.*dev server/i);
});

// ── S4: the wheel door refuses blended seats ──

test("the wheel door REFUSES a blended seat — the pane IS the live session (no second writer)", async () => {
  const proj = join(scratch, "wheel-rig");
  mkdirSync(join(proj, ".agents"), { recursive: true });
  writeFileSync(join(proj, ".agents", "rig.conf"), 'PROJECT="wheel"\nCODER_AGENT="claude"\n'); // S4: blended by default
  const r = await call("POST", `/api/tty/start?project=${encodeURIComponent(proj)}`, { seat: "coder" });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /pane IS the live session/);
  assert.match(r.body.error, /BLEND_CODER=0/, "the refusal teaches the opt-out escape hatch");
});

// ── Pack 3: the stale-reattach probe ──

test("/api/version reports the LOADED sha + pid — boot-captured, not disk-at-request-time", async () => {
  const r = await call("GET", "/api/version");
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.loadedSha, "string");
  assert.equal(r.body.loadedSha, gui.state.loadedSha ?? "unknown", "the probe reads what the process LOADED");
  assert.equal(r.body.pid, process.pid, "pid rides along for crate stop's plain-words reporting");
});

test("/api/shutdown is token-gated like everything else (403 without the token — and the handler never runs)", async () => {
  const wrong = await call("POST", "/api/shutdown", undefined, "nope");
  assert.equal(wrong.status, 403);
});

test("serverIsStale: mismatch or an unnameable server restarts; an unjudgeable disk never thrashes", async () => {
  const { serverIsStale } = await import("../src/gui/server.js");
  assert.equal(serverIsStale("abc1234", "abc1234"), false, "same sha = fresh, keep the server");
  assert.equal(serverIsStale("abc1234", "def5678"), true, "mismatch = the stale survivor (the live-found incident)");
  assert.equal(serverIsStale(undefined, "def5678"), true, "a pre-Pack-3 server cannot prove itself — restart once onto code that can");
  assert.equal(serverIsStale("unknown", "def5678"), true);
  assert.equal(serverIsStale(undefined, "unknown"), false, "no git on disk — never restart-thrash what cannot be compared");
  assert.equal(serverIsStale("abc1234", "unknown"), false);
});
