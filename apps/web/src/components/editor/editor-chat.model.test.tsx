// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";
import {
	byText,
	click,
	fakeEditor,
	installChatHarness,
	key,
	mount,
	tick,
	type,
} from "./chat-panel-harness.tsx";

installChatHarness();
const first = { providerId: "api", model: "deepseek-flash" };
const second = { providerId: "api", model: "deepseek-v4-pro" };

test("queue keeps model A after model B is selected and rebuilds editor context at launch", async () => {
	const editor = fakeEditor({ selection: [{ kind: "clip", id: "scene:1" }] });
	const h = await mount({ busy: true, modelChoice: first, editor: editor.bridge });
	type(h, "shorten this");
	key(h, "Enter");
	await tick();
	h.setModelChoice(second);
	editor.select([{ kind: "clip", id: "scene:2" }]);
	h.setBusy(false);
	await tick();
	expect(h.runs).toHaveLength(1);
	expect(h.runs[0]?.textSelection).toEqual(first);
	expect(editor.previews.at(-1)?.mentions).toEqual([]);
	expect(h.messages().find((message) => message.role === "user")?.scope?.[0]?.id).toBe("scene:2");
});
test("editing and resubmitting queue captures current model; removal starts nothing", async () => {
	const h = await mount({ busy: true, modelChoice: first });
	type(h, "first instruction");
	key(h, "Enter");
	await tick();
	h.setModelChoice(second);
	await click(byText(h.host, ".fc-queued button", "Edit"));
	key(h, "Enter");
	await tick();
	h.setBusy(false);
	await tick();
	expect(h.runs).toHaveLength(1);
	expect(h.runs[0]?.textSelection).toEqual(second);
	h.setBusy(true);
	type(h, "discard");
	key(h, "Enter");
	await tick();
	await click(byText(h.host, ".fc-queued button", "Remove"));
	h.setBusy(false);
	await tick();
	expect(h.runs).toHaveLength(1);
});
test("pending decision holds queue and answer ignores next-message model", async () => {
	const h = await mount({
		modelChoice: first,
		messages: [
			{
				id: 1,
				role: "assistant",
				jobId: "parked",
				question: {
					jobId: "parked",
					actionId: "decision",
					question: "Continue?",
					options: [{ label: "Yes", value: "yes" }],
				},
			},
		],
	});
	type(h, "after decision");
	key(h, "Enter");
	await tick();
	h.setModelChoice(second);
	expect(h.runs).toEqual([]);
	await click(byText(h.host, "button", "Yes"));
	await tick();
	expect(h.answers).toEqual([
		{ jobId: "parked", answer: "yes", actionId: "decision", batch: undefined },
	]);
	expect(h.runs[0]?.textSelection).toEqual(first);
});
test("rejected submission retains draft and command context", async () => {
	const h = await mount({ modelChoice: first, refuseRuns: true });
	type(h, "Keep this draft");
	key(h, "Enter");
	await tick();
	expect(h.textarea().value).toBe("Keep this draft");
	expect(h.runs).toHaveLength(1);
});
