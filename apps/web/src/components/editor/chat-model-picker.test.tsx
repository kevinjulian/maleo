// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	useChatModelSelection,
	type ChatModelSelection,
} from "@hooks/editor/use-chat-model-selection.ts";
import type { TextSelection } from "@maleo/shared";
import type { TextProviderStatus } from "@models/settings/text-provider.ts";
import { ChatComposerBox } from "./chat-composer-box.tsx";

const api = vi.hoisted(() => ({ fetchTextProviderStatus: vi.fn() }));
vi.mock("@api/text-provider.ts", () => api);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let host: HTMLElement;
let model: ChatModelSelection;
let initial: TextSelection | undefined;
const save = vi.fn();
const status = (): TextProviderStatus => ({
	selected: { providerId: "api", model: "gpt-stale" },
	effective_provider: null,
	selection_error: "Choose an available model",
	source: "settings",
	providers: [
		{
			id: "api",
			label: "API",
			models: ["deepseek-flash", "deepseek-v4-pro"],
			model_options: [
				{ id: "deepseek-flash", source: "discovered" },
				{ id: "deepseek-v4-pro", source: "declared" },
			],
			discovery: { status: "ready", models: ["deepseek-flash"] },
			thinking_levels: ["low", "high"],
			health: "ready",
			health_reason: null,
			supported: true,
			metered_per_token: true,
			context_tokens: 200000,
		},
	],
});

function Probe() {
	const [preference, setPreference] = useState(initial);
	const [value, setValue] = useState("Keep my draft");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	model = useChatModelSelection({
		projectId: "project",
		preference,
		onSelect: async (choice) => {
			setPreference(choice);
			await save(choice);
		},
	});
	return (
		<ChatComposerBox
			model={model}
			value={value}
			onChange={setValue}
			inputRef={inputRef}
			commands={[]}
			onRemoveChip={() => {}}
			onMention={() => {}}
			running={false}
			queued={null}
			onEditQueued={() => {}}
			onRemoveQueued={() => {}}
			replyingTo={null}
			onCancelReply={() => {}}
			onSubmit={() => {}}
		/>
	);
}
beforeEach(() => {
	initial = undefined;
	api.fetchTextProviderStatus.mockReset().mockResolvedValue(status());
	save.mockReset().mockResolvedValue(undefined);
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
});
const mount = () =>
	act(async () => {
		root.render(<Probe />);
	});
const trigger = () => host.querySelector<HTMLButtonElement>('[aria-label="Chat model"]')!;
const send = () => host.querySelector<HTMLButtonElement>('[data-prompt="submit"]')!;

test("invalid default stays visible and blocks send until a valid choice saves", async () => {
	await mount();
	expect(trigger().textContent).toContain("gpt-stale (unavailable)");
	expect(send().disabled).toBe(true);
	await act(async () => model.select({ providerId: "api", model: "deepseek-flash" }));
	expect(save).toHaveBeenCalledWith({ providerId: "api", model: "deepseek-flash" });
	expect(trigger().textContent).toContain("deepseek-flash");
	expect(send().disabled).toBe(false);
	expect(host.querySelector("textarea")?.value).toBe("Keep my draft");
});
test("pending and failed save retain choice and draft, then Retry acknowledges it", async () => {
	await mount();
	save.mockRejectedValueOnce(new Error("offline"));
	await act(async () => model.select({ providerId: "api", model: "deepseek-flash" }));
	expect(host.querySelector('[role="alert"]')?.textContent).toContain("not saved");
	expect(send().disabled).toBe(true);
	await act(async () => model.retrySave());
	expect(model.saveError).toBeNull();
	expect(send().disabled).toBe(false);
	let finish!: () => void;
	save.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	let write: Promise<void>;
	await act(async () => {
		write = model.select({ providerId: "api", model: "deepseek-v4-pro" });
	});
	expect(trigger().disabled).toBe(true);
	expect(host.textContent).toContain("Saving model choice");
	await act(async () => {
		finish();
		await write;
	});
	expect(send().disabled).toBe(false);
	expect(host.querySelector("textarea")?.value).toBe("Keep my draft");
});
test("discovery failure retains saved preference and Retry explicitly refreshes", async () => {
	initial = { providerId: "api", model: "deepseek-flash" };
	const failed = status();
	failed.providers[0]!.discovery = { status: "error", models: [], error: "Discovery timed out" };
	api.fetchTextProviderStatus.mockResolvedValueOnce(failed);
	await mount();
	expect(trigger().textContent).toContain("deepseek-flash");
	expect(host.querySelector('[role="alert"]')?.textContent).toContain("Discovery timed out");
	await act(async () => model.retry());
	expect(api.fetchTextProviderStatus).toHaveBeenLastCalledWith(true);
	expect(model.error).toBeNull();
	expect(model.choice).toEqual(initial);
});
test("picker supports keyboard opening and Escape without editing draft", async () => {
	await mount();
	await act(async () => {
		trigger().focus();
		trigger().dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
		);
	});
	expect(trigger().getAttribute("aria-expanded")).toBe("true");
	await act(async () => {
		document.activeElement?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
		);
	});
	expect(trigger().getAttribute("aria-expanded")).toBe("false");
	expect(document.activeElement).toBe(trigger());
	expect(host.querySelector("textarea")?.value).toBe("Keep my draft");
});
