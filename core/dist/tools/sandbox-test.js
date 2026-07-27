// sandbox-test — P3-3: the containment suite. Mechanizes the P0-6 deterministic
// matrix against the walls the GENERATOR renders (not hand-built ones), so
// every template/generator change re-proves the wall in one command. Fabricates
// a throwaway project under $HOME (deliberately OUTSIDE the scratch allow-zones
// — a project under /private/tmp would ride the scratch door and fake a PASS),
// probes each rendered wall with real writes/reads/network, table output,
// nonzero exit on ANY deviation. Run before trusting any wrapped seat.
// PHASE-8 T6: platform-dispatched — the SAME probe matrix runs the Seatbelt
// wrap on macOS and the bwrap wrap on Linux (clause 4's 1:1 law).
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { findBwrap, renderBwrapArgs, writeProfile } from "../sandbox.js";
const execFileP = promisify(execFile);
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
async function runProbe(wrapArgv, probe) {
    let denied = false;
    let detail = "";
    try {
        await execFileP(wrapArgv[0], [...wrapArgv.slice(1), "bash", "-c", probe.cmd], { timeout: 20000 });
    }
    catch (e) {
        denied = true;
        detail =
            e instanceof Error
                ? (e.message.split("\n").find((l) => l.includes("not permitted") || l.includes("Permission denied") || l.includes("Read-only")) ?? "").trim()
                : "";
    }
    const pass = probe.expect === "deny" ? denied : !denied;
    return { profile: "", probe, pass, detail };
}
/** Render one spec's wall as the exec wrap argv for THIS platform. */
function wrapFor(spec, paths, profileDir) {
    if (process.platform === "darwin") {
        return [SANDBOX_EXEC, "-f", writeProfile(spec, paths, profileDir)];
    }
    const bwrap = findBwrap();
    return [bwrap, ...renderBwrapArgs(spec, paths).args];
}
async function main() {
    const platformOk = (process.platform === "darwin" && existsSync(SANDBOX_EXEC)) ||
        (process.platform === "linux" && findBwrap() !== undefined);
    if (!platformOk) {
        console.error(process.platform === "linux"
            ? "sandbox-test: requires bubblewrap on Linux — install it: sudo apt install bubblewrap"
            : "sandbox-test: requires macOS with /usr/bin/sandbox-exec, or Linux with bubblewrap");
        process.exit(2);
    }
    const home = homedir();
    // The brain is where this tool lives: core/{src|dist}/tools/ → three up.
    const brainArg = process.argv.indexOf("--brain");
    const brainRoot = brainArg !== -1 && process.argv[brainArg + 1]
        ? resolve(process.argv[brainArg + 1])
        : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    // Fabricated project + door target, both under HOME (write-walled zone).
    const work = mkdtempSync(join(home, ".crate-sbtest-"));
    const project = join(work, "proj");
    const doorDir = join(work, "door");
    mkdirSync(join(project, ".agents", "state"), { recursive: true });
    mkdirSync(doorDir, { recursive: true });
    symlinkSync(join(brainRoot, "bin"), join(project, ".agents", "bin"));
    writeFileSync(join(project, "existing.txt"), "containment probe target\n");
    // Localhost probe server (allow-default keeps network open — verify the
    // wall doesn't break the loopback path every seat's dev-server work needs).
    const server = createServer((_req, res) => res.end("ok"));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const paths = { brainRoot, projectRoot: project, home };
    const profileDir = mkdtempSync(join(tmpdir(), "crate2-sbtest-"));
    const specs = [
        { label: "readonly", spec: { seat: "readonly-probe", sandbox: "readonly", doors: [] } },
        { label: "standard", spec: { seat: "standard-probe", sandbox: "standard", doors: [] } },
        { label: "standard+door", spec: { seat: "door-probe", sandbox: "standard", doors: [doorDir] } },
    ];
    // The home-write escape target: ~/Desktop on macOS; home root on Linux
    // (a Linux box need not have a Desktop — ENOENT would fake a DENIED pass).
    const homeProbe = process.platform === "darwin" ? join(home, "Desktop", ".crate-sbtest-probe") : join(home, ".crate-sbtest-probe");
    const shared = [
        { name: "write home (escape)", cmd: `touch '${homeProbe}'`, expect: "deny" },
        { name: "write /usr/local", cmd: "touch /usr/local/.crate-sbtest-probe", expect: "deny" },
        { name: "write outside project (workdir)", cmd: `touch '${work}/escape-probe'`, expect: "deny" },
        { name: "write .agents/state", cmd: `touch '${project}/.agents/state/probe.md'`, expect: "allow" },
        { name: "scratch mktemp", cmd: "f=$(mktemp) && echo x > \"$f\"", expect: "allow" },
        { name: "read brain via .agents symlink", cmd: `ls '${project}/.agents/bin/' >/dev/null`, expect: "allow" },
        { name: "localhost fetch", cmd: `curl -fsS --max-time 5 http://127.0.0.1:${port}/ >/dev/null`, expect: "allow" },
    ];
    const perProfile = {
        readonly: [
            { name: "write inside project", cmd: `touch '${project}/probe.txt'`, expect: "deny" },
            { name: "append to project file", cmd: `echo x >> '${project}/existing.txt'`, expect: "deny" },
            ...shared,
        ],
        standard: [
            { name: "write inside project", cmd: `touch '${project}/probe.txt'`, expect: "allow" },
            { name: "write door dir (NO door declared)", cmd: `touch '${doorDir}/undeclared'`, expect: "deny" },
            ...shared,
        ],
        "standard+door": [
            { name: "write door dir (door declared)", cmd: `touch '${doorDir}/declared'`, expect: "allow" },
            { name: "write outside project (workdir)", cmd: `touch '${work}/escape-probe2'`, expect: "deny" },
        ],
    };
    const results = [];
    try {
        for (const { label, spec } of specs) {
            const wrapArgv = wrapFor(spec, paths, profileDir);
            for (const probe of perProfile[label]) {
                const r = await runProbe(wrapArgv, probe);
                r.profile = label;
                results.push(r);
                console.log(`[${label.padEnd(13)}] ${probe.name.padEnd(36)} ${probe.expect === "deny" ? "DENIED" : "ALLOWED"} ${r.pass ? "✓" : `✗ DEVIATION${r.detail ? ` (${r.detail})` : ""}`}`);
            }
        }
    }
    finally {
        server.close();
        rmSync(work, { recursive: true, force: true });
        rmSync(profileDir, { recursive: true, force: true });
        rmSync(homeProbe, { force: true }); // only exists on a deviation
    }
    const failures = results.filter((r) => !r.pass);
    console.log(`SUMMARY: ${results.length} probes, ${failures.length} deviation(s).` +
        (failures.length ? " THE WALL IS NOT TRUSTWORTHY — fix before wrapping seats." : " Containment matrix green."));
    process.exit(failures.length ? 1 : 0);
}
await main();
//# sourceMappingURL=sandbox-test.js.map