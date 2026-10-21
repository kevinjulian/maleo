// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createShellChromeStore } from "@stores/shell-chrome-store.ts";
import { useRenderFlow, type RenderFlow } from "./use-render-flow.ts";
import type { Job } from "@models/video/render-job.ts";

const api = vi.hoisted(() => ({ getOrNull: vi.fn() }));
vi.mock("@api/client.ts", () => api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLElement;
let flow: RenderFlow;
let chrome = createShellChromeStore();
const submit = vi.fn();
const setSaveError = vi.fn();
function Probe({ projectId }: { projectId?: string }) {
	flow = useRenderFlow({
		chrome,
		projectId,
		submit,
		setSaveError,
		getBlockers: () => [],
		isVideo: () => true,
	});
	return null;
}
const job = (status: Job["status"]): Job => ({
	id: "same-job",
	status,
	preset: "wide",
	output_path: null,
	output_url: status === "done" ? "/api/media/output" : null,
	error: null,
	progress: 0.4,
	created_at: 1,
	finished_at: null,
});
async function mount(projectId?: string) {
	await act(async () => {
		root.render(createElement(Probe, { projectId }));
	});
}
async function focus() {
	await act(async () => {
		window.dispatchEvent(new Event("focus"));
	});
}
beforeEach(() => {
	chrome = createShellChromeStore();
	submit.mockReset();
	api.getOrNull.mockReset();
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
});

test("reload and return navigation attach server-owned active job without submission", async () => {
	api.getOrNull.mockResolvedValue({ active: job("running"), latest: job("done") });
	await mount("p");
	expect(chrome.get()).toMatchObject({
		renderJobId: "same-job",
		rendering: true,
		exportConnection: "connected",
	});
	await act(async () => flow.confirmRender());
	expect(submit).not.toHaveBeenCalled();
	await act(async () => root.unmount());
	root = createRoot(host);
	chrome = createShellChromeStore();
	await mount("p");
	expect(chrome.get().renderJobId).toBe("same-job");
	expect(submit).not.toHaveBeenCalled();
});
test("checking blocks duplicate submission and status opens without menu", async () => {
	api.getOrNull.mockImplementation(() => new Promise(() => {}));
	await mount("p");
	await act(async () => {
		flow.confirmRender();
		flow.onRenderClick();
	});
	expect(chrome.get().exportConnection).toBe("checking");
	expect(chrome.get().renderInfoOpen).toBe(true);
	expect(submit).not.toHaveBeenCalled();
});
test("outage retains progress and focus recovers terminal result", async () => {
	api.getOrNull.mockResolvedValue({ active: job("running"), latest: null });
	await mount("p");
	api.getOrNull.mockRejectedValue(new Error("offline"));
	await focus();
	expect(chrome.get()).toMatchObject({
		exportConnection: "disconnected",
		rendering: true,
		renderStatus: { progress: 0.4 },
	});
	await act(async () => flow.confirmRender());
	expect(submit).not.toHaveBeenCalled();
	api.getOrNull.mockResolvedValue({ active: null, latest: job("done") });
	await focus();
	expect(chrome.get()).toMatchObject({
		exportConnection: "connected",
		rendering: false,
		renderStatus: { status: "done" },
	});
});
test("confirmed missing project stops active state and exposes recovery error", async () => {
	api.getOrNull.mockResolvedValue(null);
	await mount("gone");
	expect(chrome.get()).toMatchObject({ exportConnection: "missing", rendering: false });
	expect(chrome.get().exportError).toContain("no longer available");
});
test("late response for previous project cannot attach to next project", async () => {
	let resolve!: (value: unknown) => void;
	api.getOrNull
		.mockImplementationOnce(
			() =>
				new Promise((r) => {
					resolve = r;
				}),
		)
		.mockResolvedValue({ active: null, latest: null });
	await mount("old");
	await mount("new");
	await act(async () => resolve({ active: job("running"), latest: null }));
	expect(chrome.get()).toMatchObject({
		renderJobId: null,
		rendering: false,
		exportConnection: "idle",
	});
});
test("browser draft without server job does not request discovery", async () => {
	await mount();
	expect(api.getOrNull).not.toHaveBeenCalled();
	expect(chrome.get().exportConnection).toBe("idle");
});
test("cleanup removes focus refresh and reconnect listeners", async () => {
	api.getOrNull.mockResolvedValue({ active: null, latest: job("error") });
	await mount("p");
	await act(async () => root.unmount());
	root = createRoot(host);
	const calls = api.getOrNull.mock.calls.length;
	await focus();
	expect(api.getOrNull).toHaveBeenCalledTimes(calls);
});

test("known job disappearing from history becomes unavailable instead of idle", async () => {
	api.getOrNull.mockResolvedValue({ active: job("running"), latest: null });
	await mount("p");
	api.getOrNull.mockResolvedValue({ active: null, latest: null });
	await focus();
	expect(chrome.get()).toMatchObject({
		exportConnection: "missing",
		rendering: false,
		renderStatus: null,
	});
	expect(chrome.get().exportError).toContain("no longer available in history");
	expect(submit).not.toHaveBeenCalled();
});
