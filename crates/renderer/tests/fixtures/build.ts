/// <reference types="node" />
// Writes the renderer's TypeScript-derived fixtures:
// - built-storyboard.json: the render storyboard `buildRenderStoryboardFromDoc`
//   builds from a shared editor corpus scope, for the Rust decoder.
// - caption-timing.json: cues chunked by `groupCaptionWords`, and per frame the
//   cue `captionAt` shows and the word `captionActiveWord` marks, for the Rust
//   cue and word selection.
//
//   bun crates/renderer/tests/fixtures/build.ts          write
//   bun crates/renderer/tests/fixtures/build.ts --check  fail when stale
import { visualEntranceStyle } from "../../../../packages/video/src/scenes/StoryboardScene.tsx";
import { spring } from "../../../../packages/video/node_modules/remotion";
import {
	sceneEntranceStyle,
	sceneExitStyle,
	sceneBoundaryHold,
	effectsBlackOpacity,
	effectsWhiteOpacity,
	effectsScale,
	effectsWhipPct,
	chapterSpans,
	storyboardSceneTimings,
} from "../../../../packages/video/src/compositions/StoryboardReel.tsx";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildRenderStoryboardFromDoc,
	groupCaptionWords,
	evaluateValueTrack,
	evaluateColorTrack,
	retainClipAnimation,
	KEYFRAME_EASINGS,
	type ValueKeyframe,
	type ColorKeyframe,
	type TimelineDoc,
} from "../../../../packages/shared/src/index.ts";
import {
	captionActiveWord,
	captionAt,
	type RenderCaptionCue,
} from "../../../../packages/video/src/components/Captions.tsx";
import { sampleTextAnimation } from "../../../../packages/video/src/lib/text-animation.ts";
import {
	evalTrack,
	evalColorTrack,
	evalMotion,
	fromLegacy,
	type KeyframeMotion,
	type EasingId,
} from "../../../../packages/video/src/lib/motion-keyframes.ts";
import {
	MOTION_PRESETS,
	resolveMotion,
} from "../../../../packages/video/src/lib/motion-presets.ts";
import {
	effectiveRevealDurationFrames,
	revealClipStyle,
	revealColorPhaseStyle,
	revealDarkPhaseStyle,
	revealColorBuildStyle,
} from "../../../../packages/video/src/components/RevealEffect.tsx";
import {
	resolveTransition,
	type TransitionId,
} from "../../../../packages/video/src/lib/transitions.tsx";
import type { VisualRevealData } from "../../../../packages/video/src/schema.ts";
type RevealStyle = ReturnType<typeof revealClipStyle>;
import { glitchOffset } from "../../../../packages/video/src/components/CameraMotion.tsx";
import { storyboardSeconds } from "../../../../packages/video/src/lib/duration.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
// SAFETY: the corpus scopes are editor scopes exported by
// scripts/export-editor-corpus.ts; `doc` is a TimelineDoc.
const scope = JSON.parse(
	readFileSync(
		join(here, "../../../../packages/shared/src/editor/corpus/scopes/video-s-0e71d5854634.json"),
		"utf8",
	),
) as { doc: TimelineDoc };
const refs = { images: [], notes: [], speakers: [], style: { tone: "", palette: "", music: "" } };
const { storyboard } = buildRenderStoryboardFromDoc({ format: "9:16" }, refs, scope.doc);

// Spoken words with a pause and a sentence end, so the chunker splits.
const spoken = "Halo semua, ini maleo. Kami membuat video pendek dengan cepat dan rapi untuk kamu"
	.split(" ")
	.map((text, i) => {
		const startSec = 0.2 + i * 0.31 + (i >= 6 ? 0.7 : 0);
		return { text, startSec, endSec: startSec + 0.26 };
	});
