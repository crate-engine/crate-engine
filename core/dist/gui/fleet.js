// THE FLEET RAIL, F1 — the fleet brain (PDR dev/pdr/fleet-rail.md).
// The LOCAL engine aggregates the whole fleet: its own workspaces + every
// remembered remote host's, fetched server-side through OWNED ssh tunnels
// (the ssh asymmetry means no page can do this — the window machine's hub
// is the only vantage that sees everything). The shells render /api/fleet
// natively and switch the webview; this module never touches lifecycle.
//
// Tunnel doctrine (decision 4): tunnels are SUPERVISED children now —
// dialed on demand, health-probed, re-dialed on failure/wake, dead with
// the hub — never the detached orphans crate open --remote leaves behind.
// One tunnel per host. An ASLEEP HOST MUST NEVER HANG THE MENU: fleet
// reads are cache-first with short timeouts; dialing happens in the
// background or on an explicit connect.
import { spawn } from "node:child_process";
import { addRemote, appUrlArgv, bootArgv, listRemotes } from "./remotes.js";
import { parseAppUrl, tunnelPlan } from "./remote.js";
export function defaultFleetExec() {
    return {
        async run(cmd, args, timeoutMs) {
            const { execFile } = await import("node:child_process");
            const { promisify } = await import("node:util");
            const r = await promisify(execFile)(cmd, args, { timeout: timeoutMs, encoding: "utf8" });
            return { stdout: r.stdout, stderr: r.stderr };
        },
        spawnTunnel(args) {
            const c = spawn("ssh", args, { stdio: "ignore" }); // OWNED: dies with the hub
            return { kill: () => c.kill("SIGTERM"), alive: () => c.exitCode === null && !c.killed };
        },
        async fetchJson(url, timeoutMs) {
            const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
            return (await r.json());
        },
        async probeHttp(url, timeoutMs) {
            try {
                await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
                return true;
            }
            catch {
                return false;
            }
        },
    };
}
const links = new Map();
/** Tests only: drop all links (kills owned tunnels). */
export function clearFleetLinks() {
    for (const l of links.values())
        l.tunnel?.kill();
    links.clear();
}
function classifyDialFailure(e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stderr = e.stderr ?? "";
    const text = `${msg}\n${stderr}`.toLowerCase();
    if (/timed out|timeout|connection refused|no route to host|host is down|operation timed out/.test(text)) {
        return { state: "asleep", note: "asleep or offline — if this host naps overnight, that's all this is. Retry when it's awake." };
    }
    return { state: "failed", note: `unreachable — ${(stderr.trim().split("\n").pop() || msg).slice(0, 160)}` };
}
/** Dial one host: read its app-url over ssh (booting the engine there if
 * absent), stand up the OWNED tunnel, probe it. Coalesced — concurrent
 * callers share one dial. Never throws; failure lands in the link state. */
export async function ensureLink(host, exec = defaultFleetExec()) {
    let link = links.get(host);
    if (!link) {
        link = { host, state: "unknown" };
        links.set(host, link);
    }
    // connected + tunnel child alive + a recent probe = done
    if (link.state === "connected" && link.tunnel?.alive() && link.app) {
        if (await exec.probeHttp(`http://127.0.0.1:${link.app.port}/api/version?token=${link.app.token}`, 1500))
            return link;
        link.state = "unknown"; // tunnel up but nobody answering — re-dial below
    }
    if (link.dialing) {
        await link.dialing;
        return link;
    }
    const l = link;
    l.state = "connecting";
    l.dialing = (async () => {
        try {
            let out = "";
            try {
                out = (await exec.run("ssh", appUrlArgv(host), 8_000)).stdout;
            }
            catch (e) {
                // no handshake — the engine may simply be down there: boot it, then re-read
                void e;
                await exec.run("ssh", bootArgv(host), 120_000);
                out = (await exec.run("ssh", appUrlArgv(host), 8_000)).stdout;
            }
            const app = parseAppUrl(out);
            if (!app)
                throw new Error(`no app url on ${host} — is Crate installed there?`);
            const plan = tunnelPlan(app, host);
            l.tunnel?.kill();
            l.tunnel = exec.spawnTunnel(plan.tunnelArgv);
            const probeUrl = `http://127.0.0.1:${app.port}/api/version?token=${app.token}`;
            let up = await exec.probeHttp(probeUrl, 1500); // probe FIRST — a warm tunnel connects instantly
            const t0 = Date.now();
            while (!up && Date.now() - t0 < 10_000) {
                await new Promise((r) => setTimeout(r, 400));
                up = await exec.probeHttp(probeUrl, 1500);
            }
            if (!up)
                throw new Error(`the tunnel to ${host}:${app.port} did not come up — is local port ${app.port} taken?`);
            l.app = { port: app.port, token: app.token };
            l.state = "connected";
            l.note = undefined;
        }
        catch (e) {
            const c = classifyDialFailure(e);
            l.state = c.state;
            l.note = c.note;
            l.tunnel?.kill();
            l.tunnel = undefined;
        }
        finally {
            l.dialing = undefined;
        }
    })();
    await l.dialing;
    return l;
}
/** Refresh one CONNECTED link's remote facts (sha + workspaces) through the
 * tunnel — short timeouts, cache honored, never throws. */
