// @vitest-environment happy-dom
/* The project chat as a workspace: runs read as a status line and their
 * output, scope is visible before sending and frozen after, the composer stays
 * usable while a run works, a parked question is pinned and answered only on
 * purpose, and a settled result leads back to the editor. */
import { describe, expect, test } from "vite-plus/test";
import {
	act,
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
	setCreditBody,
} from "./chat-panel-harness.tsx";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";

installChatHarness();

/* ── 1.1 Feed structure ── */
describe("feed", () => {
	test("an active run is one card with its stage; tool events are not peer messages", async () => {
		const h = await mount({
			busy: true,
			messages: [
				user(1, "make it punchier"),
				{
					id: 2,
					role: "assistant",
					jobId: "j1",
					note: {
						title: "Step 1",
						body: "Reading the hook",
						elapsedSec: 0,
						running: true,
						startedAt: Date.now(),
					},
				},
				{ id: 3, role: "assistant", jobId: "j1", tool: { name: "patch_scene", status: "running" } },
			],
		});
		const cards = h.host.querySelectorAll(".fc-run");
		expect(cards).toHaveLength(1);
		expect(cards[0]!.getAttribute("data-phase")).toBe("running");
		expect(cards[0]!.querySelector("[data-gen='stage']")!.textContent).toBe("patch scene");
		// Activity lives inside the card and is open while nothing useful is out yet.
		const toggle = cards[0]!.querySelector<HTMLButtonElement>(".fc-run-think-h")!;
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(cards[0]!.querySelector("[data-slot='tool-call']")).not.toBeNull();
		// Nothing tool-shaped sits at the conversation level.
		expect(
			h.host.querySelectorAll(
				".fc-chat-log > [data-slot='tool-call'], .fc-turn > [data-slot='tool-call']",
			),
		).toHaveLength(0);
		// Hidden reasoning is never labelled or rendered as such.
		expect(h.host.textContent?.toLowerCase()).not.toContain("thinking");
		expect(h.host.textContent?.toLowerCase()).not.toContain("reasoning");
	});

	test("completed activity collapses once output arrives, and can be reopened", async () => {
		const h = await mount({
			messages: [
				user(1, "tighten"),
				{
					id: 2,
					role: "assistant",
					jobId: "j1",
					tool: { name: "patch_scene", status: "done", note: "patched" },
				},
				{ id: 3, role: "assistant", jobId: "j1", text: "Tightened the hook." },
			],
		});
		const card = h.host.querySelector(".fc-run")!;
		expect(card.getAttribute("data-phase")).toBe("done");
		const toggle = card.querySelector<HTMLButtonElement>(".fc-run-think-h")!;
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(card.querySelector("[data-slot='tool-call']")).toBeNull();
		await click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(card.querySelector("[data-slot='tool-call']")).not.toBeNull();
		// The answer is its own message after the card, not inside it.
		expect(
			byText(
				h.host,
				".fc-turn > [data-slot='chat-message'][data-speaker='assistant']",
				"Tightened the hook.",
			),
		).toBeDefined();
	});

	test("a failed run names the failure and retries its own instruction", async () => {
		const h = await mount({
			messages: [
				user(1, "first thing"),
				user(2, "second thing"),
				{
					id: 3,
					role: "assistant",
					jobId: "j2",
					error: {
						kind: "timeout",
						code: "timeout",
						title: "Planning timed out",
						message: "too long",
						retryable: true,
					},
				},
			],
		});
		const card = h.host.querySelectorAll(".fc-run")[0]!;
		expect(card.getAttribute("data-phase")).toBe("failed");
		expect(card.querySelector("[data-gen='stage']")!.textContent).toBe("Planning timed out");
		await click(byText(card, "[data-gen='action'] button", "Retry"));
		expect(h.runs.map((r) => r.text)).toEqual(["second thing"]);
	});
});

