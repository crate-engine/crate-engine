// Backlog 2b — the rig telemetry mirror. Laws under test: the mirror is a
// LABELED COPY (header names the canonical source); appends are deltas
// (offsets are durable — a restart never re-appends mirrored history); an
// upstream truncation is announced and re-mirrored, never silently mangled;
// failures are invisible (no source file = no crash, no output).
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mirrorDir, startTelemetryMirror } from "../src/telemetry.js";

function rig(): { project: string; home: string; state: string } {
  const base = mkdtempSync(join(tmpdir(), "telemetry-test-"));
  const project = join(base, "demo-rig");
  const state = join(project, ".agents", "state");
  mkdirSync(state, { recursive: true });
  return { project, home: join(base, "home"), state };
}

test("the mirror is a labeled copy: header names the canonical source, content follows in append-order deltas", () => {
  const { project, home, state } = rig();
  try {
    writeFileSync(join(state, "events.log"), "e1\ne2\n");
    const m = startTelemetryMirror(project, home);
    const dst = join(mirrorDir(project, home), "events.log");
    let out = readFileSync(dst, "utf8");
    assert.ok(out.startsWith("# CRATE MIRROR — a COPY of"), "the label leads the file");
    assert.ok(out.includes("canonical"), "the rig's file is named canonical");
    assert.ok(out.endsWith("e1\ne2\n"), "existing history mirrored on start");
    appendFileSync(join(state, "events.log"), "e3\n");
    m.tick();
    out = readFileSync(dst, "utf8");
    assert.ok(out.endsWith("e1\ne2\ne3\n"), "a new line arrives as a delta — nothing re-appended");
    m.stop();
  } finally {
    rmSync(join(project, ".."), { recursive: true, force: true });
  }
});

test("offsets are durable: a mirror restart (engine restart) never duplicates mirrored history", () => {
  const { project, home, state } = rig();
  try {
    writeFileSync(join(state, "events.log"), "one\ntwo\n");
    startTelemetryMirror(project, home).stop();
    appendFileSync(join(state, "events.log"), "three\n");
    startTelemetryMirror(project, home).stop(); // the restarted engine
    const out = readFileSync(join(mirrorDir(project, home), "events.log"), "utf8");
    assert.equal(out.split("one\ntwo\n").length, 2, "history appears exactly once");
    assert.ok(out.endsWith("three\n"), "…and the delta landed");
  } finally {
    rmSync(join(project, ".."), { recursive: true, force: true });
  }
});

test("an upstream truncation (rotation/distillation) is announced, then re-mirrored — never silently mangled", () => {
  const { project, home, state } = rig();
  try {
    writeFileSync(join(state, "events.log"), "old-history-line\n");
    const m = startTelemetryMirror(project, home);
    writeFileSync(join(state, "events.log"), "fresh\n"); // the rig distilled
    m.tick();
    m.stop();
    const out = readFileSync(join(mirrorDir(project, home), "events.log"), "utf8");
    assert.ok(out.includes("# source reset"), "the reset is announced in-band");
    assert.ok(out.indexOf("old-history-line") < out.indexOf("# source reset"), "old history stays above the marker");
    assert.ok(out.endsWith("fresh\n"), "the re-mirror starts from the new beginning");
  } finally {
    rmSync(join(project, ".."), { recursive: true, force: true });
  }
});

test("no source file yet = no output, no crash; turns.log mirrors beside events.log when present", () => {
  const { project, home, state } = rig();
  try {
    const m = startTelemetryMirror(project, home); // state dir is empty
    m.tick();
    writeFileSync(join(state, "turns.log"), "t1\n");
    m.tick();
    m.stop();
    const out = readFileSync(join(mirrorDir(project, home), "turns.log"), "utf8");
    assert.ok(out.endsWith("t1\n"), "turns.log mirrors too — the per-turn summary lines");
  } finally {
    rmSync(join(project, ".."), { recursive: true, force: true });
  }
});
