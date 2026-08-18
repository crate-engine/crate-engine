import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  assert.match(conf, /DEV_HOST="local"/); // local default shape (CE-147: was SUPERMAN_HOST)
  assert.doesNotMatch(conf, /^SUPERMAN_/m); // no stranger's machine name in a fresh conf
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

// ── FLAWS (Adam's gate-day run #1 request, pulled forward 2026-08-13):
// create-new offers a GitHub repo — gh-CLI driven, strictly graceful. The
// local mirror keeps `origin`; GitHub rides its own `github` remote. ──

test("create + GitHub: gh authed → repo created on a `github` remote and PUSHED; origin stays the mirror", () => {
  const fakebin = join(scratch, "fakebin-gh-ok");
  mkdirSync(fakebin, { recursive: true });
  const ghRemotes = join(scratch, "gh-remotes");
  mkdirSync(ghRemotes, { recursive: true });
  writeFileSync(
    join(fakebin, "gh"),
    [
      "#!/bin/sh",
      'if [ "$1 $2" = "auth status" ]; then exit 0; fi',
      'if [ "$1 $2" = "repo create" ]; then',
      `  git init --bare --quiet "${ghRemotes}/$3.git"`,
      `  git remote add github "${ghRemotes}/$3.git"`,
      "  git push --quiet github HEAD",
      "  exit 0",
      "fi",
      "exit 1",
    ].join("\n") + "\n",
  );
  chmodSync(join(fakebin, "gh"), 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${fakebin}:${oldPath}`;
  try {
    const target = resolveTarget("ghproj", { projectsRoot: join(scratch, "projects") });
    const plan = planAttach(target, engine, { create: true });
    const report = executeAttach(plan, { githubRepo: true });
    assert.equal(report.githubNote, undefined, report.githubNote ?? "");
    assert.match(report.githubRepo ?? "", /ghproj\.git$/, "the github remote URL is reported");
    const remotes = execFileSync("git", ["remote"], { cwd: target.projectRoot, encoding: "utf8" }).trim().split("\n").sort();
    assert.deepEqual(remotes, ["github", "origin"], "origin stays the local mirror; GitHub rides its own remote");
    const pushed = execFileSync("git", ["ls-remote", "--heads", join(ghRemotes, "ghproj.git")], { encoding: "utf8" });
    assert.ok(pushed.trim().length > 0, "the first commit is PUSHED off-box");
  } finally {
    process.env.PATH = oldPath;
  }
});

test("create + GitHub: gh not signed in → the attach itself still SUCCEEDS, with an honest note and no github remote", () => {
  const fakebin = join(scratch, "fakebin-gh-noauth");
  mkdirSync(fakebin, { recursive: true });
  writeFileSync(join(fakebin, "gh"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(fakebin, "gh"), 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${fakebin}:${oldPath}`;
  try {
    const target = resolveTarget("ghproj2", { projectsRoot: join(scratch, "projects") });
    const plan = planAttach(target, engine, { create: true });
    const report = executeAttach(plan, { githubRepo: true });
    assert.ok(report.firstCommit, "the attach itself succeeded");
    assert.equal(report.githubRepo, undefined);
    assert.match(report.githubNote ?? "", /signed in/);
    const remotes = execFileSync("git", ["remote"], { cwd: target.projectRoot, encoding: "utf8" }).trim().split("\n");
    assert.ok(!remotes.includes("github"), "no half-made github remote");
  } finally {
    process.env.PATH = oldPath;
  }
});

test("listDirs: the headless-era jail — extra roots browse, the picker STARTS where rigs live, outside-all still refuses (Adam's ↑Up find, 2026-08-15)", () => {
  const home = mkdtempSync(join(tmpdir(), "crate2-pick2-"));
  const rigsRoot = mkdtempSync(join(tmpdir(), "crate2-rigs-"));
  mkdirSync(join(rigsRoot, "site-rig", ".git"), { recursive: true });
  const opts = { home, roots: [rigsRoot] };

  const root = listDirs(rigsRoot, opts);
  assert.equal(root.parent, undefined, "a projects root is a jail root — ↑Up stops there, never wanders the system");
  assert.ok(root.dirs.some((d) => d.name === "site-rig" && d.isRepo), "rigs are browsable and badged");
  assert.equal(root.roots?.length, 2, "both roots surface for the picker's jump chips");

  assert.equal(listDirs(undefined, opts).path, root.path, "no path = start where rigs LIVE, not home");
  assert.ok(listDirs(join(rigsRoot, "site-rig"), opts).parent, "a child inside the root has a parent");
  assert.equal(listDirs(home, opts).parent, undefined, "home stays a browsable jail root too");
  assert.throws(() => listDirs("/private/tmp", opts), /inside your home/); // an EXISTING outside path refuses (a vanished one falls back, pinned above)

  const made = makeDir(rigsRoot, "fresh-rig", opts);
  assert.ok(made.path.endsWith("fresh-rig"), "New-folder works inside the projects root");
});

// ── CE-012: the SHIPPED reference config must not describe someone else's box ──
// rig.conf.example rides the dist whitelist, so every tester reads it. It had
// drifted a full generation: cmux-era pane titles (cmux retired in 2.1), a
// PROJECTS_ROOT hardcoded to one machine's /mnt/data/projects, and four knobs
// `attach` generates that it never mentioned. `attach` is the generator and the
// example is the annotated reference — the reference may say MORE, never less,
// and never anything host-specific outside a commented power-user block.
test("rig.conf.example: no foreign absolute paths, and every generated key is documented (CE-012)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const example = readFileSync(join(root, "rig.conf.example"), "utf8");
  const attachSrc = readFileSync(join(root, "core", "src", "attach.ts"), "utf8");
  const template = /const RIG_CONF_LOCAL = `([\s\S]*?)\n`;/.exec(attachSrc)?.[1];
  assert.ok(template, "the generated rig.conf template is still findable in attach.ts");

  const keys = (s: string): Set<string> =>
    new Set([...s.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));
  const missing = [...keys(template!)].filter((k) => !keys(example).has(k));
  assert.deepEqual(missing, [], "keys attach generates but the shipped reference never documents");

  // Host-specific paths belong in the commented remote block, if anywhere.
  const live = example
    .split("\n")
    .filter((l) => !l.trim().startsWith("#") && l.trim() !== "");
  for (const l of live) {
    assert.doesNotMatch(l, /\/mnt\/data\//, `a foreign machine's path shipped as a default: ${l}`);
    assert.doesNotMatch(l, /192\.168\./, `a foreign machine's LAN IP shipped as a default: ${l}`);
  }
  // cmux died in 2.1 — its layout keys must not linger in a shipped file.
  assert.doesNotMatch(example, /WORKSPACE_NAME|WORKSPACE_END|cmux/, "cmux-era keys are gone");
});
