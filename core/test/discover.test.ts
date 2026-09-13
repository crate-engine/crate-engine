// Open Project doors (PDR open-project-doors, 2026-09-13): the discovered
// project list and the SSH-config computers — pure, bounded, honest.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverProjects, foldSshHosts, parseSshHosts, projectState } from "../src/discover.js";

function engine(root: string): string {
  const e = join(root, "engine");
  for (const d of ["bin", "config", "templates"]) mkdirSync(join(e, d), { recursive: true });
  return e;
}
function project(root: string, name: string, kind: "new" | "ready" | "heal", engineDir: string): string {
  const p = join(root, name);
  mkdirSync(join(p, ".git"), { recursive: true });
  if (kind !== "new") {
    mkdirSync(join(p, ".agents"), { recursive: true });
    writeFileSync(join(p, ".agents", "rig.conf"), "PROJECT=x\n");
    const target = kind === "ready" ? engineDir : join(root, "old-engine-gone");
    symlinkSync(join(target, "bin"), join(p, ".agents", "bin"));
    symlinkSync(join(target, "config"), join(p, ".agents", "config"));
  }
  return p;
}

test("projectState: new (no .agents) / ready (links → this engine) / heal (links dangle or point elsewhere)", () => {
  const root = mkdtempSync(join(tmpdir(), "discover-"));
  try {
    const e = engine(root);
    assert.equal(projectState(project(root, "a", "new", e), e), "new");
    assert.equal(projectState(project(root, "b", "ready", e), e), "ready");
    assert.equal(projectState(project(root, "c", "heal", e), e), "heal", "the docket case: an older engine's links");
    assert.equal(projectState(join(root, "nope"), e), "new");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discoverProjects: recents first (newest focus first), then A–Z under the roots; hidden/non-projects skipped; bounded", () => {
  const root = mkdtempSync(join(tmpdir(), "discover-"));
  try {
    const e = engine(root);
    const roots = join(root, "Projects");
    mkdirSync(roots);
    const zed = project(roots, "zed", "new", e);
    const alpha = project(roots, "alpha", "ready", e);
    const docket = project(roots, "docket", "heal", e);
    mkdirSync(join(roots, "not-a-project")); // no .git, no .agents
    mkdirSync(join(roots, ".hidden", ".git"), { recursive: true });
    const list = discoverProjects({
      roots: [roots, roots, join(root, "missing-root")],
      recents: [{ path: zed, focusedAt: 10 }, { path: docket, focusedAt: 20 }, { path: join(root, "vanished") }],
      engineDir: e,
    });
    assert.deepEqual(list.map((p) => `${p.name}:${p.state}`), ["docket:heal", "zed:new", "alpha:ready"]);
    assert.equal(list[0]!.lastOpened, 20);
    assert.ok(!list.some((p) => p.name === "not-a-project" || p.name === ".hidden"));
    assert.equal(discoverProjects({ roots: [roots], recents: [], engineDir: e, max: 2 }).length, 2, "bounded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const CONFIG = `
# ─── Superman (the rig host) ───
Host superman 192.168.100.218 100.64.55.121
    HostName 192.168.100.218
    User adam-duguay
Host superman-wifi 192.168.100.112
    HostName 192.168.100.112
Host superman-ts
    HostName 100.64.55.121
Host macmini
    HostName fd7a::1
Host *
    ServerAliveInterval 30
Host github.com
    IdentityFile ~/.ssh/id_ed25519
Match host foo
    User x
`;

test("parseSshHosts: Host names (multi-name lines included), HostName carried, wildcards and Match blocks skipped", () => {
  const hosts = parseSshHosts(CONFIG);
  assert.deepEqual(hosts.map((h) => h.name), [
    "superman", "192.168.100.218", "100.64.55.121", "superman-wifi", "192.168.100.112", "superman-ts", "macmini", "github.com",
  ]);
  assert.equal(hosts.find((h) => h.name === "superman")!.hostName, "192.168.100.218");
  assert.equal(hosts.find((h) => h.name === "github.com")!.hostName, undefined);
});

test("foldSshHosts: one computer per machine — superman's three names fold; the first declared name leads", () => {
  const computers = foldSshHosts(parseSshHosts(CONFIG));
  const names = computers.map((c) => c.name);
  assert.deepEqual(names, ["superman", "superman-wifi", "macmini", "github.com"]);
  const sm = computers.find((c) => c.name === "superman")!;
  assert.ok(sm.aliases.includes("100.64.55.121") && sm.aliases.includes("192.168.100.218"), "raw addresses fold under the alias");
  // superman-ts declares the Tailscale address that superman ALSO lists as an alias → same computer
  assert.ok(sm.aliases.includes("superman-ts"), `superman-ts folds into superman: ${sm.aliases.join(",")}`);
});
