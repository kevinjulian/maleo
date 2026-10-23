import { describe, expect, test } from "vite-plus/test";
import {
	engineExecutor,
	insertClip,
	moveClip,
	replaceScope,
	type EditorCommand,
	type EditScope,
} from "@maleo/shared/editor";
import type { Clip } from "@maleo/shared";
import type { CommandLogRead, SubmitCommandsReply } from "@api/project-commands.ts";
import { testEngine as engine } from "@models/editor-engine/engine-fixture.ts";
import { createCommandLedger } from "@models/chat/command-ledger.ts";
import { createCommandSync, type SyncProblem } from "./command-sync.ts";

const clip = (id: string, startSec = 0): Clip => ({
	id,
	type: "text",
	startSec,
	durationSec: 1,
	track: 0,
});
const scopeOf = (clips: Clip[], mediaAssets: EditScope["mediaAssets"] = []): EditScope => ({
	doc: { schemaVersion: 2, clips, markers: [] },
	slides: [],
	posts: [],
	mediaAssets,
});
const starts = (scope: EditScope) =>
	Object.fromEntries(scope.doc.clips.map((c) => [c.id, c.startSec]));

/** An editor with its scope, ledger and sync wired the way the editor wires them. */
function editor(
	initial: EditScope,
	server: {
		submit?: (
			baseSeq: number,
			commands: { clientCommandId: string; command: EditorCommand }[],
		) => Promise<SubmitCommandsReply>;
		read?: (after: number) => Promise<CommandLogRead>;
	},
) {
	const executor = engineExecutor(engine);
	const ledger = createCommandLedger(executor);
	let current = initial;
	const problems: SyncProblem[] = [];
	let ids = 0;
	const sync = createCommandSync({
		executor,
		ledger: ledger.handle,
		baseSeq: 1,
		submit:
			server.submit ??
			(async () => ({ headSeq: 1, headVersion: 1, accepted: [], rejected: [], delivered: [] })),
		read:
			server.read ??
			(async () => ({ headSeq: 1, headVersion: 1, headStoryboardId: null, entries: [] })),
		scope: () => current,
		commit: (next) => {
			current = next;
		},
		report: (found) => problems.push(...found),
		diverged: (error) => {
			throw error;
		},
		mintId: () => `c${++ids}`,
	});
	const edit = (command: EditorCommand): void => {
		const executed = executor.execute(current, command);
		current = executed.scope;
		ledger.record(command, current, undefined, executed);
		sync.enqueue(command, executed.inverse);
	};
	return { sync, edit, problems, scope: () => current };
}

/** Until the fake server has received `n` requests. */
async function requests(sent: unknown[], n: number): Promise<void> {
	while (sent.length < n) await new Promise((resolve) => setTimeout(resolve, 0));
}

const reply = (over: Partial<SubmitCommandsReply>): SubmitCommandsReply => ({
	headSeq: 2,
	headVersion: 2,
	accepted: [],
	rejected: [],
	delivered: [],
	...over,
});

describe("the editor submits its pending commands", () => {
	test("an edit made while a request is in flight waits for the next one", async () => {
		const sent: string[][] = [];
		let answer: (value: SubmitCommandsReply) => void = () => {};
		const { sync, edit, scope } = editor(scopeOf([clip("text:1"), clip("text:2")]), {
			submit: (_base, commands) => {
				sent.push(commands.map((c) => c.clientCommandId));
				return new Promise((resolve) => {
					answer = resolve;
				});
			},
		});
		edit(moveClip("text:1", { startSec: 4 }));
		const inFlight = sync.flush();
		await requests(sent, 1);
		edit(moveClip("text:2", { startSec: 6 }));
		answer(reply({ accepted: [{ clientCommandId: "c1", seq: 2, version: 2 }] }));
		await inFlight;

		expect(sent).toEqual([["c1"]]);
		expect(sync.pending()).toBe(1);
		expect(sync.baseSeq()).toBe(2);
		expect(starts(scope())).toEqual({ "text:1": 4, "text:2": 6 });

		const next = sync.flush();
		await requests(sent, 2);
		answer(reply({ headSeq: 3, accepted: [{ clientCommandId: "c2", seq: 3, version: 3 }] }));
		await next;
		expect(sent).toEqual([["c1"], ["c2"]]);
		expect(sync.pending()).toBe(0);
	});

	test("a rejected command is removed from the document and reported", async () => {
		const { sync, edit, scope, problems } = editor(scopeOf([clip("text:1")]), {
			submit: async () =>
				reply({
					accepted: [{ clientCommandId: "c1", seq: 2, version: 2 }],
					rejected: [{ clientCommandId: "c2", kind: "local_media_url", message: "blob: URL" }],
				}),
		});
		edit(moveClip("text:1", { startSec: 4 }));
		edit(insertClip(clip("text:2", 2)));
		await sync.flush();

		expect(starts(scope())).toEqual({ "text:1": 4 });
		expect(sync.pending()).toBe(0);
		expect(problems).toEqual([
			{
				id: "c2",
				kind: "rejected",
				type: "clip.insert",
				reason: "local_media_url",
				message: "blob: URL",
			},
		]);
	});

	test("a failed request keeps the queue for the next flush", async () => {
		let fail = true;
		const { sync, edit } = editor(scopeOf([clip("text:1")]), {
			submit: async () => {
				if (fail) throw new Error("offline");
				return reply({ accepted: [{ clientCommandId: "c1", seq: 2, version: 2 }] });
			},
		});
		edit(moveClip("text:1", { startSec: 4 }));
		await expect(sync.flush()).rejects.toThrow("offline");
		expect(sync.pending()).toBe(1);
		fail = false;
		await sync.flush();
		expect(sync.pending()).toBe(0);
	});
});

describe("the editor reads the log", () => {
	test("an agent's scope.replace lands under pending edits and keeps the media library", async () => {
		const media = [
			{ id: "m1", label: "Upload", url: "/api/media/m1", kind: "image", source: "upload" },
		];
		const agentScope = scopeOf([clip("text:1"), clip("text:9", 7)]);
		const { sync, edit, scope } = editor(scopeOf([clip("text:1")], media as never), {
			read: async (after) => ({
				headSeq: after + 1,
				headVersion: after + 1,
				headStoryboardId: null,
				entries: [
					{
						seq: after + 1,
						version: after + 1,
						actor: "system",
						commands: [replaceScope(agentScope)],
					},
				],
			}),
		});
		edit(moveClip("text:1", { startSec: 4 }));
		await sync.pull();

		expect(starts(scope())).toEqual({ "text:1": 4, "text:9": 7 });
		expect(scope().mediaAssets).toEqual(media);
		expect(sync.pending()).toBe(1);
		expect(sync.baseSeq()).toBe(2);
	});

	test("a pending edit the delivered entries make impossible is dropped and reported", async () => {
		const { sync, edit, scope, problems } = editor(scopeOf([clip("text:1")]), {
			read: async () => ({
				headSeq: 2,
				headVersion: 2,
				headStoryboardId: null,
				entries: [{ seq: 2, version: 2, actor: "system", commands: [replaceScope(scopeOf([]))] }],
			}),
		});
		edit(moveClip("text:1", { startSec: 4 }));
		await sync.pull();

		expect(scope().doc.clips).toEqual([]);
		expect(problems.map((p) => [p.id, p.kind, p.type])).toEqual([["c1", "dropped", "clip.move"]]);
	});
});
