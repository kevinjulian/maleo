// @vitest-environment happy-dom
/* A settled run that carries its executed commands lands as exactly those commands,
 * through the editor's real executor and ledger (`move-agent-tools-to-editor-commands`). */
import { describe, expect, test } from "vite-plus/test";
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { toTimelineDoc } = await import("@maleo/shared");
const { batch, engineExecutor, sceneEditCommand, updateClip } =
	await import("@maleo/shared/editor");
const { testEngine } = await import("@models/editor-engine/engine-fixture.ts");
const { createCommandLedger } = await import("@models/chat/command-ledger.ts");
const { scopeFingerprints } = await import("@models/timeline/agent-result-scope.ts");
const { useAgentApply } = await import("./use-agent-apply.ts");
import type { AgentEditMarker, EditorCommand, EditScope } from "@maleo/shared/editor";
import type { Scene } from "@maleo/shared";
import type { AgentApply } from "./use-content-agent.ts";
import type { AgentJobState } from "@models/agent/agent-wire.ts";

const scene = (id: number, dur: number): Scene =>
	({
		id,
		dur,
		name: `S${id}`,
		shot: "Medium Shot",
		move: "Static",
		transition: "fade",
		vis: "",
		vo: "",
		img: false,
	}) as Scene;
const initialDoc = toTimelineDoc(
	[scene(40, 3), scene(12, 4)],
	[],
	[{ id: 2, content: "Hi", start: 0, dur: 2, track: 0, preset: "title" }],
	[],
	[],
	[],
);

/* The editor's command path, as `useCommandStack.run` drives it. */
function editor() {
	const executor = engineExecutor(testEngine);
	const ledger = createCommandLedger(executor);
	let scope: EditScope = { mediaAssets: [], doc: initialDoc, slides: [], posts: [] };
	const recorded: EditorCommand[] = [];
	const runCommand = (command: EditorCommand, before: EditScope = scope): string | null => {
		recorded.push(command);
		let executed;
		try {
			executed = executor.execute(before, command);
		} catch {
			return null;
		}
		if (executed.scope === before) return null;
		scope = executed.scope;
		return ledger.record(command, before, undefined, executed);
	};
	const undo = () => {
		scope = ledger.undo(scope) ?? scope;
	};
	const redo = () => {
		scope = ledger.redo(scope) ?? scope;
	};
	return {
		recorded,
		get scope() {
			return scope;
		},
		set doc(doc: EditScope["doc"]) {
			scope = { ...scope, doc };
		},
		runCommand,
		undo,
		redo,
		depths: ledger.depths,
	};
}

async function mount(
	e: ReturnType<typeof editor>,
	loaded?: AgentEditMarker,
	onPreview = () => undefined,
): Promise<{ apply: AgentApply; unmount: () => Promise<void> }> {
	let apply!: AgentApply;
	const noop = () => undefined;
	function Harness() {
		apply = useAgentApply({
			getMediaAssets: () => e.scope.mediaAssets,
			type: "video",
			config: {} as never,
			settings: {} as never,
			pool: [],
			refs: {} as never,
			projectReferences: { entityIds: [] },
			store: { getDoc: () => e.scope.doc },
			slides: [],
			posts: [],
			scenesRef: { current: [] },
			slidesRef: { current: [] },
			postsRef: { current: [] },
			styleRef: { current: undefined },
			setScenes: onPreview,
			setOverlays: noop,
			setVideoOverlays: noop,
			setInfographicOverlays: noop,
			setAudioOverlays: noop,
			setPool: noop,
			runCommand: e.runCommand,
			ensureMediaAsset: () => "asset-1",
			agentBrief: () => "",
			effectiveDirection: () => ({}) as never,
			projectMaterials: () => ({}) as never,
			contextFor: () => ({}) as never,
			loadedAgentEdit: () => loaded,
		}).apply;
		return null;
	}
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => root.render(<Harness />));
	return {
		apply,
		unmount: async () => {
			await act(async () => root.unmount());
			host.remove();
		},
	};
}

const job = (commands: EditorCommand[]): AgentJobState => ({
	status: "done",
	events: [],
	scenes: [],
	slides: [],
	posts: [],
	textOverlays: [],
	videoOverlays: [],
	audioOverlays: [],
	characters: [],
	artifacts: [],
	error: null,
	commands,
});
const textClip = (e: ReturnType<typeof editor>) =>
	e.scope.doc.clips.find((c) => c.id === "text:2")!;
