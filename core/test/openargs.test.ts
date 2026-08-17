// CE-127 — `crate open` never reinterprets its target in silence.
// Battle-test find (2026-08-17): a positional path was silently swallowed and
// the cwd project opened instead, bypassing the P1 guard by comparing the
// wrong target; `--help` executed instead of printing usage.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOpenArgs } from "../src/openargs.js";

test("bare positional path IS the project — the DETACHED-banner form works", () => {
  const p = parseOpenArgs(["/mnt/data/projects/jdm-rush-crate"]);
  assert.deepEqual(p, { kind: "local", project: "/mnt/data/projects/jdm-rush-crate", printUrl: false, stopOthers: false });
});

test("no args → local with no explicit project (cwd anchor decides downstream)", () => {
  const p = parseOpenArgs([]);
  assert.equal(p.kind, "local");
  assert.equal((p as { project?: string }).project, undefined);
});

test("--project flag still works, and agrees with an identical positional", () => {
  assert.deepEqual(parseOpenArgs(["--project", "/a/b"]), { kind: "local", project: "/a/b", printUrl: false, stopOthers: false });
  assert.equal(parseOpenArgs(["/a/b", "--project", "/a/b"]).kind, "local");
});

test("positional vs --project DISAGREEING is a loud error, never a silent pick", () => {
  const p = parseOpenArgs(["/a/b", "--project", "/c/d"]);
  assert.equal(p.kind, "error");
  assert.match((p as { message: string }).message, /two different projects/);
});

test("--help / -h are help, not execution", () => {
  assert.equal(parseOpenArgs(["--help"]).kind, "help");
  assert.equal(parseOpenArgs(["-h"]).kind, "help");
  assert.equal(parseOpenArgs(["/a/b", "--help"]).kind, "help");
});

test("an unknown flag is a loud error", () => {
  const p = parseOpenArgs(["--frobnicate"]);
  assert.equal(p.kind, "error");
  assert.match((p as { message: string }).message, /unknown option --frobnicate/);
});

test("two positionals are a loud error", () => {
  const p = parseOpenArgs(["/a/b", "/c/d"]);
  assert.equal(p.kind, "error");
  assert.match((p as { message: string }).message, /one project path only/);
});

test("--remote takes a host; its value is never read as a positional", () => {
  assert.deepEqual(parseOpenArgs(["--remote", "superman"]), { kind: "remote", host: "superman", printUrl: false });
  assert.deepEqual(parseOpenArgs(["--remote", "superman", "--print-url"]), { kind: "remote", host: "superman", printUrl: true });
});

test("--remote with a missing host is a loud error", () => {
  assert.equal(parseOpenArgs(["--remote"]).kind, "error");
  assert.equal(parseOpenArgs(["--remote", "--print-url"]).kind, "error");
});

test("--remote plus a project path is a loud error (the remote host picks its project)", () => {
  const p = parseOpenArgs(["--remote", "superman", "/a/b"]);
  assert.equal(p.kind, "error");
  assert.match((p as { message: string }).message, /--remote is not supported/);
});

test("--project with a missing value is a loud error", () => {
  assert.equal(parseOpenArgs(["--project"]).kind, "error");
  assert.equal(parseOpenArgs(["--project", "--print-url"]).kind, "error");
});

test("--stop-others / --force / --print-url carry through on the local path", () => {
  const p = parseOpenArgs(["/a/b", "--stop-others", "--print-url"]);
  assert.deepEqual(p, { kind: "local", project: "/a/b", printUrl: true, stopOthers: true });
  assert.equal((parseOpenArgs(["--force"]) as { stopOthers: boolean }).stopOthers, true);
});
