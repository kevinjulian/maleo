// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
	captureCaptionResult,
	CaptionJobResponseSchema,
	CaptionApplyContextSchema,
	type CaptionJobResponse,
} from "@maleo/shared";
import { createTimelineDocumentStore } from "@stores/timeline-document-store.ts";
import { createDocumentWriters } from "@stores/document-writers.ts";
import { setActiveWorkspace } from "@models/core/active-workspace.ts";
import { importSrtCaptions, parseSrt } from "@models/captions/srt.ts";
import { useCaptionJobs, type CaptionJobControls } from "./use-caption-jobs.ts";
import type { CaptionJobInput } from "@api/caption-jobs.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
	setActiveWorkspace("default");
});
const emptyDoc = () => ({ schemaVersion: 2 as const, clips: [], markers: [] });
const input: Omit<CaptionJobInput, "requestKey" | "doc"> = {
	source: "all",
	sourceRevisions: {},
	language: "en",
	captionTrack: 0,
	replaceEdited: false,
};

test("caption errors show API recovery instructions instead of transport paths and error codes", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json(
				{ error: "caption_request_failed", message: "Select an audible audio or video source" },
				{ status: 400 },
			),
		),
	);
	const editor = await mount();
	try {
		await act(async () => editor.controls.generate(input));
		expect(editor.controls.error).toBe("Select an audible audio or video source");
	} finally {
		await editor.unmount();
	}
});
function ready(doc: import("@maleo/shared/editor").EditorDoc = emptyDoc()): CaptionJobResponse {
	return CaptionJobResponseSchema.parse({
		id: "job-1",
		status: "done",
		stage: "ready",
		error: null,
		language: "en",
		sourceCount: 1,
		context: {
			...captureCaptionResult(doc, { startSec: 0, endSec: 2, sources: [] }),
			replaceEdited: false,
		},
		result: {
			type: "captions",
			cues: importSrtCaptions(
				doc,
				parseSrt("1\n00:00:00,000 --> 00:00:02,000\nHello world"),
				"proof",
			).clips.filter((clip) => clip.type === "caption"),
			language: "en",
			engine: "whisper",
			model: "base",
			fromCache: false,
		},
	});
}
async function mount(
	project = "project-a",
	doc: import("@maleo/shared/editor").EditorDoc = emptyDoc(),
) {
	const store = createTimelineDocumentStore();
	store.setDoc(doc);
	const commits: unknown[] = [];
	const writers = createDocumentWriters({
		store,
		commit: (doc) => {
			commits.push(doc);
			store.setDoc(doc);
		},
	});
	let controls!: CaptionJobControls;
	function Harness({ project }: { project: string }) {
		controls = useCaptionJobs(project, store, writers);
		return null;
	}
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => root.render(<Harness project={project} />));
	return {
		store,
		commits,
		get controls() {
			return controls;
		},
		switchProject: async (project: string) => {
			await act(async () => root.render(<Harness project={project} />));
		},
		unmount: async () => {
			await act(async () => root.unmount());
			host.remove();
		},
	};
}
const key = (project = "project-a", workspace = "default") =>
	`caption-job:${JSON.stringify([workspace, project])}`;

test("resumed applied result adds no empty lane after its cues were deleted", async () => {
	const doc = {
		...emptyDoc(),
		captionSet: {
			initialized: true as const,
			language: "en",
			revision: 1,
			deletedRanges: [],
			appliedRunIds: ["job-1"],
		},
	};
	localStorage.setItem(key(), "job-1");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json(ready())),
	);
	const editor = await mount("project-a", doc);
	try {
		expect(editor.store.getDoc()).toEqual(doc);
		expect(editor.commits).toHaveLength(0);
		expect(localStorage.getItem(key())).toBeNull();
	} finally {
		await editor.unmount();
	}
});

test("failed cancellation after delayed submission retains visible resumable identity", async () => {
	const accepted = deferred<Response>();
	vi.stubGlobal(
		"fetch",
		vi.fn((_url: string, init: RequestInit) =>
			init.method === "POST" ? accepted.promise : Promise.reject(new Error("Offline")),
		),
	);
	const editor = await mount();
	try {
		let pending!: Promise<void>;
		await act(async () => {
			pending = editor.controls.generate(input);
		});
		await act(async () => editor.controls.cancel());
		await act(async () => {
			accepted.resolve(Response.json({ id: "job-1" }));
			await pending;
		});
		expect(editor.controls.id).toBe("job-1");
		expect(editor.controls.busy).toBe(false);
		expect(editor.controls.status).toContain("Resume");
		expect(localStorage.getItem(key())).toBe("job-1");
	} finally {
		await editor.unmount();
	}
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("known job resumes, applies through Rust once, and leaves no journal to reapply after undo", async () => {
	localStorage.setItem(key(), "job-1");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json(ready())),
	);
	const editor = await mount();
	try {
		expect(editor.store.getDoc().clips[0]?.caption?.text).toBe("Hello world");
		expect(editor.store.getDoc().trackFlags?.[0]?.group).toBe("caption");
		expect(editor.commits).toHaveLength(1);
		expect(localStorage.getItem(key())).toBeNull();
		await act(async () => editor.controls.apply());
		expect(editor.commits).toHaveLength(1);
	} finally {
		await editor.unmount();
	}
});

