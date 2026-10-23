/* The project command log (`p1-command-log`) for suites that run without the api.
 *
 * The editor saves edits as commands through `POST /projects/:id/commands`, not
 * as whole documents. A spec that asserts on what was saved therefore needs a
 * server that applies those commands, which is what this is: it reads the stored
 * document the spec serves, applies every submitted command with the real editor
 * engine exactly as the api does (`storyboardScope` in, `storyboardWithScope`
 * out), accepts it, and hands the resulting document back through `onSave`.
 *
 * It is not the system under test. A command the engine refuses is rejected with
 * the engine's message, as the api would, and the document stays as it was. */
import type { BrowserContext } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
	engineExecutor,
	instantiateEngine,
	storyboardScope,
	storyboardWithScope,
	type EditorCommand,
	type EditScope,
} from "@maleo/shared/editor";
import { ENGINE_WASM, buildEditorWasm } from "../../../scripts/editor-engine.mts";

const engine = await instantiateEngine(
	readFileSync(existsSync(ENGINE_WASM) ? ENGINE_WASM : buildEditorWasm()),
);
const executor = engineExecutor(engine);

export interface CommandLogMock {
	/** Every accepted command, in order. */
	readonly commands: EditorCommand[];
}

/** Serve the command log for `projectId`. `stored` is the document the spec
 *  currently serves as the head; `onSave` receives the head after each write. */
export async function mockCommandLog<Stored extends object>(
	context: BrowserContext,
	projectId: string,
	options: {
		/** The stored document, as the project detail serves it. */
		stored: () => Stored;
		onSave: (next: Stored) => void;
		/** True to fail this submission, as an unavailable server would. */
		fail?: (commands: readonly EditorCommand[]) => boolean;
		/** The project's media library (server rows since `p1-media-library`). */
		media?: () => EditScope["mediaAssets"];
		onMedia?: (next: EditScope["mediaAssets"]) => void;
	},
): Promise<CommandLogMock> {
	const commands: EditorCommand[] = [];
	let seq = 0;
	let version = 1;
	const base = `/api/operations/projects/${projectId}`;
	await context.route(new RegExp(`${base}/commands(\\?|$)`), async (route) => {
		const request = route.request();
		if (request.method() === "GET") {
			await route.fulfill({
				json: {
					headSeq: seq,
					headVersion: version,
					headStoryboardId: "fixture-saved-storyboard",
					entries: [],
				},
			});
			return;
		}
		const body = request.postDataJSON() as {
			commands: { clientCommandId: string; command: EditorCommand }[];
		};
		if (options.fail?.(body.commands.map(({ command }) => command))) {
			await route.fulfill({ status: 503, json: { error: "Temporary save failure" } });
			return;
		}
		let scope: EditScope = storyboardScope(options.stored(), options.media?.() ?? []);
		const accepted: { clientCommandId: string; seq: number; version: number | null }[] = [];
		const rejected: { clientCommandId: string; kind: string; message: string }[] = [];
		for (const { clientCommandId, command } of body.commands) {
			try {
				scope = executor.execute(scope, command).scope;
			} catch (error) {
				rejected.push({ clientCommandId, kind: "invalid", message: String(error) });
				continue;
			}
			commands.push(command);
			seq += 1;
			version += 1;
			accepted.push({ clientCommandId, seq, version });
		}
		if (accepted.length) {
			// SAFETY: the write keeps every key of the stored document and replaces the
			// document fields the scope owns with their new values, as the api does.
			options.onSave(storyboardWithScope(options.stored(), scope) as unknown as Stored);
			options.onMedia?.(scope.mediaAssets);
		}
		await route.fulfill({
			json: { headSeq: seq, headVersion: version, accepted, rejected, delivered: [] },
		});
	});
	await context.route(new RegExp(`${base}/storyboard-presentation(\\?|$)`), async (route) => {
		const fields = route.request().postDataJSON() as Partial<Stored>;
		version += 1;
		options.onSave({ ...options.stored(), ...fields });
		await route.fulfill({ json: { ok: true, version } });
	});
	return { commands };
}
