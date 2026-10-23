import { payloadOfKind, storyPlanArtifact } from "@maleo/shared";
import { fixtureArtifact } from "@models/agent/artifact-fixture.ts";
import { describe, expect, it } from "vite-plus/test";
import { type TrackFlags } from "@maleo/shared";
import { parseLoadedProject } from "./parse-loaded-project.ts";
import { baseDetail } from "./parse-loaded-project.fixtures.ts";

describe("a restored version carries what it rendered with", () => {
	/* Rows 0 and 2 hold a clip each, because lane flags are lane state: a lane
	 * with nothing on it and no declared group is not a lane, and the load-time
	 * lane migration drops it. Two occupied rows keep this test about the
	 * precedence it is named for. */
	const laneClips = [
		{
			id: "video:1",
			type: "video",
			startSec: 0,
			durationSec: 2,
			track: 0,
			video: { id: 1, kind: "video", start: 0, dur: 2, track: 0, url: "v.mp4" },
		},
		{
			id: "audio:2",
			type: "audio",
			startSec: 0,
			durationSec: 2,
			track: 2,
			audio: { id: 2, kind: "music", content: "", start: 0, dur: 2, track: 2 },
		},
	];
	const flags = { 0: { hidden: true }, 2: { muted: true } };
	// What the flags become once every lane declares its group. The audio lane
	// moves to row 1 because migration lays lanes out in canonical order.
	const migratedFlags: TrackFlags = {
		0: { hidden: true, group: "visual" },
		1: { muted: true, group: "audio" },
	};

	it("takes track flags from the document, not from the desk", () => {
		const parsed = parseLoadedProject({
			...baseDetail(
				{},
				{
					schemaVersion: 2,
					sceneTextClipMigrationVersion: 5,
					clips: laneClips,
					markers: [],
					trackFlags: flags,
				},
			),
			project: {
				...baseDetail({}, null).project,
				// The desk has since been changed; the version has not.
				editor_state_json: { track_flags: { 0: { hidden: false } } },
			},
		});
		expect(parsed.trackFlags).toEqual(migratedFlags);
	});

	it("falls back to the desk for a project saved before the document carried them", () => {
		const parsed = parseLoadedProject({
			...baseDetail(
				{},
				{ schemaVersion: 2, sceneTextClipMigrationVersion: 5, clips: laneClips, markers: [] },
			),
			project: { ...baseDetail({}, null).project, editor_state_json: { track_flags: flags } },
		});
		expect(parsed.trackFlags).toEqual(migratedFlags);
	});

	it("declares a group for every lane of a project saved before lanes had one", () => {
		const parsed = parseLoadedProject(
			baseDetail(
				{},
				{ schemaVersion: 2, sceneTextClipMigrationVersion: 5, clips: laneClips, markers: [] },
			),
		);
		expect(parsed.trackFlags).toEqual({
			0: { group: "visual" },
			1: { group: "audio" },
		} satisfies TrackFlags);
	});

	it("restores the aspect and brand the version rendered with", () => {
		const parsed = parseLoadedProject({
			...baseDetail(
				{ target_format: "16:9" },
				{
					schemaVersion: 2,
					clips: [],
					markers: [],
					presentation: {
						aspectRatio: "1:1",
						brand: { accentColor: "#ff0055" },
						backgroundFill: "#101014",
					},
				},
			),
			project: {
				...baseDetail({}, null).project,
				target_format: "16:9",
				editor_state_json: { settings: { aspectRatio: "9:16" } },
			},
		});
		expect(parsed.settings.aspectRatio).toBe("1:1");
		expect(parsed.settings.brandAccent).toBe("#ff0055");
		expect(parsed.settings.backgroundFill).toBe("#101014");
	});

	it("leaves settings the document does not own to the desk", () => {
		const parsed = parseLoadedProject({
			...baseDetail(
				{},
				{ schemaVersion: 2, clips: [], markers: [], presentation: { aspectRatio: "1:1" } },
			),
			project: {
				...baseDetail({}, null).project,
				editor_state_json: { settings: { renderBackend: "lambda" } },
			},
		});
		// How a render is PRODUCED is not part of what it contains.
		expect(parsed.settings.renderBackend).toBe("lambda");
	});

	/* The load flow's aspect seeding. The submit flow seeds the global aspect
	 * from the selected format; on load it is this function that falls the
	 * aspect ratio back to the project's saved target_format. */
	it("falls the global aspect ratio back to the project's saved format", () => {
		const parsed = parseLoadedProject({
			project: {
				id: "p",
				title: "t",
				type: "video",
				target_audience: null,
				target_duration_sec: null,
				target_format: "9:16",
				target_platform: null,
				brief_json: null,
			},
			storyboards: [{ storyboard_json: { scenes: [] } }],
		});
		expect(parsed.settings.aspectRatio).toBe("9:16");
	});
});

/* Provenance survives a load, and its ABSENCE is preserved as absence.
 *
 * The second half matters more than it looks. `setContentEditorState` replaces
 * `editor_state_json` wholesale, so a save that omits these keys deletes whatever was
 * on disk — which is why they are carried through the desk even before anything
 * mutates them. And an empty map must not be confused with a project that predates
 * provenance: the first says "recorded, nothing to say", the second says "unknown",
 * and only the second must never be seeded over. */
