// CE-106 / CE-110 — ONE dev-port resolution, and never publish someone else's app.
//
// The port was worked out in four places with different precedences: bin/dev-server
// and bin/preview-tunnel `source`d .agents/dev.conf ON TOP of rig.conf (so the
// helper file quietly won), while doctor.ts and servers.ts never read dev.conf at
// all. A rig could serve on one port while the cockpit diagnosed another.
// bin/serve-resolve owns the order now; everyone else asks it.
//
// CE-110 is what that split cost in practice: with PREVIEW_DEV_PORT unset the port
// fell back to 3000 and `preview-tunnel up` published whatever answered there — a
// sibling rig's dev server, tunnelled to the operator under THIS project's name.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { confValue, resolveDevPorts } from "../src/devport.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RESOLVER = join(ROOT, "bin", "serve-resolve");

/** A project with the given conf files, and .agents/bin linked to the real engine bin. */
function mkProj(rigConf?: string, devConf?: string): string {
  const proj = mkdtempSync(join(tmpdir(), "crate2-devport-"));
  mkdirSync(join(proj, ".agents"), { recursive: true });
  if (rigConf !== undefined) writeFileSync(join(proj, ".agents", "rig.conf"), rigConf);
  if (devConf !== undefined) writeFileSync(join(proj, ".agents", "dev.conf"), devConf);
  return proj;
}

/** What bash resolves — the authority both sides must agree on. */
function bashPorts(proj: string): { port: number; previewPort: number } {
  const out = execFileSync("bash", [RESOLVER, "dev", proj], { encoding: "utf8" });
  const pick = (k: string): number => Number(new RegExp(`^${k}=(\\d+)$`, "m").exec(out)?.[1] ?? 0);
  return { port: pick("PORT"), previewPort: pick("PREVIEW_PORT") };
}

const CASES: Array<[string, string | undefined, string | undefined, number, number]> = [
  ["DEV_PORT wins outright", 'DEV_PORT="4100"\n', undefined, 4100, 4100],
  ["else the last :port in DEV_URL", 'DEV_URL="http://192.168.1.9:4200/app"\n', undefined, 4200, 4200],
  ["else 3000", 'PROJECT="x"\n', undefined, 3000, 3000],
  ["PREVIEW_DEV_PORT only shifts the preview port", 'DEV_PORT="4300"\nPREVIEW_DEV_PORT="4301"\n', undefined, 4300, 4301],
  // The heart of CE-106: rig.conf is authoritative, dev.conf only fills gaps.
  ["rig.conf BEATS dev.conf", 'DEV_PORT="4400"\n', 'DEV_PORT="9999"\n', 4400, 4400],
  ["dev.conf fills a gap rig.conf leaves", 'PROJECT="x"\n', 'DEV_PORT="4500"\n', 4500, 4500],
  ["dev.conf-only project (the docket shape)", undefined, 'DEV_PORT="4600"\n', 4600, 4600],
  // Caught while writing this: with KEY-major precedence a stale dev.conf
  // DEV_PORT beat the rig's own DEV_URL — CE-106's inversion, reintroduced by
  // the fix for CE-106. The file is the outer key.
  ["rig.conf DEV_URL beats a stale dev.conf DEV_PORT", 'DEV_URL="http://localhost:4700"\n', 'DEV_PORT="3000"\n', 4700, 4700],
  ["rig.conf PREVIEW_DEV_PORT beats dev.conf's", 'DEV_PORT="4800"\nPREVIEW_DEV_PORT="4801"\n', 'PREVIEW_DEV_PORT="3001"\n', 4800, 4801],
];

for (const [name, rig, dev, port, previewPort] of CASES) {
  test(`serve-resolve dev ports: ${name} (CE-106)`, () => {
    const proj = mkProj(rig, dev);
    assert.deepEqual(bashPorts(proj), { port, previewPort }, "bash resolution");
  });

  test(`TS agrees with bash: ${name} (CE-106)`, () => {
    const proj = mkProj(rig, dev);
    // No .agents/bin symlink here, so this exercises the conf-fallback path —
    // which must produce the SAME answer as the resolver, or the split is back.
    const ts = resolveDevPorts(proj);
    assert.equal(ts.origin, "conf-fallback");
    assert.deepEqual({ port: ts.port, previewPort: ts.previewPort }, { port, previewPort });
  });
}

test("resolveDevPorts prefers the real resolver when .agents/bin is linked (CE-106)", () => {
  const proj = mkProj('DEV_PORT="4700"\n');
  mkdirSync(join(proj, ".agents", "bin"), { recursive: true });
  writeFileSync(
    join(proj, ".agents", "bin", "serve-resolve"),
    `#!/usr/bin/env bash\nexec bash ${JSON.stringify(RESOLVER)} "$@"\n`,
  );
  const ts = resolveDevPorts(proj);
  assert.equal(ts.origin, "serve-resolve", "the bash resolver is the authority when reachable");
  assert.equal(ts.port, 4700);
});

test("confValue: rig.conf first hit, dev.conf as the gap-filler (CE-106)", () => {
  const proj = mkProj('DEV_PORT="1"\nDEV_URL="http://localhost:2"\n', 'DEV_PORT="3"\nDEV_CMD="npm run dev"\n');
  assert.equal(confValue(proj, "DEV_PORT"), "1", "rig.conf wins");
  assert.equal(confValue(proj, "DEV_CMD"), "npm run dev", "dev.conf fills what rig.conf omits");
  assert.equal(confValue(proj, "NOPE"), undefined);
});

// ── CE-110: the refusal ─────────────────────────────────────────────────────
test("preview-tunnel REFUSES to tunnel a port held by another project (CE-110)", async () => {
  const proj = mkProj('PROJECT="mine"\nPREVIEW_PROVIDER="tailscale"\nDEV_URL="http://localhost:5991"\n');
  const foreign = mkdtempSync(join(tmpdir(), "crate2-foreign-"));
  writeFileSync(join(foreign, "index.html"), "the WRONG repo");

  // A real listener on our resolved port, owned by a different directory.
  const { spawn } = await import("node:child_process");
  const srv = spawn("python3", ["-m", "http.server", "5991", "--bind", "127.0.0.1"], {
    cwd: foreign,
    stdio: "ignore",
  });
  try {
    await new Promise((r) => setTimeout(r, 1500));
    let out = "";
    let status = 0;
    try {
      execFileSync("bash", [join(ROOT, "bin", "preview-tunnel"), "up", proj], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.fail("must refuse");
    } catch (e) {
      const err = e as { stderr?: string; status?: number };
      out = err.stderr ?? "";
      status = err.status ?? 0;
    }
    assert.equal(status, 1, "a refusal is a non-zero exit, not a warning");
    assert.match(out, /REFUSING/);
    assert.match(out, /:5991 is held by a process that is NOT this project/);
    assert.match(out, /DIFFERENT repo's app/, "it says what the operator would have seen");
    assert.match(out, /PREVIEW_ALLOW_FOREIGN=1/, "and names the deliberate override");
  } finally {
    srv.kill("SIGKILL");
  }
});
