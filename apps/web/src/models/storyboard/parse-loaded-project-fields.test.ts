import { describe, expect, it } from "vite-plus/test";
import { findPresetFixture, type StyleKnobs, DEFAULT_CAPTIONS } from "@maleo/shared";

const knobs = (styleId: string): StyleKnobs => findPresetFixture(styleId)!.bundle.style!;
import { parseLoadedProject } from "./parse-loaded-project.ts";
import { baseDetail } from "./parse-loaded-project.fixtures.ts";
import { DEFAULT_SETTINGS } from "@models/presets/creative-settings.ts";
import { DEFAULT_PACING_DEVICES } from "@models/presets/generation-defaults.ts";

describe("parseLoadedProject · config", () => {
	it("maps project meta into config", () => {
		const p = parseLoadedProject(
			baseDetail(
				{
					title: "Hello",
					target_audience: "devs",
					target_duration_sec: 30,
					target_format: "9:16",
					target_platform: "tiktok",
					reference_notes: "internal note",
					brief_json: { goal: "sell", style_preset: knobs("high-energy-challenge") },
				},
				null,
			),
		);
		expect(p.config).toEqual({
			title: "Hello",
			brief: "sell",
			description: "internal note",
			audience: "devs",
			length: "30",
			format: "9:16",
			platform: "tiktok",
			style: knobs("high-energy-challenge"),
			styleName: undefined,
			styleDescription: undefined,
		});
		expect(p.projectId).toBe("p1");
		expect(p.unresolved).toEqual([]);
	});

	/* There is no identifier-to-knobs table left, so a project the backfill missed
	 * cannot be recovered at read time. It must still LOAD, and it must say so:
	 * silently substituting a default style would look deliberate. */
	it("reads a style the backfill never converted as none, and names it", () => {
		const p = parseLoadedProject(
			baseDetail(
				{
					brief_json: { goal: "sell", style_preset: "high-energy-challenge" },
				},
				null,
			),
		);
		expect(p.config.style).toBeNull();
		expect(p.unresolved).toEqual(["style_preset:high-energy-challenge"]);
	});

	it("loads a project with no style at all", () => {
		const p = parseLoadedProject(baseDetail({ brief_json: { goal: "sell" } }, null));
		expect(p.config.style).toBeNull();
		expect(p.unresolved).toEqual([]);
	});
});

describe("parseLoadedProject · agent edit marker", () => {
	it("reads which run's commands the loaded version holds, and nothing when it has none", () => {
		const marked = parseLoadedProject(
			baseDetail(
				{},
				{ schemaVersion: 2, clips: [], markers: [], agentEdit: { runId: "agent-1", applied: 3 } },
			),
		);
		expect(marked.agentEdit).toEqual({ runId: "agent-1", applied: 3 });
		expect(
			parseLoadedProject(baseDetail({}, { schemaVersion: 2, clips: [], markers: [] })).agentEdit,
		).toBeUndefined();
		expect(
			parseLoadedProject(
				baseDetail({}, { schemaVersion: 2, clips: [], markers: [], agentEdit: { runId: 7 } }),
			).agentEdit,
		).toBeUndefined();
	});
});

describe("parseLoadedProject · text", () => {
	it("parses posts, leaves scenes/slides empty", () => {
		const p = parseLoadedProject(
			baseDetail({ type: "text" }, { posts: [{ body: "hi", image: "u.png" }, { body: "yo" }] }),
		);
		expect(p.type).toBe("text");
		expect(p.posts.map((x) => x.body)).toEqual(["hi", "yo"]);
		expect(p.posts[0].img).toBe(true);
		expect(p.posts[1].img).toBe(false);
		expect(p.scenes).toEqual([]);
		expect(p.slides).toEqual([]);
	});
});

describe("parseLoadedProject · image", () => {
	it("parses slides", () => {
		const p = parseLoadedProject(
			baseDetail(
				{ type: "image" },
				{ slides: [{ caption: "c", visual: "v", image: "i.png", reference_ids: ["r1"] }] },
			),
		);
		expect(p.type).toBe("image");
		expect(p.slides).toHaveLength(1);
		expect(p.slides[0].cap).toBe("c");
		expect(p.slides[0].img).toBe(true);
		expect(p.slides[0].refIds).toEqual(["r1"]);
		expect(p.scenes).toEqual([]);
		expect(p.posts).toEqual([]);
	});
});

