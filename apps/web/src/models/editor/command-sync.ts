/* The editor's side of the project command log (`p1-command-log` D3, D4).
 *
 * Every local edit is enqueued with the inverse it executed with. Submissions
 * send the queue in order, one request at a time; edits made while a request is
 * in flight wait for the next one. A reply — and a log read — resolves through
 * app-core in one call: undo pending, apply what the server delivered, re-apply
 * pending except what it rejected, drop what it accepted or rejected from the
 * queue. The resolved scope is committed back to the editor.
 *
 * Pure orchestration: transport, scope and commit are injected, so this runs in
 * a unit test against the real engine with a fake server. */
import {
	admitAsset,
	applyDelta,
	EngineCommandError,
	replaceScope,
	type EditorCommand,
	type EditScope,
	type EngineExecutor,
	type EngineResult,
	type ScopeDelta,
} from "@maleo/shared/editor";
import type {
	CommandLogEntry,
	CommandLogRead,
	SubmitCommandsReply,
} from "@api/project-commands.ts";
import { awaitsImport } from "@models/core/pending-media-sources.ts";

/** A local edit the server will not hold: refused by it, or no longer applying
 *  after what it delivered. */
export interface SyncProblem {
	id: string;
	kind: "rejected" | "dropped";
	type: string;
	reason: string;
	message: string;
}

export interface CommandSyncInput {
	executor: EngineExecutor;
	/** The undo ledger handle (`CommandLedger.handle`); a resolve clears its redo. */
	ledger: number;
	baseSeq: number;
	submit: (
		baseSeq: number,
		commands: { clientCommandId: string; command: EditorCommand }[],
	) => Promise<SubmitCommandsReply>;
	read: (after: number) => Promise<CommandLogRead>;
	/** The live editing scope. */
	scope: () => EditScope;
	/** Write a resolved scope back onto the editor. */
	commit: (scope: EditScope) => void;
	report: (problems: SyncProblem[]) => void;
	/** Client and server diverged (a delivered or accepted command does not
	 *  apply here). The caller reloads the saved document. */
	diverged: (error: EngineCommandError) => void;
	/** Commands per request; the rest go in the next one. */
	batch?: number;
	mintId?: () => string;
}

export interface CommandSync {
	/** A local edit, already applied: `inverse` restores the scope before it. */
	enqueue: (command: EditorCommand, inverse: EditorCommand) => void;
	/** A change applied outside a command, sent as a whole-scope replace. */
	enqueueReplace: (before: EditScope, after: EditScope) => void;
	/** Submit what is pending, waiting for any request in flight first. */
	flush: () => Promise<void>;
	/** Read and apply what other writers saved since the last reply. */
	pull: () => Promise<void>;
	pending: () => number;
	baseSeq: () => number;
	dispose: () => void;
}

const DEFAULT_BATCH = 200;

function unwrap<T>(result: EngineResult<T>): T {
	if (!result.ok) throw new EngineCommandError(result.error.kind, result.error.message);
	return result.value;
}

type Library = EditScope["mediaAssets"];

/* The media library is the server's (`p1-media-library`). A submitted
 * `scope.replace` does not change it there, so its replay here must not either:
 * after a resolve the library is the server's as delivered, with the pending
 * `media.*` commands applied, and with uploads that have not finished — those
 * exist only here until the server admits them at finish. */
function libraryAfter(library: Library, command: EditorCommand, server: boolean): Library {
	switch (command.type) {
		case "media.admit":
			return admitAsset(library, command.asset).assets;
		case "media.update":
			return command.mediaAssets;
		case "scope.replace":
			return server ? command.scope.mediaAssets : library;
		case "batch":
			return command.commands.reduce((lib, inner) => libraryAfter(lib, inner, server), library);
		case "caption.edit":
		case "clip.replace":
		case "clip.trim-before":
		case "clip.trim-after":
		case "clip.insert":
		case "clip.remove":
		case "clip.update":
		case "clip.resize":
		case "clip.setKeys":
		case "clip.move":
		case "marker.upsert":
		case "marker.remove":
		case "marker.update":
		case "bookmark.set":
		case "bookmark.upsert":
		case "bookmark.remove":
		case "doc.setCaptions":
		case "doc.setMaterials":
		case "doc.setProjectReferences":
		case "doc.setTrackFlags":
		case "slide.insert":
		case "slide.remove":
		case "slide.update":
		case "post.insert":
		case "post.remove":
		case "post.update":
		case "noop":
			return library;
	}
}

function withPendingUploads(library: Library, local: Library): Library {
	const pending = local.filter(
		(asset) =>
			awaitsImport(asset) &&
			!library.some((held) => held.id === asset.id || held.url === asset.url),
	);
	return pending.length ? [...pending, ...library] : library;
}

