// THE FLEET RAIL, F1 (PDR dev/pdr/fleet-rail.md) — the fleet brain, driven
// hermetically through an injected FleetExec. The laws under test: the menu
// read NEVER blocks on ssh (cache-first; asleep hosts are calm states);
// tunnels are OWNED and die with the hub; skew is shown, never acted on;
// a pre-lifecycle remote degrades to name-only rows.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  clearFleetLinks,
  connectHost,
  ensureLink,
  fleetView,
  type FleetExec,
} from "../src/gui/fleet.js";
import { addRemote } from "../src/gui/remotes.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function mkHome(): string {
  const home = mkdtempSync(join(tmpdir(), "fleet-home-"));
  mkdirSync(join(home, ".crate"), { recursive: true });
  return home;
}

/** A fake superman: answers ssh reads, records tunnel spawns, serves JSON. */
function fakeExec(overrides: Partial<FleetExec> & { appUrl?: string } = {}) {
  const calls: string[] = [];
  const tunnels: Array<{ argv: string[]; killed: boolean }> = [];
  const exec: FleetExec = {
    run: overrides.run ?? (async (_cmd, args) => {
      calls.push(args.join(" "));
      if (args.join(" ").includes("cat ~/.crate/app-url")) {
        return { stdout: (overrides.appUrl ?? "http://127.0.0.1:45001/team?token=rtok&pv=45900") + "\n", stderr: "" };
      }
      return { stdout: "ok", stderr: "" };
    }),
    spawnTunnel: (argv) => {
      const t = { argv, killed: false };
      tunnels.push(t);
      return { kill: () => { t.killed = true; }, alive: () => !t.killed };
    },
    fetchJson: overrides.fetchJson ?? (async (url) => {
      if (url.includes("/api/version")) return { loadedSha: "beefcafe" };
      if (url.includes("/api/workspaces"))
        return { workspaces: [{ name: "jdm", path: "/mnt/p/jdm", desired: "running", liveSeats: 5 }] };
      return {};
    }),
    probeHttp: overrides.probeHttp ?? (async () => true),
  };
  return { exec, calls, tunnels };
}

const HUB = { home: "", hubSha: "aaaa111", hubOrigin: "http://127.0.0.1:5000", hubToken: "ltok", hostLabel: "This Mac", localWorkspaces: [] as never[] };

test("ensureLink dials: app-url over ssh → OWNED tunnel with the deterministic plan → probe → connected", async () => {
  clearFleetLinks();
  const { exec, tunnels } = fakeExec();
  const link = await ensureLink("superman", exec);
  assert.equal(link.state, "connected");
  assert.equal(tunnels.length, 1);
  const argv = tunnels[0]!.argv.join(" ");
  assert.match(argv, /-L 45001:127\.0\.0\.1:45001/, "the app port forwards");
  assert.match(argv, /-L 45900:127\.0\.0\.1:45900/, "the preview proxy rides the same tunnel");
  clearFleetLinks();
  assert.equal(tunnels[0]!.killed, true, "owned tunnels die with the hub — never orphans");
});

test("a host with no handshake gets BOOTED over ssh, then read again (the crate open --remote leg, owned)", async () => {
  clearFleetLinks();
  let asked = 0;
  const { exec, calls } = fakeExec({
    run: async (_cmd, args) => {
      const line = args.join(" ");
      calls.push(line);
      if (line.includes("cat ~/.crate/app-url")) {
        asked += 1;
        if (asked === 1) throw new Error("cat: no such file");
        return { stdout: "http://127.0.0.1:45001/team?token=rtok\n", stderr: "" };
      }
      return { stdout: "ok", stderr: "" };
    },
  });
  const link = await ensureLink("superman", exec);
  assert.equal(link.state, "connected");
  assert.ok(calls.some((c) => c.includes('"$HOME/.local/bin/crate" open')), "the engine was booted there first");
  clearFleetLinks();
});

