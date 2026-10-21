// @vitest-environment happy-dom
/* The pinned blocker batch: every open blocker at once, answered in one submit,
 * and still actionable however the run that reported them ended.
 *
 * The failure this locks: fixing one blocker used to start a run, which turned
 * the card holding the others into history and left them as dead text. */
import { describe, expect, test } from "vite-plus/test";
import {
	installChatHarness,
	mount,
	click,
	byText,
	fakeEditor,
	user,
	tick,
	blockerSubmissions,
	setBlockerBody,
	setBlockerResolution,
	type Harness,
} from "./chat-panel-harness.tsx";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import type { BlockerRemedy, OpenBlocker } from "@maleo/shared";

installChatHarness();

const blocker = (id: string, message: string, remedy?: BlockerRemedy): OpenBlocker => ({
	id,
	source: "outcome_finding",
	message,
	...(remedy ? { remedy } : {}),
});

const question = (id: string, message: string, withRemedy: boolean) => ({
	id,
	header: "Delivery check",
	question: message,
	options: [
		...(withRemedy
			? [
					{
						id: "remedy",
						label: "Apply the fix",
						value: "command",
						description: "Runs the fix and re-checks.",
						recommended: true,
					},
				]
			: []),
		{
			id: "leave",
			label: "Leave as is",
			value: "leave as is",
			description: "Keeps it as it is.",
			...(withRemedy ? {} : { recommended: true }),
		},
	],
});

function threeOpen(): void {
	setBlockerBody({
		acknowledged: [],
		blockers: [
			blocker("b1", "Runtime is 22s over the target.", {
				kind: "command",
				label: "Apply the fix",
				command: "Trim section 3.",
			}),
			blocker("b2", "Section 2 cites no source."),
			blocker("b3", "Scene 4 has no image.", {
				kind: "command",
				label: "Apply the fix",
				command: "Regenerate scene 4.",
			}),
		],
		batch: {
			id: "blockers-abc",
			stage: "pre_generation",
			purpose: "blocker",
			questions: [
				question("b1", "Runtime is 22s over the target.", true),
				question("b2", "Section 2 cites no source.", false),
				question("b3", "Scene 4 has no image.", true),
			],
			intro: "3 things are still blocking this project.",
		},
	});
}

/** The recommended choice in every group — the card's own default answer.
 *  Deliberately not "every radio": the last one in each group is Other, which
 *  with no text is an unanswered question wearing an answer's shape. */
const answerEveryGroup = async (h: Harness): Promise<void> => {
	for (const group of h.host.querySelectorAll(".fc-blockers fieldset")) {
		await click(group.querySelector("input[type=radio]"));
	}
};