const cues: RenderCaptionCue[] = groupCaptionWords(spoken).map((phrase, i) => ({
	id: `cue-${i}`,
	startSec: phrase.startSec,
	durationSec: phrase.endSec - phrase.startSec,
	caption: { text: phrase.text, words: phrase.words } as RenderCaptionCue["caption"],
}));
const lastFrame = Math.ceil((cues.at(-1)!.startSec + cues.at(-1)!.durationSec) * 30) + 2;
const frames = Array.from({ length: lastFrame }, (_, frame) => {
	const cue = captionAt(cues, frame / 30);
	return {
		frame,
		cue: cue ? cues.indexOf(cue) : null,
		word: cue ? captionActiveWord(cue.caption.words, frame / 30 - cue.startSec) : null,
	};
});

const outputs: Array<[string, unknown]> = [
	["built-storyboard.json", storyboard],
	["caption-timing.json", { cues: cues.map((c) => ({ ...c, type: "caption", track: 0 })), frames }],
	["keyframe-timing.json", keyframeSamples()],
	["text-animation.json", textSamples()],
	["camera-timing.json", cameraSamples()],
	["reveal-timing.json", revealSamples()],
	["transition-timing.json", transitionSamples()],
	["transition-placement.json", placementSamples()],
	["effect-timing.json", effectSamples()],
	["chapter-timing.json", chapterSamples()],
	[
		"decoration-spring.json",
		[
			{ damping: 18, stiffness: 120 },
			{ damping: 16, stiffness: 160 },
		].flatMap((config) =>
			[12, 24, 30, 60].map((fps) => ({
				config,
				fps,
				samples: [-1, 0, 1, 2, 4, 8, 12, 18, 30, 60, 300].map((frame) => ({
					frame,
					value: spring({ frame, fps, config }),
				})),
			})),
		),
	],
];
for (const [name, value] of outputs) {
	const out = join(here, name);
	const json = `${JSON.stringify(value, null, "\t")}\n`;
	if (process.argv.includes("--check")) {
		if (readFileSync(out, "utf8") !== json) throw new Error(`${out} is stale; run without --check`);
	} else writeFileSync(out, json);
}

/** Source-derived local-second samples, including both sides of hold boundaries. */
function keyframeSamples() {
	const fps = 30;
	const frames = [-1, 0, 14, 15, 16, 30, 45, 60, 74, 75, 76, 90];
	const numeric: Array<{ name: string; keys: ValueKeyframe[] }> = [];
	const colors: Array<{ name: string; keys: ColorKeyframe[] }> = [];
	for (const easing of KEYFRAME_EASINGS) {
		for (const retained of [false, true]) {
			const easingRange: [number, number] | undefined = retained ? [0.25, 0.85] : undefined;
			const end = { t: 2.5, easing, ...(easingRange ? { easingRange } : {}) };
			const name = `${easing}${retained ? "-range" : ""}`;
			numeric.push({
				name,
				keys: [
					{ t: 0.5, v: 0.2 },
					{ ...end, v: 0.9 },
				],
			});
			colors.push({
				name,
				keys: [
					{ t: 0.5, v: "#123" },
					{ ...end, v: "#efb248" },
				],
			});
		}
	}
	numeric.push({ name: "empty", keys: [] }, { name: "single", keys: [{ t: 0.5, v: 0.4 }] });
	colors.push({ name: "empty", keys: [] }, { name: "single", keys: [{ t: 0.5, v: "#abc" }] });
	colors.push({
		name: "css-color-mix",
		keys: [
			{ t: 0.5, v: "red" },
			{ t: 2.5, v: "#fff" },
		],
	});
	const original = {
		tracks: {
			opacity: [
				{ t: 0, v: 0 },
				{ t: 2, v: 1, easing: "in" as const },
			],
		},
	};
	const retained = retainClipAnimation(original, 0.75, 1.75)!;
	numeric.push({ name: "trimmed-subcurve", keys: retained.tracks.opacity! });
	return {
		fps,
		timing: "clip-local seconds = frame / fps; no key-time rounding",
		numeric: numeric.map(({ name, keys }) => ({
			name,
			keys,
			fallback: 0.7,
			samples: frames.map((frame) => ({
				frame,
				seconds: frame / fps,
				value: evaluateValueTrack(keys, frame / fps, 0.7),
			})),
		})),
		colors: colors.map(({ name, keys }) => ({
			name,
			keys,
			fallback: "#789",
			samples: frames.map((frame) => ({
				frame,
				seconds: frame / fps,
				value: evaluateColorTrack(keys, frame / fps, "#789"),
			})),
		})),
	};
}

