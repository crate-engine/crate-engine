// nmgate-ro-mount — the gate's worktree parent must be the WALL'S door, on
// every rig shape. The wall realpaths the project before expanding the coder's
// `../.nmgate-wt` door (wall.ts/launcher.ts -> expandDoor), but a pane shell
// keeps the LOGICAL $PWD, so on a rig reached through a symlinked parent dir
// (the standard Superman shape: ~/Repos/<rig> -> /mnt/data/projects/<rig>) the
// old derivation put the worktrees in the UNWALLED logical sibling and the
// gate hit EROFS mid-run. These tests drive the REAL bin/precheck.sh (fixture
// law: the shipped script, never a hand-simplified copy) through exactly that
// alias shape and pin the shell/wall agreement.
//
// This file ALSO pins the SCRIPT_DIR-stays-logical trap: the fixture's
// .agents/bin is a symlink into the engine (as attach creates), so a future
// `pwd -P` at precheck's SCRIPT_DIR step would resolve into the BRAIN, derive
// the engine's root as the "repo", fail to resolve the rig's `feat` ref, and
// fail these tests loudly.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { expandDoor } from "../src/sandbox.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scratch = mkdtempSync(join(tmpdir(), "crate2-nmparent-"));

/** A scratch rig at an EXACT path: git repo with a `feat` delta branch and the
 * REAL engine bin wired at .agents/bin (as attach's symlink does). */
function mkRigAt(rig: string): void {
  mkdirSync(join(rig, ".agents"), { recursive: true });
  symlinkSync(join(ROOT, "bin"), join(rig, ".agents", "bin"));
  writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
  const git = (...a: string[]) => execFileSync("git", a, { cwd: rig, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(rig, "README.md"), "# rig\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  git("checkout", "-qb", "feat");
  writeFileSync(join(rig, "feature.txt"), "the change\n");
  git("add", "-A");
  git("commit", "-qm", "feature");
  git("checkout", "-q", "main");
}

/** Run the real precheck.sh the way a pane does: relative script path, cwd AND
 * env PWD at the (possibly aliased) rig path — bash keeps the logical $PWD
 * when the inode matches, which is exactly the seat-shell condition. */
function gate(cwd: string): { out: string; code: number } {
  try {
    return {
      out: execFileSync("bash", [".agents/bin/precheck.sh", "feat"], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, PWD: cwd },
        timeout: 120_000,
      }),
      code: 0,
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? 1 };
  }
}

test("symlinked-parent rig: the worktree parent is the REAL sibling — the exact door the wall binds", () => {
  const realDir = join(scratch, "real");
  const rig = join(realDir, "rig");
  mkRigAt(rig);
  // The Superman shape: the rig is reached through an aliased PARENT dir.
  const aliasDir = join(scratch, "alias");
  symlinkSync(realDir, aliasDir);
  const aliasRig = join(aliasDir, "rig");

  const r = gate(aliasRig);
  assert.equal(r.code, 0, r.out);

  // expandDoor over the realpath'd project is precisely what wall.ts:123 /
  // launcher.ts (realProject) feed the wall — the shell/wall agreement pin.
  const door = expandDoor("../.nmgate-wt", {
    brainRoot: ROOT,
    projectRoot: realpathSync(aliasRig),
    home: homedir(),
  });
  assert.ok(
    r.out.includes(`precheck: worktree parent -> ${door}`),
    `expected the wall's door ${door} in:\n${r.out}`,
  );
  // ...and NOT the unwalled logical sibling the old `pwd` derivation produced.
  assert.ok(
    !r.out.includes(join(aliasDir, ".nmgate-wt")),
    `worktree parent must not be the alias sibling:\n${r.out}`,
  );
});

test("unwritable real sibling: precheck refuses LOUDLY at stage 0 — no /tmp improvisation", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("running as root — mode 0555 would not block writes");
    return;
  }
  const parentDir = join(scratch, "ro");
  const rig = join(parentDir, "rig");
  mkRigAt(rig);
  // Freeze the REAL sibling read-only before the gate can mkdir/probe it.
  const roParent = join(parentDir, ".nmgate-wt");
  mkdirSync(roParent);
  chmodSync(roParent, 0o555);
  t.after(() => chmodSync(roParent, 0o755));

  const r = gate(rig);
  assert.equal(r.code, 2, r.out);
  const door = join(dirname(realpathSync(rig)), ".nmgate-wt");
  assert.ok(r.out.includes(door), `refusal must name the resolved parent ${door}:\n${r.out}`);
  assert.match(r.out, /do NOT replicate the gate in \/tmp/);
});
