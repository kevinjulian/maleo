/* Agent tool registry — shared types.
 *
 * The forward-looking home for the create-flow agent's tools. Each tool is one
 * `ToolDef` co-locating its name, routing intents, description (single source
 * for the planner prompt), Zod input schema (per-tool validation), and handler.
 * The legacy flat enum + switch in agent-orchestrator.ts migrates into this
 * registry one tool at a time; `ask_user` is the first live example. */
import type { EditorCommand } from "@maleo/shared/editor";
import type { z } from "zod";
import type { AgentTemplateOperation } from "@maleo/shared";
import type { AgentJob } from "./model.ts";

/* Declared in the run contract: both ride on events the editor renders. */
import type { ToolEffect, Intent } from "@maleo/shared/agent-wire";
export type { ToolEffect, Intent } from "@maleo/shared/agent-wire";

// Stage-1 routing buckets. A request is classified into one intent, and the
// planner is then handed only the tools whose `intents` include it.
export type ContentType = "video" | "image" | "text";

/** A tool call's arguments as they arrive, before the tool's own schema parses them. */
export type ToolArgs = Record<string, unknown>;

export interface QuestionOption {
	// Chip label shown to the user.
	label: string;
	// Exact answer text sent back when the chip is chosen (resumes the run).
	value: string;
}

// The effect class of a tool — its cost/side-effect profile. Drives loop, gate,
// and client rendering instead of per-tool name special-casing.
//   read     — pure query, no state change (view_timeline)
//   mutate   — cheap, reversible edit (add_scene, update_section, plan_*)
//   generate — expensive, side-effecting asset gen (generate_frame, *_assets)
//   approve  — a checkpoint that gates a following generate
//   respond  — terminal / conversational (finish, ask_user)
export type ToolKind = "read" | "mutate" | "generate" | "approve" | "respond";

// How a tool's result should be rendered by the client. Defaults from `kind` when
// a handler doesn't set it explicitly.
export type ToolReplay =
	| { kind: "scene_frame"; index: number; url: string }
	// An editing tool's executed commands, re-applied when a retry finds the call done.
	| { kind: "edit"; commands: EditorCommand[] };

export interface GeneratedArtifact {
	kind: "image" | "audio" | "video";
	url: string;
	logicalRef: string;
	metadata?: {
		providerId?: string;
		providerSource?: string;
		model?: string;
		cost?: number;
		latencyMs?: number;
	};
}

// What a tool handler resolves to — mirrors the orchestrator's execTool shape.
// `effect` is optional; the loop stamps a default derived from the tool's kind.
export interface ToolResult {
	note: string;
	thumbs?: string[];
	artifacts?: GeneratedArtifact[];
	effect?: ToolEffect;
	// Present only for replayable generate tools (see ToolReplay).
	replay?: ToolReplay;
	/* The tool has NOT finished. It ran a first phase, persisted everything the
	 * second phase needs, and parked the run on a question — so the loop must keep
	 * the pending call and hold its cursor rather than treat this note as the
	 * tool's outcome. Set only by a handler that has already persisted a resumable
	 * checkpoint AND a required action; a handler that sets it without them parks a
	 * run nothing can resume. Absent on every ordinary tool result. */
	suspended?: true;
}

// Coercion helpers a handler needs, injected by the loop so tool files stay free
// of orchestrator value imports (they'd form a cycle). Migrated handlers use
// these instead of reaching into the orchestrator directly.
export interface ToolHelpers {
	str: (v: unknown, fallback?: string) => string;
	num: (v: unknown, fallback: number) => number;
	/** Resolve an `index` argument against a list: rounded, clamped into range, and
	 *  0 when absent. Eight tools wrote this same expression out. */
	index: (v: unknown, length: number) => number;
	clampSceneDuration: (n: number) => number;
}

export interface StyleLock {
	ok: boolean;
	visualStyle?: string;
	note?: string;
}
export interface RefImage {
	url: string;
	role: string;
}

// Context passed to a tool handler. The loop always injects helpers + caps, so
// they are required — handlers use them without a non-null assertion, and a
// caller that forgets to provide them is a compile error, not a runtime crash.
export interface ToolContext {
	job: AgentJob;
	toolCallId?: string;
	helpers: ToolHelpers;
}

export interface ToolDef<A = unknown> {
	inspection?: {
		operations?: AgentTemplateOperation[];
		prompts?: string[];
		promptMode?: "none" | "passthrough" | "composed";
	};
	name: string;
	// Effect class — its cost/side-effect profile (loop + client branch on this).
	kind: ToolKind;
	// A `generate` that must not run until its proposal artifact is approved.
	gated?: boolean;
	// A `generate` that reuses its finished work by input hash, so the durable
	// host may run it again over an attempt whose outcome is uncertain (a crash
	// mid-call): only the work in flight at the crash is asked for again.
	reentrant?: boolean;
	// Marks a tool that actually builds/changes the storyboard (drives the loop's
	// finish-guard via buildersFor). A plan/outline is NOT a build; some mutates
	// (create_story_outline, set_clip_layout) and generates (create_character) are
	// deliberately untagged. Single source for the builder taxonomy.
	builds?: boolean;
	// Changes the timeline only through editor commands (`edit-document.ts`). Any
	// other mutate or generate marks the run as generation output (`run.jobWrites`).
	edits?: true;
	// For a `mutate` that drafts a reviewable artifact: the artifact kind it writes
	// (a gated generate names the same kind via its own `proposes`/lookup).
	proposes?: string;
	// Which stage-1 intents surface this tool to the planner.
	intents: Intent[];
	// Restrict to specific content types; omit = available for all.
	contentType?: ContentType[];
	// One-line spec rendered into the planner prompt (single source of truth).
	description: string;
	// Per-tool argument schema — validated before the handler runs so malformed
	// args never execute (they become a clarifying question or an observation).
	input: z.ZodType<A>;
	// Side-effecting implementation. Terminal tools (finish, ask_user) omit it and
	// are handled directly by the run loop.
	handler?: (ctx: ToolContext, args: A) => Promise<ToolResult>;
}

// A registry is heterogeneous over the per-tool arg type, so it stores the
// existential form. `any` is confined to this alias — call sites still get full
// per-tool typing through ToolDef<A>. The optional handler is contravariant in
// A, so a plain ToolDef<unknown> can't hold a ToolDef<SpecificArgs>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDef = ToolDef<any>;

/** Declare a tool, inferring its handler's argument type from its own schema.
 *
 *  `ToolDef<A>` has always been generic, but every tool but one declared itself
 *  as `AnyToolDef` and re-typed its args as `Record<string, unknown>` — so the
 *  handler hand-coerced fields that `tool-executor` had already parsed and
 *  coerced through the very schema sitting three lines above it. There was no
 *  way to name the type: it lives in the Zod schema, and the annotation erased
 *  it. This infers it, and returns the existential form the registry stores. */
export function defineTool<S extends z.ZodType>(
	def: Omit<ToolDef<z.output<S>>, "input"> & { input: S },
): AnyToolDef {
	// SAFETY: stored as the existential `ToolDef<any>`; `tool-executor` parses the
	// arguments through this same `input` before `handler` receives them.
	return def as AnyToolDef;
}
