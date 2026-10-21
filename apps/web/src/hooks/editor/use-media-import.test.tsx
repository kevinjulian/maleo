// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import {
	DEFAULT_MEDIA_IMPORT_LIMITS,
	ProjectMediaImportResponseSchema,
	type ProjectMediaImportPage,
	type ReadyImportedMedia,
} from "@maleo/shared";
import type { MediaImportControls } from "./use-media-import.ts";
import type { MediaAsset } from "@models/timeline/editor-media.ts";
import type { LocalMediaProbe } from "@models/analysis/local-media-probe.ts";
import type { UploadStaging } from "@services/upload-staging/upload-staging.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useMediaImport } = await import("./use-media-import.ts");
const { resolveMediaUrl, clearPendingSources } =
	await import("@models/core/pending-media-sources.ts");
const realFetch = globalThis.fetch;
const RealXHR = globalThis.XMLHttpRequest;
/** Upload progress each fake request reports before sending, as fractions of the body. */
let progressSteps: number[] = [];
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
const admitted: Array<{ project: string; asset: ReadyImportedMedia }> = [];
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function response(filename: string) {
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
			url: `/api/media/${crypto.randomUUID()}`,
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
function Harness({ project }: { project: string }) {
	controls = useMediaImport(project, (asset) => admitted.push({ project, asset }));
	return null;
}
const current = () => {
	if (!controls) throw new Error("Import hook not mounted");
	return controls;
};
const tick = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
const mount = async (project: string) => {
	await act(async () => root.render(createElement(Harness, { project })));
	await tick();
};
const stub = (
	fn: (url: string, init: RequestInit) => Promise<Response>,
	pending: ProjectMediaImportPage["items"] = [],
) => {
	globalThis.fetch = Object.assign(
		(input: string | URL | Request, init?: RequestInit) =>
			!init?.method &&
			new URL(String(input), "http://local.invalid").pathname.endsWith("/media/import")
				? Promise.resolve(json({ items: pending, nextCursor: null }))
				: fn(String(input), init ?? {}),
		{ preconnect: realFetch.preconnect },
	);
};
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

test("partial batch keeps successes and retries only failed files with original request identity", async () => {
	const attempts = new Map<string, string[]>();
	stub(async (url, init) => {
		if (url.includes("readiness"))
			return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
		const headers = new Headers(init.headers);
		const name = decodeURIComponent(headers.get("x-file-name")!);
		const previous = attempts.get(name) ?? [];
		previous.push(headers.get("x-upload-id")!);
		attempts.set(name, previous);
		expect(headers.get("x-file-size")).toBe("1");
		return name === "retry.png" && previous.length === 1
			? json({ message: "Storage offline" }, 503)
			: json(response(name), 202);
	});
	await mount("first");
	await act(async () =>
		current().enqueue([
			new File(["x"], "good.png"),
			new File(["x"], "retry.png"),
			new File(["x"], "bad.exe"),
		]),
	);
	await tick();
	expect(admitted.map(({ asset }) => asset.label)).toEqual(["good.png"]);
	expect(current().rows.map((row) => row.status)).toEqual(["ready", "failed", "failed"]);
	const retry = current().rows.find((row) => row.filename === "retry.png")!;
	await act(async () => current().retry(retry.key));
	await tick();
	expect(admitted.map(({ asset }) => asset.label)).toEqual(["good.png", "retry.png"]);
	expect(attempts.get("good.png")).toHaveLength(1);
	expect(attempts.get("retry.png")).toEqual([retry.key, retry.key]);
	expect(current().rows[0]!.file).toBeUndefined();
});

test("only two uploads run; cancelling queued file never submits it", async () => {
	const pending: Array<{ name: string; finish: (response: Response) => void }> = [];
	stub(async (url, init) => {
		if (url.includes("readiness"))
			return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
		if (init.method === "DELETE") return json({}, 404);
		const name = decodeURIComponent(new Headers(init.headers).get("x-file-name")!);
		return new Promise((finish) => pending.push({ name, finish }));
	});
	await mount("first");
	await act(async () =>
		current().enqueue(
			["first.png", "second.png", "third.png"].map((name) => new File(["x"], name)),
		),
	);
	expect(pending.map((request) => request.name)).toEqual(["first.png", "second.png"]);
	await act(async () => current().cancel(current().rows[2]!.key));
	await act(async () => {
		for (const request of pending) request.finish(json(response(request.name), 202));
	});
	await tick();
	expect(current().rows.map((row) => row.status)).toEqual(["ready", "ready", "cancelled"]);
	expect(pending).toHaveLength(2);
});

test("project switch aborts upload and ignores completion even when transport ignores cancellation", async () => {
	let placements = 0;
	let finish: ((response: Response) => void) | undefined;
	let signal: AbortSignal | undefined;
	stub(async (url, init) => {
		if (url.includes("readiness"))
			return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
		signal = init.signal ?? undefined;
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	await mount("first");
	await act(async () =>
		current().enqueue([new File(["x"], "late.png")], () => {
			placements++;
			return true;
		}),
	);
	await mount("second");
	expect(signal?.aborted).toBe(true);
	await act(async () => finish?.(json(response("late.png"), 202)));
	await tick();
	expect(admitted).toEqual([]);
	expect(placements).toBe(0);
	expect(current().rows).toEqual([]);
});

test("reload restores durable pending import by polling; never uploads again or places stale drop", async () => {
	const ready = response("restored.png");
	const pending = { ...ready, status: "processing", asset: null };
	let polls = 0;
	stub(
		async (url, init) => {
			if (url.includes("readiness"))
				return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
			expect(init.method).toBeUndefined();
			polls++;
			return json(ready);
		},
		[{ requestKey: "restored-key", import: ProjectMediaImportResponseSchema.parse(pending) }],
	);
	await mount("first");
	await tick();
	expect(polls).toBe(1);
	expect(admitted[0]).toMatchObject({ project: "first", asset: ready.asset });
	expect(current().rows[0]).toMatchObject({
		key: "restored-key",
		id: ready.id,
		status: "ready",
		retryable: false,
	});
});

test("a drop before import is available is reported, not silently discarded", async () => {
	stub(async (url) =>
		url.includes("readiness")
			? json({
					available: false,
					limits: DEFAULT_MEDIA_IMPORT_LIMITS,
					reason: "Media worker unavailable",
				})
			: json({}, 500),
	);
	await mount("first");
	await act(async () => current().enqueue([new File(["x"], "early.png")]));
	expect(current().rows).toEqual([]);
	expect(current().error).toBe("Import unavailable: Media worker unavailable");
});

test("a transient poll failure keeps polling the same import; only a missing import fails", async () => {
	const pending = { ...response("flaky.png"), status: "processing" as const, asset: null };
	const ready = { ...response("flaky.png"), id: pending.id };
	let polls = 0,
		uploads = 0;
	stub(
		async (url, init) => {
			if (url.includes("readiness"))
				return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
			if (init.method === "POST") {
				uploads++;
				return json(pending, 202);
			}
			if (url.includes("gone")) return json({ message: "Import not found" }, 404);
			polls++;
			return polls === 1 ? json({ message: "Bad gateway" }, 502) : json(ready);
		},
		[
			{
				requestKey: "gone-key",
				import: ProjectMediaImportResponseSchema.parse({
					...pending,
					id: "gone",
					filename: "gone.png",
				}),
			},
		],
	);
	await mount("first");
	await act(async () => current().enqueue([new File(["x"], "flaky.png")]));
	await tick();
	expect(current().rows.find((row) => row.filename === "flaky.png")).toMatchObject({
		status: "processing",
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 2100));
	});
	expect(current().rows.find((row) => row.filename === "flaky.png")).toMatchObject({
		status: "ready",
	});
	expect(current().rows.find((row) => row.id === "gone")).toMatchObject({
		status: "failed",
		error: "Import not found",
	});
	expect(uploads).toBe(1);
});

test("row updates replace row objects instead of mutating rendered state", async () => {
	stub(async (url) =>
		url.includes("readiness")
			? json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS })
			: new Promise(() => {}),
	);
	await mount("first");
	await act(async () => current().enqueue([new File(["x"], "held.png")]));
	const uploading = current().rows[0]!;
	expect(uploading.status).toBe("uploading");
	await act(async () => current().cancel(uploading.key));
	expect(uploading.status).toBe("uploading");
	expect(current().rows[0]!.status).toBe("cancelled");
});

