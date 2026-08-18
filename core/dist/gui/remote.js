// remote.ts — the Mac side of the Linux headless server (PDR
// dev/pdr/linux-headless-server.md). `crate open --remote <host>` reads the
// server's ~/.crate/app-url over ssh, tunnels its port to the same local
// port, and opens the local app window on the tunneled URL. These are the
// PURE plans (unit-tested); cli.ts owns the ssh/spawn side effects.
/** Parse a ~/.crate/app-url payload (one tokened 127.0.0.1 URL). */
export function parseAppUrl(text) {
    const line = text.trim().split("\n")[0]?.trim() ?? "";
    let u;
    try {
        u = new URL(line);
    }
    catch {
        return undefined;
    }
    const token = u.searchParams.get("token") ?? "";
    // The server binds loopback only (that IS the security posture — the ssh
    // tunnel is the transport); anything else in the file is not our server.
    if (u.hostname !== "127.0.0.1" || !u.port || token === "")
        return undefined;
    // pv = the preview-proxy port(s) (satellites, 2026-08-13; a comma LIST
    // since the lifecycle PDR — one proxy per workspace). Absent on servers
    // that predate it; a single value stays valid (old handshakes).
    const pv = (u.searchParams.get("pv") ?? "").split(",").filter((x) => /^\d+$/.test(x));
    return {
        port: u.port,
        token,
        ...(pv.length > 0 ? { previewPort: pv[0], previewPorts: pv } : {}),
    };
}
/** The tunnel + window plan for a parsed remote app. Same ports locally —
 * deterministic, and the token in the URL keeps a collision honest (a
 * different local app on that port won't answer with our token). */
export function tunnelPlan(app, host) {
    const p = app.port;
    const pvs = app.previewPorts ?? (app.previewPort ? [app.previewPort] : []);
    return {
        tunnelArgv: [
            "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-N",
            "-L", `${p}:127.0.0.1:${p}`,
            // every workspace's preview proxy rides the same tunnel (satellites +
            // Launch in Chrome reach each preview through the connection the app has)
            ...pvs.flatMap((pv) => ["-L", `${pv}:127.0.0.1:${pv}`]),
            host,
        ],
        probeUrl: `http://127.0.0.1:${p}/health?token=${app.token}`,
        teamUrl: `http://127.0.0.1:${p}/team?token=${app.token}`,
    };
}
//# sourceMappingURL=remote.js.map