describe("parseLoadedProject · video V1", () => {
	const sb = {
		scenes: [
			{ name: "A", visual: "beach", voiceover: "hi", duration_sec: 4, transition: "fade" },
			{ name: "B", visual: "city", sfx: "boom", duration_sec: 6, transition: "cut" },
			{ name: "C", visual: "end", duration_sec: 2 },
		],
	};
	it("parses scenes in order", () => {
		const p = parseLoadedProject(baseDetail({ type: "video" }, sb));
		expect(p.scenes.map((s) => s.name)).toEqual(["A", "B", "C"]);
	});
	it("seeds audio from voiceover/sfx when none saved", () => {
		const p = parseLoadedProject(baseDetail({ type: "video" }, sb));
		// A has voiceover, B has SFX, C nothing
		expect(p.audioOverlays.map((a) => [a.kind, a.content, a.start])).toEqual([
			["voiceover", "hi", 0],
			["sfx", "boom", 4],
		]);
	});
	it("derives transitions between scenes, skipping cut", () => {
		const p = parseLoadedProject(baseDetail({ type: "video" }, sb));
		// scene0->1 is fade (kept), scene1->2 is cut (skipped)
		expect(p.transitions).toHaveLength(1);
		expect(p.transitions[0].type).toBe("fade");
	});
	it("parses a valid custom keyframe motion and sorts by t", () => {
		const p = parseLoadedProject(
			baseDetail(
				{ type: "video" },
				{
					scenes: [
						{
							name: "M",
							duration_sec: 4,
							movement: "Static",
							motion: {
								keyframes: [
									{ t: 1, scale: 1.2, x: 10, y: 0, easing: "bezier" },
									{ t: 0, scale: 1, x: 0, y: 0 },
								],
							},
						},
					],
				},
			),
		);
		expect(p.scenes[0].motion?.keyframes.map((k) => k.t)).toEqual([0, 1]);
		expect(p.scenes[0].motion?.keyframes[1].easing).toBe("bezier");
	});
	it("parses per-visual-clip motion, dropping malformed ones", () => {
		const p = parseLoadedProject(
			baseDetail(
				{ type: "video" },
				{
					scenes: [
						{
							name: "MV",
							duration_sec: 4,
							visual_clips: [
								{
									id: "a",
									url: "a.png",
									kind: "image",
									motion: {
										keyframes: [
											{ t: 0, scale: 1, x: 0, y: 0 },
											{ t: 1, scale: 1.3, x: 0, y: 0 },
										],
									},
								},
								{
									id: "b",
									url: "b.png",
									kind: "image",
									motion: { keyframes: [{ t: 0, scale: 1, x: 0, y: 0 }] },
								},
							],
						},
					],
				},
			),
		);
		const clips = p.scenes[0].visualClips!;
		expect(clips[0].motion?.keyframes).toHaveLength(2);
		expect(clips[1].motion == null).toBe(true);
	});
	it("drops malformed motion (fewer than 2 valid keyframes)", () => {
		const p = parseLoadedProject(
			baseDetail(
				{ type: "video" },
				{
					scenes: [
						{ name: "M", duration_sec: 4, motion: { keyframes: [{ t: 0, scale: 1, x: 0 }] } },
					],
				},
			),
		);
		expect(p.scenes[0].motion == null).toBe(true);
	});
	it("uses saved audio_overlays verbatim when present", () => {
		const p = parseLoadedProject(
			baseDetail(
				{ type: "video" },
				{
					...sb,
					audio_overlays: [
						{
							id: 9,
							kind: "music",
							origin: "stock",
							content: "song",
							start_sec: 1,
							duration_sec: 3,
						},
						{ id: 10, kind: "ambient", content: "room tone", start_sec: 2, duration_sec: 4 },
						{ id: 11, kind: "accent_hit", content: "sting", start_sec: 3, duration_sec: 1 },
					],
				},
			),
		);
		expect(p.audioOverlays).toHaveLength(3);
		expect(p.audioOverlays[0]).toMatchObject({
			id: 9,
			kind: "music",
			origin: "stock",
			content: "song",
			start: 1,
			dur: 3,
		});
		expect(p.audioOverlays[1]).toMatchObject({ id: 10, kind: "ambient", content: "room tone" });
		expect(p.audioOverlays[2]).toMatchObject({ id: 11, kind: "accent_hit", content: "sting" });
	});
});