test("an asleep host is a CALM state with a plain note — and the failed tunnel never lingers", async () => {
  clearFleetLinks();
  const { exec, tunnels } = fakeExec({
    run: async () => {
      throw Object.assign(new Error("ssh: connect to host superman: Operation timed out"), { stderr: "Operation timed out" });
    },
  });
  const link = await ensureLink("superman", exec);
  assert.equal(link.state, "asleep");
  assert.match(link.note ?? "", /asleep or offline/, "superman's 22:30 nap is a state, not an error");
  assert.ok(tunnels.every((t) => t.killed), "no half-dialed tunnel survives a failure");
  clearFleetLinks();
});

test("fleetView is CACHE-FIRST and never blocks: unknown remotes render instantly and get a background dial", async () => {
  clearFleetLinks();
  const home = mkHome();
  try {
    addRemote(home, "superman");
    const { exec } = fakeExec();
    const t0 = Date.now();
    const v1 = fleetView({ ...HUB, home }, exec);
    assert.ok(Date.now() - t0 < 200, "the menu read returns instantly — no ssh in its path");
    assert.equal(v1.hosts[0]!.local, true, "the local row leads");
    assert.equal(v1.hosts[1]!.state, "connecting", "the background dial was kicked, honestly labeled");
    await new Promise((r) => setTimeout(r, 100)); // let the background dial + row fetch land
    const v2 = fleetView({ ...HUB, home }, exec);
    const sup = v2.hosts[1]!;
    assert.equal(sup.state, "connected");
    assert.equal(sup.engineSha, "beefcafe");
    assert.equal(sup.skew, true, "sha differs from the hub → the amber marker, display-only");
    assert.equal(sup.workspaces[0]!.name, "jdm");
    assert.equal(sup.workspaces[0]!.liveSeats, 5);
    assert.match(sup.workspaces[0]!.url, /^http:\/\/127\.0\.0\.1:45001\/team\?token=rtok&project=/, "the click loads the tunneled cockpit");
  } finally {
    clearFleetLinks();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a pre-lifecycle remote degrades to name-only rows — display the truth, never guess", async () => {
  clearFleetLinks();
  const home = mkHome();
  try {
    addRemote(home, "oldbox");
    const { exec } = fakeExec({
      fetchJson: async (url) => {
        if (url.includes("/api/version")) return { loadedSha: "old00000" };
        return { workspaces: [{ name: "legacy", path: "/p/legacy" }] }; // no desired/liveSeats
      },
    });
    const row = await connectHost("oldbox", { hubSha: "aaaa111", home }, exec);
    assert.equal(row.state, "connected");
    assert.equal(row.skew, true);
    assert.equal(row.workspaces[0]!.name, "legacy");
    assert.equal(row.workspaces[0]!.desired, undefined, "no invented lifecycle facts");
    assert.equal(row.workspaces[0]!.liveSeats, undefined);
  } finally {
    clearFleetLinks();
    rmSync(home, { recursive: true, force: true });
  }
});

// ── the shells carry the menu (string pins, the linux-shell precedent) ──────

test("both shells ship the Fleet menu wired to the hub, and ensure the local hub even on a remote window", () => {
  const swift = readFileSync(join(ROOT, "apps", "mac-shell", "main.swift"), "utf8");
  assert.ok(swift.includes("/api/fleet"), "mac: menu reads the hub");
  assert.ok(swift.includes("menuNeedsUpdate"), "mac: rows rebuilt on open");
  assert.ok(swift.includes('launchEngine(remote: "")'), "mac: the local hub is ensured even when the window is remote");
  assert.match(swift, /engine differs — Update menu fans out/, "mac: skew is honesty, not action");
  const py = readFileSync(join(ROOT, "apps", "linux-shell", "main.py"), "utf8");
  assert.ok(py.includes("/api/fleet"), "linux: menu reads the hub");
  assert.ok(py.includes("on_fleet_open"), "linux: rows rebuilt on open");
  assert.ok(py.includes('launch_engine("")'), "linux: the local hub is ensured even when the window is remote");
  assert.match(py, /engine differs — Update menu fans out/, "linux: skew is honesty, not action");
});