describe("parseLoadedProject · element provenance", () => {
	it("a recorded source map is read back", () => {
		const parsed = parseLoadedProject(
			baseDetail(
				{
					editor_state_json: {
						element_sources: {
							style: { layer: "project-preset", defaulterId: "cp_9f3a" },
							"settings.voice": { layer: "operator", defaulterId: null },
						},
					},
				},
				null,
			),
		);

		expect(parsed.elementSources.style).toEqual({
			layer: "project-preset",
			defaulterId: "cp_9f3a",
		});
		expect(parsed.elementSources["settings.voice"]).toEqual({
			layer: "operator",
			defaulterId: null,
		});
	});

	it("render overrides are read back with their values intact", () => {
		const parsed = parseLoadedProject(
			baseDetail(
				{
					editor_state_json: {
						render_overrides: { maxVisualBeatSec: 6, staticSceneMovement: false },
					},
				},
				null,
			),
		);

		expect(parsed.renderOverrides).toEqual({ maxVisualBeatSec: 6, staticSceneMovement: false });
	});

	it("a project with no editor state loads with empty provenance, not a crash", () => {
		const parsed = parseLoadedProject(baseDetail({}, null));

		expect(parsed.elementSources).toEqual({});
		expect(parsed.renderOverrides).toEqual({});
	});

	it("a garbage source map degrades to empty rather than failing the load", () => {
		const parsed = parseLoadedProject(
			baseDetail(
				{
					editor_state_json: { element_sources: "not-an-object", render_overrides: 42 },
				},
				null,
			),
		);

		expect(parsed.elementSources).toEqual({});
		expect(parsed.renderOverrides).toEqual({});
	});

	it("an unreadable entry is dropped while its siblings survive", () => {
		const parsed = parseLoadedProject(
			baseDetail(
				{
					editor_state_json: {
						element_sources: {
							style: { layer: "invented-layer", defaulterId: "x" },
							pacingDevices: { layer: "project-preset", defaulterId: "cp_1" },
						},
					},
				},
				null,
			),
		);

		expect(parsed.elementSources.style).toBeUndefined();
		expect(parsed.elementSources.pacingDevices).toEqual({
			layer: "project-preset",
			defaulterId: "cp_1",
		});
	});
});

/* The document's presentation wins at load, so a restored version opens as it rendered.
 * Where it actually replaces a value, that element has to be recorded as the operator's
 * — otherwise the source map describes values the fold just replaced, and a later preset
 * apply would overwrite what the restore brought back.
 *
 * This is asserted at LOAD rather than only on the helper because the settings and the
 * sources are assembled in different places, and there are several return paths. One of
 * them shipped the folded settings with unfolded sources until this test existed. */
describe("parseLoadedProject · a restored presentation and its provenance stay paired", () => {
	const sources = { "settings.aspectRatio": { layer: "project-preset", defaulterId: "cp_1" } };

	it("records the operator where the document replaced a value", () => {
		const parsed = parseLoadedProject(
			baseDetail(
				{
					editor_state_json: { settings: { aspectRatio: "9:16" }, element_sources: sources },
				},
				{ schemaVersion: 2, clips: [], markers: [], presentation: { aspectRatio: "16:9" } },
			),
		);

		expect(parsed.settings.aspectRatio).toBe("16:9");
		expect(parsed.elementSources["settings.aspectRatio"]).toEqual({
			layer: "operator",
			defaulterId: null,
		});
	});

	/* The normal case. This fold runs on every load, so claiming elements when nothing
	 * changed would make every project operator-owned after one open, and presets would
	 * stop applying to anything. */
	it("leaves the source alone when the document agrees with the editor state", () => {
		const parsed = parseLoadedProject(
			baseDetail(
				{
					editor_state_json: { settings: { aspectRatio: "16:9" }, element_sources: sources },
				},
				{ schemaVersion: 2, clips: [], markers: [], presentation: { aspectRatio: "16:9" } },
			),
		);

		expect(parsed.settings.aspectRatio).toBe("16:9");
		expect(parsed.elementSources["settings.aspectRatio"]).toEqual({
			layer: "project-preset",
			defaulterId: "cp_1",
		});
	});

	it("leaves an untouched field's source alone while claiming the replaced one", () => {
		const parsed = parseLoadedProject(
			baseDetail(
				{
					editor_state_json: {
						settings: { aspectRatio: "9:16", backgroundFill: "#123456" },
						element_sources: {
							...sources,
							"settings.backgroundFill": { layer: "project-preset", defaulterId: "cp_1" },
						},
					},
				},
				{
					schemaVersion: 2,
					clips: [],
					markers: [],
					presentation: { aspectRatio: "16:9", backgroundFill: "#123456" },
				},
			),
		);

		expect(parsed.elementSources["settings.aspectRatio"]?.layer).toBe("operator");
		expect(parsed.elementSources["settings.backgroundFill"]?.layer).toBe("project-preset");
	});
});