test("recognition reuses the declared caption lane after its last cue was deleted", async () => {
	const doc = { ...emptyDoc(), trackFlags: { 0: { group: "caption" as const } } };
	localStorage.setItem(key(), "job-1");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json(ready(doc))),
	);
	const editor = await mount("project-a", doc);
	try {
		expect(editor.store.getDoc().clips[0]?.track).toBe(0);
		expect(editor.store.getDoc().trackFlags).toEqual(doc.trackFlags);
	} finally {
		await editor.unmount();
	}
});

test("no speech preserves exact document including absent caption initialization", async () => {
	localStorage.setItem(key(), "job-1");
	const job = ready();
	job.result!.cues = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json(job)),
	);
	const editor = await mount();
	try {
		expect(editor.store.getDoc()).toEqual(emptyDoc());
		expect(editor.controls.status).toContain("No speech");
	} finally {
		await editor.unmount();
	}
});

test.each([false, true])(
	"deleted captions stay protected unless replacement is selected (%s)",
	async (replaceEdited) => {
		const job = ready();
		const cue = job.result!.cues[0]!;
		const doc = {
			...emptyDoc(),
			captionSet: {
				initialized: true as const,
				language: "en",
				revision: 1,
				deletedRanges: [{ id: "deleted", groupId: "prior", startSec: 0, endSec: 2, sources: [] }],
				appliedRunIds: [],
			},
		};
		job.context = CaptionApplyContextSchema.parse({
			...captureCaptionResult(doc, { startSec: 0, endSec: 2, sources: [] }),
			replaceEdited,
		});
		localStorage.setItem(key(), job.id);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(job)),
		);
		const editor = await mount("project-a", doc);
		try {
			expect(editor.store.getDoc().clips.map((clip) => clip.id)).toEqual(
				replaceEdited ? [cue.id] : [],
			);
			expect(editor.store.getDoc().captionSet?.deletedRanges).toHaveLength(replaceEdited ? 0 : 1);
			expect(editor.controls.status).toContain(
				replaceEdited ? "Captions ready" : "No captions added",
			);
			if (!replaceEdited) {
				expect(editor.controls.status).toContain("Replace edited captions in this range");
				expect(editor.store.getDoc().trackFlags).toBeUndefined();
			}
		} finally {
			await editor.unmount();
		}
	},
);

test("late submission stays with originating project and workspace", async () => {
	const accepted = deferred<Response>();
	const fetcher = vi.fn((_url: string | URL | Request) => accepted.promise);
	vi.stubGlobal("fetch", fetcher);
	const editor = await mount();
	try {
		let pending!: Promise<void>;
		await act(async () => {
			pending = editor.controls.generate(input);
		});
		await editor.switchProject("project-b");
		await act(async () => {
			setActiveWorkspace("other");
		});
		await act(async () => {
			accepted.resolve(Response.json({ id: "job-1" }));
			await pending;
		});
		expect(localStorage.getItem(key())).toBe("job-1");
		expect(editor.controls.id).toBeNull();
		expect(editor.store.getDoc()).toEqual(emptyDoc());
		expect(String(fetcher.mock.calls[0]?.[0])).toContain("workspace=default");
	} finally {
		await editor.unmount();
	}
});

test("cancel while submitting cancels accepted job in its original workspace", async () => {
	const accepted = deferred<Response>();
	const calls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn((url: string, init: RequestInit) => {
			calls.push(`${init.method ?? "GET"} ${url}`);
			return init.method === "POST"
				? accepted.promise
				: Promise.resolve(Response.json({ ok: true }));
		}),
	);
	const editor = await mount();
	try {
		let pending!: Promise<void>;
		await act(async () => {
			pending = editor.controls.generate(input);
		});
		await act(async () => editor.controls.cancel());
		await act(async () => {
			setActiveWorkspace("other");
		});
		await act(async () => {
			accepted.resolve(Response.json({ id: "job-1" }));
			await pending;
		});
		expect(calls).toHaveLength(2);
		expect(calls[1]).toContain("DELETE");
		expect(calls[1]).toContain("workspace=default");
		expect(localStorage.getItem(key())).toBeNull();
		expect(editor.store.getDoc()).toEqual(emptyDoc());
	} finally {
		await editor.unmount();
	}
});