async function refreshRemoteRows(link, exec) {
    if (link.state !== "connected" || !link.app)
        return;
    if (link.fetchedAt !== undefined && Date.now() - link.fetchedAt < 5_000)
        return; // cache
    const base = `http://127.0.0.1:${link.app.port}`;
    const tok = link.app.token;
    try {
        const v = (await exec.fetchJson(`${base}/api/version?token=${tok}`, 2_000));
        link.engineSha = v.loadedSha;
        const w = (await exec.fetchJson(`${base}/api/workspaces?token=${tok}`, 2_000));
        link.workspaces = (w.workspaces ?? []).map((x) => ({
            name: x.name,
            path: x.path,
            ...(x.desired !== undefined ? { desired: x.desired } : {}),
            ...(x.liveSeats !== undefined ? { liveSeats: x.liveSeats } : {}),
            url: `${base}/team?token=${tok}&project=${encodeURIComponent(x.path)}`,
        }));
        link.fetchedAt = Date.now();
    }
    catch {
        // the tunnel answered the probe but the read failed — keep last-known
        // rows (cache-first honesty); the next connect re-proves the link
        link.state = "unknown";
        link.note = "stopped answering through the tunnel — Retry reconnects";
    }
}
/**
 * The whole fleet, cache-first: the local row is always fresh; remote rows
 * render last-known state while unknown hosts get a BACKGROUND dial kicked
 * (fire-and-forget) so the next open is populated. This function itself
 * never dials and never blocks on ssh — the menu must open instantly.
 */
export function fleetView(deps, exec = defaultFleetExec()) {
    const hosts = [
        {
            host: deps.hostLabel,
            local: true,
            state: "connected",
            engineSha: deps.hubSha,
            skew: false,
            workspaces: deps.localWorkspaces.map((w) => ({
                ...w,
                url: `${deps.hubOrigin}/team?token=${deps.hubToken}&project=${encodeURIComponent(w.path)}`,
            })),
            cockpitUrl: `${deps.hubOrigin}/team?token=${deps.hubToken}`,
        },
    ];
    for (const r of listRemotes(deps.home)) {
        let link = links.get(r.host);
        if (!link) {
            link = { host: r.host, state: "unknown" };
            links.set(r.host, link);
            void ensureLink(r.host, exec).then(() => refreshRemoteRows(links.get(r.host), exec)); // background — never blocks this read
        }
        else if (link.state === "connected") {
            void refreshRemoteRows(link, exec); // cache-first refresh in the background
        }
        hosts.push({
            host: r.host,
            local: false,
            state: link.state,
            ...(link.note !== undefined ? { note: link.note } : {}),
            ...(link.engineSha !== undefined ? { engineSha: link.engineSha } : {}),
            skew: link.engineSha !== undefined && link.engineSha !== deps.hubSha,
            workspaces: link.workspaces ?? [],
            ...(link.app ? { cockpitUrl: `http://127.0.0.1:${link.app.port}/team?token=${link.app.token}` } : {}),
        });
    }
    return { hubSha: deps.hubSha, hosts };
}
/** The explicit connect (POST /api/fleet/connect and the menu's Retry):
 * dial NOW, refresh rows, answer with the row. */
export async function connectHost(host, deps, exec = defaultFleetExec()) {
    const link = await ensureLink(host, exec);
    await refreshRemoteRows(link, exec);
    // the S1 law, verbatim: connected once = remembered forever (the card's
    // chips and the fleet's rows read the same registry)
    if (link.state === "connected")
        addRemote(deps.home, host);
    return {
        host,
        local: false,
        state: link.state,
        ...(link.note !== undefined ? { note: link.note } : {}),
        ...(link.engineSha !== undefined ? { engineSha: link.engineSha } : {}),
        skew: link.engineSha !== undefined && link.engineSha !== deps.hubSha,
        workspaces: link.workspaces ?? [],
        ...(link.app ? { cockpitUrl: `http://127.0.0.1:${link.app.port}/team?token=${link.app.token}` } : {}),
    };
}
//# sourceMappingURL=fleet.js.map