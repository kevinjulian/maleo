/* The `useMediaImport` test harness: a fake upload transport, a stubbed fetch,
 * and a mounted hook. Shared by the import and pending-asset suites; the
 * suites register its `beforeEach`/`afterEach` through `useHarness()`. */
import { afterEach, beforeEach } from "vite-plus/test";
import {
	ProjectMediaImportResponseSchema,
	type ProjectMediaImportPage,
	type ReadyImportedMedia,
} from "@maleo/shared";
import type { MediaImportControls } from "./use-media-import.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useMediaImport } = await import("./use-media-import.ts");
export { act };
const realFetch = globalThis.fetch;
const RealXHR = globalThis.XMLHttpRequest;
/** Upload progress each fake request reports before sending, as fractions of the body. */
let progressSteps: number[] = [];
export const setUploadProgress = (steps: number[]): void => {
	progressSteps = steps;
};
interface ProgressStep {
	lengthComputable: boolean;
	loaded: number;
	total: number;
}
interface FakeUpload {
	onprogress: ((event: ProgressStep) => void) | null;
}
/** XHR stand-in that sends through the stubbed fetch, so upload and poll stubs stay in one place. */
class FakeXHR {
	status = 0;
	responseText = "";
	withCredentials = false;
	upload: FakeUpload = { onprogress: null };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onabort: (() => void) | null = null;
	private method = "GET";
	private url = "";
	private headers: Record<string, string> = {};
	private controller = new AbortController();
	open(method: string, url: string) {
		this.method = method;
		this.url = url;
	}
	setRequestHeader(name: string, value: string) {
		this.headers[name] = value;
	}
	abort() {
		this.controller.abort();
		this.onabort?.();
	}
	send(body: Blob) {
		for (const step of progressSteps)
			this.upload.onprogress?.({
				lengthComputable: true,
				loaded: step * body.size,
				total: body.size,
			});
		void globalThis
			.fetch(this.url, {
				method: this.method,
				headers: this.headers,
				body,
				signal: this.controller.signal,
			})
			.then(async (response) => {
				this.status = response.status;
				this.responseText = await response.text();
				this.onload?.();
			})
			.catch(() => {
				if (!this.controller.signal.aborted) this.onerror?.();
			});
	}
}
let controls: MediaImportControls | undefined;
let root: ReturnType<typeof createRoot>;
export const admitted: Array<{ project: string; asset: ReadyImportedMedia }> = [];
export const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

/** A ready import; given its minted media id, the server publishes under it. */
export function response(filename: string, mediaId?: string) {
	const id = crypto.randomUUID();
	return ProjectMediaImportResponseSchema.parse({
		id,
		filename,
		status: "ready",
		error: null,
		asset: {
			id,
			label: filename,
			kind: "image",
			source: "upload",
			url: `/api/media/${mediaId ?? crypto.randomUUID()}`,
			metadata: { originalFilename: filename, kind: "image", byteSize: 1 },
			compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
			importedSource: {
				revision: crypto.randomUUID(),
				fingerprint: "a".repeat(64),
				originalMediaId: crypto.randomUUID(),
			},
		},
	});
}
function Harness({ use }: { use: () => MediaImportControls }) {
	controls = use();
	return null;
}
export const current = () => {
	if (!controls) throw new Error("Import hook not mounted");
	return controls;
};
export const tick = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
/** Mount a hook built by `use`; `current()` reads what it returned last. */
export const mountWith = async (use: () => MediaImportControls) => {
	await act(async () => root.render(createElement(Harness, { use })));
	await tick();
};
export const mount = (project: string) =>
	mountWith(() => useMediaImport(project, (asset) => admitted.push({ project, asset })));
const requestUrl = (input: string | URL | Request): string =>
	typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
export const stub = (
	fn: (url: string, init: RequestInit) => Promise<Response>,
	pending: ProjectMediaImportPage["items"] = [],
) => {
	globalThis.fetch = Object.assign(
		(input: string | URL | Request, init?: RequestInit) =>
			!init?.method &&
			new URL(requestUrl(input), "http://local.invalid").pathname.endsWith("/media/import")
				? Promise.resolve(json({ items: pending, nextCursor: null }))
				: fn(requestUrl(input), init ?? {}),
		{ preconnect: realFetch.preconnect },
	);
};
export function useHarness(): void {
	beforeEach(() => {
		Reflect.set(globalThis, "XMLHttpRequest", FakeXHR);
		progressSteps = [];
		root = createRoot(document.createElement("div"));
		admitted.length = 0;
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		globalThis.fetch = realFetch;
		Reflect.set(globalThis, "XMLHttpRequest", RealXHR);
	});
}