export function createCommandSync(input: CommandSyncInput): CommandSync {
	const { executor, ledger, submit, read, scope, commit, report, diverged } = input;
	const { engine } = executor;
	const batch = input.batch ?? DEFAULT_BATCH;
	const mintId = input.mintId ?? (() => crypto.randomUUID());
	const queue = engine.pendingOpen();
	// The queue's commands by id, in order; the engine holds their inverses.
	const commands = new Map<string, EditorCommand>();
	let baseSeq = input.baseSeq;
	// The server's library as of `baseSeq`; read from the editor at the first resolve.
	let serverLibrary: Library | null = null;
	let chain: Promise<void> = Promise.resolve();
	let disposed = false;

	const pendingIds = (): string[] =>
		// SAFETY: `[{id, type}]` as `AppState::pending_state` writes it.
		(JSON.parse(unwrap(engine.pendingState(queue))) as { id: string }[]).map((item) => item.id);

	const resolve = (
		entries: readonly CommandLogEntry[],
		accepted: readonly string[],
		rejected: readonly { clientCommandId: string; kind: string; message: string }[],
	): void => {
		if (!entries.length && !accepted.length && !rejected.length) return;
		const current = scope();
		const delivered = entries.flatMap((entry) => entry.commands);
		serverLibrary = accepted
			.map((id) => commands.get(id))
			.reduce<Library>(
				(library, command) => (command ? libraryAfter(library, command, false) : library),
				delivered.reduce<Library>(
					(library, command) => libraryAfter(library, command, true),
					serverLibrary ?? current.mediaAssets,
				),
			);
		let out: {
			delta: ScopeDelta;
			dropped: { id: string; type: string; kind: string; message: string }[];
		};
		try {
			out = JSON.parse(
				unwrap(
					engine.pendingResolve(
						queue,
						ledger,
						executor.handleFor(current),
						JSON.stringify({
							delivered,
							accepted,
							rejected: rejected.map((r) => r.clientCommandId),
						}),
					),
				),
			);
		} catch (error) {
			if (!(error instanceof EngineCommandError)) throw error;
			diverged(error);
			return;
		}
		const resolved = applyDelta(current, out.delta);
		const kept = pendingIds();
		const next: EditScope = {
			...resolved,
			mediaAssets: kept.reduce<Library>(
				(library, id) => {
					const command = commands.get(id);
					return command ? libraryAfter(library, command, false) : library;
				},
				withPendingUploads(serverLibrary, current.mediaAssets),
			),
		};
		executor.adopt(next);
		commit(next);
		const problems: SyncProblem[] = [
			...rejected.map((r) => ({
				id: r.clientCommandId,
				kind: "rejected" as const,
				type: commands.get(r.clientCommandId)?.type ?? "unknown",
				reason: r.kind,
				message: r.message,
			})),
			...out.dropped.map((d) => ({
				id: d.id,
				kind: "dropped" as const,
				type: d.type,
				reason: d.kind,
				message: d.message,
			})),
		];
		const keep = new Set(kept);
		for (const id of [...commands.keys()]) if (!keep.has(id)) commands.delete(id);
		if (problems.length) report(problems);
	};

	/* One request at a time, in the order asked. A failed request leaves the
	 * queue as it was, and the next flush sends it again with the same ids. */
	const serialized = (run: () => Promise<void>): Promise<void> => {
		const next = chain.then(run);
		chain = next.catch(() => {});
		return next;
	};

	/** Send one batch; true when the batch was full and more may wait. */
	const flushOnce = async (): Promise<boolean> => {
		if (disposed || !commands.size) return false;
		const sent = [...commands].slice(0, batch).map(([clientCommandId, command]) => ({
			clientCommandId,
			command,
		}));
		const reply = await submit(baseSeq, sent);
		if (disposed) return false;
		resolve(
			reply.delivered,
			reply.accepted.map((a) => a.clientCommandId),
			reply.rejected,
		);
		baseSeq = reply.headSeq;
		return sent.length === batch;
	};

	return {
		enqueue(command, inverse) {
			const id = mintId();
			unwrap(engine.pendingEnqueue(queue, JSON.stringify({ id, command, inverse })));
			commands.set(id, command);
		},
		enqueueReplace(before, after) {
			this.enqueue(replaceScope(after), replaceScope(before));
		},
		flush: () =>
			serialized(async () => {
				// An overflowing queue drains now; edits made during a request wait for the next flush.
				while (await flushOnce());
			}),
		pull: () =>
			serialized(async () => {
				if (disposed) return;
				const log = await read(baseSeq);
				if (disposed) return;
				resolve(log.entries, [], []);
				baseSeq = log.headSeq;
			}),
		pending: () => commands.size,
		baseSeq: () => baseSeq,
		dispose() {
			disposed = true;
			engine.pendingClose(queue);
		},
	};
}