describe("pinned blocker batch", () => {
	test("every open blocker is shown at once, with one submit", async () => {
		threeOpen();
		const h = await mount({ projectId: "p1", messages: [user(1, "go")] });
		await tick();
		const card = h.host.querySelector(".fc-blockers")!;
		expect(card.querySelectorAll("fieldset")).toHaveLength(3);
		expect(byText(h.host, ".fc-blockers button", "Apply these answers")).toBeDefined();
	});

	test("answering one blocker does not remove the others' controls", async () => {
		threeOpen();
		setBlockerResolution({
			ok: true,
			blockers: [
				blocker("b2", "Section 2 cites no source."),
				blocker("b3", "Scene 4 has no image."),
			],
			instructions: ["Trim section 3."],
			navigate: [],
			failed: [],
		});
		const h = await mount({ projectId: "p1", messages: [user(1, "go")] });
		await tick();
		// Apply the first, leave the other two as they are — three answers, one submit.
		const groups = [...h.host.querySelectorAll(".fc-blockers fieldset")];
		await click(groups[0]!.querySelector("input[value=remedy]"));
		await click(groups[1]!.querySelector("input[value=leave]"));
		await click(groups[2]!.querySelector("input[value=leave]"));
		await click(byText(h.host, ".fc-blockers button", "Apply these answers"));
		await tick();
		expect(blockerSubmissions).toHaveLength(1);
		expect(blockerSubmissions[0]!.answers.map((answer) => answer.id)).toEqual(["b1", "b2", "b3"]);
		// The card is still here, still answerable — not turned into history.
		expect(h.host.querySelector(".fc-blockers")).not.toBeNull();
	});

	test("a blocker's fix runs as an instruction rather than a lost command", async () => {
		threeOpen();
		setBlockerResolution({
			ok: true,
			blockers: [],
			instructions: ["Trim section 3."],
			navigate: [],
			failed: [],
		});
		const h = await mount({ projectId: "p1", messages: [user(1, "go")] });
		await tick();
		await answerEveryGroup(h);
		await click(byText(h.host, ".fc-blockers button", "Apply these answers"));
		await tick();
		expect(h.runs.map((run) => run.text)).toContain("Trim section 3.");
	});

	test("a remedy that failed is named beside the card", async () => {
		threeOpen();
		setBlockerResolution({
			ok: true,
			blockers: [blocker("b1", "Runtime is 22s over the target.")],
			instructions: [],
			navigate: [],
			failed: [{ id: "b1", message: "Direction could not run: provider timed out." }],
		});
		const h = await mount({ projectId: "p1", messages: [user(1, "go")] });
		await tick();
		await answerEveryGroup(h);
		await click(byText(h.host, ".fc-blockers button", "Apply these answers"));
		await tick();
		expect(h.host.textContent).toContain("provider timed out");
	});

	test("an operator-only blocker offers the place it is cleared", async () => {
		setBlockerBody({
			acknowledged: [],
			blockers: [
				{
					id: "b9",
					source: "story_direction",
					message: "beat-a: shot 1 requires a product with no roster entity",
					remedy: { kind: "navigate", label: "Add the missing reference", target: "references" },
				},
			],
			batch: {
				id: "blockers-nav",
				stage: "pre_generation",
				purpose: "blocker",
				questions: [
					{
						id: "b9",
						header: "Story direction",
						question: "beat-a: shot 1 requires a product with no roster entity",
						options: [
							{
								id: "remedy",
								label: "Add the missing reference",
								value: "navigate",
								description: "Opens where you can clear it.",
								recommended: true,
							},
							{
								id: "leave",
								label: "Leave as is",
								value: "leave as is",
								description: "Keeps it as it is.",
							},
						],
					},
				],
			},
		});
		const h = await mount({ projectId: "p1", messages: [user(1, "go")] });
		await tick();
		const link = h.host.querySelector<HTMLAnchorElement>(".fc-blockers a")!;
		expect(link.getAttribute("href")).toBe("/library/references");
	});

	test("what was left as is stays named beside the card", async () => {
		setBlockerBody({
			acknowledged: [blocker("b7", "Section 2 cites no source.")],
			blockers: [blocker("b1", "Runtime is 22s over the target.")],
			batch: {
				id: "blockers-ack",
				stage: "pre_generation",
				purpose: "blocker",
				questions: [question("b1", "Runtime is 22s over the target.", false)],
			},
		});
		const h = await mount({ projectId: "p1", messages: [user(1, "go")] });
		await tick();
		expect(h.host.querySelector(".fc-blockers")!.textContent).toContain("1 left as it is");
	});

	test("what was left as is survives the last blocker being answered", async () => {
		setBlockerBody({
			acknowledged: [blocker("b7", "Section 2 cites no source.")],
			blockers: [],
			batch: null,
		});
		const h = await mount({ projectId: "p1", messages: [user(1, "go")] });
		await tick();
		expect(h.host.querySelector(".fc-blockers")!.textContent).toContain("1 left as it is");
		expect(h.host.querySelectorAll(".fc-blockers fieldset")).toHaveLength(0);
	});

	test("nothing open is no card", async () => {
		const h = await mount({ projectId: "p1", messages: [user(1, "go")] });
		await tick();
		expect(h.host.querySelector(".fc-blockers")).toBeNull();
	});

	test("the composer stays usable while blockers are open", async () => {
		threeOpen();
		const h = await mount({ projectId: "p1", messages: [user(1, "go")] });
		await tick();
		expect(h.textarea().disabled).toBe(false);
	});

	test("blockers reported by a run that failed are still answerable", async () => {
		threeOpen();
		const failed: ChatLogMessage[] = [
			user(1, "go"),
			{
				id: 2,
				role: "assistant",
				jobId: "j1",
				error: {
					kind: "timeout",
					code: "timeout",
					title: "Planning timed out",
					message: "too long",
					retryable: true,
				},
			},
		];
		const h = await mount({ projectId: "p1", editor: fakeEditor().bridge, messages: failed });
		await tick();
		// The run keeps its own one action, and the blockers keep theirs.
		expect(byText(h.host, "button", "Retry")).toBeDefined();
		expect(h.host.querySelectorAll(".fc-blockers fieldset")).toHaveLength(3);
	});
});
