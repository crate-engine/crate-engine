import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  AttachError,
  executeAttach,
  planAttach,
  listDirs,
  makeDir,
  resolveTarget,
  writeManagedGitignore,
} from "../src/attach.js";

const scratch = mkdtempSync(join(tmpdir(), "crate2-attach-"));

// A miniature engine dir shaped like the real brain (templates/ is what attach reads).
function makeEngine(): string {
  const engine = join(scratch, "engine");
  for (const d of ["bin", "config", "adapters"]) mkdirSync(join(engine, d), { recursive: true });
  mkdirSync(join(engine, "templates", "state", "checkpoints"), { recursive: true });
  for (const doc of ["AGENTS.md", "PROGRESS.md", "ISSUES.md"]) {
    writeFileSync(join(engine, "templates", doc), `# ${doc} — {{PROJECT}} at {{PROJECT_PATH}}\n`);
  }
  writeFileSync(join(engine, "templates", "state", "FLAWS.md"), "# FLAWS — {{PROJECT}}\n");
  writeFileSync(join(engine, "templates", "state", "session.md"), "# session — {{PROJECT}}\n");
  return engine;
}
const engine = makeEngine();

const git = (args: string[], cwd: string) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });

/** Snapshot every path under root (for the disclosure-truth diff). */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const abs = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) out.set(r, `link:${readlinkSync(abs)}`);
      else if (st.isDirectory()) {
        out.set(`${r}/`, "dir");
        walk(abs, r);
      } else out.set(r, readFileSync(abs, "utf8"));
    }
  };
  if (existsSync(root)) walk(root, "");
  return out;
}

// ── target resolution (three forms) ──────────────────────────────────────────

test("resolveTarget: '.'/paths/bare names", () => {
  const cwd = join(scratch, "cwd-repo");
  mkdirSync(cwd, { recursive: true });
  assert.equal(resolveTarget(".", { cwd }).projectRoot, cwd);
  assert.equal(resolveTarget(cwd, { cwd: "/" }).projectRoot, cwd);
  assert.equal(
    resolveTarget("myproj", { projectsRoot: join(scratch, "projects") }).projectRoot,
    join(scratch, "projects", "myproj"),
  );
  assert.equal(resolveTarget("~/x", { cwd: "/", home: "/Users/nobody" }).projectRoot, "/Users/nobody/x");
});

// ── P4-3: the disclosure can never lie (plan == actual file delta) ───────────

