// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useVideoRender } from "./use-video-render.ts";
import { setActiveWorkspace } from "@models/core/active-workspace.ts";
const api = vi.hoisted(() => ({ fetchVideoJobs: vi.fn(), retryVideoRender: vi.fn() }));
vi.mock("@api/video-jobs.ts", () => api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let model: ReturnType<typeof useVideoRender>;
let root: Root;
let host: HTMLElement;
const row = {
	id: "j",
	preset: "wide",
	status: "done",
	progress: 1,
	created_at: 1,
	finished_at: 2,
	output_path: null,
	error: null,
};
const result = {
	items: [row],
	total: 70,
	limit: 60,
	offset: 0,
	has_more: true,
	next_offset: 60,
	projects: [{ id: "p", title: "Project" }],
};
function Probe() {
	model = useVideoRender();
	return null;
}
async function mount() {
	await act(async () => root.render(createElement(Probe)));
}
beforeEach(() => {
	api.fetchVideoJobs.mockReset().mockResolvedValue(result);
	api.retryVideoRender.mockReset();
	window.history.replaceState(null, "", "/video?search=needle&project=p&offset=60");
	setActiveWorkspace("default");
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
});
test("reload keeps URL page, filters reset it and Back reads URL", async () => {
	await mount();
	expect(model.filters.offset).toBe(60);
	expect(model.filters.project).toBe("p");
	await act(async () => model.applyFilters({ search: "next" }));
	expect(model.filters.offset).toBe(0);
	expect(window.location.search).toContain("search=next");
	await act(async () => {
		window.history.replaceState(null, "", "/video?status=error&offset=120");
		window.dispatchEvent(new PopStateEvent("popstate"));
	});
	expect(model.filters).toMatchObject({ status: "error", offset: 120 });
});
test("failed refresh retains rows and failed retry reports action error", async () => {
	await mount();
	api.fetchVideoJobs.mockRejectedValue(new Error("offline"));
	await act(async () => model.refresh());
	expect(model.jobs).toHaveLength(1);
	expect(model.error).toContain("offline");
	api.retryVideoRender.mockRejectedValue(new Error("denied"));
	await act(async () => model.retryJob("j"));
	expect(model.error).toContain("Could not retry export");
});
test("workspace switch clears old data and ignores late previous response", async () => {
	let old!: (value: unknown) => void;
	api.fetchVideoJobs
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					old = resolve;
				}),
		)
		.mockResolvedValue({ ...result, items: [], total: 0 });
	await mount();
	await act(async () => setActiveWorkspace("other"));
	await act(async () => old(result));
	expect(model.workspace).toBe("other");
	expect(model.jobs).toEqual([]);
	expect(model.filters.offset).toBe(0);
});
test("focus refreshes terminal history without submit or retry", async () => {
	await mount();
	const count = api.fetchVideoJobs.mock.calls.length;
	await act(async () => window.dispatchEvent(new Event("focus")));
	expect(api.fetchVideoJobs.mock.calls.length).toBeGreaterThan(count);
	expect(api.retryVideoRender).not.toHaveBeenCalled();
});