function textSamples() {
	const layout = { xPct: 10, yPct: 20, widthPct: 70, heightPct: 30, rotationDeg: 5, opacity: 0.8 };
	const style = {
		fontFamily: "Inter",
		fontSize: 64,
		letterSpacing: 1,
		lineHeight: 1.1,
		fill: "#123456",
		background: "#111111",
		bgOpacity: 0.5,
	};
	const numeric = (from: number, to: number): ValueKeyframe[] => [
		{ t: 0.5, v: from },
		{ t: 2.5, v: to, easing: "in-out" },
	];
	const animation = {
		tracks: {
			xPct: numeric(10, 30),
			yPct: numeric(20, 35),
			widthPct: numeric(70, 50),
			heightPct: numeric(30, 40),
			rotationDeg: numeric(5, 20),
			opacity: numeric(0.8, 0.4),
			scale: numeric(0.9, 1.1),
			blur: numeric(0, 8),
			bgOpacity: numeric(0.2, 0.7),
			fontSize: numeric(48, 80),
			letterSpacing: numeric(0, 3),
			lineHeight: numeric(1, 1.4),
		},
		colorTracks: {
			fill: [
				{ t: 0.5, v: "#123456" },
				{ t: 2.5, v: "#fedcba" },
			],
			background: [
				{ t: 0.5, v: "#111111" },
				{ t: 2.5, v: "#444444" },
			],
		},
	};
	const frames = [-1, 0, 14, 15, 16, 30, 45, 60, 74, 75, 76, 90];
	const legacy = {
		tracks: {
			x: [
				{ t: 0, v: 0 },
				{ t: 1, v: 15 },
			],
			y: [
				{ t: 0, v: 0 },
				{ t: 1, v: -10 },
			],
			width: [
				{ t: 0, v: 70 },
				{ t: 1, v: 50 },
			],
			height: [
				{ t: 0, v: 30 },
				{ t: 1, v: 40 },
			],
			scale: [
				{ t: 0, v: 1 },
				{ t: 1, v: 1.2 },
			],
			rotate: [
				{ t: 0, v: 0 },
				{ t: 1, v: 20 },
			],
			opacity: [
				{ t: 0, v: 1 },
				{ t: 0.5, v: 0.4, easing: "hold" as const },
			],
			blur: [
				{ t: 0, v: 0 },
				{ t: 1, v: 6 },
			],
		},
		colorTracks: {
			fill: [
				{ t: 0, v: "#123456" },
				{ t: 1, v: "#fedcba" },
			],
		},
	};
	return {
		fps: 30,
		durationFrames: 120,
		layout,
		style,
		animation,
		legacy,
		modern: frames.map((frame) => ({
			frame,
			expected: sampleTextAnimation(animation, layout, style, frame / 30),
		})),
		normalized: frames.map((frame) => ({
			frame,
			expected: Object.fromEntries(
				Object.entries(legacy.tracks).map(([name, keys]) => [
					name,
					evalTrack(keys, frame / 120, 0),
				]),
			),
			fill: evalColorTrack(legacy.colorTracks.fill, frame / 120, style.fill),
		})),
	};
}

