/* The editor's connection to the project command log (`p1-command-log` D4).
 *
 * Once a project is loaded it opens a sync controller from the version the
 * editor loaded, attaches the document's bridge, and then:
 *  - submits pending commands on a debounce after each enqueue, one request
 *    at a time (`command-sync.ts`);
 *  - reads the log when the window regains focus, and when an agent run
 *    settles (`pull`);
 *  - reports rejected and dropped edits, and reloads the saved document when
 *    client and server diverge. */
import { useEffect, useRef } from "react";
import {
	isEngineExecutor,
	type CommandExecutor,
	type EditScope,
	type EngineCommandError,
} from "@maleo/shared/editor";
import { readCommandLog, submitCommands } from "@api/project-commands.ts";
import {
	createCommandSync,
	type CommandSync,
	type SyncProblem,
} from "@models/editor/command-sync.ts";
import { errMsg } from "@models/core/cc-helpers.ts";
import type { EditorDocument } from "@components/editor/use-editor-document.ts";

const SUBMIT_DEBOUNCE_MS = 1200;

export interface CommandLog {
	/** Submit what is pending now; resolves when the log holds it. */
	flush: () => Promise<void>;
	/** Read what other writers saved. */
	pull: () => Promise<void>;
}

/** A sentence for the user about edits the server will not hold. */
export function describeSyncProblems(problems: readonly SyncProblem[]): string {
	const [first] = problems;
	if (!first) return "";
	const count = problems.length === 1 ? "An edit" : `${problems.length} edits`;
	return `${count} could not be saved and ${problems.length === 1 ? "was" : "were"} removed: ${first.message || first.reason}`;
}

export function useCommandLog(input: {
	projectId: string;
	/** The log sequence of the version the editor loaded; null until loaded. */
	loadedSeq: number | null;
	executor: CommandExecutor;
	log: EditorDocument["log"];
	scope: () => EditScope;
	onSaving: () => void;
	onSaved: () => void;
	onFailed: (message: string) => void;
	onProblems: (message: string) => void;
	/** Client and server disagree; the caller reloads the saved document. */
	onDiverged: (error: EngineCommandError) => void;
}): CommandLog {
	const latest = useRef(input);
	latest.current = input;
	const syncRef = useRef<CommandSync | null>(null);
	const { projectId, loadedSeq, executor, log } = input;

	useEffect(() => {
		if (loadedSeq === null) return;
		if (!isEngineExecutor(executor)) throw new Error("the command log needs the engine executor");
		const sync = createCommandSync({
			executor,
			ledger: log.ledgerHandle,
			baseSeq: loadedSeq,
			submit: (base, commands) => submitCommands(projectId, base, commands),
			read: (after) => readCommandLog(projectId, after),
			scope: () => latest.current.scope(),
			commit: (scope) => {
				log.commit(scope);
				log.bridge.resolved(scope);
			},
			report: (problems) => latest.current.onProblems(describeSyncProblems(problems)),
			diverged: (error) => latest.current.onDiverged(error),
		});
		syncRef.current = sync;
		log.bridge.attach(sync);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const submit = (): void => {
			// A write that went around the stack in the last moments goes too.
			log.bridge.catchUp();
			latest.current.onSaving();
			sync
				.flush()
				.then(() => latest.current.onSaved())
				.catch((error) => latest.current.onFailed(`Auto-save failed: ${errMsg(error)}`));
		};
		log.onEnqueued.current = () => {
			clearTimeout(timer);
			timer = setTimeout(submit, SUBMIT_DEBOUNCE_MS);
		};
		const onFocus = (): void => {
			void sync.pull().catch(() => {
				/* the next submit or focus reads again */
			});
		};
		window.addEventListener("focus", onFocus);
		return () => {
			window.removeEventListener("focus", onFocus);
			clearTimeout(timer);
			log.onEnqueued.current = () => {};
			log.bridge.detach();
			syncRef.current = null;
			// Whatever is still pending goes out before the controller closes.
			void sync
				.flush()
				.catch(() => {})
				.finally(() => sync.dispose());
		};
	}, [projectId, loadedSeq, executor, log]);

	return {
		flush: () => syncRef.current?.flush() ?? Promise.resolve(),
		pull: () => syncRef.current?.pull() ?? Promise.resolve(),
	};
}