/* A saved chat card is only as good as its artifact. editor-chat picks a card by
 * kind, and a plan it cannot read threw on `sections.reduce` and unmounted the
 * whole editor — found by opening a real saved project while every unit test
 * passed. Loading keeps an artifact only if it parses against its kind and is a
 * kind the chat renders. */
describe("parseLoadedProject · saved artifact cards", () => {
	const plan = fixtureArtifact("story_plan", {
		targetSec: 60,
		sections: [{ id: "s1", title: "T", narration: "n", visualPrompt: "v" }],
	});

	it("keeps a plan that parses, payload and all", () => {
		const p = parseLoadedProject(
			baseDetail(
				{ editor_state_json: { chat: [{ id: 1, role: "assistant", artifact: plan }] } as never },
				null,
			),
		);
		expect(payloadOfKind(p.chatMessages[0]?.artifact, storyPlanArtifact)?.targetSec).toBe(60);
	});

	it("drops an artifact that does not parse and keeps the log around it", () => {
		const flat = {
			id: 2,
			role: "assistant",
			artifact: { kind: "story_plan", targetSec: 60, sections: [] },
		};
		const chat = [
			{ id: 1, role: "assistant", text: "before" },
			flat,
			{ id: 3, role: "user", text: "after" },
		];
		const p = parseLoadedProject(baseDetail({ editor_state_json: { chat } as never }, null));
		expect(p.chatMessages.some((m) => m.artifact)).toBe(false);
		expect(p.chatMessages.map((m) => m.text).filter(Boolean)).toEqual(["before", "after"]);
	});

	it("drops a kind the chat does not render", () => {
		const chat = [
			{
				id: 1,
				role: "assistant",
				artifact: fixtureArtifact("blocker_acknowledgements", { ids: ["b1"] }),
			},
		];
		const p = parseLoadedProject(baseDetail({ editor_state_json: { chat } as never }, null));
		expect(p.chatMessages.some((m) => m.artifact)).toBe(false);
	});
});

/* Observed in the wild on one project: 152 persisted chat messages containing 13
 * question cards, ten of them sharing a single `actionId` — one more copy appended
 * on every reload, because a reload replays a still-running job from its first
 * event and the log kept what the previous reload had already written.
 *
 * Dropping the replayed run's cards before it streams stops new copies, but cannot
 * clean what is already saved, and cards persisted before they carried a job id
 * have nothing to match on. Loading the log has to hold the invariant itself. */
describe("parseLoadedProject · duplicated question cards", () => {
	const card = (id: number, actionId: string, extra: Record<string, unknown> = {}) => ({
		id,
		role: "assistant",
		question: { question: "Which city?", actionId, batch: { questions: [] }, ...extra },
	});

	it("keeps one card per actionId out of a log that accumulated many", () => {
		const chat = [
			{ id: 1, role: "user", text: "make a video" },
			card(2, "action-a"),
			card(3, "action-a"),
			card(4, "action-a"),
		];
		const p = parseLoadedProject(baseDetail({ editor_state_json: { chat } as never }, null));
		expect(p.chatMessages.filter((m) => m.question).length).toBe(1);
	});

	it("keeps the last copy, which carries the answer state the run ended with", () => {
		const chat = [card(1, "action-a"), card(2, "action-a", { answered: true })];
		const p = parseLoadedProject(baseDetail({ editor_state_json: { chat } as never }, null));
		expect(p.chatMessages.find((m) => m.question)?.question?.answered).toBe(true);
	});

	it("cleans copies persisted before cards carried a job id", () => {
		const chat = [card(1, "action-a"), { ...card(2, "action-a"), jobId: "job-a" }];
		const p = parseLoadedProject(baseDetail({ editor_state_json: { chat } as never }, null));
		expect(p.chatMessages.filter((m) => m.question).length).toBe(1);
	});

	it("keeps distinct questions apart", () => {
		const chat = [card(1, "action-a"), card(2, "action-b"), card(3, "action-a")];
		const p = parseLoadedProject(baseDetail({ editor_state_json: { chat } as never }, null));
		expect(p.chatMessages.filter((m) => m.question).map((m) => m.question?.actionId)).toEqual([
			"action-b",
			"action-a",
		]);
	});

	it("leaves a card with no actionId alone", () => {
		const chat = [
			{ id: 1, role: "assistant", question: { question: "Free text?", freeText: true } },
			{ id: 2, role: "assistant", question: { question: "Another?", freeText: true } },
		];
		const p = parseLoadedProject(baseDetail({ editor_state_json: { chat } as never }, null));
		expect(p.chatMessages.filter((m) => m.question).length).toBe(2);
	});

	it("does not disturb non-question messages", () => {
		const chat = [
			{ id: 1, role: "user", text: "one" },
			card(2, "action-a"),
			{ id: 3, role: "user", text: "two" },
			card(4, "action-a"),
			{ id: 5, role: "assistant", text: "done" },
		];
		const p = parseLoadedProject(baseDetail({ editor_state_json: { chat } as never }, null));
		expect(p.chatMessages.map((m) => m.text ?? "Q")).toEqual(["one", "two", "Q", "done"]);
	});
});
