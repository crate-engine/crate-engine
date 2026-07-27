import { z } from "zod";
import type { Loadout, Seat } from "./manifest.js";
export interface Staffed {
    agent: string;
    /** "" means: let the interactive /login session pick (the pi adapter's rule). */
    model: string;
}
/** rig.conf uses v1's station prefixes; the seat ids are 2.0's. */
export declare const RIG_PREFIX: Record<Seat, string>;
/**
 * Parse shell-style KV assignments: `KEY="value"`, single quotes, bare values,
 * optional `export`, comments, and MULTIPLE assignments per line separated by
 * ";" (rig.conf.example writes `ORCH_AGENT="claude"; ORCH_MODEL="opus"`).
 */
export declare function parseRigConf(text: string): Record<string, string>;
declare const UserDefaultsSchema: z.ZodObject<{
    seats: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        agent: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        agent?: string | undefined;
        model?: string | undefined;
    }, {
        agent?: string | undefined;
        model?: string | undefined;
    }>>>;
    prefs: z.ZodOptional<z.ZodObject<{
        preview_provider: z.ZodOptional<z.ZodEnum<["none", "tailscale", "custom"]>>;
        brand: z.ZodOptional<z.ZodObject<{
            name: z.ZodOptional<z.ZodString>;
            accent: z.ZodOptional<z.ZodString>;
            bg: z.ZodOptional<z.ZodString>;
            fg: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            name?: string | undefined;
            accent?: string | undefined;
            bg?: string | undefined;
            fg?: string | undefined;
        }, {
            name?: string | undefined;
            accent?: string | undefined;
            bg?: string | undefined;
            fg?: string | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        preview_provider?: "custom" | "none" | "tailscale" | undefined;
        brand?: {
            name?: string | undefined;
            accent?: string | undefined;
            bg?: string | undefined;
            fg?: string | undefined;
        } | undefined;
    }, {
        preview_provider?: "custom" | "none" | "tailscale" | undefined;
        brand?: {
            name?: string | undefined;
            accent?: string | undefined;
            bg?: string | undefined;
            fg?: string | undefined;
        } | undefined;
    }>>;
}, "strict", z.ZodTypeAny, {
    seats: Record<string, {
        agent?: string | undefined;
        model?: string | undefined;
    }>;
    prefs?: {
        preview_provider?: "custom" | "none" | "tailscale" | undefined;
        brand?: {
            name?: string | undefined;
            accent?: string | undefined;
            bg?: string | undefined;
            fg?: string | undefined;
        } | undefined;
    } | undefined;
}, {
    seats?: Record<string, {
        agent?: string | undefined;
        model?: string | undefined;
    }> | undefined;
    prefs?: {
        preview_provider?: "custom" | "none" | "tailscale" | undefined;
        brand?: {
            name?: string | undefined;
            accent?: string | undefined;
            bg?: string | undefined;
            fg?: string | undefined;
        } | undefined;
    } | undefined;
}>;
export type UserDefaults = z.infer<typeof UserDefaultsSchema>;
/** ~/.crate/defaults.yaml — optional until Phase 4 builds the user tier. */
export declare function loadUserDefaults(home: string): UserDefaults | undefined;
/** Where a resolved staffing value came from (P4-1: provenance for `print`). */
export type StaffingSource = "rig.conf" | "user default" | "loadout floor" | "built-in";
export interface StaffedDetailed {
    agent: {
        value: string;
        source: StaffingSource;
    };
    model: {
        value: string;
        source: StaffingSource;
    };
}
/**
 * Precedence, most specific wins: rig.conf → user defaults → loadout floor.
 * A rig.conf key that EXISTS but is empty ("") is an explicit "let /login pick"
 * and is honored as-is — existence beats emptiness. Returns each value WITH
 * its source, so `crate2 print` can disclose where staffing came from.
 */
export declare function resolveSeatDetailed(seat: Seat, loadout: Pick<Loadout, "policy"> | undefined, sources: {
    rigConf?: Record<string, string>;
    userDefaults?: UserDefaults;
}): StaffedDetailed;
export declare function resolveSeat(seat: Seat, loadout: Pick<Loadout, "policy"> | undefined, sources: {
    rigConf?: Record<string, string>;
    userDefaults?: UserDefaults;
}): Staffed;
export {};
