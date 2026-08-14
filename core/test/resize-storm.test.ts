// Resize-storm regression (flaw 2026-08-12): the cockpit's 2s repaint re-fired
// fit() on every seat every tick, and each POST /api/tty/resize SIGWINCHed the
// TUI — claude repaints its FULL transcript on resize, so five resumed seats
// pushed ~3 GB in 15 min down the cockpit link and drowned the operator's WiFi
// (350ms+ keystroke echo). Two guards now hold the line:
//   client — fit() only sends a REAL dim change (t.pcols/t.prows memory);
//   server — TtySeat.resize() drops identical dims before the PTY.
// Client logic is JS inside the teampage template → structural assertions (the
// loopchip precedent); the server guard is proven on a REAL spawned PTY.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { teamPage } from "../src/gui/teampage.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "resize-storm-test-"));
}

// ── client: the guard ships in the page, BEFORE the resize POST ──

test("client fit() only lets a real dim change leave the browser", () => {
  const html = teamPage({ project: "demo", seats: [] });
  const guard = html.indexOf("term.cols===t.pcols&&term.rows===t.prows");
  const post = html.indexOf("/api/tty/resize");
  assert.ok(guard >= 0, "the no-change guard is in the page");
  assert.ok(post >= 0, "the resize POST is still wired");
  assert.ok(guard < post, "the guard sits BEFORE the POST — unchanged dims never reach the wire");
});

test("a respawned PTY forgets the remembered dims (the guard must not starve a fresh session)", () => {
  const html = teamPage({ project: "demo", seats: [] });
  assert.ok(
    html.includes("TTYS[s.seat].pcols=TTYS[s.seat].prows=null"),
    "gen change resets pcols/prows so the next fit() re-sends the real size",
  );
});

// ── server: identical dims never reach the PTY (real spawn, WINCH-counted) ──

test("TtySeat.resize drops identical dims — repeated same-size calls never SIGWINCH the TUI", async () => {
  const p = tmpProject();
  const { startSeatTty, evictSeatTty } = await import("../src/ptyseat.js");
  try {
    // A stub TUI that announces every SIGWINCH it receives.
    const script = 'trap \'echo "@WINCH@"\' WINCH; echo "@READY@"; while :; do sleep 0.05; done';
    const r = await startSeatTty({ projectRoot: p, seat: "coder", agent: "pi", blended: true, argvOverride: ["bash", "-c", script] });
    assert.ok(r.ok, "stub TUI spawned");
    let out = "";
    r.tty.subscribe((ev) => {
      if (ev.data) out += ev.data.toString("utf8");
    });
    const count = (m: string) => out.split(m).length - 1;
    const until = async (cond: () => boolean, why: string) => {
      const t0 = Date.now();
      while (!cond()) {
        if (Date.now() - t0 > 5000) assert.fail(`timed out: ${why}\n--- pty output ---\n${out}`);
        await new Promise((res) => setTimeout(res, 25));
      }
    };
    await until(() => count("@READY@") >= 1, "stub TUI came up");
    assert.equal(r.tty.cols, 120, "spawn default cols");

    r.tty.resize(100, 40); // real change → one WINCH
    await until(() => count("@WINCH@") >= 1, "a real dim change reaches the TUI");
    assert.equal(count("@WINCH@"), 1);

    for (let i = 0; i < 10; i++) r.tty.resize(100, 40); // the 2s-repaint pattern
    r.tty.resize(90, 30); // then one more real change
    await until(() => count("@WINCH@") >= 2, "the next real change still reaches the TUI");
    // Settle, then the verdict: 10 identical resizes contributed ZERO signals.
    await new Promise((res) => setTimeout(res, 200));
    assert.equal(count("@WINCH@"), 2, "identical dims were dropped — only the two real changes signaled");
    assert.equal(r.tty.cols, 90, "tracked dims follow the last real change");
    assert.equal(r.tty.rows, 30);
  } finally {
    evictSeatTty(p, "coder"); // kills the stub
    rmSync(p, { recursive: true, force: true });
  }
});

// ── multi-view sizing (2026-08-14, Adam's call): EVENT-driven like tmux —
// the stream is the liveness signal; nothing polls to keep proposals alive ──

test("multi-view sizing rides the stream, not a poll: per-generation client id, onopen re-propose, no resize heartbeat", () => {
  const html = teamPage({ project: "demo", seats: [] });
  assert.ok(html.includes('"&client="+TTYCID'), "the tty stream carries the per-generation view id — the connection IS the liveness");
  assert.ok(html.includes("TTYES.onopen=proposeAllSizes"), "every (re)connect re-asserts this view's dims");
  assert.ok(html.includes('TTYCID=VIEWID+"."+(++TTYGEN)'), "per-STREAM keys: an old generation's close can never erase the successor's proposals");
  assert.ok(!/setInterval\([\s\S]{0,250}?tty\/resize/.test(html), "no interval posts resize — proposals live and die with the stream, zero standing chatter");
});
