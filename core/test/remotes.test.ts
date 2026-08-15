// Cockpit-first onboarding S1 — the "+ Add a server" machinery: registry,
// ssh plans, the consent-gated install/connect job, and the clone door.
// Hermetic: every side effect goes through a fake RemoteExec.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cloneDirNameFor, cloneRepo, validCloneUrl } from "../src/attach.js";
import {
  addRemote,
  appUrlArgv,
  bootArgv,
  clearRemoteJobs,
  installArgv,
  listRemotes,
  parseProbe,
  probeArgv,
  probeRemote,
  remoteJob,
  removeRemote,
  startConnect,
  startInstall,
  validRemoteHost,
  type RemoteExec,
} from "../src/gui/remotes.js";

function mkHome(): string {
  const home = mkdtempSync(join(tmpdir(), "remotes-home-"));
  mkdirSync(join(home, ".crate"), { recursive: true }); // the user tier exists
  return home;
}

async function settle(host: string, timeoutMs = 3000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const j = remoteJob(host);
    if (j && (j.phase === "connected" || j.phase === "failed")) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`job for ${host} never settled: ${JSON.stringify(remoteJob(host))}`);
}

test("registry: add is idempotent, remove drops, corrupt file degrades to empty", () => {
  const home = mkHome();
  try {
    assert.deepEqual(listRemotes(home), []);
    addRemote(home, "superman");
    addRemote(home, "superman");
    assert.equal(listRemotes(home).length, 1);
    assert.equal(listRemotes(home)[0]!.host, "superman");
    removeRemote(home, "superman");
    assert.deepEqual(listRemotes(home), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("host validation: aliases and user@host pass; option smuggling and shell syntax refuse", () => {
  for (const ok of ["superman", "superman-wifi", "adam@10.0.0.5", "build.example.com", "a_b-c.d"]) {
    assert.ok(validRemoteHost(ok), ok);
  }
  for (const bad of ["-oProxyCommand=evil", "host; rm -rf /", "host x", "", "host`id`", "host$(id)", "host|x"]) {
    assert.ok(!validRemoteHost(bad), bad);
  }
});

test("ssh plans: BatchMode everywhere (keys or nothing); install = the standard installer, --no-open, never sudo; boot = the proven crate-open leg", () => {
  for (const argv of [probeArgv("h"), installArgv("h"), bootArgv("h"), appUrlArgv("h")]) {
    assert.ok(argv.includes("BatchMode=yes"), argv.join(" "));
  }
  const inst = installArgv("h").join(" ");
  assert.match(inst, /crate-engine\.ai\/get/);
  assert.match(inst, /--no-open/);
  assert.doesNotMatch(inst, /sudo/);
  assert.match(bootArgv("h").join(" "), /"\$HOME\/\.local\/bin\/crate" open/); // cli.ts's remote leg, verbatim
  assert.equal(parseProbe("CRATE_ENGINE=yes\n").engine, true);
  assert.equal(parseProbe("motd banner\nCRATE_ENGINE=no\n").engine, false);
});

test("probeRemote: an unreachable host answers plainly (keys hint), never a throw", async () => {
  const exec: RemoteExec = {
    run: async () => {
      throw Object.assign(new Error("ssh: connect refused"), { stderr: "Permission denied (publickey)." });
    },
    spawnDetached: () => {},
    probeHttp: async () => false,
  };
  const p = await probeRemote("nope-host", exec);
  assert.equal(p.reachable, false);
  assert.match(p.note ?? "", /ssh could not reach nope-host with your keys/);
});

test("install job: consent → installing → booting → tunneling → connected; the host becomes a remembered chip; the url is the tunneled /team", async () => {
  const home = mkHome();
  clearRemoteJobs();
  const calls: string[] = [];
  const exec: RemoteExec = {
    run: async (_cmd, args) => {
      const line = args.join(" ");
      calls.push(line);
      if (line.includes("cat ~/.crate/app-url")) return { stdout: "http://127.0.0.1:4321/?token=abc&pv=555\n", stderr: "" };
      return { stdout: "ok", stderr: "" };
    },
    spawnDetached: (_cmd, args) => calls.push("TUNNEL " + args.join(" ")),
    probeHttp: async () => true,
  };
  try {
    const j = startInstall(home, "superman", exec);
    assert.equal(j.phase, "installing"); // kicked off eagerly — the poller never sees a blank
    await settle("superman");
    const done = remoteJob("superman")!;
    assert.equal(done.phase, "connected");
    assert.equal(done.url, "http://127.0.0.1:4321/team?token=abc");
    assert.ok(calls.some((c) => c.includes("crate-engine.ai/get")), "the installer ran");
    assert.ok(calls.some((c) => c.startsWith("TUNNEL") && c.includes("4321:127.0.0.1:4321") && c.includes("555:127.0.0.1:555")), "app + preview ports tunneled");
    assert.equal(listRemotes(home)[0]?.host, "superman", "connected once = remembered forever");
  } finally {
    clearRemoteJobs();
    rmSync(home, { recursive: true, force: true });
  }
});

test("connect job failure: plain words + evidence in the log; a retry may start after a failure", async () => {
  const home = mkHome();
  clearRemoteJobs();
  const exec: RemoteExec = {
    run: async () => {
      throw Object.assign(new Error("ssh died"), { stderr: "ssh: Could not resolve hostname ghost" });
    },
    spawnDetached: () => {},
    probeHttp: async () => false,
  };
  try {
    const first = startConnect(home, "ghost", exec);
    const again = startConnect(home, "ghost", exec);
    assert.equal(first, again, "one live job per host");
    await settle("ghost");
    const j = remoteJob("ghost")!;
    assert.equal(j.phase, "failed");
    assert.ok(j.log.length > 0, "failure evidence one click away");
    assert.equal(listRemotes(home).length, 0, "a failed host is NOT remembered");
    const retry = startConnect(home, "ghost", exec);
    assert.notEqual(retry, j, "failed jobs do not block retries");
    await settle("ghost");
  } finally {
    clearRemoteJobs();
    rmSync(home, { recursive: true, force: true });
  }
});

// ── the clone door (backlog 15, absorbed by the card) ────────────────────────

test("clone URLs: https/git@ repos pass; option smuggling, shell syntax, and bare hosts refuse", () => {
  for (const ok of [
    "https://github.com/you/repo",
    "https://github.com/you/repo.git",
    "git@github.com:you/repo.git",
    "https://gitlab.com/group/sub/repo",
  ]) {
    assert.ok(validCloneUrl(ok), ok);
  }
  for (const bad of ["--upload-pack=evil", "https://github.com", "http://github.com/you/repo", "repo; rm -rf /", "file:///etc", "https://github.com/you/re po"]) {
    assert.ok(!validCloneUrl(bad), bad);
  }
  assert.equal(cloneDirNameFor("https://github.com/you/repo.git"), "repo");
  assert.equal(cloneDirNameFor("git@github.com:you/repo"), "repo");
});

test("cloneRepo refusals are plain: bad url; a destination outside the jail; an existing target", async () => {
  const home = mkHome();
  mkdirSync(join(home, "Projects", "repo"), { recursive: true });
  try {
    await assert.rejects(() => cloneRepo("not-a-url", undefined, { home }), /doesn't look like a git URL/);
    await assert.rejects(() => cloneRepo("https://github.com/you/repo", "/private/tmp", { home }), /inside your home/);
    await assert.rejects(
      () => cloneRepo("https://github.com/you/repo", join(home, "Projects"), { home }),
      /already exists/,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
