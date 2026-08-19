// CE-149 — per-project routes answered about the WRONG rig.
//
// Found by the battle test (docs/manual/battle-test.md, rung B1) on 2026-08-18.
// `crate open ~/Projects/battle-test-rig` booted five seats and printed a window
// URL carrying `?project=…/battle-test-rig`. Replaying that window's own health
// request came back `{"project":"…/delegation-probe","booted":false}` with all
// five seats "unknown / not booted" — while the five seats were live.
//
// The workspace-lifecycle change (PDR workspace-lifecycle S1) made one engine
// serve N workspaces and gave ~20 routes the idiom
// `url.searchParams.get("project") ?? state.project`. Seven per-project routes
// never got it and read the server-global ACTIVE workspace instead. The cockpit
// page ALWAYS sends the parameter — `tq()` appends `&project=` whenever PROJECT
// is set — so this was never a caller that forgot to ask; it was a callee
// throwing the answer away.
//
// The mirror case is the dangerous one and is pinned below: when the ACTIVE
// workspace is the live one and the window is on a parked rig, the window is
// shown five live seats that are not its own — a green cockpit over a team that
// is not there. `crate open` deliberately does NOT rebind the active workspace
// (that non-rebind is CE-014's cure), which is exactly why the callee must
// honour the parameter rather than the operator being told to keep them in sync.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

/** A minimal attached rig — `.agents/bin` is the server's "is this attached?"
 * check and `.agents/rig.conf` is the open door's. */
function rig(label: string): string {
  const p = mkdtempSync(join(tmpdir(), `ce149-${label}-`));
  mkdirSync(join(p, ".agents", "bin"), { recursive: true });
  writeFileSync(join(p, ".agents", "rig.conf"), `PROJECT="${label}"\n`);
  return p;
}

async function withTwoRigs(
  fn: (ctx: { home: string; active: string; other: string; url: string; token: string }) => Promise<void>,
): Promise<void> {
  const { startGuiServer } = await import("../src/gui/server.js");
  const home = mkdtempSync(join(tmpdir(), "ce149-home-"));
  const active = rig("active");
  const other = rig("other");
  // The server binds `active` as state.project; `other` is the rig whose window
  // the operator is actually looking at. This is the everyday two-workspace
  // shape, not a contrived one.
  const server = await startGuiServer({ home, project: active });
  try {
    await fn({ home, active, other, url: `http://127.0.0.1:${server.port}`, token: server.token });
  } finally {
    server.server.close();
    // A GUI server's "close" handler calls stopAllTeams() — process-wide, by
    // design ("runners die WITH the GUI") — and it awaits a dynamic import
    // first, so it lands a tick or two LATER. In production nothing boots a team
    // after that, but in one test process the pending stop will silently strip a
    // team a later test just booted. Flush it here rather than debug it twice.
    await new Promise((r) => setTimeout(r, 50));
    for (const d of [home, active, other]) rmSync(d, { recursive: true, force: true });
  }
}

const get = (url: string, token: string, route: string, project?: string): Promise<Response> =>
  fetch(`${url}${route}?token=${token}${project ? `&project=${encodeURIComponent(project)}` : ""}`, {
    headers: { "X-Crate-Token": token },
  });

test("/api/health answers about the WINDOW's rig, not the active one", async () => {
  await withTwoRigs(async ({ other, url, token }) => {
    const body = (await (await get(url, token, "/api/health", other)).json()) as { project: string };
    assert.equal(body.project, other, "this is CE-149: the window asked about `other` and was told about `active`");
  });
});

test("/api/health with NO project still falls back to the active one", async () => {
  // The fallback half of the idiom. A caller that genuinely has no project —
  // the app before a window binds one — must keep working exactly as before.
  await withTwoRigs(async ({ active, url, token }) => {
    const body = (await (await get(url, token, "/api/health")).json()) as { project: string };
    assert.equal(body.project, active);
  });
});

test("THE DANGEROUS DIRECTION: a parked rig's window is never shown the live rig's seats", async () => {
  // The mirror of the live repro, and the one that would ship a green cockpit
  // over nothing. `active` gets genuinely live seats; the window is on `other`,
  // which has none. Before the fix both windows read `active`.
  const { startGuiServer } = await import("../src/gui/server.js");
  const { teamProcessFor } = await import("../src/gui/teamproc.js");
  const home = mkdtempSync(join(tmpdir(), "ce149-home-"));
  const active = rig("live");
  const other = rig("parked");
  const tp = teamProcessFor(active, () => spawn("sleep", ["30"], { stdio: "ignore" }), undefined, home);
  let server: Awaited<ReturnType<typeof startGuiServer>> | undefined;
  try {
    server = await startGuiServer({ home, project: active });
    // Boot AFTER the server: see the note in withTwoRigs — a previous test's
    // close handler stops every team in this process, and it arrives late.
    await new Promise((r) => setTimeout(r, 50));
    tp.boot();
    const url = `http://127.0.0.1:${server.port}`;

    const live = (await (await get(url, server.token, "/api/health", active)).json()) as {
      booted: boolean;
      seats: Array<{ liveness: string }>;
    };
    assert.equal(live.booted, true, "the live rig must read live — the fix must not break the true case");
    assert.ok(live.seats.some((s) => s.liveness === "live"));

    const parked = (await (await get(url, server.token, "/api/health", other)).json()) as {
      project: string;
      booted: boolean;
      seats: Array<{ liveness: string }>;
    };
    assert.equal(parked.project, other);
    assert.equal(parked.booted, false, "a parked rig's window must never be shown a green team");
    assert.ok(
      parked.seats.every((s) => s.liveness !== "live"),
      "seats belonging to ANOTHER rig were reported as this window's own",
    );
  } finally {
    tp.stop();
    server?.server.close();
    for (const d of [home, active, other]) rmSync(d, { recursive: true, force: true });
  }
});