/* ── 1.2 Reading position ── */
describe("reading position", () => {
	function geometry(el: HTMLElement, g: { scrollHeight: number; clientHeight: number }) {
		Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => g.scrollHeight });
		Object.defineProperty(el, "clientHeight", { configurable: true, get: () => g.clientHeight });
	}

	test("scrolled away: position holds and unread appears with Jump to latest", async () => {
		const h = await mount({ busy: true, messages: [user(1, "go")] });
		const log = h.host.querySelector<HTMLElement>(".fc-chat-log")!;
		const g = { scrollHeight: 1000, clientHeight: 200 };
		geometry(log, g);
		log.scrollTop = 100;
		act(() => {
			log.dispatchEvent(new Event("scroll", { bubbles: true }));
		});
		g.scrollHeight = 1400;
		h.setMessages((m) => [
			...m,
			{ id: 2, role: "assistant", jobId: "j1", tool: { name: "search", status: "running" } },
		]);
		expect(log.scrollTop).toBe(100);
		const jump = byText(h.host, ".fc-jump", "Jump to latest");
		expect(jump).toBeDefined();
		await click(jump);
		expect(h.host.querySelector(".fc-jump")).toBeNull();
	});

	test("at the latest: new content follows the bottom", async () => {
		const h = await mount({ busy: true, messages: [user(1, "go")] });
		const log = h.host.querySelector<HTMLElement>(".fc-chat-log")!;
		const g = { scrollHeight: 1000, clientHeight: 200 };
		geometry(log, g);
		log.scrollTop = 800;
		act(() => {
			log.dispatchEvent(new Event("scroll", { bubbles: true }));
		});
		g.scrollHeight = 1400;
		h.setMessages((m) => [
			...m,
			{ id: 2, role: "assistant", jobId: "j1", tool: { name: "search", status: "running" } },
		]);
		expect(log.scrollTop).toBe(1400);
		expect(h.host.querySelector(".fc-jump")).toBeNull();
	});
});

/* ── Context line ── */
describe("context line", () => {
	test("labels follow the selection, removal falls through, and the submitted scope is frozen closed", async () => {
		const ed = fakeEditor({
			selection: [{ kind: "clip", id: "scene:1" }],
			playhead: { kind: "clip", id: "scene:2" },
		});
		const h = await mount({ editor: ed.bridge });
		const live = () =>
			[...h.host.querySelectorAll(".fc-context .fc-context-item")].map((c) => c.textContent);
		expect(live()).toEqual(["Harbour at dawn"]);
		ed.select([
			{ kind: "clip", id: "scene:1" },
			{ kind: "clip", id: "scene:2" },
		]);
		expect(live()).toEqual(["Harbour at dawn", "Storm"]);
		// Removing a selection chip removes the selection source: the playhead answers.
		await click(h.host.querySelector('[aria-label="Remove Harbour at dawn from context"]'));
		expect(live()).toEqual(["Storm"]);
		expect(h.host.querySelector(".fc-context .fc-context-item")!.getAttribute("data-source")).toBe(
			"playhead",
		);

		type(h, "punch this up");
		key(h, "Enter");
		await tick();
		expect(h.runs).toEqual([
			{ text: "punch this up", scope: { mentions: [], excludedSources: ["selection"] } },
		]);
		const disclosure = () =>
			h.host.querySelector<HTMLDetailsElement>(".fc-turn details.fc-sent-context")!;
		const frozen = () => disclosure().querySelector("span")!.textContent;
		// Kept on the instruction, closed: history is not a row of chips.
		expect(disclosure().open).toBe(false);
		expect(frozen()).toBe("Storm");
		// A later selection change does not rewrite what the run received.
		ed.select([{ kind: "clip", id: "scene:1" }]);
		expect(frozen()).toBe("Storm");
		expect(h.messages()[0]!.scope?.map((c) => c.label)).toEqual(["Storm"]);
		expect(live()).toEqual(["Harbour at dawn"]);
	});

	test("several explicit targets stay several labels", async () => {
		const ed = fakeEditor();
		const h = await mount({ editor: ed.bridge });
		type(h, "@Open");
		key(h, "Enter");
		await frame();
		type(h, `${h.textarea().value}and @Sto`);
		key(h, "Enter");
		await frame();
		expect(
			[...h.host.querySelectorAll(".fc-context .fc-context-item")].map((c) => c.textContent),
		).toEqual(["Opening hook", "Storm"]);
	});

	test("whole-project focus shows no line; more than three labels count instead", async () => {
		const whole = await mount({ editor: fakeEditor().bridge });
		expect(whole.host.querySelector(".fc-context")).toBeNull();
		unmount();
		const many = fakeEditor({
			selection: [
				{ kind: "clip", id: "scene:1" },
				{ kind: "clip", id: "scene:2" },
				{ kind: "section", id: "sec-a" },
				{ kind: "section", id: "sec-b" },
			],
		});
		const h = await mount({ editor: many.bridge });
		expect(h.host.querySelectorAll(".fc-context-item")).toHaveLength(3);
		expect(h.host.querySelector(".fc-context-more")!.textContent).toBe("+1");
	});
});