function cameraSamples() {
	const fps = 30;
	const frames = [-1, 0, 1, 2, 6, 15, 29, 30, 59, 60, 89, 90, 119, 120, 121];
	const cameraEasings: EasingId[] = ["linear", "in", "out", "in-out", "bezier"];
	const custom: KeyframeMotion = {
		keyframes: [
			{ t: 0.15, scale: 1.04, x: -17, y: 23, rotate: -6 },
			{ t: 0.6, scale: 1.2, x: 31, y: -13, rotate: 8, easing: "in-out" },
			{ t: 0.9, scale: 1.08, x: 9, y: 4, rotate: 2, easing: "bezier" },
		],
	};
	const aliases = [
		"Static",
		"Slow Pan",
		"Slow Pan Left",
		"Slow Pan Right",
		"Slow Zoom In",
		"Slow Zoom Out",
		"Slight Push In",
		"Slight Pull Out",
		"Follow / Tracking",
		"Tilt Up",
		"Tilt Down",
		"Orbit",
		"Handheld",
		"Glitch",
		"Glitch / Flicker",
		"Slow Motion",
		"Time Lapse",
	];
	const cases: Array<{
		name: string;
		movement?: string;
		motion?: KeyframeMotion;
		durationFrames: number;
	}> = [
		...Object.keys(MOTION_PRESETS).map((movement) => ({
			name: movement,
			movement,
			durationFrames: 120,
		})),
		...aliases.map((movement) => ({ name: `alias-${movement}`, movement, durationFrames: 120 })),
		{ name: "absent", durationFrames: 120 },
		{ name: "unknown", movement: "unknown", durationFrames: 120 },
		{ name: "custom-precedence", movement: "slow-pan-left", motion: custom, durationFrames: 120 },
		{ name: "custom-glitch", movement: "Glitch", motion: custom, durationFrames: 120 },
		...cameraEasings.map((easing) => ({
			name: `custom-easing-${easing}`,
			movement: "static",
			motion: { keyframes: custom.keyframes.map((key) => ({ ...key, easing })) },
			durationFrames: 120,
		})),
		{ name: "zero-duration", durationFrames: 0 },
	];
	return {
		fps,
		timing:
			"camera progress = frame / durationFrames; duration <= 0 uses 1; camera translation stays pixels",
		cases: cases.map((c) => ({
			...c,
			samples: frames.map((frame) => {
				const motion = c.motion ?? fromLegacy(resolveMotion(c.movement));
				const sample = evalMotion(motion, c.durationFrames > 0 ? frame / c.durationFrames : 1);
				const glitch = ["Glitch", "Glitch / Flicker", "glitch"].includes(c.movement ?? "")
					? glitchOffset(frame, fps)
					: { x: 0, y: 0, opacity: 1 };
				return {
					frame,
					...sample,
					x: sample.x + glitch.x,
					y: sample.y + glitch.y,
					opacity: glitch.opacity,
				};
			}),
		})),
	};
}