const commandsFor = () => [
	sceneEditCommand(initialDoc, 12, { name: "Longer", dur: 5 }),
	updateClip("text:2", {
		text: { ...initialDoc.clips.find((c) => c.id === "text:2")!.text!, content: "Hello" },
	}),
];

describe("settling a run that carries its commands", () => {
	test("applies them as one undo step; undo restores, redo re-applies", async () => {
		const e = editor();
		const { apply, unmount } = await mount(e);
		try {
			apply.onContext?.({ fingerprints: scopeFingerprints(e.scope) } as never);
			const outcome = apply.onScenes!(job(commandsFor()), { running: false });

			expect(outcome).toMatchObject({ status: "applied", undoable: true });
			// Exactly the run's commands, not a command derived by diffing documents.
			expect(e.recorded).toEqual([batch(commandsFor(), "agent.video")]);
			expect(textClip(e).text?.content).toBe("Hello");
			expect(e.scope.doc.clips.find((c) => c.id === "scene:12")?.durationSec).toBe(5);
			expect(e.depths()).toEqual({ undo: 1, redo: 0 });

			e.undo();
			expect(e.scope.doc).toEqual(initialDoc);
			e.redo();
			expect(textClip(e).text?.content).toBe("Hello");
		} finally {
			await unmount();
		}
	});

	test("does not preview them while the run works", async () => {
		const e = editor();
		const { apply, unmount } = await mount(e);
		try {
			expect(
				apply.onScenes!({ ...job(commandsFor()), status: "running" }, { running: true }),
			).toBeUndefined();
			expect(e.scope.doc).toEqual(initialDoc);
			expect(e.depths().undo).toBe(0);
		} finally {
			await unmount();
		}
	});

	test("a resumed approval does not preview its stale scene snapshot before commands exist", async () => {
		const e = editor();
		let previews = 0;
		const { apply, unmount } = await mount(e, undefined, () => {
			previews++;
		});
		try {
			apply.onContext?.({ fingerprints: scopeFingerprints(e.scope) } as never);
			e.runCommand(sceneEditCommand(initialDoc, 12, { name: "Manual save" }));
			const before = e.scope.doc;
			apply.onScenes!(
				{
					...job([]),
					status: "awaiting_input",
					scenes: [
						{
							id: 12,
							name: "Stale scene",
							durationSec: 4,
							visual: "",
							voiceover: "",
							shot: "Wide",
							move: "Static",
							transition: "fade",
						},
					],
				},
				{ running: true },
			);
			expect(previews).toBe(0);
			expect(e.scope.doc).toBe(before);
			expect(e.recorded).toHaveLength(1);
		} finally {
			await unmount();
		}
	});

	test("holds them when the user edited a clip they touch", async () => {
		const e = editor();
		const { apply, unmount } = await mount(e);
		try {
			apply.onContext?.({ fingerprints: scopeFingerprints(e.scope) } as never);
			e.runCommand(updateClip("text:2", { track: 3 }));
			const before = e.scope.doc;

			expect(apply.onScenes!(job(commandsFor()), { running: false })).toMatchObject({
				status: "held",
				reason: "changed",
				conflicts: [{ kind: "clip", id: "text:2" }],
			});
			expect(e.scope.doc).toBe(before);
		} finally {
			await unmount();
		}
	});

	test("holds them, with the refusal as the reason, when a target is gone", async () => {
		const e = editor();
		const { apply, unmount } = await mount(e);
		try {
			// No captured baseline, so only the executor can tell the clip is gone.
			e.doc = { ...e.scope.doc, clips: e.scope.doc.clips.filter((c) => c.id !== "text:2") };
			const before = e.scope.doc;

			expect(apply.onScenes!(job(commandsFor()), { running: false })).toMatchObject({
				status: "held",
				reason: "refused",
			});
			expect(e.scope.doc).toBe(before);
		} finally {
			await unmount();
		}
	});

	test("holds an insert whose id the user has taken since", async () => {
		const e = editor();
		const { apply, unmount } = await mount(e);
		try {
			const taken = { ...textClip(e), id: "text:9" };
			e.runCommand({ type: "clip.insert", clip: taken });
			expect(
				apply.onScenes!(job([{ type: "clip.insert", clip: { ...taken, startSec: 1 } }]), {
					running: false,
				}),
			).toMatchObject({ status: "held", conflicts: [{ kind: "clip", id: "text:9" }] });
		} finally {
			await unmount();
		}
	});
});

