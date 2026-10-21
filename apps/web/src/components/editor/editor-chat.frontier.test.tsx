// @vitest-environment happy-dom
/* Only the newest run may act, and only as its state allows: history is a
 * read-only record, a newer instruction supersedes an earlier decision, each
 * frontier state offers one action set, story plans are summaries, and credits
 * appear only when they constrain work. */
import { fixtureArtifact } from "@models/agent/artifact-fixture.ts";
import { describe, expect, test } from "vite-plus/test";
import {
	installChatHarness,
	mount,
	type,
	key,
	click,
	byText,
	fakeEditor,
	user,
	planMsg,
	tick,
	frame,
	unmount,
	setBlockerBody,
	setCreditBody,
	type Harness,
} from "./chat-panel-harness.tsx";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";

installChatHarness();

/* ── Read-only history (audit finding 1) ── */
describe("read-only history", () => {
	const err = {
		kind: "timeout" as const,
		code: "timeout",
		title: "Planning timed out",
		message: "too long",
		retryable: true,
	};
	/* Every kind of stale thing the first design left live: a failed run, a
	 * partial run with an editable plan, media with
	 * Add to timeline, an outcome with Fix this, an applied result, a held one. */
	const history: ChatLogMessage[] = [
		user(1, "first"),
		{ id: 2, role: "assistant", jobId: "j1", error: err },
		user(3, "generate"),
		planMsg(4, ["ready", "failed", "ready"]),
		user(5, "critique"),
		{
			id: 7,
			role: "assistant",
			jobId: "j3",
			artifact: fixtureArtifact("media", {
				mediaType: "image",
				url: "https://example.test/a.png",
				label: "Frame",
			}),
		},
		{
			id: 8,
			role: "assistant",
			jobId: "j3",
			outcome: {
				status: "needs_attention",
				score: 60,
				findings: [
					{ id: "f", severity: "warning", message: "tighten", fix: { command: "tighten it" } },
				],
				metrics: { blockerCount: 0, warningCount: 1 },
			},
		},
		user(9, "apply"),
		{
			id: 10,
			role: "assistant",
			jobId: "j4",
			result: { status: "applied", touched: [{ kind: "clip", id: "scene:1" }], undoable: true },
		},
		user(11, "rewrite"),
		{
			id: 12,
			role: "assistant",
			jobId: "j5",
			result: {
				status: "held",
				touched: [{ kind: "clip", id: "scene:2" }],
				reason: "changed",
				conflicts: [{ kind: "clip", id: "scene:2" }],
			},
		},
		user(13, "and now this"),
		{ id: 14, role: "assistant", jobId: "j6", text: "Done." },
	];
	/** Controls that open or close a record rather than act on the project. */
	const DISCLOSURE = "[aria-expanded], summary";

	test("outside the frontier and the composer, only disclosures remain", async () => {
		const ed = fakeEditor();
		ed.undoable.add("j4");
		const h = await mount({ editor: ed.bridge, messages: history, onJump: true });
		const log = h.host.querySelector(".fc-chat-log")!;
		const acting = [...log.querySelectorAll("button, textarea, select, input")].filter(
			(el) => !el.matches(DISCLOSURE) && !el.closest("[data-frontier]"),
		);
		expect(acting.map((el) => el.textContent)).toEqual([]);
		// The newest run settled with nothing to act on, so it offers nothing either.
		expect(log.querySelectorAll("[data-frontier] button:not(.fc-run-think-h)")).toHaveLength(0);
		// Story plans in history are summaries, not editors.
		expect(log.querySelector(".fc-plan-summary")).not.toBeNull();
		expect(log.querySelector(".fc-plan")).toBeNull();
		// Stale state keeps its words and loses its colour.
		expect(log.querySelectorAll(".fc-run:not([data-frontier])[data-phase=failed]")).toHaveLength(1);
		expect(log.querySelector(".fc-result.held")!.getAttribute("role")).toBeNull();
	});

	test("a newer instruction removes the previous run's actions", async () => {
		const ed = fakeEditor();
		ed.undoable.add("j1");
		const h = await mount({
			editor: ed.bridge,
			messages: [
				user(1, "tighten"),
				{
					id: 2,
					role: "assistant",
					jobId: "j1",
					result: { status: "applied", touched: [{ kind: "clip", id: "scene:1" }], undoable: true },
				},
			],
		});
		expect(byText(h.host, "button", "Show changes")).toBeDefined();
		expect(byText(h.host, "button", "Undo")).toBeDefined();
		type(h, "next thing");
		key(h, "Enter");
		await tick();
		expect(byText(h.host, "button", "Show changes")).toBeUndefined();
		expect(byText(h.host, "button", "Undo")).toBeUndefined();
	});

	test("each frontier state offers exactly its one action", async () => {
		const cases: Array<{
			messages: ChatLogMessage[];
			busy?: boolean;
			interrupted?: { jobId: string };
			expected: string[];
		}> = [
			{ messages: [user(1, "go")], busy: true, expected: ["Stop"] },
			{
				messages: [user(1, "go"), { id: 2, role: "assistant", jobId: "j1", error: err }],
				expected: ["Retry"],
			},
			{
				messages: [user(1, "go"), { id: 2, role: "assistant", jobId: "j1", text: "x" }],
				interrupted: { jobId: "j1" },
				expected: ["Resume"],
			},
			{
				messages: [
					user(1, "go"),
					{
						id: 2,
						role: "assistant",
						jobId: "j1",
						result: {
							status: "held",
							touched: [],
							reason: "changed",
							conflicts: [{ kind: "clip", id: "scene:1" }],
						},
					},
				],
				expected: ["Review conflict", "Re-plan with my edits"],
			},
		];
		for (const c of cases) {
			const h = await mount({
				messages: c.messages,
				busy: c.busy,
				interrupted: c.interrupted,
				editor: fakeEditor().bridge,
			});
			const frontier = h.host.querySelector("[data-frontier]")!;
			const labels = [...frontier.querySelectorAll("button:not(.fc-run-think-h)")].map(
				(b) => b.textContent,
			);
			expect(labels).toEqual(c.expected);
			unmount();
		}
	});

	test("a turn nests no bordered surface inside another", async () => {
		const h = await mount({
			messages: [
				user(1, "plan"),
				{
					id: 2,
					role: "assistant",
					jobId: "j1",
					tool: { name: "draft", status: "done", note: "drafted" },
				},
				planMsg(3, ["ready", "ready"]),
				{
					id: 4,
					role: "assistant",
					jobId: "j1",
					result: { status: "applied", touched: [{ kind: "clip", id: "scene:1" }] },
				},
				user(5, "later"),
			],
		});
		const BORDERED =
			".fc-output, .fc-sbtable, .fc-plan, .fc-plan-panel, .fc-plan-box, .fc-ask, [data-slot='generation-error'], .fc-workflow, [data-slot='tool-call']";
		const turn = h.host.querySelector(".fc-turn")!;
		const nested = [...turn.querySelectorAll(BORDERED)].filter((el) =>
			el.parentElement?.closest(BORDERED),
		);
		expect(nested.map((el) => el.className)).toEqual([]);
		// No container around the run itself.
		expect(turn.querySelector(".fc-run")!.matches(BORDERED)).toBe(false);
	});
});

