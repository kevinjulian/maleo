// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { DEFAULT_MEDIA_IMPORT_LIMITS, isMediaId, mediaUrl, mintMediaId } from "@maleo/shared";
import {
	act,
	admitted,
	current,
	json,
	mount,
	mountWith,
	response,
	stub,
	tick,
	useHarness,
} from "./use-media-import.harness.ts";
import type { MediaAsset } from "@models/timeline/editor-media.ts";
import type { LocalMediaProbe } from "@models/analysis/local-media-probe.ts";
import type { UploadStaging } from "@services/upload-staging/upload-staging.ts";

const { useMediaImport } = await import("./use-media-import.ts");
const { resolveMediaUrl, clearPendingSources, withReadyPending } =
	await import("@models/core/pending-media-sources.ts");

useHarness();

describe("pending assets", () => {
	/* Minted media identities for the uploads a reload finds, by name. */
	const ID = {
		done: mintMediaId(),
		working: mintMediaId(),
		gone: mintMediaId(),
		failed: mintMediaId(),
		expired: mintMediaId(),
		never: mintMediaId(),
		lost: mintMediaId(),
		restored: mintMediaId(),
	};
	const ref = (name: keyof typeof ID) => mediaUrl(ID[name]);
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
	const usePending = (project: string) =>
		useMediaImport(project, (asset) => admitted.push({ project, asset }), {
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
	const mountPending = async () => {
		await mountWith(() => usePending("p"));
	};
	/* Holds every upload until `release` answers it ready, so assertions run mid-upload. */
	const holdUploads = () => {
		const held: Array<() => void> = [];
		stub(async (url, init) => {
			if (url.includes("readiness"))
				return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
			const headers = new Headers(init.headers);
			const name = decodeURIComponent(headers.get("x-file-name")!);
			const mediaId = headers.get("x-upload-id")!;
			return new Promise<Response>((resolve) =>
				held.push(() => resolve(json(response(name, mediaId), 202))),
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
		expect(isMediaId(key)).toBe(true);
		expect(pendingAdmitted).toEqual([
			expect.objectContaining({ id: key, url: mediaUrl(key), kind: "image", source: "upload" }),
		]);
		expect(current().rows[0]!.status).toBe("uploading");
		expect(resolveMediaUrl(mediaUrl(key))).toBe("blob:http://local/1");
		await uploads.release();
		expect(current().rows[0]!.status).toBe("ready");
		expect(admitted).toEqual([]);
		expect(resolveMediaUrl(mediaUrl(key))).toBe(mediaUrl(key));
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
		const key = current().rows[0]!.key;
		expect(placed.map((asset) => asset.url)).toEqual([mediaUrl(key)]);
		expect(pendingAdmitted).toEqual([]);
		await uploads.release();
		// The import finishing changes no placed reference: the same URL now names the stored bytes.
		expect(placed).toHaveLength(1);
		expect(placed[0]!.url).toBe(mediaUrl(key));
		expect(withReadyPending({ url: placed[0]!.url })).toEqual({ url: mediaUrl(key) });
		expect(resolveMediaUrl(placed[0]!.url)).toBe(mediaUrl(key));
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
		const done = response("done.png", ID.done),
			working = {
				...response("working.png", ID.working),
				status: "processing" as const,
				asset: null,
			};
		let polled = false;
		stub(async (url) => {
			if (url.includes("readiness"))
				return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
			if (url.includes(`/request/${ID.done}`)) return json(done);
			if (url.includes(`/request/${ID.working}`)) return json(working);
			if (url.includes("/request/")) return json({ error: "not_found" }, 404);
			if (url.includes(`/${working.id}`)) {
				polled = true;
				return json({ ...response("working.png", ID.working), id: working.id });
			}
			throw new Error(`unexpected ${url}`);
		});
		await mountPending();
		pendingAdmitted.push({
			id: ID.working,
			url: ref("working"),
			label: "working.png",
			kind: "image",
			source: "upload",
		});
		await act(async () =>
			current().resolve([
				{ url: ref("done"), label: "done.png" },
				{ url: ref("working"), label: "working.png" },
				{ url: ref("gone"), label: "gone.png" },
				{ url: "/api/media/x", label: "managed" },
			]),
		);
		await tick();
		await tick();
		expect(resolveMediaUrl(ref("done"))).toBe(done.asset!.url);
		expect(current().rows.find((row) => row.key === ID.gone)).toMatchObject({
			status: "failed",
			filename: "gone.png",
			error: "Upload interrupted. Choose the file again.",
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1100));
		});
		expect(polled).toBe(true);
		expect(resolveMediaUrl(ref("working"))).toMatch(/^\/api\/media\//);
		// Resolution, not admission: the ready asset is not added a second time.
		expect(admitted).toEqual([]);
	});

	test("a reloaded minted reference plays the staged copy while the server copy is pending, then the same URL", async () => {
		const id = mintMediaId();
		const ready = response("clip.png", id);
		const working = { ...ready, status: "processing" as const, asset: null };
		let finished = false;
		const reads: string[] = [];
		stub(async (url) => {
			if (url.includes("readiness"))
				return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
			if (url.includes(`/request/${id}`)) return json(working);
			if (url.includes(`/${ready.id}`)) return json(finished ? ready : working);
			// The stable route answers an unfinished import with 409 media_pending.
			reads.push(url);
			return json({ error: "media_pending" }, 409);
		});
		staged.set(id, new File(["x"], "clip.png"));
		await mountPending();
		await act(async () => current().resolve([{ url: mediaUrl(id), label: "clip.png" }]));
		for (let i = 0; i < 3; i++) await tick();
		expect(resolveMediaUrl(mediaUrl(id))).toBe("blob:http://local/1");
		finished = true;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1100));
		});
		expect(resolveMediaUrl(mediaUrl(id))).toBe(mediaUrl(id));
		expect(reads).toEqual([]);
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
		// No session copy remains; the discarded asset takes its clips with it.
		expect(resolveMediaUrl(mediaUrl(a!))).toBe(mediaUrl(a!));
	});

	test("reload resumes each pending upload by what the server and staging hold, under the same identity", async () => {
		const uploads: string[] = [];
		const done = response("done.png", ID.done);
		stub(async (url, init) => {
			if (url.includes("readiness"))
				return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
			if (url.includes(`/request/${ID.done}`)) return json(done);
			if (url.includes(`/request/${ID.failed}`))
				return json({
					...response("failed.png"),
					status: "failed",
					asset: null,
					error: "Upload failed; retry file",
				});
			if (url.includes(`/request/${ID.expired}`))
				return json({ ...response("expired.png"), status: "uploading", asset: null });
			if (url.includes("/request/")) return json({ error: "not_found" }, 404);
			if (init.method === "POST") {
				const headers = new Headers(init.headers);
				uploads.push(headers.get("x-upload-id")!);
				return json(response(decodeURIComponent(headers.get("x-file-name")!)), 202);
			}
			throw new Error(`unexpected ${url}`);
		});
		staged.set(ID.failed, new File(["x"], "failed.png"));
		staged.set(ID.expired, new File(["x"], "expired.png"));
		staged.set(ID.never, new File(["x"], "never.png"));
		staged.set(ID.done, new File(["x"], "done.png"));
		await mountPending();
		for (const key of ["done", "failed", "expired", "never", "lost"] as const)
			pendingAdmitted.push({
				id: ID[key],
				url: ref(key),
				label: `${key}.png`,
				kind: "image",
				source: "upload",
			});
		await act(async () =>
			current().resolve(pendingAdmitted.map(({ url, label }) => ({ url, label }))),
		);
		for (let i = 0; i < 4; i++) await tick();
		expect(resolveMediaUrl(ref("done"))).toBe(done.asset!.url);
		expect(uploads.sort()).toEqual([ID.expired, ID.failed, ID.never].sort());
		for (const key of ["failed", "expired", "never"] as const)
			expect(resolveMediaUrl(ref(key))).toMatch(/^\/api\/media\//);
		expect(removedStaged.sort()).toEqual([ID.done, ID.expired, ID.failed, ID.never].sort());
		expect(current().rows.find((row) => row.key === ID.lost)).toMatchObject({
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
			id: ID.lost,
			url: ref("lost"),
			label: "lost.png",
			kind: "image",
			source: "upload",
		});
		await act(async () => current().resolve([{ url: ref("lost"), label: "lost.png" }]));
		await tick();
		await tick();
		expect(current().rows[0]).toMatchObject({ key: ID.lost, interrupted: true });
		await act(async () => current().chooseAgain(ID.lost, new File(["x"], "wrong.mp4")));
		await tick();
		expect(current().rows[0]).toMatchObject({ status: "failed", error: "Choose an image file" });
		expect(uploads).toEqual([]);
		await act(async () => current().chooseAgain(ID.lost, new File(["x"], "again.png")));
		await tick();
		await tick();
		expect(uploads).toEqual([`${ID.lost}:again.png`]);
		expect(resolveMediaUrl(ref("lost"))).toMatch(/^\/api\/media\//);
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
				if (url.includes(`/request/${ID.restored}`)) return json(failed);
				if (init.method === "POST") {
					uploads.push(new Headers(init.headers).get("x-upload-id")!);
					return json(response("restored.png"), 202);
				}
				throw new Error(`unexpected ${url}`);
			},
			[{ requestKey: ID.restored, import: failed }],
		);
		staged.set(ID.restored, new File(["x"], "restored.png"));
		await mountPending();
		expect(current().rows[0]).toMatchObject({ key: ID.restored, status: "failed" });
		pendingAdmitted.push({
			id: ID.restored,
			url: ref("restored"),
			label: "restored.png",
			kind: "image",
			source: "upload",
		});
		await act(async () => current().resolve([{ url: ref("restored"), label: "restored.png" }]));
		for (let i = 0; i < 3; i++) await tick();
		expect(uploads).toEqual([ID.restored]);
		expect(resolveMediaUrl(ref("restored"))).toMatch(/^\/api\/media\//);
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
