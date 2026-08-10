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
    return { port: u.port, token };
}
/** The tunnel + window plan for a parsed remote app. Same port locally —
 * deterministic, and the token in the URL keeps a collision honest (a
 * different local app on that port won't answer with our token). */
export function tunnelPlan(app, host) {
    const p = app.port;
    return {
        tunnelArgv: ["-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-N", "-L", `${p}:127.0.0.1:${p}`, host],
        probeUrl: `http://127.0.0.1:${p}/health?token=${app.token}`,
        teamUrl: `http://127.0.0.1:${p}/team?token=${app.token}`,
    };
}
//# sourceMappingURL=remote.js.map