describe("parseLoadedProject · settings", () => {
	it("restores selected global timeline template from editor state", () => {
		const p = parseLoadedProject(
			baseDetail(
				{
					type: "video",
					editor_state_json: {
						settings: {
							...DEFAULT_SETTINGS,
							timelineTemplateId: "tpl-global",
							backgroundFill: "#16202A",
						},
					},
				},
				{ scenes: [] },
			),
		);
		expect(p.settings.timelineTemplateId).toBe("tpl-global");
		expect(p.settings.backgroundFill).toBe("#16202A");
	});

	it("falls back aspectRatio to target_format when no editor settings", () => {
		const p = parseLoadedProject(
			baseDetail({ type: "video", target_format: "1:1" }, { scenes: [] }),
		);
		expect(p.settings.aspectRatio).toBe("1:1");
	});
	it("leaves default settings for non-video types", () => {
		const p = parseLoadedProject(
			baseDetail({ type: "image", target_format: "1:1" }, { slides: [] }),
		);
		expect(p.settings).toEqual(DEFAULT_SETTINGS);
	});
	it("captions default when none saved", () => {
		const p = parseLoadedProject(baseDetail({ type: "video" }, { scenes: [] }));
		expect(p.captions).toEqual(DEFAULT_CAPTIONS);
	});
	it("pacing devices load from saved storyboard, default off when absent", () => {
		const saved = parseLoadedProject(
			baseDetail(
				{ type: "video" },
				{
					schemaVersion: 2,
					clips: [],
					pacingDevices: { chapterPills: true, progressBar: false, variant: "minimal" },
				},
			),
		);
		expect(saved.pacingDevices).toEqual({
			chapterPills: true,
			progressBar: false,
			variant: "minimal",
		});
		const bare = parseLoadedProject(baseDetail({ type: "video" }, { scenes: [] }));
		expect(bare.pacingDevices).toEqual(DEFAULT_PACING_DEVICES);
	});
});

describe("parseLoadedProject · scene text metadata", () => {
	it("migrates legacy scene metadata text into timeline text clips", () => {
		const p = parseLoadedProject(
			baseDetail(
				{ type: "video" },
				{
					schemaVersion: 2,
					clips: [
						{
							id: "scene:1",
							type: "image",
							startSec: 3,
							durationSec: 4,
							track: 0,
							scene: {
								id: 1,
								dur: 4,
								name: "A",
								shot: "Medium Shot",
								move: "Static",
								transition: "fade",
								vis: "desk",
								vo: "hi",
								onScreenText: "Do not press",
								claim: "Forbidden button",
								evidence: "Nobody can ignore it.",
								sectionTransition: { text: "One rule", durationSec: 0.8 },
							},
						},
					],
					markers: [],
				},
			),
		);
		expect(p.overlays.map((o) => [o.id, o.content, o.start, o.dur, o.preset])).toEqual([
			[41_000_000, "Forbidden button\nNobody can ignore it.", 3.6, 2.6, "explainer-card"],
		]);
	});

	it("places migrated scene text on next free track when preferred track is occupied", () => {
		const p = parseLoadedProject(
			baseDetail(
				{ type: "video" },
				{
					schemaVersion: 2,
					clips: [
						{
							id: "text:9",
							type: "text",
							startSec: 3.1,
							durationSec: 2,
							track: 1,
							text: { id: 9, content: "Manual", start: 3.1, dur: 2, preset: "title", track: 1 },
						},
						{
							id: "scene:1",
							type: "image",
							startSec: 3,
							durationSec: 4,
							track: 0,
							scene: {
								id: 1,
								dur: 4,
								name: "A",
								shot: "Medium Shot",
								move: "Static",
								transition: "fade",
								vis: "desk",
								vo: "hi",
								onScreenText: "Do not press",
							},
						},
					],
					markers: [],
				},
			),
		);
		expect(p.overlays.map((o) => [o.id, o.track])).toEqual([
			[9, 1],
			[40_000_000, 2],
		]);
	});

	it("migrates v3 marker forward for explainer claim card style", () => {
		const p = parseLoadedProject(
			baseDetail(
				{ type: "video" },
				{
					schemaVersion: 2,
					sceneTextClipMigrationVersion: 3,
					clips: [
						{
							id: "scene:1",
							type: "image",
							startSec: 0,
							durationSec: 4,
							track: 0,
							scene: {
								id: 1,
								dur: 4,
								name: "A",
								shot: "Medium Shot",
								move: "Static",
								transition: "fade",
								vis: "desk",
								vo: "hi",
								claim: "Needs clip",
								evidence: "Not hidden metadata",
							},
						},
					],
					markers: [],
				},
			),
		);
		expect(p.overlays.map((o) => [o.content, o.preset])).toEqual([
			["Needs clip\nNot hidden metadata", "explainer-card"],
		]);
	});

	it("does not remigrate scene metadata after the storyboard is marked v5 migrated", () => {
		const p = parseLoadedProject(
			baseDetail(
				{ type: "video" },
				{
					schemaVersion: 2,
					sceneTextClipMigrationVersion: 5,
					clips: [
						{
							id: "scene:1",
							type: "image",
							startSec: 0,
							durationSec: 4,
							track: 0,
							scene: {
								id: 1,
								dur: 4,
								name: "A",
								shot: "Medium Shot",
								move: "Static",
								transition: "fade",
								vis: "desk",
								vo: "hi",
								onScreenText: "Deleted text",
							},
						},
					],
					markers: [],
				},
			),
		);
		expect(p.overlays).toEqual([]);
	});
});