/* ── Credits (audit finding 4) ── */
describe("credits", () => {
	const summary = (daily: number, used: number) => ({
		account: { available_credits: daily, reserved_credits: 0 },
		policy: { dailyLimitCredits: 100, rolling5hLimitCredits: 100 },
		dailyUsedCredits: used,
		rolling5hUsedCredits: 0,
		dailyRemainingCredits: daily,
		rolling5hRemainingCredits: 100,
		dailyRefreshAt: new Date().toISOString(),
		rolling5hRefreshAt: null,
		enforcementEnabled: true,
	});

	test("healthy credits show nothing; low shows the meter; blocked replaces the input", async () => {
		setCreditBody(summary(90, 10));
		let h = await mount();
		await frame();
		expect(h.host.querySelector(".fc-creditmeter")).toBeNull();
		unmount();
		setCreditBody(summary(15, 85));
		h = await mount();
		await frame();
		expect(h.host.querySelector(".fc-creditmeter.low")).not.toBeNull();
		expect(h.host.querySelector("textarea")).not.toBeNull();
		unmount();
		setCreditBody(summary(0, 100));
		h = await mount();
		await frame();
		expect(h.host.querySelector(".fc-creditblock")).not.toBeNull();
		expect(h.host.querySelector("textarea")).toBeNull();
	});
});

