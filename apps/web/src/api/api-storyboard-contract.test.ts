import { describe, expect, test } from "vite-plus/test";
import { normalizeSceneClips, resequenceScenes, buildRenderStoryboard } from "@maleo/shared";
import type { Scene } from "@maleo/shared";
import { storyboardJson } from "@models/storyboard/document-wire.ts";
// The render projection lives in @maleo/shared; the HTTP client used to
// re-export it for import compatibility.

describe("create-content multi-track storyboard contract", () => {
	test("storyboardJson writes schemaVersion 2 with a clip carrying the scene payload", () => {
		const scene = normalizeSceneClips({
			id: 1,
			dur: 4,
			name: "Hook",
			shot: "Close Up",
			move: "Static",
			vis: "phone stop on product",
			vo: "cheap serum hook",
			img: true,
			src: "https://cdn.example.com/primary.png",
			visualClips: [
				{
					id: "v1",
					kind: "image",
					label: "Primary",
					url: "https://cdn.example.com/primary.png",
					startSec: 0,
					durationSec: 4,
					primary: true,
				},
				{
					id: "v2",
					kind: "video",
					label: "Alt motion",
					url: "https://cdn.example.com/alt.mp4",
					startSec: 0,
					durationSec: 4,
				},
			],
			audioClips: [
				{
					id: "a1",
					kind: "voiceover",
					label: "VO",
					content: "cheap serum hook",
					startSec: 0,
					durationSec: 4,
				},
				{
					id: "a2",
					kind: "music",
					label: "Bed",
					content: "soft beat",
					startSec: 0,
					durationSec: 4,
				},
			],
		});
		const out = storyboardJson(
			"video",
			{ scenes: [scene] },
			{ projectReferences: { prompt: "keep kitchen consistent", entityIds: ["global-kitchen"] } },
		);
		expect(out.schemaVersion).toBe(2);
		expect("scenes" in out).toBe(false);
		expect(out.projectReferences).toEqual({
			prompt: "keep kitchen consistent",
			entityIds: ["global-kitchen"],
		});
		const clips = out.clips;
		const sceneClip = clips.find((c) => c.id === "scene:1");
		const payload = sceneClip?.scene as Scene | undefined;
		// Primary visual stays nested on the scene clip; the audioClips ride along.
		expect(payload?.visualClips?.length).toBe(1);
		expect(payload?.visualClips?.[0]?.primary).toBe(true);
		expect(payload?.audioClips?.[1]?.kind).toBe("music");
		// The extra (non-primary) visual is promoted to a top-level clip with markerId.
		const extra = clips.find((c) => c.id === "vis:1:v2");
		expect(extra?.markerId).toBe(1);
		expect(extra?.type).toBe("video");
		expect((extra?.vis as Record<string, unknown>)?.vclip).toBeDefined();
		// marker.clipIds lists the beat's real visual clips.
		expect(out.markers[0]?.clipIds).toEqual(["scene:1", "vis:1:v2"]);
	});

	test("buildRenderStoryboard uses primary visual clip and merged voiceover", () => {
		const scene = normalizeSceneClips({
			id: 1,
			dur: 5,
			name: "Scene 1",
			shot: "Medium Shot",
			move: "Slow Pan",
			vis: "host review",
			vo: "",
			img: false,
			visualClips: [
				{ id: "v1", kind: "image", label: "Alt", url: "alt.png", startSec: 0, durationSec: 5 },
				{
					id: "v2",
					kind: "image",
					label: "Primary",
					url: "primary.png",
					startSec: 0,
					durationSec: 5,
					primary: true,
				},
			],
			audioClips: [
				{
					id: "a1",
					kind: "voiceover",
					label: "VO 1",
					content: "first sentence",
					startSec: 0,
					durationSec: 3,
				},
				{
					id: "a2",
					kind: "voiceover",
					label: "VO 2",
					content: "second sentence",
					startSec: 3,
					durationSec: 2,
				},
			],
		});
		const built = buildRenderStoryboard(
			{ format: "9:16", length: "5" },
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "chill" } },
			[scene],
		);
		expect(built.storyboard.scenes[0]?.image).toBe("primary.png");
		expect(built.storyboard.scenes[0]?.voiceover).toBe("first sentence second sentence");
	});

	test("buildRenderStoryboard holds a lone scene visual for the full scene span", () => {
		const scene = normalizeSceneClips({
			id: 1,
			dur: 6.6,
			name: "Scene 1",
			shot: "Medium Shot",
			move: "Static",
			vis: "hold art through semantic pause",
			vo: "narration",
			img: true,
			src: "scene.png",
			visualClips: [
				{
					id: "v1",
					kind: "image",
					label: "Primary",
					url: "scene.png",
					startSec: 0,
					durationSec: 5.318,
					primary: true,
				},
			],
		});
		const built = buildRenderStoryboard(
			{ format: "9:16", length: "7" },
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "chill" } },
			[scene],
		);
		expect(built.storyboard.scenes[0]?.visualClips?.[0]?.durationSec).toBe(6.6);
	});

	test("buildRenderStoryboard does not render implicit scene labels", () => {
		const scene = normalizeSceneClips({
			id: 1,
			dur: 4,
			name: "Pintu Tak Terlihat",
			shot: "Medium Shot",
			move: "Static",
			vis: "metadata-only visual description",
			vo: "narration",
			img: true,
			src: "a.png",
		});
		const built = buildRenderStoryboard(
			{ format: "9:16", length: "4" },
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "chill" } },
			[scene],
			{
				overlays: [
					{
						id: 99,
						content: "Timeline text only",
						start: 0,
						dur: 2,
						preset: "title",
						track: 0,
						style: {
							fontFamily: "Inter",
							fontSize: 64,
							weight: 800,
							fill: "#f8fafc",
							background: "#020617",
							accent: "#38bdf8",
							bodyFill: "#cbd5e1",
							align: "center",
							casing: "none",
						},
					},
				],
			},
		);
		expect(built.storyboard.showLabels).toBe(false);
		expect(built.storyboard.textOverlays?.map((o) => o.content)).toEqual(["Timeline text only"]);
		expect(built.storyboard.textOverlays?.[0]?.style).toMatchObject({
			fill: "#f8fafc",
			background: "#020617",
			accent: "#38bdf8",
			bodyFill: "#cbd5e1",
		});
	});

	test("infographic clips persist to schema v2 and map into render storyboard", () => {
		const scene = normalizeSceneClips({
			id: 1,
			dur: 4,
			name: "Data beat",
			shot: "Medium Shot",
			move: "Static",
			vis: "chart background",
			vo: "organic leads grew",
			img: true,
			src: "a.png",
		});
		const infographic = {
			id: 7,
			start: 1,
			dur: 3,
			track: 2,
			payload: {
				type: "bar_chart" as const,
				title: "Traffic Sources",
				unit: "%",
				rows: [{ label: "Organic", value: 48 }],
			},
			style: { dataColor: "#22c55e", labelColor: "#f8fafc" },
		};
		const saved = storyboardJson(
			"video",
			{ scenes: [scene] },
			{ infographicOverlays: [infographic] },
		);
		const clip = saved.clips.find((c) => c.id === "infographic:7");
		expect(clip?.type).toBe("infographic");
		expect(clip?.infographic?.payload).toMatchObject({
			type: "bar_chart",
			title: "Traffic Sources",
		});

		const built = buildRenderStoryboard(
			{ format: "9:16", length: "4" },
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "chill" } },
			[scene],
			{ infographicOverlays: [infographic] },
		);
		expect(built.storyboard.infographicOverlays?.[0]).toMatchObject({
			startSec: 1,
			durationSec: 3,
			payload: { type: "bar_chart" },
			style: { dataColor: "#22c55e", labelColor: "#f8fafc" },
		});
	});

	test("RVE chart templates persist and map into render storyboard", () => {
		const scene = normalizeSceneClips({
			id: 1,
			dur: 8,
			name: "Charts",
			shot: "Medium Shot",
			move: "Static",
			vis: "charts",
			vo: "",
			img: true,
			src: "a.png",
		});
		const overlays = [
			{
				id: 21,
				start: 0,
				dur: 2,
				payload: {
					type: "line_chart" as const,
					title: "Trend",
					points: [
						{ label: "Q1", value: 10 },
						{ label: "Q2", value: 30 },
					],
				},
			},
			{
				id: 22,
				start: 1,
				dur: 2,
				payload: {
					type: "area_chart" as const,
					title: "Volume",
					points: [
						{ label: "Jan", value: 12 },
						{ label: "Feb", value: 28 },
					],
				},
			},
			{
				id: 23,
				start: 2,
				dur: 2,
				payload: {
					type: "pie_chart" as const,
					title: "Split",
					slices: [
						{ label: "A", value: 60 },
						{ label: "B", value: 40 },
					],
				},
			},
			{
				id: 24,
				start: 3,
				dur: 2,
				payload: {
					type: "donut_chart" as const,
					title: "Mix",
					centerLabel: "100%",
					slices: [
						{ label: "A", value: 70 },
						{ label: "B", value: 30 },
					],
				},
			},
			{
				id: 25,
				start: 4,
				dur: 2,
				payload: {
					type: "progress_bars" as const,
					title: "Readiness",
					rows: [{ label: "Script", value: 90 }],
				},
			},
			{
				id: 26,
				start: 5,
				dur: 2,
				payload: {
					type: "circular_progress" as const,
					title: "Complete",
					value: 78,
					label: "ready",
				},
			},
		];
		const saved = storyboardJson("video", { scenes: [scene] }, { infographicOverlays: overlays });
		expect(saved.clips.filter((c) => c.type === "infographic")).toHaveLength(6);

		const built = buildRenderStoryboard(
			{ format: "9:16", length: "8" },
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "chill" } },
			[scene],
			{ infographicOverlays: overlays },
		);
		expect(built.storyboard.infographicOverlays?.map((g) => g.payload.type)).toEqual([
			"line_chart",
			"area_chart",
			"pie_chart",
			"donut_chart",
			"progress_bars",
			"circular_progress",
		]);
	});

	test("engagement payloads (social_proof, urgency, table marks, price badge) and revealAt survive persist + render mapping", () => {
		const scene = normalizeSceneClips({
			id: 1,
			dur: 6,
			name: "Data beat",
			shot: "Medium Shot",
			move: "Static",
			vis: "product",
			vo: "proof",
			img: true,
			src: "a.png",
		});
		const overlays = [
			{
				id: 11,
				start: 0.5,
				dur: 3,
				revealAt: 1.2,
				payload: {
					type: "social_proof" as const,
					title: "Loved by buyers",
					rating: 4.8,
					reviewCount: "2,300",
					soldCount: "12k",
				},
			},
			{
				id: 12,
				start: 2,
				dur: 3,
				payload: {
					type: "urgency" as const,
					title: "Selling fast",
					stockCount: 7,
					deadlineText: "Ends tonight",
				},
			},
			{
				id: 13,
				start: 3,
				dur: 3,
				payload: {
					type: "price_tag" as const,
					title: "Offer",
					price: "$49",
					compareAt: "$79",
					badge: "Today only",
					dropAnimation: true,
				},
			},
			{
				id: 14,
				start: 4,
				dur: 2,
				payload: {
					type: "table_build" as const,
					title: "Us vs them",
					columns: ["", "Ours", "Theirs"],
					rows: [["Battery", "30h", "12h"]],
					marks: [["none", "tick", "cross"] as Array<"tick" | "cross" | "none">],
					rowSfx: { tickUrl: "tick.mp3", crossUrl: "cross.mp3" },
				},
			},
		];
		const saved = storyboardJson("video", { scenes: [scene] }, { infographicOverlays: overlays });
		const clips = saved.clips;
		const proofClip = clips.find((c) => c.id === "infographic:11");
		expect(proofClip?.infographic?.revealAt).toBe(1.2);
		expect(proofClip?.infographic?.payload).toMatchObject({ type: "social_proof", rating: 4.8 });

		const built = buildRenderStoryboard(
			{ format: "9:16", length: "6" },
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "chill" } },
			[scene],
			{ infographicOverlays: overlays },
		);
		const igs = built.storyboard.infographicOverlays ?? [];
		expect(igs[0]).toMatchObject({
			revealAtSec: 1.2,
			payload: { type: "social_proof", soldCount: "12k" },
		});
		expect(igs[1]?.payload).toMatchObject({ type: "urgency", stockCount: 7 });
		expect(igs[2]?.payload).toMatchObject({
			type: "price_tag",
			badge: "Today only",
			dropAnimation: true,
		});
		expect(igs[3]?.payload).toMatchObject({
			type: "table_build",
			marks: [["none", "tick", "cross"]],
			rowSfx: { tickUrl: "tick.mp3" },
		});
	});

	test("buildRenderStoryboard does not render scene text metadata without timeline clips", () => {
		const scene = normalizeSceneClips({
			id: 1,
			dur: 4,
			name: "Question beat",
			shot: "Medium Shot",
			move: "Slow Zoom In",
			vis: "modern person scrolling beside ancient campfire",
			vo: "Why do we still get bored?",
			img: true,
			src: "a.png",
			question: "Why are we still bored?",
			claim: "Boredom is older than screens.",
			evidence: "Decorated artifacts predate cities.",
			sourceEvidence: [
				{ url: "https://example.test/source", quote: "Decorated artifacts predate cities." },
			],
			analogy: "Like doodling in a notebook.",
			visualType: "evidence",
			onScreenText: "Boredom is ancient",
			sectionTransition: {
				type: "question_card",
				plateId: "thread",
				text: "Why boredom matters?",
				motion: "line_draw",
				durationSec: 0.9,
				plateImageUrl: "/uploads/thread.png",
			},
		});
		const built = buildRenderStoryboard(
			{ format: "9:16", length: "4" },
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "chill" } },
			[scene],
		);
		expect(built.storyboard.scenes[0]?.explainer).toBeUndefined();
		expect(built.storyboard.scenes[0]?.sectionTransition).toBeUndefined();
		expect(built.storyboard.textOverlays).toEqual([]);
	});

	test("storyboardJson marks scene text metadata migration complete", () => {
		const doc = storyboardJson("video", {
			scenes: [
				normalizeSceneClips({
					id: 1,
					dur: 3,
					name: "A",
					shot: "Medium Shot",
					move: "Static",
					transition: "fade",
					vis: "desk",
					vo: "hi",
					img: false,
					onScreenText: "Visible only as clip",
				}),
			],
		});
		expect(doc.schemaVersion).toBe(2);
		expect(doc.sceneTextClipMigrationVersion).toBe(5);
	});

	test("buildRenderStoryboard carries caption menu config into Remotion storyboard", () => {
		const scene = normalizeSceneClips({
			id: 1,
			dur: 3,
			name: "Caption Scene",
			shot: "",
			move: "",
			vis: "",
			vo: "hello world",
			img: true,
			src: "a.png",
		});
		const captions = {
			enabled: true,
			fontFamily: "Montserrat",
			fontSize: 96,
			weight: "Black",
			italic: true,
			allCaps: true,
			style: "Word pop",
			lines: "Two Lines" as const,
			chunkDuration: "0.8,1.6",
			maxWords: 5,
			maxChars: 32,
			maxPauseMs: 240,
			verticalPosition: 82,
			maxWidth: 80,
			fill: "#ffd400",
			activeColor: "#ffffff",
			stroke: "#000000",
			background: "transparent",
			shadow: "#000000",
			shadowOpacity: 80,
			shadowBlur: 18,
			shadowDistance: 5,
			shadowAngle: 90,
			inactiveOpacity: 50,
			motion: "Pop" as const,
			preset: "yellow" as const,
		};
		const built = buildRenderStoryboard(
			{ format: "9:16", length: "3" },
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "chill" } },
			[scene],
			{ captions },
		);
		expect(built.storyboard.captions).toMatchObject(captions);
	});

	test("pacing devices persist in storyboard json and reach the render storyboard", () => {
		const scene = normalizeSceneClips({
			id: 1,
			dur: 3,
			name: "S1",
			shot: "",
			move: "",
			vis: "",
			vo: "",
			img: true,
			src: "a.png",
		});
		const pacingDevices = { chapterPills: true, progressBar: true, variant: "minimal" as const };
		const json = storyboardJson("video", { scenes: [scene] }, { pacingDevices });
		expect(json.pacingDevices).toEqual(pacingDevices);
		const built = buildRenderStoryboard(
			{ format: "9:16", length: "3" },
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "chill" } },
			[scene],
			{ pacingDevices },
		);
		expect(built.storyboard.pacingDevices).toEqual(pacingDevices);
		// Omitted → not emitted (renderer defaults everything off).
		const bare = buildRenderStoryboard(
			{ format: "9:16", length: "3" },
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "chill" } },
			[scene],
			{},
		);
		expect(bare.storyboard.pacingDevices).toBeUndefined();
	});

	test("resequence keeps clip-local offsets after scene reorder", () => {
		const scenes = resequenceScenes([
			normalizeSceneClips({
				id: 2,
				dur: 6,
				name: "Second",
				shot: "Close Up",
				move: "Static",
				vis: "",
				vo: "",
				img: false,
				visualClips: [
					{
						id: "v2",
						kind: "image",
						label: "Cutaway",
						url: "cutaway.png",
						startSec: 2,
						durationSec: 2,
						primary: true,
					},
				],
			}),
			normalizeSceneClips({
				id: 1,
				dur: 4,
				name: "First",
				shot: "Medium Shot",
				move: "Slow Pan",
				vis: "",
				vo: "",
				img: false,
				audioClips: [
					{ id: "a1", kind: "music", label: "Music", content: "beat", startSec: 1, durationSec: 2 },
				],
			}),
		]);
		expect(scenes[0]?.visualClips?.[0]?.startSec).toBe(2);
		expect(scenes[1]?.audioClips?.[0]?.startSec).toBe(1);
	});
});
