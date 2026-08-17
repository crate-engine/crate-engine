import { z } from "zod";
export declare const SEATS: readonly ["orchestrator", "coder", "reviewer", "designer", "tester"];
export type Seat = (typeof SEATS)[number];
export declare const LoadoutSchema: z.ZodObject<{
    seat: z.ZodEnum<["orchestrator", "coder", "reviewer", "designer", "tester"]>;
    agent: z.ZodDefault<z.ZodEnum<["pi", "claude-code"]>>;
    binder: z.ZodString;
    append_system: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    skills: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    prompt_templates: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    extensions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        source: z.ZodString;
        kind: z.ZodEnum<["pi-extension", "mcp-adapter"]>;
        scope: z.ZodDefault<z.ZodEnum<["global", "project"]>>;
        mcp_servers: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strict", z.ZodTypeAny, {
        source: string;
        kind: "pi-extension" | "mcp-adapter";
        scope: "project" | "global";
        mcp_servers?: string[] | undefined;
    }, {
        source: string;
        kind: "pi-extension" | "mcp-adapter";
        scope?: "project" | "global" | undefined;
        mcp_servers?: string[] | undefined;
    }>, "many">>;
    cli_deps: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        check: z.ZodString;
        install: z.ZodOptional<z.ZodString>;
        heavy: z.ZodDefault<z.ZodBoolean>;
        /** Plain-words purpose, shown to the USER by the attach tooling box —
         * "what your <seat> seat uses this for" (run #7 clarity pass). */
        why: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        name: string;
        check: string;
        heavy: boolean;
        install?: string | undefined;
        why?: string | undefined;
    }, {
        name: string;
        check: string;
        install?: string | undefined;
        heavy?: boolean | undefined;
        why?: string | undefined;
    }>, "many">>;
    policy: z.ZodEffects<z.ZodObject<{
        tools: z.ZodString;
        thinking: z.ZodDefault<z.ZodEnum<["off", "minimal", "low", "medium", "high", "xhigh"]>>;
        default_model: z.ZodString;
        sandbox: z.ZodEnum<["readonly", "standard", "none"]>;
        network: z.ZodDefault<z.ZodBoolean>;
        sandbox_doors: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        permission_mode: z.ZodDefault<z.ZodEnum<["default", "bypassPermissions"]>>;
    }, "strict", z.ZodTypeAny, {
        tools: string;
        thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
        default_model: string;
        sandbox: "readonly" | "standard" | "none";
        network: boolean;
        sandbox_doors: string[];
        permission_mode: "default" | "bypassPermissions";
    }, {
        tools: string;
        default_model: string;
        sandbox: "readonly" | "standard" | "none";
        thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
        network?: boolean | undefined;
        sandbox_doors?: string[] | undefined;
        permission_mode?: "default" | "bypassPermissions" | undefined;
    }>, {
        tools: string;
        thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
        default_model: string;
        sandbox: "readonly" | "standard" | "none";
        network: boolean;
        sandbox_doors: string[];
        permission_mode: "default" | "bypassPermissions";
    }, {
        tools: string;
        default_model: string;
        sandbox: "readonly" | "standard" | "none";
        thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
        network?: boolean | undefined;
        sandbox_doors?: string[] | undefined;
        permission_mode?: "default" | "bypassPermissions" | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    seat: "orchestrator" | "coder" | "reviewer" | "designer" | "tester";
    agent: "pi" | "claude-code";
    binder: string;
    append_system: string[];
    skills: string[];
    prompt_templates: string[];
    extensions: {
        source: string;
        kind: "pi-extension" | "mcp-adapter";
        scope: "project" | "global";
        mcp_servers?: string[] | undefined;
    }[];
    cli_deps: {
        name: string;
        check: string;
        heavy: boolean;
        install?: string | undefined;
        why?: string | undefined;
    }[];
    policy: {
        tools: string;
        thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
        default_model: string;
        sandbox: "readonly" | "standard" | "none";
        network: boolean;
        sandbox_doors: string[];
        permission_mode: "default" | "bypassPermissions";
    };
}, {
    seat: "orchestrator" | "coder" | "reviewer" | "designer" | "tester";
    binder: string;
    policy: {
        tools: string;
        default_model: string;
        sandbox: "readonly" | "standard" | "none";
        thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
        network?: boolean | undefined;
        sandbox_doors?: string[] | undefined;
        permission_mode?: "default" | "bypassPermissions" | undefined;
    };
    agent?: "pi" | "claude-code" | undefined;
    append_system?: string[] | undefined;
    skills?: string[] | undefined;
    prompt_templates?: string[] | undefined;
    extensions?: {
        source: string;
        kind: "pi-extension" | "mcp-adapter";
        scope?: "project" | "global" | undefined;
        mcp_servers?: string[] | undefined;
    }[] | undefined;
    cli_deps?: {
        name: string;
        check: string;
        install?: string | undefined;
        heavy?: boolean | undefined;
        why?: string | undefined;
    }[] | undefined;
}>;
export type Loadout = z.infer<typeof LoadoutSchema>;
export declare class ManifestError extends Error {
}
/** Path of a seat's manifest inside the brain. */
export declare function loadoutPath(brainRoot: string, seat: Seat): string;
/**
 * Load + validate a seat's loadout manifest from the brain.
 * Every failure is a ManifestError whose message says what to fix, in plain words.
 */
export declare function loadLoadout(brainRoot: string, seat: Seat): Loadout;
export declare function projectDoorsPath(projectRoot: string): string;
/**
 * The project's own additive doors for one seat: `doors.all` plus
 * `doors.<seat>` from `<project>/.agents/doors.yaml`. Absent file → none.
 * A malformed file is a LOUD ManifestError — a silently ignored typo would
 * strand a seat behind a wall the operator believes they opened.
 */
export declare function loadProjectDoors(projectRoot: string, seat: Seat): string[];