/** Existing exported reveal helpers remain the timing/style oracle. */
function revealSamples() {
	const cases: Array<{ name: string; reveal?: VisualRevealData; clipFrames: number; fps: number }> =
		[];
	const add = (name: string, reveal?: VisualRevealData, clipFrames = 120, fps = 30) =>
		cases.push({ name, reveal, clipFrames, fps });
	add("absent");
	for (const type of ["fade", "wipe", "spotlight", "sketch_draw"] as const)
		for (const direction of [
			"left",
			"right",
			"top",
			"bottom",
			"top_left_to_bottom_right",
			"draw_top_left_to_bottom_right",
			"center",
		] as const)
			add(`${type}-${direction}`, {
				type,
				direction,
				delaySec: 0.2,
				durationSec: 1.4,
				intensity: 0.4,
			});
	for (const phase of ["dark_pixels_first", "black_then_color"] as const)
		for (const blackDirection of ["none", "left", "right", "top", "bottom"] as const)
			add(`${phase}-${blackDirection}`, {
				type: "wipe",
				phase,
				blackDirection,
				delaySec: 0.2,
				durationSec: 1.4,
				colorBuild: "muted_to_full",
			});
	for (const texture of ["clean", "paper", "ink", "dust", "glitch"] as const)
		add(`texture-${texture}`, { type: "sketch_draw", texture });
	add("one-frame", { type: "fade", phase: "black_then_color" }, 1);
	add("manual-rounds-to-one", { type: "fade", durationSec: 0.001 });
	add("manual-clamped-to-clip", { type: "fade", durationSec: 20 }, 7);
	add(
		"delay-rounding-24",
		{ type: "fade", delaySec: 0.0625, durationSec: 0.10416666666666667 },
		12,
		24,
	);
	add("delay-rounding-60", { type: "fade", delaySec: 0.025, durationSec: 0.2 }, 60, 60);
	add("intensity-low-clamp", { type: "spotlight", intensity: -1 });
	add("intensity-high-clamp", { type: "sketch_draw", intensity: 2 });
	const filters = (style: RevealStyle) =>
		[...String(style?.filter ?? "").matchAll(/(contrast|saturate)\(([-+0-9.e]+)\)/g)].map((m) => ({
			kind: m[1],
			value: Number(m[2]),
		}));
	const layer = (style: RevealStyle) => {
		if (!style) return null;
		const path = style.clipPath;
		const clip = path
			? {
					kind: path.slice(0, path.indexOf("(")),
					values: [...path.matchAll(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g)].map((m) => Number(m[0])),
				}
			: null;
		const transform = String(style.transform ?? "");
		const number = Number(transform.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/)?.[0] ?? 0);
		return {
			opacity: style.opacity ?? 1,
			clip,
			translate: [
				transform.startsWith("translateX") ? number : 0,
				transform.startsWith("translateY") ? number : 0,
			],
			filters: filters(style),
		};
	};
	return cases.map((c) => {
		const duration = effectiveRevealDurationFrames(c.reveal, c.clipFrames, c.fps);
		const delay = Math.max(0, Math.round((c.reveal?.delaySec ?? 0) * c.fps)),
			split = Math.max(1, Math.round(duration * 0.45));
		const frames = [
			...new Set([
				-1,
				0,
				1,
				delay - 1,
				delay,
				delay + 1,
				delay + split - 1,
				delay + split,
				delay + split + 1,
				delay + duration - 1,
				delay + duration,
				delay + duration + 1,
			]),
		].sort((a, b) => a - b);
		return {
			...c,
			duration,
			delay,
			split,
			samples: frames.map((frame) => ({
				frame,
				clip: layer(revealClipStyle(c.reveal, frame, c.clipFrames, c.fps)),
				color: layer(revealColorPhaseStyle(c.reveal, frame, c.clipFrames, c.fps)),
				dark: layer(revealDarkPhaseStyle(c.reveal, frame, c.clipFrames, c.fps)),
				build: filters(revealColorBuildStyle(c.reveal, frame, c.clipFrames, c.fps)),
			})),
		};
	});
}

function transitionSamples() {
	return (
		["cut", "fade", "slide", "zoom", "wipe", "flip", "clock_wipe", "pixel"] as TransitionId[]
	).flatMap((kind) =>
		[undefined, 1, 9, 12].map((requested) => {
			const { timing } = resolveTransition(kind, requested);
			const duration = timing.getDurationInFrames({ fps: 30 });
			return {
				kind,
				requested: requested ?? null,
				duration,
				samples: [-1, 0, 1, Math.floor(duration / 2), duration - 1, duration, duration + 1].map(
					(frame) => ({ frame, progress: timing.getProgress({ frame, fps: 30 }) }),
				),
			};
		}),
	);
}