test("upload rows report real byte progress, then processing after the last byte", async () => {
	const pending = { ...response("progress.png"), status: "processing" as const, asset: null };
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	stub(async (url, init) => {
		if (url.includes("readiness"))
			return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
		if (init.method === "POST") {
			await held;
			return json(pending, 202);
		}
		return new Promise(() => {});
	});
	progressSteps = [0.25, 0.5];
	await mount("first");
	await act(async () => current().enqueue([new File(["xxxx"], "progress.png")]));
	expect(current().rows[0]).toMatchObject({ status: "uploading", progress: 0.5 });
	progressSteps = [];
	await act(async () => {
		release();
	});
	await tick();
	expect(current().rows[0]).toMatchObject({ status: "processing" });
});

test("a gateway HTML error reads as a short message, and Delete dismisses a failed row for good", async () => {
	const cancelled: string[] = [];
	stub(async (url, init) => {
		if (url.includes("readiness"))
			return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
		if (init.method === "DELETE") {
			cancelled.push(url);
			return json({}, 404);
		}
		return new Response("<!DOCTYPE html><title>502: Bad gateway</title>", {
			status: 502,
			headers: { "content-type": "text/html" },
		});
	});
	await mount("first");
	await act(async () => current().enqueue([new File(["x"], "gateway.png")]));
	await tick();
	expect(current().rows[0]).toMatchObject({
		status: "failed",
		error: "Upload service unavailable (HTTP 502). Retry in a moment.",
	});
	await act(async () => current().dismiss(current().rows[0]!.key));
	await tick();
	expect(current().rows).toEqual([]);
	expect(cancelled.some((url) => url.includes("/media/import/request/"))).toBe(true);
});

