// Open Project doors (PDR dev/pdr/open-project-doors.md, 2026-09-13): the
// engine FINDS a person's projects so they pick from a list instead of walking
// a folder tree — and reads their SSH config so "which computer?" is a click.
// Pure and bounded: roots only, one level deep, capped, never a crawl.
import { existsSync, lstatSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { missingSeeds } from "./attach.js";
export function projectState(dir, engineDir) {
    const agents = join(dir, ".agents");
    if (!existsSync(join(agents, "rig.conf")))
        return "new";
    for (const part of ["bin", "config"]) {
        const link = join(agents, part);
        try {
            const st = lstatSync(link);
            if (!st.isSymbolicLink())
                return "heal"; // v1 copies — attach refuses to clobber; still not "ready"
            if (readlinkSync(link) !== join(engineDir, part) || !existsSync(link))
                return "heal";
        }
        catch {
            return "heal";
        }
    }
    // CE-178: links right but the state dir predates this engine (no session.md
    // …) — attach's additive seed still has work to do, so it is not "ready".
    if (missingSeeds(join(engineDir, "templates", "state"), join(agents, "state")).length)
        return "heal";
    return "ready";
}
function isProjectDir(dir) {
    return existsSync(join(dir, ".git")) || existsSync(join(dir, ".agents", "rig.conf"));
}
/**
 * The list a person picks from: registered (recent) projects first, newest
 * focus first; then every project folder one level under each root, A–Z.
 * Hidden folders, files and non-projects are skipped. `max` bounds the scan.
 */
export function discoverProjects(opts) {
    const max = opts.max ?? 200;
    const out = [];
    const seen = new Set();
    const recents = [...opts.recents].sort((a, b) => (b.focusedAt ?? 0) - (a.focusedAt ?? 0));
    for (const r of recents) {
        if (seen.has(r.path) || !existsSync(r.path))
            continue;
        seen.add(r.path);
        out.push({
            name: basename(r.path),
            path: r.path,
            state: projectState(r.path, opts.engineDir),
            ...(r.focusedAt !== undefined ? { lastOpened: r.focusedAt } : {}),
        });
    }
    const found = [];
    for (const root of [...new Set(opts.roots)]) {
        let names;
        try {
            names = readdirSync(root);
        }
        catch {
            continue;
        }
        for (const n of names.sort((a, b) => a.localeCompare(b))) {
            if (n.startsWith("."))
                continue;
            const p = join(root, n);
            if (seen.has(p))
                continue;
            try {
                if (!statSync(p).isDirectory())
                    continue;
            }
            catch {
                continue;
            }
            if (!isProjectDir(p))
                continue;
            seen.add(p);
            found.push({ name: n, path: p, state: projectState(p, opts.engineDir) });
            if (out.length + found.length >= max)
                break;
        }
    }
    return [...out, ...found].slice(0, max);
}
/** `Host` names from an ssh config (wildcards and negations skipped), each
 * with its HostName when the block declares one. */
export function parseSshHosts(text) {
    const out = [];
    let current = [];
    for (const raw of text.split("\n")) {
        const line = raw.replace(/#.*$/, "").trim();
        if (!line)
            continue;
        const m = line.match(/^(\S+)\s*[=\s]\s*(.+)$/);
        if (!m)
            continue;
        const key = m[1].toLowerCase();
        const val = m[2].trim();
        if (key === "host") {
            current = val
                .split(/\s+/)
                .filter((n) => n && !/[*?!]/.test(n))
                .map((name) => ({ name }));
            out.push(...current);
        }
        else if (key === "match") {
            current = [];
        }
        else if (key === "hostname") {
            for (const e of current)
                e.hostName = val;
        }
    }
    return out;
}
/** Fold aliases that resolve to the same HostName into ONE computer (superman
 * / superman-wifi / superman-ts are one box, not three strangers). Entries
 * without a HostName stand alone. Declaration order is kept. */
export function foldSshHosts(entries) {
    const out = [];
    const byHost = new Map();
    for (const e of entries) {
        const key = e.hostName ? `hn:${e.hostName}` : `nm:${e.name}`;
        // an alias whose HostName IS another alias's name (Host a → HostName b) folds under b
        const existing = byHost.get(key) ?? (e.hostName ? byHost.get(`nm:${e.hostName}`) : undefined);
        if (existing) {
            if (!existing.aliases.includes(e.name))
                existing.aliases.push(e.name);
            byHost.set(`nm:${e.name}`, existing); // a later block naming THIS alias as its HostName folds too
            continue;
        }
        const c = { name: e.name, aliases: [e.name], ...(e.hostName ? { hostName: e.hostName } : {}) };
        out.push(c);
        byHost.set(key, c);
        byHost.set(`nm:${e.name}`, c);
    }
    return out;
}
//# sourceMappingURL=discover.js.map