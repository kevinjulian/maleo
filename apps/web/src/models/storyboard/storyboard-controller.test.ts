import { describe, expect, test } from "vite-plus/test";
import type { StoryboardGenerationState } from "@maleo/shared";
import {
	StoryboardController,
	type StoryboardControllerMutation,
} from "./storyboard-controller.ts";

const base: StoryboardGenerationState = {
	planId: "plan-a",
	draft: {
		revisionId: "rev-a",
		sections: [
			{
				id: "section-a",
				title: "Opening",
				beats: [
					{ id: "beat-a", title: "A", narration: "First", visualPrompt: "Wide" },
					{ id: "beat-b", title: "B", narration: "Second", visualPrompt: "Close" },
				],
			},
		],
	},
};
const generatedByBeatId = {};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function controller(
	command: (
		revisionId: string,
		value: Parameters<StoryboardController["submit"]>[0],
	) => Promise<StoryboardControllerMutation>,
) {
	return new StoryboardController({
		load: async () => ({ state: base, legacy: false, generatedByBeatId }),
		command,
		approve: async () => ({ ok: true, state: base, legacy: false, generatedByBeatId }),
	});
}

describe("StoryboardController", () => {
	test("loads server-confirmed state", async () => {
		const subject = controller(async () => ({
			ok: true,
			state: base,
			legacy: false,
			generatedByBeatId,
		}));
		await subject.refresh();
		expect(subject.getSnapshot()).toMatchObject({
			confirmed: base,
			storyboard: base,
			loading: false,
			error: null,
		});
	});

	test("shows shared-reducer preview then replaces it with server response", async () => {
		const pending = deferred<StoryboardControllerMutation>();
		const subject = controller(() => pending.promise);
		await subject.refresh();
		const submitted = subject.submit({
			type: "update_beat",
			beatId: "beat-a",
			fields: { narration: "Local" },
		});
		expect(subject.getSnapshot().storyboard?.draft.sections[0]?.beats[0]?.narration).toBe("Local");
		expect(subject.getSnapshot().pending).toBe(true);

		const server = structuredClone(base);
		server.draft.revisionId = "rev-server";
		server.draft.sections[0]!.beats[0]!.narration = "Server normalized";
		pending.resolve({ ok: true, state: server, legacy: false, generatedByBeatId });
		await submitted;
		expect(subject.getSnapshot()).toMatchObject({
			confirmed: server,
			storyboard: server,
			pending: false,
		});
	});

	test("keeps only one structural command in flight", async () => {
		const calls: string[] = [];
		const first = deferred<StoryboardControllerMutation>();
		const second = deferred<StoryboardControllerMutation>();
		const subject = controller((revisionId) => {
			calls.push(revisionId);
			return calls.length === 1 ? first.promise : second.promise;
		});
		await subject.refresh();
		const a = subject.submit({ type: "lock_beat", beatId: "beat-a" });
		const b = subject.submit({ type: "lock_beat", beatId: "beat-b" });
		expect(calls).toEqual(["rev-a"]);
		const afterFirst = structuredClone(base);
		afterFirst.draft.revisionId = "rev-b";
		first.resolve({ ok: true, state: afterFirst, legacy: false, generatedByBeatId });
		await a;
		expect(calls).toEqual(["rev-a", "rev-b"]);
		second.resolve({
			ok: true,
			state: { ...afterFirst, draft: { ...afterFirst.draft, revisionId: "rev-c" } },
			legacy: false,
			generatedByBeatId,
		});
		await b;
	});

	test("reorder conflict replaces structure and stops queued commands", async () => {
		let calls = 0;
		const server = structuredClone(base);
		server.draft.revisionId = "rev-new";
		server.draft.sections[0]!.beats.reverse();
		const conflict = {
			ok: false,
			reason: "conflict",
			message: "reload",
			state: server,
			legacy: false,
			generatedByBeatId,
		} as const;
		const gate = deferred<StoryboardControllerMutation>();
		const subject = controller(() => {
			calls += 1;
			return gate.promise;
		});
		await subject.refresh();
		const reorder = subject.submit({
			type: "reorder_beat",
			beatId: "beat-b",
			sectionId: "section-a",
			afterBeatId: null,
		});
		const queued = subject.submit({ type: "lock_beat", beatId: "beat-a" });
		gate.resolve(conflict);
		expect(await reorder).toEqual(conflict);
		expect(await queued).toEqual(conflict);
		expect(calls).toBe(1);
		expect(subject.getSnapshot()).toMatchObject({
			confirmed: server,
			storyboard: server,
			conflict,
		});
	});

	test("refuses commands during conflict instead of replaying after refresh", async () => {
		const calls: string[] = [];
		const server = structuredClone(base);
		server.draft.revisionId = "rev-server";
		let loaded = base;
		const subject = new StoryboardController({
			load: async () => ({ state: loaded, legacy: false, generatedByBeatId }),
			command: async (revisionId, command) => {
				calls.push(`${command.type}@${revisionId}`);
				if (calls.length === 1)
					return {
						ok: false,
						reason: "conflict",
						message: "reload",
						state: server,
						legacy: false,
						generatedByBeatId,
					};
				return { ok: true, state: server, legacy: false, generatedByBeatId };
			},
			approve: async () => ({ ok: true, state: server, legacy: false, generatedByBeatId }),
		});
		await subject.refresh();
		await subject.submit({ type: "lock_beat", beatId: "beat-a" });
		const refused = await subject.submit({
			type: "reorder_beat",
			beatId: "beat-b",
			sectionId: "section-a",
			afterBeatId: null,
		});
		expect(refused).toMatchObject({ ok: false, reason: "conflict" });
		loaded = server;
		await subject.refresh();
		await subject.submit({ type: "lock_beat", beatId: "beat-a" });
		expect(calls).toEqual(["lock_beat@rev-a", "lock_beat@rev-server"]);
	});

	test("narration conflict keeps typed text for explicit retry", async () => {
		const conflict = {
			ok: false,
			reason: "conflict",
			message: "reload",
			state: base,
			legacy: false,
			generatedByBeatId,
		} as const;
		const subject = controller(async () => conflict);
		await subject.refresh();
		subject.setTextDraft("beat-a", { narration: "Uncommitted local narration" });
		await subject.submit({
			type: "update_beat",
			beatId: "beat-a",
			fields: { narration: "Uncommitted local narration" },
		});
		expect(subject.getSnapshot().textDrafts["beat-a"]?.narration).toBe(
			"Uncommitted local narration",
		);
		expect(subject.getSnapshot().confirmed?.draft.sections[0]?.beats[0]?.narration).toBe("First");
	});
});