/* ── Story plans (3.2) ── */
describe("story plans in chat", () => {
	const richPlan = (id: number, jobId: string): ChatLogMessage => ({
		id,
		role: "assistant",
		jobId,
		artifact: fixtureArtifact("story_plan", {
			targetSec: 30,
			arc: "three_act",
			verificationStatus: "partial",
			citationCoverage: { verified: 1, total: 2 },
			sections: [
				{
					id: "s0",
					title: "Hook",
					narration: "n",
					visualPrompt: "v",
					estimatedDurationSec: 6,
					status: "ready",
					chapterFunction: "setup",
					chapterObligation: "open the question",
					sourceUrls: ["https://example.test/a"],
				},
				{
					id: "s1",
					title: "Turn",
					narration: "n",
					visualPrompt: "v",
					estimatedDurationSec: 6,
					status: "draft",
					needsDrafting: true,
				},
			],
		}),
	});
	const editors = (root: Element) =>
		[...root.querySelectorAll("textarea, select, input, button")].filter(
			(el) => !el.matches("[aria-expanded], summary"),
		);

	test("the newest plan is a summary with Open in Storyboard, and nothing that edits or generates", async () => {
		let opened = 0;
		const bridge = {
			...fakeEditor().bridge,
			openStoryboard: () => {
				opened++;
			},
		};
		const h = await mount({ editor: bridge, messages: [user(1, "plan it"), richPlan(2, "j1")] });
		const summary = h.host.querySelector(".fc-plan-summary")!;
		expect(summary.textContent).toContain("Story plan · 2 sections");
		expect(summary.textContent).toContain("1 ready");
		expect(summary.textContent).toContain("Evidence partially matched · 1/2 factual sections");
		// Review material is kept, closed, as read-only rows.
		const details = summary.querySelector<HTMLDetailsElement>("details.fc-plan-details")!;
		expect(details.open).toBe(false);
		expect(details.textContent).toContain("setup — open the question");
		expect(details.textContent).toContain("Needs drafting");
		expect(editors(summary).map((el) => el.textContent)).toEqual(["Open in Storyboard"]);
		await click(byText(summary, "button", "Open in Storyboard"));
		expect(opened).toBe(1);
	});

	test("an earlier plan offers nothing, and no Open in Storyboard without a Storyboard to open", async () => {
		const bridge = { ...fakeEditor().bridge, openStoryboard: () => {} };
		const h = await mount({
			editor: bridge,
			messages: [user(1, "plan it"), richPlan(2, "j1"), user(3, "something else")],
		});
		expect(editors(h.host.querySelector(".fc-plan-summary")!)).toEqual([]);
		unmount();
		const without = await mount({
			editor: fakeEditor().bridge,
			messages: [user(1, "plan it"), richPlan(2, "j1")],
		});
		expect(editors(without.host.querySelector(".fc-plan-summary")!)).toEqual([]);
	});
});

