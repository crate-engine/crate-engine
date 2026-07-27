import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setConf } from "../src/tools/conf-set.js";

const CONF = `# rig.conf — comments and spacing must survive byte-exact
PROJECT="demo"
PREVIEW_PROVIDER="tailscale"   # trailing comment on an untouched line
PREVIEW_URL=""
NMGATE_ENFORCE="0"
`;

test("setConf: replaces the existing key line, everything else byte-exact", () => {
  const out = setConf(CONF, "PREVIEW_URL", "https://mac.tail1234.ts.net");
  assert.equal(
    out,
    CONF.replace('PREVIEW_URL=""', 'PREVIEW_URL="https://mac.tail1234.ts.net"'),
  );
});

test("setConf: appends when the key is absent (newline-safe)", () => {
  const out = setConf('A="1"', "B", "2");
  assert.equal(out, 'A="1"\nB="2"\n');
});

test("setConf: replaces only the FIRST match and never a prefix-cousin key", () => {
  const text = 'PREVIEW_URL=""\nPREVIEW_URL_OLD="keep"\n';
  const out = setConf(text, "PREVIEW_URL", "x");
  assert.equal(out, 'PREVIEW_URL="x"\nPREVIEW_URL_OLD="keep"\n');
});

test("setConf: leading whitespace forms are still the same key", () => {
  const out = setConf('  PREVIEW_URL="old"\n', "PREVIEW_URL", "new");
  assert.equal(out, 'PREVIEW_URL="new"\n');
});

test("setConf: a value carrying $ is single-quoted (run-time expansion contract)", () => {
  const out = setConf("", "GATE_START_CMD", "npm run preview -- --port $GATE_PORT --strictPort");
  assert.equal(out, "GATE_START_CMD='npm run preview -- --port $GATE_PORT --strictPort'\n");
});

test("conf-set CLI: real file round-trip via the shim path", () => {
  const dir = mkdtempSync(join(tmpdir(), "conf-set-"));
  const file = join(dir, "rig.conf");
  writeFileSync(file, CONF);
  const shim = join(import.meta.dirname, "..", "tools", "conf-set");
  execFileSync("bash", [shim, file, "PREVIEW_URL", "https://mac.ts.net:8443"]);
  const text = readFileSync(file, "utf8");
  assert.match(text, /^PREVIEW_URL="https:\/\/mac\.ts\.net:8443"$/m);
  assert.match(text, /trailing comment on an untouched line/);
  execFileSync("bash", [shim, file, "NEW_KEY", "v"]);
  assert.match(readFileSync(file, "utf8"), /NEW_KEY="v"\n$/);
});

test("the P4-8 bug, reproduced: GNU `sed -i` syntax fails on macOS BSD sed", (t) => {
  if (process.platform !== "darwin") return t.skip("macOS-only reproduction");
  const dir = mkdtempSync(join(tmpdir(), "sed-repro-"));
  const file = join(dir, "rig.conf");
  writeFileSync(file, 'PREVIEW_URL=""\n');
  // the exact v1 idiom preview-tunnel used
  assert.throws(() =>
    execFileSync("sed", ["-i", 's#^[[:space:]]*PREVIEW_URL=.*#PREVIEW_URL="x"#', file], {
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  // and the file was left unwritten — the silent failure mode on a Mac rig
  assert.equal(readFileSync(file, "utf8"), 'PREVIEW_URL=""\n');
});