test("attach existing git repo: disclosure equals the actual delta; artifacts correct", () => {
  const repo = join(scratch, "repo-a");
  mkdirSync(repo, { recursive: true });
  git(["init", "--quiet"], repo);
  writeFileSync(join(repo, "app.ts"), "export {}\n");

  const before = snapshot(repo);
  const plan = planAttach(resolveTarget(repo, { cwd: "/" }), engine);
  const report = executeAttach(plan);
  const after = snapshot(repo);

  // every disclosed create actually appeared; nothing undisclosed changed
  const newOrChanged = [...after.keys()].filter((k) => !before.has(k) || before.get(k) !== after.get(k));
  const disclosed = plan.writes.filter((w) => w.action !== "keep").map((w) => w.rel);
  for (const d of disclosed) {
    const hit = newOrChanged.some((k) => k === d || k.startsWith(d) || `${k}/` === d || d === `${k}`);
    assert.ok(hit, `disclosed ${d} did not appear in the delta`);
  }
  for (const k of newOrChanged) {
    const covered = disclosed.some((d) => k === d || k.startsWith(d.replace(/\/$/, "")));
    assert.ok(covered, `UNDISCLOSED change: ${k}`);
  }
  assert.deepEqual(report.changed.sort(), disclosed.sort());

  // artifacts
  assert.equal(readlinkSync(join(repo, ".agents", "bin")), join(engine, "bin"));
  assert.match(readFileSync(join(repo, ".agents", ".gitignore"), "utf8"), /crate-engine managed/);
  assert.match(readFileSync(join(repo, "AGENTS.md"), "utf8"), new RegExp(`repo-a at ${repo}`));
  const conf = readFileSync(join(repo, ".agents", "rig.conf"), "utf8");
  assert.match(conf, /PROJECT="repo-a"/);
  assert.match(conf, /SUPERMAN_HOST="local"/); // local default shape
  assert.match(conf, /# CODER_AGENT=/); // staffing overrides commented, not mandatory
  assert.match(readFileSync(join(repo, ".agents", "state", "FLAWS.md"), "utf8"), /repo-a/);
});

test("attach re-run is a keep-everything no-op (idempotent heal)", () => {
  const repo = join(scratch, "repo-a");
  const before = snapshot(repo);
  const plan = planAttach(resolveTarget(repo, { cwd: "/" }), engine);
  // symlinks + gitignore block rewrite are the only actions; docs/state/conf all keep
  for (const w of plan.writes) {
    if (w.rel.endsWith(".gitignore")) continue; // managed block always self-heals
    if (w.rel.startsWith(".agents/") && ["bin", "config", "adapters"].some((p) => w.rel.endsWith(p))) {
      assert.equal(w.action, "keep", `${w.rel} should be keep`);
    } else assert.equal(w.action, "keep", `${w.rel} should be keep`);
  }
  executeAttach(plan);
  const after = snapshot(repo);
  assert.deepEqual([...after.entries()], [...before.entries()]); // byte-identical
});

test("create mode: new folder, git init, seeded docs, first commit", () => {
  const target = resolveTarget("newproj", { projectsRoot: join(scratch, "projects") });
  const plan = planAttach(target, engine, { create: true });
  assert.ok(plan.createsProjectDir);
  const report = executeAttach(plan);
  const root = target.projectRoot;
  assert.ok(report.gitInitialized);
  assert.ok(report.firstCommit);
  const tracked = git(["ls-files"], root).trim().split("\n").sort();
  // committed docs + the durable local files git keeps (managed .gitignore + FLAWS)
  assert.deepEqual(tracked, [".agents/.gitignore", ".agents/state/FLAWS.md", "AGENTS.md", "ISSUES.md", "PROGRESS.md"]);
  // engine symlinks are NOT tracked (the managed block works from commit one)
  assert.ok(!tracked.includes(".agents/bin"));
});

// ── P4-4: the enumerated edge cases ──────────────────────────────────────────

test("edge: non-git folder attaches (no crash), plan says needsGit", () => {
  const plain = join(scratch, "plain-folder");
  mkdirSync(plain, { recursive: true });
  const plan = planAttach(resolveTarget(plain, { cwd: "/" }), engine);
  assert.ok(plan.needsGit);
  const report = executeAttach(plan, { gitInit: true });
  assert.ok(report.gitInitialized);
  assert.ok(existsSync(join(plain, ".git")));
});

test("edge: existing .agents with REAL (non-link) bin refuses plainly", () => {
  const repo = join(scratch, "repo-real-agents");
  mkdirSync(join(repo, ".agents", "bin"), { recursive: true });
  writeFileSync(join(repo, ".agents", "bin", "tool"), "real file\n");
  assert.throws(() => planAttach(resolveTarget(repo, { cwd: "/" }), engine), /NOT a symlink/);
});

test("edge: moved brain — dangling symlinks detected and re-pointed", () => {
  const repo = join(scratch, "repo-moved-brain");
  mkdirSync(join(repo, ".agents"), { recursive: true });
  git(["init", "--quiet"], repo);
  const oldEngine = join(scratch, "old-engine-location");
  for (const p of ["bin", "config", "adapters"]) symlinkSync(join(oldEngine, p), join(repo, ".agents", p));
  const plan = planAttach(resolveTarget(repo, { cwd: "/" }), engine);
  for (const p of ["bin", "config", "adapters"]) {
    assert.equal(plan.writes.find((w) => w.rel === `.agents/${p}`)!.action, "heal");
  }
  executeAttach(plan);
  assert.equal(readlinkSync(join(repo, ".agents", "bin")), join(engine, "bin"));
});

test("edge: junk paths refuse with actionable messages", () => {
  // a file, not a directory
  const f = join(scratch, "iam-a-file");
  writeFileSync(f, "x");
  assert.throws(() => planAttach(resolveTarget(f, { cwd: "/" }), engine), /file, not a directory/);
  // missing target without --create
  assert.throws(
    () => planAttach(resolveTarget(join(scratch, "missing-dir"), { cwd: "/" }), engine),
    /--create/,
  );
  // missing engine
  const ok = join(scratch, "fine-repo");
  mkdirSync(ok, { recursive: true });
  assert.throws(
    () => planAttach(resolveTarget(ok, { cwd: "/" }), join(scratch, "no-engine-here")),
    /crate2 setup/,
  );
  assert.ok(AttachError !== undefined);
});

test("managed gitignore block: idempotent, preserves user lines, refreshes stale blocks", () => {
  const gi = join(scratch, "gitignore-test");
  writeFileSync(gi, "my-own-line\n# >>> crate-engine managed (symlinks + live state) - do not edit between markers >>>\nSTALE\n# <<< crate-engine managed <<<\n");
  writeManagedGitignore(gi);
  writeManagedGitignore(gi); // twice = once
  const text = readFileSync(gi, "utf8");
  assert.match(text, /^my-own-line\n/);
  assert.ok(!text.includes("STALE"));
  assert.equal(text.match(/crate-engine managed \(symlinks/g)!.length, 1);
  assert.match(text, /!\/state\/FLAWS\.md/);
});

test("resolveTarget: an empty string refuses plainly (run #3: it silently became ~/Projects)", () => {
  assert.throws(() => resolveTarget(""), /type a project folder/);
  assert.throws(() => resolveTarget("   "), /type a project folder/);
});

test("listDirs: folders only, repos badged, hidden skipped, jailed to home (run #4 picker)", () => {
  const home = mkdtempSync(join(tmpdir(), "crate2-pick-"));
  mkdirSync(join(home, "Projects", "my-repo", ".git"), { recursive: true });
  mkdirSync(join(home, "Projects", "plain"), { recursive: true });
  mkdirSync(join(home, "Projects", ".hidden"), { recursive: true });
  writeFileSync(join(home, "Projects", "a-file.txt"), "x");

  const top = listDirs(undefined, { home });
  assert.equal(top.parent, undefined, "home is the jail root");
  assert.ok(top.dirs.some((d) => d.name === "Projects"));

  const proj = listDirs(join(home, "Projects"), { home });
  assert.deepEqual(
    proj.dirs.map((d) => [d.name, d.isRepo]),
    [
      ["my-repo", true],
      ["plain", false],
    ],
  );
  assert.ok(proj.parent, "non-root has a parent");

  // outside home → plain refusal; a vanished path falls back to home
  assert.throws(() => listDirs("/private/tmp", { home }), /inside your home/);
  assert.equal(listDirs(join(home, "no-such-dir"), { home }).path, listDirs(undefined, { home }).path);
});

test("makeDir: creates inside the jail and steps in; junk names + duplicates refuse (run #6 picker)", () => {
  const home = mkdtempSync(join(tmpdir(), "crate2-mkdir-"));
  mkdirSync(join(home, "Projects"), { recursive: true });

  const made = makeDir(join(home, "Projects"), "my-new-app", { home });
  assert.ok(made.path.endsWith(join("Projects", "my-new-app")), "returns the NEW folder's listing (realpathed)");
  assert.deepEqual(made.dirs, []);
  assert.ok(existsSync(join(home, "Projects", "my-new-app")));

  // refusals: empty, slashes, hidden, dot-walks, duplicates, outside the jail
  for (const bad of ["", "  ", "a/b", "../up", ".hidden", "."]) {
    assert.throws(() => makeDir(join(home, "Projects"), bad, { home }), /plain name/, `must refuse ${JSON.stringify(bad)}`);
  }
  assert.throws(() => makeDir(join(home, "Projects"), "my-new-app", { home }), /already exists/);
  assert.throws(() => makeDir("/private/tmp", "x", { home }), /inside your home/);
});
