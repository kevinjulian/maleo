import { afterEach, expect, test, vi } from "vite-plus/test";
import { startChatAgent } from "./chat.ts";

afterEach(() => vi.unstubAllGlobals());

test("chat submits selection and reports actionable selection rejection", async () => {
	const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
		Response.json(
			{ error: "text_selection_unavailable", message: "Choose another available model." },
			{ status: 400 },
		),
	);
	vi.stubGlobal("fetch", fetch);
	const selection = { providerId: "api", model: "deepseek-flash" };
	await expect(
		startChatAgent({
			projectId: "project",
			instruction: "Keep draft",
			contentType: "video",
			textSelection: selection,
		}),
	).rejects.toThrow(/^Choose another available model\.$/);
	const [, init] = fetch.mock.calls[0]!;
	expect(JSON.parse(String(init.body))).toMatchObject({ text_selection: selection });
});

test("unrelated server failures retain their original error", async () => {
	vi.stubGlobal("fetch", async () =>
		Response.json({ error: "runtime_unavailable" }, { status: 502 }),
	);
	await expect(
		startChatAgent({ projectId: "project", instruction: "Keep draft", contentType: "video" }),
	).rejects.toThrow("runtime_unavailable");
});
