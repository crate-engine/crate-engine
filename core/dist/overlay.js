// P4-5: the update overlay (§2.6, MVP-blocking). ~/.crate/overlay/ mirrors
// brain paths; at launch the launcher materializes a COMPOSED view of the
// brain and seats consume only that view. The pristine clone is never edited.
//
// Marker syntax (pinned — the Control Room refinement):
//   The overlay file's FIRST LINE selects the mode, exactly:
//     <!-- crate-overlay: append -->     (markdown/HTML comment form)
//     # crate-overlay: append            (hash-comment form: yaml/conf/shell)
//   With a marker: composed = brain file + "\n" + the overlay file WITHOUT its
//   marker line (append-or-replace's APPEND). Without a marker: the overlay
//   file REPLACES the brain file wholesale. The marker never reaches a seat.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync, } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse, stringify } from "yaml";
const APPEND_MARKERS = ["<!-- crate-overlay: append -->", "# crate-overlay: append"];
/** Files inside overlay/ that are overlay MACHINERY, not entries. */
const OVERLAY_INTERNAL = new Set([".base-hashes.yaml"]);
export function overlayMode(overlayFileText) {
    const firstLine = overlayFileText.split("\n", 1)[0].trim();
    return APPEND_MARKERS.includes(firstLine) ? "append" : "replace";
}
/** Compose one file: brain base text + overlay text per the pinned marker law. */
export function composeFile(baseText, overlayText) {
    if (overlayMode(overlayText) === "replace")
        return overlayText;
    const body = overlayText.split("\n").slice(1).join("\n");
    const base = baseText ?? "";
    return base.endsWith("\n") || base === "" ? base + body : `${base}\n${body}`;
}
/** Every overlay entry under overlayDir (recursive; machinery + dotfiles skipped). */
export function listOverlayEntries(overlayDir) {
    const out = [];
    if (!existsSync(overlayDir))
        return out;
    const walk = (dir) => {
        for (const name of readdirSync(dir, { withFileTypes: true })) {
            if (name.name.startsWith("."))
                continue;
            const abs = join(dir, name.name);
            if (name.isDirectory())
                walk(abs);
            else if (name.isFile()) {
                if (OVERLAY_INTERNAL.has(name.name))
                    continue;
                out.push({
                    relPath: relative(overlayDir, abs),
                    mode: overlayMode(readFileSync(abs, "utf8")),
                });
            }
        }
    };
    walk(overlayDir);
    return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}
const baseHashFile = (overlayDir) => join(overlayDir, ".base-hashes.yaml");
export function hashFile(absPath) {
    if (!existsSync(absPath))
        return null;
    return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}
export function readBaseHashes(overlayDir) {
    const f = baseHashFile(overlayDir);
    if (!existsSync(f))
        return {};
    const raw = parse(readFileSync(f, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
}
export function writeBaseHashes(overlayDir, hashes) {
    mkdirSync(overlayDir, { recursive: true });
    writeFileSync(baseHashFile(overlayDir), `# managed by crate2 (P4-6): sha256 of the brain base file each overlay entry\n# was recorded against; updates flag entries whose base changed. Do not edit.\n${stringify(hashes)}`);
}
// ── the composed brain view ──────────────────────────────────────────────────
/**
 * Materialize the composed view: a shadow root where every top-level brain
 * entry is a symlink to the pristine clone, expanded copy-on-write along each
 * overlay entry's path, with the overlay entry itself a REAL composed file.
 * Seats consume only this root. Fast path: no overlay entries → the pristine
 * brainRoot itself is returned (zero cost, nothing materialized).
 *
 * Also records first-seen base hashes for entries that have none yet (the
 * written-against baseline the P4-6 compatibility pass compares to).
 */
export function composedBrainRoot(brainRoot, overlayDir, outDir) {
    const entries = listOverlayEntries(overlayDir);
    if (entries.length === 0)
        return brainRoot;
    const shadow = join(outDir, "brain");
    mkdirSync(shadow, { recursive: true });
    for (const name of readdirSync(brainRoot)) {
        if (name === ".git")
            continue;
        linkInto(shadow, brainRoot, name);
    }
    const hashes = readBaseHashes(overlayDir);
    let hashesDirty = false;
    for (const e of entries) {
        const parts = e.relPath.split(sep);
        // Expand symlinked ancestors into real dirs (copy-on-write).
        let realDir = shadow;
        let brainDir = brainRoot;
        for (const part of parts.slice(0, -1)) {
            brainDir = join(brainDir, part);
            realDir = expandDir(realDir, brainDir, part);
        }
        const leaf = parts[parts.length - 1];
        const target = join(realDir, leaf);
        if (existsSync(target) && lstatSync(target).isSymbolicLink())
            unlinkSync(target);
        const basePath = join(brainRoot, e.relPath);
        const overlayText = readFileSync(join(overlayDir, e.relPath), "utf8");
        const baseText = existsSync(basePath) ? readFileSync(basePath, "utf8") : undefined;
        writeFileSync(target, composeFile(baseText, overlayText));
        if (!(e.relPath in hashes)) {
            hashes[e.relPath] = hashFile(basePath);
            hashesDirty = true;
        }
    }
    if (hashesDirty)
        writeBaseHashes(overlayDir, hashes);
    return shadow;
}
/** Ensure shadowDir/name is a REAL directory mirroring brainDir (children symlinked). */
function expandDir(shadowDir, brainDir, name) {
    const target = join(shadowDir, name);
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
        const resolved = readlinkSync(target);
        unlinkSync(target);
        mkdirSync(target);
        for (const child of readdirSync(resolved))
            linkInto(target, resolved, child);
    }
    else if (!existsSync(target)) {
        mkdirSync(target, { recursive: true });
        if (existsSync(brainDir))
            for (const child of readdirSync(brainDir))
                linkInto(target, brainDir, child);
    }
    return target;
}
function linkInto(dir, sourceDir, name) {
    const link = join(dir, name);
    if (!existsSync(link) && !isLink(link))
        symlinkSync(join(sourceDir, name), link);
}
function isLink(p) {
    try {
        return lstatSync(p).isSymbolicLink();
    }
    catch {
        return false;
    }
}
/** The user's overlay dir for a HOME (single source for callers). */
export function overlayDirFor(home) {
    return join(home, ".crate", "overlay");
}
//# sourceMappingURL=overlay.js.map