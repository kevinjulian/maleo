/* The Rust engine as the command executor (`migrate-editor-to-shared-rust-core`,
 * task 4.5).
 *
 * The engine holds the document behind a handle; the host keeps its own copy,
 * which it renders from and memoizes by identity. Each edit crosses as the
 * command in and `{inverse, delta}` out, and the copy is rebuilt from the delta
 * reusing every object the edit did not replace — the same sharing the TS
 * executor's spreads give, so a move repaints one clip, not the timeline.
 *
 * The handle follows the copy by identity: when `before`'s parts are not the
 * ones the handle last produced (a load, an undo that retained unrelated media, a
 * generation landing), the handle is reopened from `before` first. That costs
 * one admission of the document, and only when something outside the engine
 * wrote it. */
import type { Engine } from "./engine.ts";
import type { EditorCommand, Execution } from "./commands.ts";
import type { EditScope } from "./scope.ts";

/** Executes a command against a scope; the editor's single write authority. */
export interface CommandExecutor {
	/** Throws when the engine refuses the command; `before` is then unchanged. */
	execute(before: EditScope, command: EditorCommand): Execution;
}

/** A parsed JSON value. */
type Json = null | boolean | number | string | Json[] | JsonObject;
interface JsonObject {
	[key: string]: Json;
}

interface PassthroughChange {
	set: JsonObject;
	remove: string[];
}

/** `maleo_editor_core::delta`: every key absent when that part is unchanged. */
interface ScopeDelta {
	mediaAssets?: EditScope["mediaAssets"];
	slides?: EditScope["slides"];
	posts?: EditScope["posts"];
	extra?: PassthroughChange;
	doc?: {
		schemaVersion?: EditScope["doc"]["schemaVersion"];
		markers?: EditScope["doc"]["markers"];
		extra?: PassthroughChange;
		/** Runs: `[start, count]` keeps prior clips; an object is a new clip. */
		clips?: ([number, number] | EditScope["doc"]["clips"][number])[];
	};
}

export class EngineCommandError extends Error {
	constructor(
		readonly kind: string,
		message: string,
	) {
		super(`${kind}: ${message}`);
		this.name = "EngineCommandError";
	}
}

function withPassthrough<T extends object>(base: T, change: PassthroughChange | undefined): T {
	if (!change) return base;
	const removed = new Set(change.remove);
	const kept = Object.fromEntries(Object.entries(base).filter(([key]) => !removed.has(key)));
	// SAFETY: only passthrough keys are set or removed; the engine never names a typed field here.
	return { ...kept, ...change.set } as T;
}

function rebuiltClips(
	prior: EditScope["doc"]["clips"],
	runs: NonNullable<NonNullable<ScopeDelta["doc"]>["clips"]>,
): EditScope["doc"]["clips"] {
	return runs.flatMap((run) => (Array.isArray(run) ? prior.slice(run[0], run[0] + run[1]) : [run]));
}

/** Rebuild `before` with only the parts the delta names replaced. */
export function applyDelta(before: EditScope, delta: ScopeDelta): EditScope {
	const { doc } = delta;
	if (!doc && !delta.mediaAssets && !delta.slides && !delta.posts && !delta.extra) return before;
	const nextDoc = doc
		? withPassthrough(
				{
					...before.doc,
					...(doc.schemaVersion === undefined ? {} : { schemaVersion: doc.schemaVersion }),
					...(doc.markers ? { markers: doc.markers } : {}),
					...(doc.clips ? { clips: rebuiltClips(before.doc.clips, doc.clips) } : {}),
				},
				doc.extra,
			)
		: before.doc;
	return withPassthrough(
		{
			...before,
			...(delta.mediaAssets ? { mediaAssets: delta.mediaAssets } : {}),
			...(delta.slides ? { slides: delta.slides } : {}),
			...(delta.posts ? { posts: delta.posts } : {}),
			doc: nextDoc,
		},
		delta.extra,
	);
}

/* Hosts rebuild the envelope per edit (`{doc, slides, posts, mediaAssets}` from
 * their stores), so the handle follows the parts, not the envelope object. */
const sameParts = (a: EditScope, b: EditScope): boolean =>
	a.doc === b.doc &&
	a.slides === b.slides &&
	a.posts === b.posts &&
	a.mediaAssets === b.mediaAssets;

/** The engine as the executor. One handle, reopened whenever the scope it
 *  holds is not the one the caller passes. */
export function engineExecutor(engine: Engine): CommandExecutor {
	let handle: number | undefined;
	let held: EditScope | undefined;
	const reopen = (scope: EditScope): number => {
		if (handle !== undefined) engine.close(handle);
		handle = undefined;
		const opened = engine.open(JSON.stringify(scope));
		if (!opened.ok) throw new EngineCommandError(opened.error.kind, opened.error.message);
		handle = opened.value;
		held = scope;
		return handle;
	};
	return {
		execute(before, command) {
			const current =
				handle !== undefined && held !== undefined && sameParts(held, before)
					? handle
					: reopen(before);
			const result = engine.executeDelta(current, JSON.stringify(command));
			if (!result.ok) throw new EngineCommandError(result.error.kind, result.error.message);
			// SAFETY: `{inverse, delta}` as `Documents::execute_delta` writes it; the inverse is a command the engine just produced.
			const out = JSON.parse(result.value) as { inverse: EditorCommand; delta: ScopeDelta };
			/* A whole-scope replace lands the caller's own object, as the TS executor
			 * does, so a replace with the scope already held changes no identity. */
			const scope =
				command.type === "scope.replace" ? command.scope : applyDelta(before, out.delta);
			held = scope;
			return { scope, inverse: out.inverse };
		},
	};
}
