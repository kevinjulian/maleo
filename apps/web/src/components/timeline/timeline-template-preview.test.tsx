// @vitest-environment happy-dom
import { afterAll, expect, test, vi } from "vite-plus/test";
import type { TimelineTemplatePreviewAudio } from "@api/templates.ts";

const pending = new Map<string, (audio: TimelineTemplatePreviewAudio | null) => void>();
vi.mock("@api/templates.ts", () => ({
	resolveTimelineTemplatePreviewSfx: (cue: string) =>
		new Promise((resolve) => pending.set(cue, resolve)),
	resolveTimelineTemplatePreviewMusic: () => Promise.resolve(null),
}));
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { usePreviewSfx } = await import("./timeline-template-preview.ts");
type Preview = ReturnType<typeof usePreviewSfx>;
const seen: Array<{ cue: string; preview: Preview }> = [];
function Harness({ cue }: { cue: string }) {
	seen.push({ cue, preview: usePreviewSfx(cue) });
	return null;
}
const root = createRoot(document.createElement("div"));
afterAll(async () => {
	await act(async () => root.unmount());
});

test("changed cues block immediately and ignore obsolete audio lookup completion", async () => {
	await act(async () => root.render(createElement(Harness, { cue: "first" })));
	await act(async () => pending.get("first")?.({ url: "/first.wav", title: "First" }));
	expect(seen.at(-1)?.preview.status).toBe("ready");
	await act(async () => root.render(createElement(Harness, { cue: "second" })));
	expect(
		seen
			.filter((entry) => entry.cue === "second")
			.every((entry) => entry.preview.status === "loading" && entry.preview.audio === null),
	).toBe(true);
	await act(async () => root.render(createElement(Harness, { cue: "third" })));
	await act(async () => pending.get("second")?.({ url: "/obsolete.wav", title: "Obsolete" }));
	expect(seen.at(-1)?.preview).toEqual({ audio: null, status: "loading" });
	await act(async () => pending.get("third")?.({ url: "/third.wav", title: "Third" }));
	expect(seen.at(-1)?.preview).toEqual({
		audio: { url: "/third.wav", title: "Third" },
		status: "ready",
	});
});