describe("pending assets", () => {
	const pendingAdmitted: MediaAsset[] = [];
	const discarded: string[] = [];
	/* Staging as a reload finds it: what an earlier tab left, keyed by request key. */
	const staged = new Map<string, File>(),
		removedStaged: string[] = [];
	const staging: UploadStaging = {
		stage: async (_project, key, file) => {
			staged.set(key, file);
			return "persisted";
		},
		read: async (_project, key) => staged.get(key),
		remove: async (_project, key) => {
			staged.delete(key);
			removedStaged.push(key);
		},
	};
	let probe: LocalMediaProbe = { duration: 2, decodable: true };
	function PendingHarness({ project }: { project: string }) {
		controls = useMediaImport(project, (asset) => admitted.push({ project, asset }), {
			admit: (asset) => {
				pendingAdmitted.push(asset);
			},
			has: (key) => pendingAdmitted.some((asset) => asset.id === key),
			discard: (key) => {
				discarded.push(key);
				return undefined;
			},
			validate: (_key, kind, duration) =>
				kind !== "image" || duration === -1 ? "Choose an image file" : undefined,
			probe: async () => probe,
			staging,
		});
		return null;
	}
	const mountPending = async () => {
		await act(async () => root.render(createElement(PendingHarness, { project: "p" })));
		await tick();
	};
	/* Holds every upload until `release` answers it ready, so assertions run mid-upload. */
	const holdUploads = () => {
		const held: Array<() => void> = [];
		stub(async (url, init) => {
			if (url.includes("readiness"))
				return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
			const name = decodeURIComponent(new Headers(init.headers).get("x-file-name")!);
			return new Promise<Response>((resolve) =>
				held.push(() => resolve(json(response(name), 202))),
			);
		});
		return {
			release: async () => {
				await act(async () => {
					held.splice(0).forEach((answer) => answer());
				});
				await tick();
			},
		};
	};
	beforeEach(() => {
		pendingAdmitted.length = 0;
		discarded.length = 0;
		staged.clear();
		removedStaged.length = 0;
		probe = { duration: 2, decodable: true };
		Object.assign(URL, { createObjectURL: () => "blob:http://local/1", revokeObjectURL: () => {} });
	});
	afterEach(() => {
		clearPendingSources();
	});

	test("a chosen file is a usable asset before it uploads, and readiness resolves it without admitting another", async () => {
		const uploads = holdUploads();
		await mountPending();
		await act(async () => current().enqueue([new File(["x"], "clip.png")]));
		await tick();
		const key = current().rows[0]!.key;
		expect(pendingAdmitted).toEqual([
			expect.objectContaining({ id: key, url: `pending:${key}`, kind: "image", source: "upload" }),
		]);
		expect(current().rows[0]!.status).toBe("uploading");
		expect(resolveMediaUrl(`pending:${key}`)).toBe("blob:http://local/1");
		await uploads.release();
		expect(current().rows[0]!.status).toBe("ready");
		expect(admitted).toEqual([]);
		expect(resolveMediaUrl(`pending:${key}`)).toMatch(/^\/api\/media\//);
	});

	test("a drop places the pending asset at once and is not placed again when ready", async () => {
		const uploads = holdUploads();
		await mountPending();
		const placed: MediaAsset[] = [];
		await act(async () =>
			current().enqueue([new File(["x"], "clip.png")], (asset) => {
				placed.push(asset);
				return true;
			}),
		);
		await tick();
		expect(placed.map((asset) => asset.url)).toEqual([`pending:${current().rows[0]!.key}`]);
		expect(pendingAdmitted).toEqual([]);
		await uploads.release();
		expect(placed).toHaveLength(1);
		expect(admitted).toEqual([]);
	});

	test("a file with no measurable length is staged, not placed, and says why", async () => {
		holdUploads();
		probe = { decodable: false, blocked: "Length unknown until processing finishes" };
		await mountPending();
		let calls = 0;
		await act(async () =>
			current().enqueue([new File(["x"], "clip.mp4")], () => {
				calls++;
				return true;
			}),
		);
		await tick();
		expect(calls).toBe(0);
		expect(pendingAdmitted).toHaveLength(1);
		expect(current().rows[0]!.error).toBe("Length unknown until processing finishes");
	});

	test("a loaded document's pending references resolve to finished imports and follow unfinished ones", async () => {
		const done = response("done.png"),
			working = { ...response("working.png"), status: "processing" as const, asset: null };
		let polled = false;
		stub(async (url) => {
			if (url.includes("readiness"))
				return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
			if (url.includes("/request/done")) return json(done);
			if (url.includes("/request/working")) return json(working);
			if (url.includes("/request/")) return json({ error: "not_found" }, 404);
			if (url.includes(`/${working.id}`)) {
				polled = true;
				return json({ ...response("working.png"), id: working.id });
			}
			throw new Error(`unexpected ${url}`);
		});
		await mountPending();
		pendingAdmitted.push({
			id: "working",
			url: "pending:working",
			label: "working.png",
			kind: "image",
			source: "upload",
		});
		await act(async () =>
			current().resolve([
				{ url: "pending:done", label: "done.png" },
				{ url: "pending:working", label: "working.png" },
				{ url: "pending:gone", label: "gone.png" },
				{ url: "/api/media/x", label: "managed" },
			]),
		);
		await tick();
		await tick();
		expect(resolveMediaUrl("pending:done")).toBe(done.asset!.url);
		expect(current().rows.find((row) => row.key === "gone")).toMatchObject({
			status: "failed",
			filename: "gone.png",
			error: "Upload interrupted. Choose the file again.",
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1100));
		});
		expect(polled).toBe(true);
		expect(resolveMediaUrl("pending:working")).toMatch(/^\/api\/media\//);
		// Resolution, not admission: the ready asset is not added a second time.
		expect(admitted).toEqual([]);
	});

	test("cancelling or deleting an unfinished upload discards its pending asset", async () => {
		holdUploads();
		await mountPending();
		await act(async () => current().enqueue([new File(["x"], "a.png"), new File(["x"], "b.png")]));
		await tick();
		const [a, b] = current().rows.map((row) => row.key);
		await act(async () => {
			current().cancel(a!);
			current().dismiss(b!);
		});
		expect(discarded).toEqual([a, b]);
		expect(resolveMediaUrl(`pending:${a}`)).toBe("");
	});

	test("reload resumes each pending upload by what the server and staging hold, under the same identity", async () => {
		const uploads: string[] = [];
		const done = response("done.png");
		stub(async (url, init) => {
			if (url.includes("readiness"))
				return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
			if (url.includes("/request/done")) return json(done);
			if (url.includes("/request/failed"))
				return json({
					...response("failed.png"),
					status: "failed",
					asset: null,
					error: "Upload failed; retry file",
				});
			if (url.includes("/request/expired"))
				return json({ ...response("expired.png"), status: "uploading", asset: null });
			if (url.includes("/request/")) return json({ error: "not_found" }, 404);
			if (init.method === "POST") {
				const headers = new Headers(init.headers);
				uploads.push(headers.get("x-upload-id")!);
				return json(response(decodeURIComponent(headers.get("x-file-name")!)), 202);
			}
			throw new Error(`unexpected ${url}`);
		});
		staged.set("failed", new File(["x"], "failed.png"));
		staged.set("expired", new File(["x"], "expired.png"));
		staged.set("never", new File(["x"], "never.png"));
		staged.set("done", new File(["x"], "done.png"));
		await mountPending();
		for (const key of ["done", "failed", "expired", "never", "lost"])
			pendingAdmitted.push({
				id: key,
				url: `pending:${key}`,
				label: `${key}.png`,
				kind: "image",
				source: "upload",
			});
		await act(async () =>
			current().resolve(pendingAdmitted.map(({ url, label }) => ({ url, label }))),
		);
		for (let i = 0; i < 4; i++) await tick();
		expect(resolveMediaUrl("pending:done")).toBe(done.asset!.url);
		expect(uploads.sort()).toEqual(["expired", "failed", "never"]);
		for (const key of ["failed", "expired", "never"])
			expect(resolveMediaUrl(`pending:${key}`)).toMatch(/^\/api\/media\//);
		expect(removedStaged.sort()).toEqual(["done", "expired", "failed", "never"]);
		expect(current().rows.find((row) => row.key === "lost")).toMatchObject({
			status: "failed",
			interrupted: true,
			error: "Upload interrupted. Choose the file again.",
		});
		// Every resumed upload resolves its existing asset; none is admitted again.
		expect(admitted).toEqual([]);
		expect(pendingAdmitted).toHaveLength(5);
	});

	test("an interrupted asset takes a file chosen again under the same identity, checked first", async () => {
		const uploads: string[] = [];
		stub(async (url, init) => {
			if (url.includes("readiness"))
				return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
			if (url.includes("/request/")) return json({ error: "not_found" }, 404);
			if (init.method === "POST") {
				const headers = new Headers(init.headers);
				uploads.push(
					`${headers.get("x-upload-id")}:${decodeURIComponent(headers.get("x-file-name")!)}`,
				);
				return json(response("again.png"), 202);
			}
			throw new Error(`unexpected ${url}`);
		});
		await mountPending();
		pendingAdmitted.push({
			id: "lost",
			url: "pending:lost",
			label: "lost.png",
			kind: "image",
			source: "upload",
		});
		await act(async () => current().resolve([{ url: "pending:lost", label: "lost.png" }]));
		await tick();
		await tick();
		expect(current().rows[0]).toMatchObject({ key: "lost", interrupted: true });
		await act(async () => current().chooseAgain("lost", new File(["x"], "wrong.mp4")));
		await tick();
		expect(current().rows[0]).toMatchObject({ status: "failed", error: "Choose an image file" });
		expect(uploads).toEqual([]);
		await act(async () => current().chooseAgain("lost", new File(["x"], "again.png")));
		await tick();
		await tick();
		expect(uploads).toEqual(["lost:again.png"]);
		expect(resolveMediaUrl("pending:lost")).toMatch(/^\/api\/media\//);
		expect([admitted, pendingAdmitted.length]).toEqual([[], 1]);
	});

	test("a pending asset restored as a failed server import on mount still resumes from staging", async () => {
		const uploads: string[] = [];
		const failed = {
			...response("restored.png"),
			status: "failed" as const,
			asset: null,
			error: "Upload failed; retry file",
		};
		stub(
			async (url, init) => {
				if (url.includes("readiness"))
					return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
				if (url.includes("/request/restored")) return json(failed);
				if (init.method === "POST") {
					uploads.push(new Headers(init.headers).get("x-upload-id")!);
					return json(response("restored.png"), 202);
				}
				throw new Error(`unexpected ${url}`);
			},
			[{ requestKey: "restored", import: failed }],
		);
		staged.set("restored", new File(["x"], "restored.png"));
		await mountPending();
		expect(current().rows[0]).toMatchObject({ key: "restored", status: "failed" });
		pendingAdmitted.push({
			id: "restored",
			url: "pending:restored",
			label: "restored.png",
			kind: "image",
			source: "upload",
		});
		await act(async () => current().resolve([{ url: "pending:restored", label: "restored.png" }]));
		for (let i = 0; i < 3; i++) await tick();
		expect(uploads).toEqual(["restored"]);
		expect(resolveMediaUrl("pending:restored")).toMatch(/^\/api\/media\//);
	});

	test("a chosen file is staged and leaves staging once ready", async () => {
		const uploads = holdUploads();
		await mountPending();
		await act(async () => current().enqueue([new File(["x"], "clip.png")]));
		await tick();
		const key = current().rows[0]!.key;
		expect(staged.has(key)).toBe(true);
		await uploads.release();
		expect(staged.has(key)).toBe(false);
	});

	test("source replacement still places only the ready asset", async () => {
		const uploads = holdUploads();
		await mountPending();
		const placed: string[] = [];
		await act(async () =>
			current().enqueue(
				[new File(["x"], "clip.png")],
				(asset) => {
					placed.push(asset.url);
					return true;
				},
				{ whenReady: true },
			),
		);
		await tick();
		expect([placed, pendingAdmitted]).toEqual([[], []]);
		await uploads.release();
		expect(placed).toEqual([expect.stringMatching(/^\/api\/media\//)]);
	});
});

test("a file over the import limit is refused with the limit named, without uploading", async () => {
	let uploads = 0;
	stub(async (url, init) => {
		if (url.includes("readiness"))
			return json({
				available: true,
				limits: { ...DEFAULT_MEDIA_IMPORT_LIMITS, maxFileBytes: 2 * 1024 * 1024 },
			});
		if (init.method === "POST") uploads++;
		return json(response("x.png"), 202);
	});
	await mount("limits");
	await act(async () =>
		current().enqueue([new File([new Uint8Array(3 * 1024 * 1024)], "big.png")]),
	);
	await tick();
	expect(current().rows[0]).toMatchObject({
		status: "failed",
		error: "File is over the 2 MB import limit",
	});
	expect(uploads).toBe(0);
});