/* ── 2.2 @ autocomplete ── */
describe("@ completion", () => {
	test("filters project items, inserts a stable-id mention, never executes", async () => {
		const ed = fakeEditor();
		const h = await mount({ editor: ed.bridge });
		type(h, "tighten @");
		expect(
			[
				...h.host.querySelectorAll('[role="listbox"][aria-label="Project items"] [role="option"]'),
			].map((o) => o.querySelector(".fc-command-token")!.textContent),
		).toEqual(["@Opening hook", "@The turn", "@Harbour at dawn", "@Storm", "@Brief", "@Captain"]);
		type(h, "tighten @tur");
		const options = h.host.querySelectorAll('[role="option"]');
		expect(options).toHaveLength(1);
		key(h, "Enter");
		await frame();
		expect(h.textarea().value).toBe("tighten @The turn ");
		expect(h.runs).toHaveLength(0);
		// Renaming the entity after insertion does not break the mention: the id travels.
		ed.state.index = {
			...ed.state.index,
			story: [
				{ kind: "section", id: "sec-a", label: "Opening hook" },
				{ kind: "section", id: "sec-b", label: "Midpoint" },
			],
		};
		key(h, "Enter");
		await tick();
		expect(h.runs[0]!.scope?.mentions).toEqual([{ kind: "section", id: "sec-b" }]);
	});

	test("Escape closes the menu without inserting; slash stays separate from @", async () => {
		const ed = fakeEditor();
		const h = await mount({ editor: ed.bridge });
		type(h, "fix @ope");
		expect(h.host.querySelector('[role="listbox"]')).not.toBeNull();
		key(h, "Escape");
		expect(h.host.querySelector('[role="listbox"]')).toBeNull();
		expect(h.textarea().value).toBe("fix @ope");
		expect(h.runs).toHaveLength(0);
		type(h, "/");
		expect(h.host.querySelector('[role="listbox"]')!.getAttribute("aria-label")).toBe("Commands");
	});
});

/* ── 2.3 Queued instruction ── */
describe("send after current", () => {
	test("typing during a run queues one visible instruction and launches it at terminal state", async () => {
		const ed = fakeEditor({ selection: [{ kind: "clip", id: "scene:1" }] });
		const h = await mount({ busy: true, editor: ed.bridge, messages: [user(1, "first")] });
		expect(h.textarea().disabled).toBe(false);
		type(h, "then shorten the ending");
		expect(h.host.querySelector("[data-prompt='submit']")!.getAttribute("aria-label")).toBe(
			"Send after current",
		);
		key(h, "Enter");
		const queued = () => h.host.querySelector(".fc-queued .fc-queued-text")?.textContent;
		expect(queued()).toBe("then shorten the ending");
		expect(h.runs).toHaveLength(0);
		// Replace: one slot, never a hidden list.
		type(h, "actually cut the outro");
		key(h, "Enter");
		expect(h.host.querySelectorAll(".fc-queued")).toHaveLength(1);
		expect(queued()).toBe("actually cut the outro");
		// Edit brings it back into the composer and empties the slot.
		await click(byText(h.host, ".fc-queued button", "Edit"));
		expect(h.textarea().value).toBe("actually cut the outro");
		expect(h.host.querySelector(".fc-queued")).toBeNull();
		key(h, "Enter");
		expect(queued()).toBe("actually cut the outro");
		// Context is rebuilt at launch from the project as it is then.
		ed.select([{ kind: "clip", id: "scene:2" }]);
		h.setBusy(false);
		await tick();
		expect(h.runs).toEqual([
			{ text: "actually cut the outro", scope: { mentions: [], excludedSources: [] } },
		]);
		expect(
			h
				.messages()
				.at(-1)!
				.scope?.map((c) => c.label),
		).toEqual(["Storm"]);
		expect(h.host.querySelector(".fc-queued")).toBeNull();
	});

	test("Remove discards the queued instruction and nothing launches", async () => {
		const h = await mount({ busy: true, messages: [user(1, "first")] });
		type(h, "later");
		key(h, "Enter");
		await click(byText(h.host, ".fc-queued button", "Remove"));
		h.setBusy(false);
		await tick();
		expect(h.runs).toHaveLength(0);
	});
});

