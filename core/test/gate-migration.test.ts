import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const engine = fileURLToPath(new URL("../../", import.meta.url));
function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "crate-migrate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".agents/state"), { recursive: true });
  cpSync(join(engine, "config"), join(root, ".agents/config"), { recursive: true });
  const path = join(root, ".agents/rig.conf");
  const initial = '# operator setting\nPROJECT="fixture"\nNMGATE_ENFORCE="0"\nexport NMGATE_ENFORCE=0\nJOIN_ENFORCE="0"\nSMOKE_ENFORCE="0"\n';
  writeFileSync(path, initial);
  const ctl = (args: string[], seat = "") => spawnSync("python3", [join(engine, "bin/agentctl.py"), "gates", ...args], { cwd: root, encoding: "utf8", env: { ...process.env, CRATE_SEAT: seat } });
  return { root, path, initial, ctl };
}
test("migration is explicit, preserves unrelated settings and removes conflicting duplicates", t => {
  const r = fixture(t);
  assert.equal(r.ctl(["status"]).status, 0);
  assert.equal(readFileSync(r.path, "utf8"), r.initial);
  const result = r.ctl(["enable"]); assert.equal(result.status, 0, result.stderr);
  const conf = readFileSync(r.path, "utf8");
  assert.ok(conf.startsWith('# operator setting\nPROJECT="fixture"\n'));
  for (const key of ["NMGATE_ENFORCE", "JOIN_ENFORCE", "SMOKE_ENFORCE"]) {
    assert.equal(conf.split(key).length, 2); assert.ok(conf.includes(`${key}="1"`));
  }
});
test("active scalar or concurrent task refuses migration without changing configuration", t => {
  const r = fixture(t);
  for (const state of ['[t] START_IMPL state=implementing\n', '[t] BOOT state=initialized\n[t] START_IMPL task=a state=implementing\n']) {
    writeFileSync(join(r.root, ".agents/state/events.log"), state);
    assert.notEqual(r.ctl(["enable"]).status, 0);
    assert.equal(readFileSync(r.path, "utf8"), r.initial);
  }
});
test("worker cannot migrate; non-web exemption requires an explicit reason and is recorded", t => {
  const r = fixture(t);
  assert.notEqual(r.ctl(["enable"], "coder").status, 0);
  assert.notEqual(r.ctl(["enable", "--no-web-smoke"]).status, 0);
  assert.equal(readFileSync(r.path, "utf8"), r.initial);
  assert.equal(r.ctl(["enable", "--no-web-smoke", "--reason", "CLI project with no HTTP server"]).status, 0);
  assert.match(readFileSync(r.path, "utf8"), /SMOKE_ENFORCE="0"/);
  assert.match(readFileSync(join(r.root, ".agents/state/events.log"), "utf8"), /GATES_ENABLED.*smoke=0 reason=CLI project/);
});

for (const [name, events] of [
  ["tagged CLOSE after untagged DEPLOYED", "[t] BOOT state=initialized\n[t] START_IMPL task=one state=implementing\n[t] DEPLOYED state=deployed\n[t] CLOSE task=one state=idle\n"],
  ["untagged CLOSE after inconsistent task labels", "[t] BOOT state=initialized\n[t] START_IMPL task=one state=implementing\n[t] VERDICT task=feature/one state=code_ready\n[t] DEPLOYED state=deployed\n[t] CLOSE state=idle\n"],
]) {
  test(`D1 single-loop migration accepts ${name} without rewriting history`, t => {
    const r = fixture(t);
    const log = join(r.root, ".agents/state/events.log");
    writeFileSync(log, events!);
    const result = r.ctl(["enable"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(readFileSync(log, "utf8").startsWith(events!));
    assert.match(readFileSync(r.path, "utf8"), /JOIN_ENFORCE="1"/);
  });
}
test("D1 concurrent mode refuses remaining active task even when last event closes another task", t => {
  const r = fixture(t);
  const conf = r.initial + 'CONCURRENT_LOOPS="1"\n';
  writeFileSync(r.path, conf);
  const log = join(r.root, ".agents/state/events.log");
  const events = '[t] BOOT state=initialized\n[t] START_IMPL task=a state=implementing\n[t] START_IMPL task=b state=implementing\n[t] CLOSE task=b state=idle\n';
  writeFileSync(log, events);
  assert.notEqual(r.ctl(["enable"]).status, 0);
  assert.equal(readFileSync(r.path, "utf8"), conf);
  assert.equal(readFileSync(log, "utf8"), events);
  writeFileSync(log, events + '[t] CLOSE task=a state=idle\n');
  assert.equal(r.ctl(["enable"]).status, 0);
});
test("D1 single-loop migration still refuses a newly started tagged loop after CLOSE", t => {
  const r = fixture(t);
  writeFileSync(join(r.root, ".agents/state/events.log"), '[t] CLOSE state=idle\n[t] START_IMPL task=new state=implementing\n');
  assert.notEqual(r.ctl(["enable"]).status, 0);
  assert.equal(readFileSync(r.path, "utf8"), r.initial);
});