test("affected edits hold ready result instead of clearing its resumable identity", async () => {
	const job = ready();
	const response = deferred<Response>();
	localStorage.setItem(key(), "job-1");
	vi.stubGlobal(
		"fetch",
		vi.fn(() => response.promise),
	);
	const editor = await mount();
	try {
		await act(async () =>
			editor.store.setDoc(
				importSrtCaptions(
					emptyDoc(),
					parseSrt("1\n00:00:00,000 --> 00:00:02,000\nManual correction"),
					"manual",
				),
			),
		);
		await act(async () => response.resolve(Response.json(job)));
		expect(editor.controls.status).toContain("Result held");
		expect(editor.controls.error).toBeTruthy();
		expect(editor.store.getDoc().clips[0]?.caption?.text).toBe("Manual correction");
		expect(localStorage.getItem(key())).toBe("job-1");
	} finally {
		await editor.unmount();
	}
});

test("generation waits for cancellation to settle and late cancel cannot clear another project job", async () => {
	const stopped = deferred<Response>();
	const calls: string[] = [];
	localStorage.setItem(key(), "job-1");
	vi.stubGlobal(
		"fetch",
		vi.fn((url: string, init: RequestInit = {}) => {
			calls.push(`${init.method ?? "GET"} ${url}`);
			if (init.method === "DELETE") return stopped.promise;
			if (init.method === "POST") return Promise.resolve(Response.json({ id: "job-2" }));
			return new Promise<Response>(() => {});
		}),
	);
	const editor = await mount();
	try {
		let cancel!: Promise<void>;
		await act(async () => {
			cancel = editor.controls.cancel();
		});
		await act(async () => editor.controls.generate(input));
		expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(0);
		await editor.switchProject("project-b");
		await act(async () => editor.controls.generate(input));
		expect(editor.controls.id).toBe("job-2");
		await act(async () => {
			stopped.resolve(Response.json({ ok: true }));
			await cancel;
		});
		expect(editor.controls.id).toBe("job-2");
		expect(localStorage.getItem(key("project-b"))).toBe("job-2");
	} finally {
		await editor.unmount();
	}
});

test("completed pending import generates managed input and applies captions without editing source", async () => {
	const { setPendingReady, clearPendingSources, withReadyPending } =
		await import("@models/core/pending-media-sources.ts");
	const mediaId = "00000000-0000-4000-8000-000000000090";
	const binding = {
		clipId: "audio:7",
		mediaId,
		mediaRevision: mediaId,
		sourceStartSec: 0,
		sourceEndSec: 2,
	};
	const doc: import("@maleo/shared/editor").EditorDoc = {
		...emptyDoc(),
		clips: [
			{
				id: "audio:7",
				type: "audio",
				track: 0,
				startSec: 0,
				durationSec: 2,
				audio: {
					id: 7,
					kind: "voiceover",
					content: "",
					url: "pending:import-1",
					start: 0,
					dur: 2,
					track: 0,
				},
			},
		],
		trackFlags: { 0: { group: "audio" } },
	};
	setPendingReady("import-1", {
		id: "import-1",
		label: "Speech",
		kind: "audio",
		source: "upload",
		url: `/api/media/${mediaId}`,
		dur: 2,
		metadata: {
			kind: "audio",
			originalFilename: "speech.wav",
			byteSize: 100,
			duration: 2,
			hasAudio: true,
		},
		compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
		importedSource: { revision: mediaId, fingerprint: "a".repeat(64), originalMediaId: mediaId },
	});
	const resolved = withReadyPending(doc);
	const job = ready(resolved);
	job.context = CaptionApplyContextSchema.parse({
		...captureCaptionResult(resolved, { startSec: 0, endSec: 2, sources: [binding] }),
		replaceEdited: false,
	});
	job.result!.cues[0]!.caption.sources = [binding];
	let submitted: CaptionJobInput | undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init: RequestInit = {}) => {
			if (init.method === "POST") {
				submitted = JSON.parse(String(init.body));
				return Response.json({ id: "job-1" });
			}
			return Response.json(job);
		}),
	);
	const editor = await mount("project-a", doc);
	try {
		await act(async () => editor.controls.generate(input));
		expect(editor.controls.error).toBeNull();
		expect(submitted?.doc.clips[0]?.audio?.url).toBe(`/api/media/${mediaId}`);
		expect(editor.store.getDoc().clips.find((clip) => clip.id === "audio:7")).toEqual(doc.clips[0]);
		expect(editor.store.getDoc().clips.find((clip) => clip.type === "caption")?.caption?.text).toBe(
			"Hello world",
		);
		expect(editor.store.getDoc().trackFlags?.[0]).toEqual(doc.trackFlags?.[0]);
	} finally {
		await editor.unmount();
		clearPendingSources();
	}
});