/* ── 2.4 Pinned decision + reply mode ── */
describe("pinned decision", () => {
	const approval = (
		id: number,
		actionId: string,
		extra: Partial<NonNullable<ChatLogMessage["question"]>> = {},
	): ChatLogMessage => ({
		id,
		role: "assistant",
		jobId: "j1",
		question: {
			question: `Approve plan ${actionId}?`,
			jobId: "j1",
			actionId,
			options: [
				{ label: "Approve", value: "approve" },
				{ label: "Reject", value: "reject" },
			],
			...extra,
		},
	});

	test("only the latest unresolved decision is pinned; an older one reads as superseded", async () => {
		const h = await mount({ messages: [user(1, "plan"), approval(2, "a1"), approval(3, "a2")] });
		const pinned = h.host.querySelectorAll(".fc-pinned");
		expect(pinned).toHaveLength(1);
		expect(pinned[0]!.textContent).toContain("Approve plan a2?");
		expect(byText(h.host, ".fc-run-note", "Superseded: Approve plan a1?")).toBeDefined();
	});

	test("choosing answers the parked run and returns focus to the composer", async () => {
		const h = await mount({ messages: [user(1, "plan"), approval(2, "a1")] });
		await click(byText(h.host, ".fc-pinned button", "Approve & generate"));
		await frame();
		expect(h.answers).toEqual([
			{ jobId: "j1", answer: "approve", actionId: "a1", batch: undefined },
		]);
		expect(h.host.querySelector(".fc-pinned")).toBeNull();
		expect(document.activeElement).toBe(h.textarea());
	});

	test("a refused answer puts the decision back", async () => {
		const h = await mount({ refuseAnswers: true, messages: [user(1, "plan"), approval(2, "a1")] });
		await click(byText(h.host, ".fc-pinned button", "Approve & generate"));
		await tick();
		expect(h.answers).toHaveLength(1);
		expect(h.host.querySelector(".fc-pinned")!.textContent).toContain("Approve plan a1?");
	});

	test("free text never answers a parked question outside explicit reply mode", async () => {
		const h = await mount({ messages: [user(1, "plan"), approval(2, "a1", { freeText: true })] });
		type(h, "make the ending darker");
		key(h, "Enter");
		await tick();
		expect(h.answers).toHaveLength(0);
		// Not an answer, and no longer a run that abandons the gate either: it waits
		// as the queued instruction until the decision is resolved.
		expect(h.runs).toHaveLength(0);
		expect(h.host.querySelector(".fc-queued")!.textContent).toContain("make the ending darker");
	});

	test("Reply enters Replying to; cancel leaves it; sending in it answers", async () => {
		const h = await mount({ messages: [user(1, "plan"), approval(2, "a1", { freeText: true })] });
		await click(byText(h.host, ".fc-pinned button", "Reply"));
		expect(h.host.querySelector(".fc-replying")!.textContent).toContain("Replying to");
		await click(h.host.querySelector('[aria-label="Cancel reply"]'));
		expect(h.host.querySelector(".fc-replying")).toBeNull();
		await click(byText(h.host, ".fc-pinned button", "Reply"));
		type(h, "swap the second section");
		key(h, "Enter");
		await tick();
		expect(h.answers).toEqual([
			{ jobId: "j1", answer: "swap the second section", actionId: "a1", batch: undefined },
		]);
		expect(h.runs).toHaveLength(0);
	});

	test("a superseding question ends reply mode, and Stop stops", async () => {
		const h = await mount({ messages: [user(1, "plan"), approval(2, "a1", { freeText: true })] });
		await click(byText(h.host, ".fc-pinned button", "Reply"));
		h.setMessages((m) => [...m, approval(3, "a2")]);
		expect(h.host.querySelector(".fc-replying")).toBeNull();
		await click(byText(h.host, ".fc-pinned button", "Stop"));
		expect(h.stops).toBe(1);
	});
});

