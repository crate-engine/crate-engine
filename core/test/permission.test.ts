import assert from "node:assert/strict";
import { test } from "node:test";
import { LoadoutSchema } from "../src/manifest.js";
import { isUnwalledSeat, permissionFlag } from "../src/launcher.js";

const base = {
  seat: "coder",
  agent: "claude-code",
  binder: "config/coder.md",
  policy: { tools: "native", default_model: "opus", sandbox: "standard" },
};

// ── the schema gate (P4-12: impossible by construction) ─────────────────────

test("schema: bypassPermissions + a wall is a valid pair", () => {
  const p = LoadoutSchema.safeParse({
    ...base,
    policy: { ...base.policy, permission_mode: "bypassPermissions" },
  });
  assert.ok(p.success);
  assert.equal(p.data!.policy.permission_mode, "bypassPermissions");
});

test("schema: permission_mode defaults to 'default'", () => {
  const p = LoadoutSchema.safeParse(base);
  assert.ok(p.success);
  assert.equal(p.data!.policy.permission_mode, "default");
});

test("schema: bypassPermissions + sandbox:none is REFUSED (the invariant)", () => {
  const p = LoadoutSchema.safeParse({
    ...base,
    policy: { ...base.policy, sandbox: "none", permission_mode: "bypassPermissions" },
  });
  assert.ok(!p.success);
  assert.match(p.error!.issues[0]!.message, /impossible by construction/);
});

test("schema: sandbox:none WITHOUT bypass stays legal (orchestrator fallback shape)", () => {
  const p = LoadoutSchema.safeParse({ ...base, policy: { ...base.policy, sandbox: "none" } });
  assert.ok(p.success);
});

// ── the runtime belt (launcher coupling) ─────────────────────────────────────

test("runtime: bypass + rendered profile → the claude-code flag", () => {
  assert.equal(
    permissionFlag("claude-code", "bypassPermissions", "/tmp/x/coder.sb"),
    " --permission-mode bypassPermissions",
  );
});

test("runtime: bypass with NO profile REFUSES loudly (belt-and-suspenders)", () => {
  assert.throws(() => permissionFlag("claude-code", "bypassPermissions", undefined), /REFUSING/);
});

test("runtime: default mode → no flag; unknown agent with bypass+wall → no flag (data-driven)", () => {
  assert.equal(permissionFlag("claude-code", "default", "/tmp/x.sb"), "");
  assert.equal(permissionFlag("pi", "bypassPermissions", "/tmp/x.sb"), "");
});

// ── P5-0a structural tripwire (was the C-interim warning predicate) ─────────

const walled = (sandbox: string) => ({ policy: { sandbox } });

test("tripwire: claude on ANY walled loadout is contained — silent (pi-loadout Reviewer included)", () => {
  assert.ok(!isUnwalledSeat("claude", walled("readonly"))); // the beta-Reviewer shape, now walled
  assert.ok(!isUnwalledSeat("claude", walled("standard")));
});

test("tripwire: claude with NO loadout flags (boot will REFUSE, not run unwalled)", () => {
  assert.ok(isUnwalledSeat("claude", undefined));
});

test("tripwire: claude on a sandbox:none loadout flags (boot will REFUSE)", () => {
  assert.ok(isUnwalledSeat("claude", walled("none")));
});

test("tripwire: pi seats stay silent (no host bypass injection risk)", () => {
  assert.ok(!isUnwalledSeat("pi", walled("standard")));
  assert.ok(!isUnwalledSeat("pi", undefined));
});