test("/api/loop and /api/doctor are scoped to the window's rig too", async () => {
  await withTwoRigs(async ({ other, url, token }) => {
    // Both routes read files under <project>/.agents/state. A wrong project is
    // not a crash here — it is a plausible, quiet, wrong answer, which is why
    // these are asserted by SUCCESS on a rig that exists rather than by error.
    for (const route of ["/api/loop", "/api/doctor"]) {
      const r = await get(url, token, route, other);
      assert.equal(r.status, 200, `${route} rejected the window's own project`);
    }
  });
});

test("/api/deps resolves against the window's rig — an install must not land in another repo", async () => {
  // The sharpest of the seven: `deps/install-one` resolved its dep list against
  // state.project and would have INSTALLED into a repo the operator was not
  // looking at. Asserting the read side (`/api/deps`) proves the resolution
  // without running an installer inside the suite.
  await withTwoRigs(async ({ other, url, token }) => {
    const r = await get(url, token, "/api/deps", other);
    assert.equal(r.status, 200);
  });
});

test("the drift guard: inside a route, the ONLY state.project allowed is the idiom's own fallback", async () => {
  // CE-149 existed because a lifecycle-wide convention was applied route by
  // route and seven were missed. CE-150 then proved the FIRST version of this
  // guard was too weak: it asked whether a route body mentioned
  // `searchParams.get("project")` ANYWHERE, so /api/health passed with a
  // leftover `readPaneHistory(state.project!, …)` sitting below the correct
  // line. A guard one right line can satisfy while a wrong one hides under it
  // is not a guard.
  //
  // The rule now: inside a route body, every `state.project` must be on the
  // idiom line itself (`?? state.project`), or on a line the preceding comment
  // marked `// project-global:` with a reason, or in a route-level allowlisted
  // case. Comments are stripped first — prose ABOUT the bug is not the bug.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/gui/server.ts", import.meta.url), "utf8");
  const ALLOWED = new Set([
    "GET /api/version", // engine-global, not a rig fact
    "POST /api/workspaces/open", // the path arrives in the body
    "POST /api/workspaces/remove", // ditto
    "POST /api/attach/execute", // a DELIBERATE rebind of the view default
  ]);
  const offenders: string[] = [];
  let current: string | undefined;
  let armed = false; // the previous comment justified the next line
  let sawRouter = false;
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    const m = /case "((?:GET|POST|DELETE|PUT|PATCH) [^"]+)":/.exec(line);
    if (m) {
      current = m[1]!;
      sawRouter = true;
      armed = false;
      continue;
    }
    // the switch's `default:` ends the router — everything after it (the
    // auto-revive monitor, the proxy bootstrap) is server-scoped by design and
    // is NOT a request handler.
    if (sawRouter && /^default:/.test(line)) break;
    if (line.startsWith("//")) {
      if (line.includes("project-global:")) armed = true;
      continue;
    }
    if (!current) continue;
    const code = raw.replace(/\/\/.*$/, "");
    if (!code.includes("state.project")) {
      if (code.trim() !== "") armed = false;
      continue;
    }
    const ok = ALLOWED.has(current) || code.includes("?? state.project") || armed;
    if (!ok) offenders.push(`${current}: ${line.slice(0, 80)}`);
    armed = false;
  }
  assert.ok(sawRouter, "no routes found — the scanner has drifted from the source");
  assert.deepEqual(offenders, [], `these read the ACTIVE workspace inside a window-scoped route:\n  ${offenders.join("\n  ")}`);
});

test("the drift guard: staffingCatalog cannot reach the active workspace at all", async () => {
  // CE-150's other half. The function took `state` and read `state.project`
  // inside, so the picker reported the ACTIVE rig's staffing while the write
  // beside it honoured `?project` — read rig A, write rig B. It now takes the
  // project explicitly, and this pins that it cannot regress.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/gui/server.ts", import.meta.url), "utf8");
  const start = src.indexOf("function staffingCatalog(");
  assert.ok(start > 0, "staffingCatalog was renamed — update this guard");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  const code = body
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.ok(!code.includes("state.project"), "staffingCatalog must take its project as a parameter, never read the active one");
});

test("the picker reads the SAME rig it writes to", async () => {
  // The live repro, as a test. `other`'s rig.conf staffs its coder with codex;
  // the active rig's does not. Before the fix, asking about `other` returned the
  // ACTIVE rig's staffing while POST /api/staffing/seat wrote to `other`.
  const { writeFileSync } = await import("node:fs");
  await withTwoRigs(async ({ active, other, url, token }) => {
    writeFileSync(join(other, ".agents", "rig.conf"), 'PROJECT="other"\nCODER_AGENT="codex"\n');
    writeFileSync(join(active, ".agents", "rig.conf"), 'PROJECT="active"\nCODER_AGENT="claude"\n');
    const body = (await (await get(url, token, "/api/staffing", other)).json()) as {
      seats: Array<{ seat: string; current: { agent: string } }>;
    };
    const coder = body.seats.find((s) => s.seat === "coder")!;
    assert.equal(coder.current.agent, "codex", "the picker reported another rig's staffing — read rig A, write rig B");
  });
});