function placementSamples() {
	const style = (value: ReturnType<typeof sceneEntranceStyle>) => {
		if (!value) return null;
		for (const key of Object.keys(value))
			if (!["opacity", "transform", "clipPath", "imageRendering"].includes(key))
				throw new Error(`Unrecorded transition style ${key}`);
		const transform = String(value.transform ?? "");
		const number = (pattern: RegExp, fallback: number) =>
			Number(transform.match(pattern)?.[1] ?? fallback);
		const path = String(value.clipPath ?? "");
		return {
			opacity: value.opacity ?? 1,
			scale: number(/scale\(([-+0-9.e]+)\)/, 1),
			xPct: number(/translateX\(([-+0-9.e]+)%\)/, 0),
			rotateY: transform.includes("rotateY") ? number(/rotateY\(([-+0-9.e]+)deg\)/, 0) : null,
			clip: path.startsWith("inset")
				? { kind: "horizontal", value: 1 - Number(path.match(/inset\(0 ([-+0-9.e]+)%/)?.[1]) / 100 }
				: path.startsWith("circle")
					? { kind: "circle", value: Number(path.match(/circle\(([-+0-9.e]+)%/)?.[1]) / 100 }
					: null,
			pixelated: value.imageRendering === "pixelated",
		};
	};
	const kinds = ["cut", "fade", "slide", "zoom", "wipe", "flip", "clock_wipe", "pixel"];
	return {
		styles: kinds.flatMap((kind) =>
			[0, 1, 12].map((duration) => ({
				kind,
				duration,
				samples: [-1, 0, 1, 6, 11, 12, 13, 29, 30, 31, 36, 41, 42, 43].map((frame) => ({
					frame,
					entrance: style(sceneEntranceStyle(kind, frame, duration)),
					exit: style(sceneExitStyle(kind, frame, 30, duration)),
					visual: style(visualEntranceStyle(kind, frame, duration)),
				})),
			})),
		),
		holds: [24, 30, 60].flatMap((fps) =>
			[undefined, 1, 1.5, 2.1].map((nextStartSec) => {
				const input = { startSec: 0.3, endSec: 1, nextStartSec, transitionFrames: 12, fps };
				return { input, expected: sceneBoundaryHold(input) };
			}),
		),
	};
}

function effectSamples() {
	const kinds = [
		"fade_in",
		"fade_out",
		"zoom_out_from_black",
		"flash",
		"zoom_punch",
		"whip_pan",
		"unknown",
	];
	const sets = kinds.flatMap((effect) =>
		[undefined, 0, 0.4, 1, -1, 2].map((intensity) => [
			{ effect, startSec: 0.1, durationSec: 0.8, intensity },
		]),
	);
	sets.push(
		kinds.map((effect, i) => ({
			effect,
			startSec: 0.1 + i * 0.01,
			durationSec: 0.8,
			intensity: 0.7,
		})),
	);
	sets.push([...sets[2]!, ...sets[14]!, ...sets[26]!, ...sets[32]!, ...sets[32]!]);
	return sets.map((effects) => ({
		effects,
		samples: [-0.1, 0, 0.099, 0.1, 0.2, 0.3, 0.34, 0.5, 0.7, 0.899, 0.9, 1].map((t) => ({
			t,
			black: effectsBlackOpacity(effects, t),
			white: effectsWhiteOpacity(effects, t),
			scale: effectsScale(effects, t),
			xPct: effectsWhipPct(effects, t),
		})),
	}));
}

function chapterSamples() {
	const sets: Array<
		Array<{
			image: string;
			label: string;
			chapter?: string;
			startSec?: number;
			durationSec: number;
		}>
	> = [
		[],
		[{ image: "", label: "One", durationSec: 1 }],
		[undefined, undefined, undefined].map((chapter) => ({
			image: "",
			label: "First",
			chapter,
			durationSec: 1,
		})),
		["A", "A", undefined, "B", undefined, "A", ""].map((chapter) => ({
			image: "",
			label: "Fallback",
			chapter,
			durationSec: 1.1,
		})),
		["A", "B", "C"].map((chapter, i) => ({
			image: "",
			label: "Fallback",
			chapter,
			startSec: i * 1.3 + 0.1,
			durationSec: 1,
		})),
	];
	return sets.map((scenes) => {
		const storyboard = { scenes, audioOverlays: [{ startSec: 6.1, durationSec: 1.23 }] };
		return {
			storyboard,
			chapters: chapterSpans(scenes, storyboardSceneTimings(scenes)),
			durations: [24, 30, 60].map((fps) => ({
				fps,
				frames: Math.max(1, Math.ceil(storyboardSeconds(storyboard) * fps)),
			})),
		};
	});
}