/* ── Second audit: decisions and output actions belong to the frontier ── */
describe("frontier decisions", () => {
	const ask = (id: number): ChatLogMessage => ({
		id,
		role: "assistant",
		jobId: "j1",
		question: {
			question: "Approve the plan?",
			jobId: "j1",
			actionId: "a1",
			options: [{ label: "Approve", value: "approve" }],
			freeText: true,
		},
	});

	test("an instruction typed while a decision is parked queues behind it", async () => {
		/* It used to launch immediately, which abandoned the gate mid-thought: a plan
		 * approval the user was still reading vanished because they typed. The gate
		 * holds, the instruction waits, and answering releases it. */
		const h = await mount({ messages: [user(1, "plan"), ask(2)] });
		expect(h.host.querySelector(".fc-pinned")).not.toBeNull();
		type(h, "do something else");
		key(h, "Enter");
		await tick();
		expect(h.runs).toHaveLength(0);
		expect(h.host.querySelector(".fc-queued")!.textContent).toContain("do something else");
		// The decision is still the one thing that may act.
		expect(h.host.querySelector(".fc-pinned")).not.toBeNull();

		await click(byText(h.host, ".fc-pinned button", "Approve"));
		await tick();
		expect(h.answers.map((a) => a.answer)).toEqual(["approve"]);
		expect(h.runs.map((r) => r.text)).toEqual(["do something else"]);
		expect(h.host.querySelector(".fc-queued")).toBeNull();
	});

	test("an earlier decision does not hold back the queued instruction", async () => {
		const h = await mount({ messages: [user(1, "plan"), ask(2), user(3, "now this")], busy: true });
		type(h, "and then this");
		key(h, "Enter");
		expect(h.host.querySelector(".fc-queued")).not.toBeNull();
		h.setBusy(false);
		await tick();
		expect(h.runs.map((r) => r.text)).toEqual(["and then this"]);
	});

	test("while a plan awaits approval, Open in Storyboard is one of the decision's controls", async () => {
		let opened = 0;
		const bridge = {
			...fakeEditor().bridge,
			openStoryboard: () => {
				opened++;
			},
		};
		const h = await mount({
			editor: bridge,
			messages: [user(1, "plan"), planMsg(2, ["draft"]), ask(3)],
		});
		expect(h.host.querySelector(".fc-plan-summary button:not([aria-expanded])")).toBeNull();
		await click(byText(h.host.querySelector(".fc-pinned")!, "button", "Open in Storyboard"));
		expect(opened).toBe(1);
	});
});

/* ── The one exception: blockers are state, not history ── */
describe("open blockers keep their own controls", () => {
	test("a failed run offers only Retry, and the pinned batch still offers its remedies", async () => {
		setBlockerBody({
			acknowledged: [],
			blockers: [
				{ id: "b1", source: "outcome_finding", message: "Runtime is 22s over the target." },
			],
			batch: {
				id: "blockers-x",
				stage: "pre_generation",
				purpose: "blocker",
				questions: [
					{
						id: "b1",
						header: "Delivery check",
						question: "Runtime is 22s over the target.",
						options: [
							{
								id: "leave",
								label: "Leave as is",
								value: "leave as is",
								description: "Keeps it as it is.",
								recommended: true,
							},
						],
					},
				],
			},
		});
		const err = {
			kind: "timeout" as const,
			code: "timeout",
			title: "Planning timed out",
			message: "too long",
			retryable: true,
		};
		const h = await mount({
			projectId: "p1",
			onJump: true,
			editor: fakeEditor().bridge,
			messages: [user(1, "go"), { id: 2, role: "assistant", jobId: "j1", error: err }],
		});
		await tick();
		// The run's own state still owns exactly one action.
		const runActions = [...h.host.querySelectorAll(".fc-chat-log button:not([aria-expanded])")].map(
			(b) => b.textContent?.trim(),
		);
		expect(runActions).toEqual(["Retry"]);
		// And the blocker is answerable anyway, because it describes the project now.
		expect(h.host.querySelectorAll(".fc-blockers fieldset")).toHaveLength(1);
	});
});