/* ── 3.1 Progress and recovery ── */
describe("progress", () => {
	test("section generation reports the stage and a measurable count", async () => {
		const h = await mount({
			busy: true,
			messages: [
				user(1, "generate"),
				planMsg(2, ["ready", "ready", "voicing", "pending", "draft", "draft", "draft", "draft"]),
			],
		});
		const card = h.host.querySelector(".fc-run")!;
		expect(card.querySelector("[data-gen='stage']")!.textContent).toBe("Generating section 3 of 8");
		expect(card.querySelector("[data-gen='count']")!.textContent).toBe("2/8 sections");
		const bar = card.querySelector<HTMLProgressElement>("progress")!;
		expect([bar.getAttribute("value"), bar.getAttribute("max")]).toEqual(["2", "8"]);
		expect(h.host.querySelector('[role="status"][aria-live="polite"]')!.textContent).toBe(
			"Generating section 3 of 8",
		);
		expect(byText(card, "[data-gen='action'] button", "Stop")).toBeDefined();
	});

	test("an awaiting run is stopped from its pinned decision, not twice", async () => {
		const h = await mount({
			messages: [
				user(1, "plan"),
				{
					id: 2,
					role: "assistant",
					jobId: "j1",
					question: {
						question: "Approve?",
						jobId: "j1",
						actionId: "a1",
						options: [{ label: "Approve", value: "approve" }],
					},
				},
			],
		});
		expect(
			[...h.host.querySelectorAll("button")].filter((b) => b.textContent === "Stop"),
		).toHaveLength(1);
		expect(h.host.querySelector(".fc-pinned")!.textContent).toContain("Stop");
	});

	test("interruption offers Resume, not a new run", async () => {
		const h = await mount({
			interrupted: { jobId: "j1" },
			messages: [
				user(1, "go"),
				{
					id: 2,
					role: "assistant",
					jobId: "j1",
					tool: { name: "draft", status: "error", note: "interrupted by reload" },
				},
			],
		});
		const card = h.host.querySelector(".fc-run")!;
		expect(card.getAttribute("data-phase")).toBe("interrupted");
		await click(byText(card, "[data-gen='action'] button", "Resume"));
		expect(h.resumes).toBe(1);
		expect(h.runs).toHaveLength(0);
	});

	test("partial failure says completed work was kept and retries only failed scope", async () => {
		const h = await mount({
			messages: [user(1, "generate"), planMsg(2, ["ready", "failed", "ready"])],
		});
		const card = h.host.querySelector(".fc-run")!;
		expect(card.getAttribute("data-phase")).toBe("partial");
		expect(byText(card, ".fc-run-note", "completed and kept")!.textContent).toContain(
			"2 sections completed and kept. 1 failed",
		);
		await click(byText(card, "[data-gen='action'] button", "Retry failed sections"));
		await tick();
		expect(h.runs.map((r) => r.text)).toEqual(["Generate any remaining/failed sections."]);
	});

	test("a credit limit turns failure into a credit action", async () => {
		setCreditBody({
			account: { available_credits: 0, reserved_credits: 0 },
			policy: { dailyLimitCredits: 100, rolling5hLimitCredits: 50 },
			dailyUsedCredits: 100,
			rolling5hUsedCredits: 10,
			dailyRemainingCredits: 0,
			rolling5hRemainingCredits: 40,
			dailyRefreshAt: new Date().toISOString(),
			rolling5hRefreshAt: null,
			enforcementEnabled: true,
		});
		const h = await mount({ messages: [user(1, "generate"), planMsg(2, ["ready", "failed"])] });
		await frame();
		const card = h.host.querySelector(".fc-run")!;
		expect(card.getAttribute("data-phase")).toBe("credit");
		expect(byText(card, "[data-gen='action'] button", "Open credits")).toBeDefined();
		expect(h.host.querySelector(".fc-creditblock")).not.toBeNull();
	});
});