describe("a run this editor did not start (an MCP edit, another tab)", () => {
	test("is fenced against the document the run started from", async () => {
		const e = editor();
		const { apply, unmount } = await mount(e);
		try {
			const base = scopeFingerprints(e.scope);
			e.runCommand(updateClip("text:2", { track: 3 }));
			const before = e.scope.doc;

			expect(
				apply.onScenes!({ ...job(commandsFor()), commandBase: base }, { running: false }),
			).toMatchObject({
				status: "held",
				reason: "changed",
				conflicts: [{ kind: "clip", id: "text:2" }],
			});
			expect(e.scope.doc).toBe(before);
		} finally {
			await unmount();
		}
	});

	test("applies when nothing it touches changed", async () => {
		const e = editor();
		const { apply, unmount } = await mount(e);
		try {
			const base = scopeFingerprints(e.scope);
			expect(
				apply.onScenes!({ ...job(commandsFor()), commandBase: base }, { running: false }),
			).toMatchObject({ status: "applied" });
		} finally {
			await unmount();
		}
	});
});

describe("settling a run whose commands the loaded document already holds", () => {
	/* A reload while the run worked loads the version the run's save wrote, with
	 * `agentEdit` naming the run (migrate-editor-to-shared-rust-core 4.6). */
	test("reports them applied and writes nothing a second time", async () => {
		const e = editor();
		const commands = commandsFor();
		const { apply, unmount } = await mount(e, { runId: "run-1", applied: commands.length });
		try {
			const outcome = apply.onScenes!(
				{ ...job(commands), commandRun: "run-1" },
				{ running: false },
			);
			expect(outcome).toMatchObject({ status: "applied", undoable: false });
			expect(e.recorded).toEqual([]);
			expect(e.depths()).toEqual({ undo: 0, redo: 0 });
		} finally {
			await unmount();
		}
	});

	test("still applies them when the loaded version is another run's, or holds fewer", async () => {
		for (const loaded of [
			{ runId: "run-0", applied: 9 },
			{ runId: "run-1", applied: 1 },
		]) {
			const e = editor();
			const { apply, unmount } = await mount(e, loaded);
			try {
				apply.onContext?.({ fingerprints: scopeFingerprints(e.scope) } as never);
				const outcome = apply.onScenes!(
					{ ...job(commandsFor()), commandRun: "run-1" },
					{ running: false },
				);
				expect(outcome).toMatchObject({ status: "applied", undoable: true });
				expect(e.depths().undo).toBe(1);
			} finally {
				await unmount();
			}
		}
	});
});

test("unrelated agent commands retain live caption corrections and empty sets", async () => {
	for (const empty of [false, true]) {
		const e = editor();
		const captionSet = {
			initialized: true as const,
			language: "id",
			revision: 3,
			deletedRanges: [],
			appliedRunIds: [],
		};
		const caption = {
			id: "caption:1",
			type: "caption" as const,
			startSec: 0,
			durationSec: 2,
			track: 1,
			caption: {
				text: "Corrected",
				words: [],
				sources: [],
				provenance: { origin: "manual" as const, wordTimingOrigin: "estimated" as const },
				protection: { text: true, timing: false, segmentation: false, style: false },
				revision: 3,
				groupId: "g1",
				status: "current" as const,
			},
		};
		const before = {
			...initialDoc,
			captionSet,
			clips: [...initialDoc.clips, ...(empty ? [] : [caption])],
		};
		e.doc = before;
		const { apply, unmount } = await mount(e);
		try {
			const outcome = apply.onScenes!(
				job([updateClip("text:2", { text: { ...textClip(e).text!, content: "Agent title" } })]),
				{ running: false },
			);
			expect(outcome).toMatchObject({ status: "applied" });
			expect(e.scope.doc.captionSet).toEqual(captionSet);
			expect(e.scope.doc.clips.filter((clip) => clip.type === "caption")).toEqual(
				empty ? [] : [caption],
			);
			e.undo();
			expect(e.scope.doc).toEqual(before);
		} finally {
			await unmount();
		}
	}
});