describe("one action set per frontier state", () => {
	const err = {
		kind: "timeout" as const,
		code: "timeout",
		title: "Planning timed out",
		message: "too long",
		retryable: true,
	};
	/* Every kind of output that can act on its own. */
	const outputs = (from: number): ChatLogMessage[] => [
		{
			id: from,
			role: "assistant",
			jobId: "j1",
			outcome: {
				status: "needs_attention",
				score: 60,
				findings: [
					{ id: "f", severity: "warning", message: "tighten", fix: { command: "tighten it" } },
				],
				metrics: { blockerCount: 0, warningCount: 1 },
			},
		},
		{
			id: from + 2,
			role: "assistant",
			jobId: "j1",
			artifact: fixtureArtifact("media", {
				mediaType: "image",
				url: "https://example.test/a.png",
				label: "Frame",
			}),
		},
		{
			id: from + 3,
			role: "assistant",
			jobId: "j1",
			text: "Scene 2",
			ref: { type: "scene", id: 2 },
		},
		{
			id: from + 4,
			role: "assistant",
			jobId: "j1",
			artifact: fixtureArtifact("story_plan", {
				targetSec: 12,
				sections: [
					{
						id: "s",
						title: "One",
						narration: "n",
						visualPrompt: "v",
						estimatedDurationSec: 6,
						status: "draft",
					},
				],
			}),
		},
	];
	/* `Fix this` is deliberately absent. A delivery-check blocker is answered in
	 * the pinned blocker batch, which reads project state — so it survives this run
	 * ending and its siblings stay actionable after one is answered. */
	const OUTPUT_ACTIONS = ["Add to timeline", "Scene 2", "Open in Storyboard"];
	const actionLabels = (h: Harness) =>
		[...h.host.querySelectorAll(".fc-chat-log button:not([aria-expanded]), .fc-pinned button")].map(
			(b) => b.textContent?.trim() ?? "",
		);

	const cases: Array<{ name: string; tail: ChatLogMessage[]; busy?: boolean; expected: string[] }> =
		[
			{ name: "running", tail: [], busy: true, expected: ["Stop"] },
			{
				name: "failed",
				tail: [{ id: 20, role: "assistant", jobId: "j1", error: err }],
				expected: ["Retry"],
			},
			{
				name: "partial",
				tail: [
					{
						id: 20,
						role: "assistant",
						jobId: "j1",
						artifact: fixtureArtifact("story_plan", {
							targetSec: 12,
							sections: [
								{
									id: "a",
									title: "A",
									narration: "n",
									visualPrompt: "v",
									estimatedDurationSec: 6,
									status: "ready",
								},
								{
									id: "b",
									title: "B",
									narration: "n",
									visualPrompt: "v",
									estimatedDurationSec: 6,
									status: "failed",
								},
							],
						}),
					},
				],
				expected: ["Retry failed sections"],
			},
			{
				name: "applied result",
				tail: [
					{
						id: 20,
						role: "assistant",
						jobId: "j1",
						result: { status: "applied", touched: [{ kind: "clip", id: "scene:1" }] },
					},
				],
				expected: ["Show changes"],
			},
			{
				name: "held result",
				tail: [
					{
						id: 20,
						role: "assistant",
						jobId: "j1",
						result: {
							status: "held",
							touched: [],
							reason: "changed",
							conflicts: [{ kind: "clip", id: "scene:1" }],
						},
					},
				],
				expected: ["Review conflict", "Re-plan with my edits"],
			},
			{
				name: "awaiting",
				tail: [
					{
						id: 20,
						role: "assistant",
						jobId: "j1",
						question: {
							question: "Go?",
							jobId: "j1",
							actionId: "a",
							options: [{ label: "Yes", value: "yes" }],
						},
					},
				],
				expected: ["Yes", "Open in Storyboard", "Stop"],
			},
		];
	for (const c of cases) {
		test(`${c.name}: the state's actions and none of its outputs'`, async () => {
			const bridge = { ...fakeEditor().bridge, openStoryboard: () => {} };
			const h = await mount({
				editor: bridge,
				onJump: true,
				busy: c.busy,
				messages: [user(1, "go"), ...outputs(10), ...c.tail],
			});
			expect(actionLabels(h)).toEqual(c.expected);
		});
	}

	test("settled with nothing pending, the outputs offer their own actions", async () => {
		const bridge = { ...fakeEditor().bridge, openStoryboard: () => {} };
		const h = await mount({
			editor: bridge,
			onJump: true,
			messages: [
				user(1, "go"),
				...outputs(10),
				{ id: 20, role: "assistant", jobId: "j1", text: "Done." },
			],
		});
		const labels = actionLabels(h);
		for (const label of OUTPUT_ACTIONS) expect(labels).toContain(label);
	});
});