/* ── 3.2 / 3.3 Results ── */
describe("results", () => {
	test("Show changes goes to the touched entities; Undo reverses one settled run", async () => {
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
					result: {
						status: "applied",
						touched: [
							{ kind: "clip", id: "scene:1" },
							{ kind: "section", id: "sec-a" },
						],
						undoable: true,
					},
				},
			],
		});
		const result = h.host.querySelector(".fc-result")!;
		expect(result.textContent).toContain("Changed 2 items");
		expect(result.textContent).toContain("Harbour at dawn, Opening hook");
		await click(byText(result, "button", "Show changes"));
		expect(ed.revealed).toEqual([
			[
				{ kind: "clip", id: "scene:1" },
				{ kind: "section", id: "sec-a" },
			],
		]);
		await click(byText(result, "button", "Undo"));
		expect(ed.undone).toEqual(["j1"]);
		// Undo is conditional: once it no longer undoes only this run, it is gone.
		h.setMessages((m) => [...m]);
		expect(byText(h.host.querySelector(".fc-result")!, "button", "Undo")).toBeUndefined();
	});

	test("a held result explains the conflict and offers review or re-plan, never success", async () => {
		const ed = fakeEditor();
		const h = await mount({
			editor: ed.bridge,
			messages: [
				user(1, "rewrite slide two"),
				{
					id: 2,
					role: "assistant",
					jobId: "j1",
					result: {
						status: "held",
						touched: [{ kind: "clip", id: "scene:2" }],
						reason: "changed",
						conflicts: [{ kind: "clip", id: "scene:2" }],
					},
				},
				{ id: 3, role: "assistant", jobId: "j1", text: "Rewrote slide two." },
			],
		});
		const card = h.host.querySelector(".fc-run")!;
		expect(card.getAttribute("data-phase")).toBe("held");
		const result = card.querySelector(".fc-result.held")!;
		expect(result.getAttribute("role")).toBe("alert");
		expect(result.textContent).toContain("Nothing was changed");
		expect(result.textContent).toContain("Storm");
		expect(byText(card, "button", "Show changes")).toBeUndefined();
		expect(byText(card, "button", "Undo")).toBeUndefined();
		expect(card.textContent).not.toContain("Changed 1 item");
		// The agent's own prose reads as a proposal, not as what happened.
		expect(
			byText(h.host, "[data-slot='chat-message'][data-held]", "Rewrote slide two.")!.textContent,
		).toContain("Proposed, not applied");
		await click(byText(result, "button", "Review conflict"));
		expect(ed.revealed).toEqual([[{ kind: "clip", id: "scene:2" }]]);
		await click(byText(result, "button", "Re-plan with my edits"));
		await tick();
		expect(h.runs.map((r) => r.text)).toEqual(["rewrite slide two"]);
	});
});

/* ── 4.2 Keyboard ── */
describe("keyboard", () => {
	test("Enter sends, Shift+Enter does not, and slash Enter picks without sending", async () => {
		const h = await mount();
		type(h, "line one");
		key(h, "Enter", { shiftKey: true });
		expect(h.runs).toHaveLength(0);
		key(h, "Enter");
		await tick();
		expect(h.runs.map((r) => r.text)).toEqual(["line one"]);
		type(h, "/make");
		key(h, "Enter");
		expect(h.runs).toHaveLength(1);
		expect(h.textarea().value).toContain("Make it punchier and shorter");
	});

	test("controls carry accessible names", async () => {
		const ed = fakeEditor({ selection: [{ kind: "clip", id: "scene:1" }] });
		const h = await mount({ editor: ed.bridge });
		expect(h.textarea().getAttribute("aria-label")).toBe("Instruction");
		expect(h.host.querySelector('[aria-label="Context for the next instruction"]')).not.toBeNull();
		expect(h.host.querySelector('[role="log"][aria-label="Chat history"]')).not.toBeNull();
		expect(h.host.querySelector("[data-prompt='submit']")!.getAttribute("aria-label")).toBe("Send");
	});
});
