// Flaw 2 (Adam's battle test, 2026-08-10): crew portability was hand-tooling
// — getting agents onto Superman meant hand-copying files over scp. `crate
// crew export` bundles the PORTABLE crew config into one 0600 file; `crate
// crew import` applies it on the target machine.
//
// DOCTRINE: CLAUDE CREDENTIALS ARE NEVER BUNDLED. Claude Code's sign-in is
// interactive-only (keychain-backed on macOS — a copied token breaks on the
// target and teaches a credential-copying habit). The import summary says so
// and points at the interactive login instead.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
/** Home-relative files worth carrying. Absent files are skipped, honestly. */
export const CREW_FILES = [
    ".pi/agent/auth.json",
    ".pi/agent/models.json",
    ".pi/agent/models-store.json",
    ".codex/auth.json",
    ".codex/config.toml",
];
export function buildCrewBundle(home, now = () => new Date().toISOString()) {
    const files = {};
    const carried = [];
    const skipped = [];
    for (const rel of CREW_FILES) {
        const abs = join(home, rel);
        if (!existsSync(abs)) {
            skipped.push(rel);
            continue;
        }
        files[rel] = readFileSync(abs).toString("base64");
        carried.push(rel);
    }
    return { bundle: { crateCrewBundle: 1, exportedAt: now(), files }, carried, skipped };
}
export function writeCrewBundle(path, bundle) {
    writeFileSync(path, JSON.stringify(bundle, null, 1));
    chmodSync(path, 0o600); // it holds API keys — owner-only from the first byte
}
/** Apply a bundle to a home. Refuses anything that isn't a real crew bundle
 * or tries to write outside the known crew paths (a hostile file must not
 * become a filesystem write primitive). */
export function applyCrewBundle(home, raw) {
    let bundle;
    try {
        bundle = JSON.parse(raw);
    }
    catch {
        throw new Error("not a crew bundle (unparseable JSON)");
    }
    if (bundle.crateCrewBundle !== 1 || typeof bundle.files !== "object" || bundle.files === null) {
        throw new Error("not a crew bundle (missing marker) — was this file made by `crate crew export`?");
    }
    const allowed = new Set(CREW_FILES);
    const written = [];
    for (const [rel, b64] of Object.entries(bundle.files)) {
        if (!allowed.has(rel))
            throw new Error(`bundle names a path outside the crew set (${rel}) — refusing the whole file`);
        const abs = join(home, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, Buffer.from(String(b64), "base64"));
        chmodSync(abs, 0o600);
        written.push(rel);
    }
    return { written };
}
//# sourceMappingURL=crew.js.map