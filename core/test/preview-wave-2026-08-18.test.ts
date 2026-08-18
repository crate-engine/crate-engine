// The 2026-08-18 config wave — CE-145, CE-005, CE-146, CE-147.
//
// All four came out of the delegation probe (the same design brief run twice,
// changing only staffing). Three of them are defects in SHIPPED PROSE — the
// binders and skills seats actually obey — so the pins here read the shipped
// files the way a seat does, plus one real bash resolver for the code half.
//
// Why prose gets tests at all: CE-005 and CE-145 were both cases of a seat
// following its SOP exactly and producing the wrong outcome, because the SOP
// permitted it. A reworded law that quietly reverts is the same bug again.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const RESOLVER = join(ROOT, "bin", "preview-base");

/** A project whose rig.conf is exactly `conf`. */
function mkProj(conf: string): string {
  const proj = mkdtempSync(join(tmpdir(), "crate2-previewbase-"));
  mkdirSync(join(proj, ".agents"), { recursive: true });
  writeFileSync(join(proj, ".agents", "rig.conf"), conf);
  return proj;
}

/** What the shipped bash resolver says, parsed. CRATE_LAN_IP stubs detection. */
function resolve(proj: string, lanIp?: string): Record<string, string> {
  const env = { ...process.env, ...(lanIp === undefined ? {} : { CRATE_LAN_IP: lanIp }) };
  const out = execFileSync("bash", [RESOLVER, proj], { encoding: "utf8", env });
  return Object.fromEntries(
    out
      .trim()
      .split("\n")
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
}

// ── CE-145: the design_locked ordering was circular ─────────────────────────
// designer.md said "only after the human's go do you emit design_locked", while
// the procedure TRIGGERED by that emit is what surfaces the design for the human
// to approve. A designer obeying its binder literally never emits — and that also
// starves CE-005 independently, because the preview procedure never fires.

test("CE-145: the designer binder no longer gates the EMIT on the human's approval", () => {
  const binder = src("config/designer.md");
  assert.doesNotMatch(
    binder,
    /Only after the human's go do you emit/,
    "the circular constraint is back — a literal designer will deadlock",
  );
  assert.match(binder, /READY TO SHOW/, "the emit's real trigger is stated");
  assert.match(binder, /reopen_design/, "the revision window the state machine already owns is named");
});

test("CE-145: binder and procedure agree that the emit comes BEFORE the confirm", () => {
  const binder = src("config/designer.md");
  const proc = src("config/procedures/design-lock-preview.md");
  // The procedure's trigger is the emit; the hold comes after it.
  assert.match(proc, /When the Designer emits design_locked/);
  assert.match(proc, /BEFORE the design-lock hold for the human's confirm/);
  // And the binder now points AT that procedure rather than contradicting it.
  assert.match(binder, /design-lock-preview\.md/, "the binder cites the procedure it must agree with");
});

test("CE-145: the coder treats [DESIGN_LOCKED] as a heads-up, not a build order", () => {
  // Consequence of fixing the ordering: the emit now genuinely precedes the
  // human's confirm, so the mail it routes must not start the build.
  const coder = src("config/coder.md");
  const row = /- \*\*On `\[DESIGN_LOCKED\]`:\*\*[\s\S]*?\n(?=- \*\*)/.exec(coder)?.[0] ?? "";
  assert.ok(row, "the [DESIGN_LOCKED] response is still documented");
  assert.match(row, /HEADS-UP|heads-up/);
  assert.match(row, /wait for the ORCHESTRATOR's brief/);
  assert.doesNotMatch(row, /implement on the named branch/, "the old build-on-signal instruction is gone");
});

test("CE-145: the handoff table no longer calls design_locked 'human approved'", () => {
  assert.doesNotMatch(src("config/handoff-protocol.md"), /design locked \+ human approved/);
});

// ── CE-005: registration was optional, so a compliant seat skipped it ───────
// build-preview step 4 offered register OR the OS open-verb "for the ONE case
// where you are running unwalled on the operator's own machine with a display".
// On Adam's Mac that is literally true. Two consecutive live loops took the
// sanctioned branch, opened Chrome, and left /api/preview empty.

test("CE-005: build-preview offers NO alternative to registering", () => {
  const skill = src("config/skills/build-preview.md");
  assert.doesNotMatch(
    skill,
    /for the\s+ONE case where you are running unwalled/,
    "the open-verb escape hatch is back — this is the exact sentence the seat obeyed",
  );
  assert.match(skill, /ALWAYS\. No condition, no alternative/);
  assert.match(skill, /agentctl\.py preview/, "the registration command is still the one it names");
});

test("CE-005: the browser is demoted to an extra that runs AFTER registering", () => {
  const skill = src("config/skills/build-preview.md");
  const step4 = /4\. \*\*REGISTER[\s\S]*?\n5\. /.exec(skill)?.[0] ?? "";
  assert.ok(step4, "step 4 is still the registration step");
  const register = step4.indexOf("agentctl.py preview");
  const browser = step4.indexOf("OPTIONAL EXTRA");
  assert.ok(register > -1 && browser > register, "the optional browser must come after the registration it may not replace");
  assert.match(step4, /Never in place of\s+registering/);
});

test("CE-005: the design-lock procedure inherits the unconditional law", () => {
  // The procedure is what a front-end loop actually reads; if it still says
  // "opens it via the adapter's open-verb", the skill's fix never reaches the loop.
  const proc = src("config/procedures/design-lock-preview.md");
  assert.match(proc, /REGISTERS it with the cockpit/);
  assert.doesNotMatch(proc, /opens it on the operator workstation via the adapter's open-verb/);
});

// ── CE-146: the QR base was a localhost address a phone cannot reach ────────

test("CE-146: a tunnel wins outright and reads as reachable-from-anywhere", () => {
  const p = mkProj('PROJECT="x"\nDEV_URL="http://localhost:5311"\nPREVIEW_URL="https://rig.tailnet.ts.net/"\n');
  try {
    const r = resolve(p, "192.168.1.50");
    assert.equal(r.BASE, "https://rig.tailnet.ts.net", "trailing slash trimmed — BASE + route must not double up");
    assert.equal(r.REACH, "tunnel");
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("CE-146: with no tunnel the base carries a real LAN address, never localhost", () => {
  const p = mkProj('PROJECT="x"\nDEV_URL="http://localhost:5311"\n');
  try {
    const r = resolve(p, "192.168.1.50");
    assert.equal(r.BASE, "http://192.168.1.50:5311", "the phone-scannable base");
    assert.equal(r.REACH, "lan");
    assert.equal(r.PORT, "5311", "the port still comes from serve-resolve's one resolution (CE-106)");
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("CE-146: an unresolvable LAN address degrades HONESTLY, it does not pretend", () => {
  const p = mkProj('PROJECT="x"\nDEV_URL="http://localhost:5311"\n');
  try {
    const r = resolve(p, "");
    assert.equal(r.BASE, "http://localhost:5311");
    assert.equal(r.REACH, "local", "REACH is what tells the card to stop claiming a phone can scan it");
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("CE-146: the seeded loopback DEV_HOST_IP is IGNORED, not treated as an override", () => {
  // attach used to seed SUPERMAN_IP="127.0.0.1". Honouring that as an explicit
  // override would pin every fresh rig to the exact answer this cure removes.
  const p = mkProj('PROJECT="x"\nDEV_URL="http://localhost:5311"\nDEV_HOST_IP="127.0.0.1"\n');
  try {
    const r = resolve(p, "192.168.1.50");
    assert.equal(r.HOST, "192.168.1.50", "detection wins over a loopback 'override'");
    assert.equal(r.REACH, "lan");
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("CE-146: an explicit DEV_HOST_IP beats detection — and the legacy key still works", () => {
  for (const key of ["DEV_HOST_IP", "SUPERMAN_IP"]) {
    const p = mkProj(`PROJECT="x"\nDEV_URL="http://localhost:5311"\n${key}="10.0.0.7"\n`);
    try {
      const r = resolve(p, "192.168.1.50");
      assert.equal(r.HOST, "10.0.0.7", `${key} must be honoured (CE-147 alias law)`);
    } finally {
      rmSync(p, { recursive: true, force: true });
    }
  }
});

test("CE-146: the skill reads the resolver and explicitly forbids DEV_URL as the base", () => {
  const skill = src("config/skills/build-preview.md");
  assert.match(skill, /preview-base/, "the skill asks the resolver");
  assert.match(skill, /Do NOT use `DEV_URL` as the base/);
  assert.doesNotMatch(skill, /ELSE `DEV_URL` \(the LAN dev address/, "the old conflation is gone");
});

test("CE-146: preview-base and attach's healer do not fight over DEV_URL", () => {
  // healDevUrl rewrites a non-loopback DEV_URL back to a free loopback port on
  // purpose. The cure had to leave DEV_URL alone and resolve the host elsewhere;
  // if attach ever starts seeding a LAN DEV_URL, these two tear at each other.
  const attach = src("core/src/attach.ts");
  assert.match(attach, /DEV_URL="http:\/\/localhost:\{\{DEV_PORT\}\}"/, "attach still seeds a loopback bind address");
  assert.match(attach, /bin\/preview-base/, "and says where the human-reachable base comes from instead");
});

// ── CE-147: a stranger's rig.conf named someone else's machine ──────────────

test("CE-147: a fresh rig.conf names no one's machine", () => {
  for (const f of ["core/src/attach.ts", "rig.conf.example"]) {
    const t = src(f);
    assert.doesNotMatch(t, /^\s*SUPERMAN_(HOST|IP)=/m, `${f} still seeds a personal machine name`);
    assert.doesNotMatch(t, /^\s*# SUPERMAN_(HOST|IP)=/m, `${f} still offers it in the commented remote block`);
    assert.match(t, /DEV_HOST="local"/, `${f} seeds the neutral key`);
  }
});

test("CE-147: the old names stay HONOURED so existing rigs keep working", () => {
  // Adam's own rigs carry SUPERMAN_HOST. A rename that breaks them is a worse
  // bug than the one it fixes, so every reader takes either spelling.
  assert.match(readFileSync(RESOLVER, "utf8"), /SUPERMAN_IP/, "the resolver falls back to the legacy key");
  for (const f of ["config/skills/build-preview.md", "adapters/claude/adapter.md", "adapters/codex/adapter.md"]) {
    assert.match(src(f), /SUPERMAN_HOST/, `${f} must tell a seat the legacy spelling is the same key`);
  }
});

test("CE-147: the preview skill's ssh line uses the neutral key", () => {
  assert.match(src("config/skills/build-preview.md"), /ssh <DEV_HOST>/);
  assert.doesNotMatch(src("config/skills/build-preview.md"), /ssh <SUPERMAN_HOST>/);
});
