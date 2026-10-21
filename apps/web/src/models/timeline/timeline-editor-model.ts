/* Maleo — timeline editor domain model: shared types, constants, and pure
 * helpers with no React/state dependencies. Kept apart from the editor
 * component so the projections and geometry math stay unit-testable. */
import type { JSX } from "react";
import {
	VISUAL_REVEAL_COLOR_BUILDS,
	VISUAL_REVEAL_BLACK_DIRECTIONS,
	VISUAL_REVEAL_DIRECTIONS,
	VISUAL_REVEAL_PHASES,
	VISUAL_REVEAL_TEXTURES,
	VISUAL_REVEAL_TYPES,
	type TextPreset,
	type VisualRevealColorBuild,
	type VisualRevealBlackDirection,
	type VisualRevealDirection,
	type VisualRevealEffect,
	type VisualRevealPhase,
	type VisualRevealTexture,
	type VisualRevealType,
} from "@maleo/shared";

// The left rail is GLOBAL only — every destination talks to shared assets or the
// whole storyboard, never a single selected scene (clip-first model). Per-scene
// editing lives exclusively in the right-hand scene drawer.
export type RailKey =
	| "media"
	| "chat"
	| "style"
	| "templates"
	| "elements"
	| "transitions"
	| "effects"
	| "captions"
	| "settings";
export type ToggleCat = "image" | "voice" | "note";
export type TrackKind = "video" | "broll" | "voice" | "music" | "text";

// Preview playback speeds (J = slower, L = faster, K/Space = play-pause).
export const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2, 4] as const;
export type TimelineDensity = "compact" | "comfortable";
export const CLIENT_VISUAL_REVEAL_TYPES = VISUAL_REVEAL_TYPES;
export const CLIENT_VISUAL_REVEAL_DIRECTIONS = VISUAL_REVEAL_DIRECTIONS;
export const CLIENT_VISUAL_REVEAL_BLACK_DIRECTIONS = VISUAL_REVEAL_BLACK_DIRECTIONS;
export const CLIENT_VISUAL_REVEAL_PHASES = VISUAL_REVEAL_PHASES;
export const CLIENT_VISUAL_REVEAL_TEXTURES = VISUAL_REVEAL_TEXTURES;
export const CLIENT_VISUAL_REVEAL_COLOR_BUILDS = VISUAL_REVEAL_COLOR_BUILDS;
export const VISUAL_REVEAL_TYPE_LABEL = {
	fade: "Fade",
	wipe: "Wipe",
	spotlight: "Spotlight",
	sketch_draw: "Sketch draw",
} satisfies Record<VisualRevealType, string>;
export const VISUAL_REVEAL_DIRECTION_LABEL = {
	left: "Left to right",
	right: "Right to left",
	top: "Top to bottom",
	bottom: "Bottom to top",
	top_left_to_bottom_right: "Top left to bottom right",
	draw_top_left_to_bottom_right: "Draw top left to bottom right",
	center: "Center",
} satisfies Record<VisualRevealDirection, string>;
export const VISUAL_REVEAL_BLACK_DIRECTION_LABEL = {
	none: "None",
	left: "Left to right",
	right: "Right to left",
	top: "Top to bottom",
	bottom: "Bottom to top",
} satisfies Record<VisualRevealBlackDirection, string>;
export const VISUAL_REVEAL_PHASE_LABEL = {
	dark_pixels_first: "Dark pixels first",
	black_then_color: "Black, then color",
	direct: "Direct color",
} satisfies Record<VisualRevealPhase, string>;
export const VISUAL_REVEAL_TEXTURE_LABEL = {
	clean: "Clean",
	paper: "Paper",
	ink: "Ink",
	dust: "Dust",
	glitch: "Glitch",
} satisfies Record<VisualRevealTexture, string>;
export const VISUAL_REVEAL_COLOR_BUILD_LABEL = {
	none: "None",
	muted_to_full: "Muted to full",
} satisfies Record<VisualRevealColorBuild, string>;
export const DEFAULT_VISUAL_REVEAL: VisualRevealEffect = {
	type: "wipe",
	direction: "top_left_to_bottom_right",
	phase: "dark_pixels_first",
};
const REVEAL_DURATION_MIN_SEC = 0.1;

export function clampRevealDurationSec(value: number, clipDurationSec: number): number {
	const max = Math.max(REVEAL_DURATION_MIN_SEC, clipDurationSec);
	const finite = Number.isFinite(value) ? value : max;
	return Math.max(REVEAL_DURATION_MIN_SEC, Math.min(max, finite));
}

export function setRevealDurationMode(
	reveal: VisualRevealEffect,
	mode: "auto" | "manual",
	clipDurationSec: number,
): VisualRevealEffect {
	if (mode === "auto") {
		const { durationSec: _durationSec, ...rest } = reveal;
		return rest;
	}
	return {
		...reveal,
		durationSec: clampRevealDurationSec(reveal.durationSec ?? clipDurationSec, clipDurationSec),
	};
}

// Canonical render dimensions per format — must match the render preset so the
// WYSIWYG Player composition is sized identically to the export.
export const FORMAT_DIMS: Record<string, { w: number; h: number }> = {
	"9:16": { w: 1080, h: 1920 },
	"1:1": { w: 1080, h: 1080 },
	"16:9": { w: 1920, h: 1080 },
};

/* The video aspects the operator may choose, declared once.
 *
 * Every picker reads this table, and `render-option-parity.test.ts` checks it
 * against what the pipeline implements — so the list being offered and the list
 * being checked are the same list. It was stated twice, as `aspectOptions` in
 * the timeline and `ASPECTS` in Project Settings, which is the defect the
 * parity check exists to catch, one level up: two lists that must agree,
 * maintained separately. `FORMAT_DIMS` and `DRAFT_DIMS` had already drifted
 * apart by a row before anyone noticed.
 *
 * Adding a row here is not enough to add a format. It must also have a
 * `FORMAT_DIMS` row, an `ASPECT_RATIOS` entry, and an `aspectMap` entry in
 * @maleo/video, and the parity check fails until all three exist. */
export const VIDEO_ASPECTS = [
	{ id: "16:9", label: "Widescreen", icon: "desktop" },
	{ id: "9:16", label: "Vertical", icon: "phone" },
	{ id: "1:1", label: "Square", icon: "square" },
] as const;

/* The create form's draft preview is the render size at half scale. It was a
 * second literal table in the create-content model, maintained
 * separately from this one and already disagreeing with it: it carries a `4:5`
 * row FORMAT_DIMS has no entry for. Deriving the shared rows leaves that one
 * discrepancy as the only thing stated twice, where it is visible.
 *
 * The `4:5` row is the IMAGE path's, and it is why this table is not a pure
 * halving of FORMAT_DIMS. Video never supported 4:5 — `aspectOf` has no branch
 * for it, FORMAT_DIMS has no row, and the renderer's `aspectMap` carries only
 * vertical/square/horizontal — so the two video pickers that offered it were
 * withdrawn rather than left to produce a 9:16 preview and a 9:16 export from a
 * control labelled Portrait. Implementing 4:5 for video means all three of
 * those, plus image-prep, and is its own change. */
export const DRAFT_DIMS: Record<string, { w: number; h: number }> = {
	...Object.fromEntries(
		Object.entries(FORMAT_DIMS).map(([format, { w, h }]) => [format, { w: w / 2, h: h / 2 }]),
	),
	"4:5": { w: 540, h: 676 },
};

export interface TLClip {
	id: string;
	sceneId: number; // video track; -1 for overlay/audio/broll clips
	overlayId?: number; // text-track clips
	audioId?: number; // voice/music-track clips
	videoId?: number; // b-roll-track clips
	start: number; // seconds from storyboard start
	dur: number;
	label: string;
	thumb?: string;
	img?: boolean;
	gen?: boolean;
}
export interface TLTrack {
	kind: TrackKind;
	label: string;
	icon: (s?: number) => JSX.Element;
	clips: TLClip[];
	onAdd: () => void;
	trackIndex?: number; // for broll: which overlay layer this lane is
}

export interface RailItem {
	key: RailKey;
	label: string;
	icon: (s?: number) => JSX.Element;
	/** Group index — a separator renders between groups: content sources /
	 *  authoring tools / configuration. Every icon is unique per destination. */
	group: number;
}

export const DEFAULT_TEXT_BY_PRESET: Partial<Record<TextPreset, string>> = {
	"explainer-card": "A forbidden object instantly creates curiosity.\nIt is like a wet paint sign.",
	"section-card": "Can he resist?",
	"rve-cinematic-title-intro": "Your Story Begins\nA Cinematic Experience",
	"rve-lower-third": "John Smith\nSenior Producer",
	"rve-end-card": "Thanks for Watching\nSubscribe for More\nSTUDIO CREATIVE",
	"rve-chapter-title": "1\nThe Beginning",
	"rve-quote-card": "Design is not just what it looks like. Design is how it works.\nSteve Jobs",
	"rve-credits-roll": "DIRECTOR\nJane Smith\nPRODUCER\nJohn Doe\nEDITOR\nMaleo Studio",
	"rve-countdown-intro": "3\nGO!",
	"rve-title-split": "REVEALED",
	"rve-subscribe-reminder": "Subscribe\n@CreativeStudio",
	"rve-logo-fade-reveal": "LOGO\nCompany Name\nYour tagline here",
	"rve-logo-spin-reveal": "LOGO\nCompany Name\nYour tagline here",
	"rve-logo-glitch-reveal": "LOGO\nCompany Name\nYour tagline here",
	"rve-logo-bounce-drop": "LOGO\nCompany Name",
	"rve-logo-stroke-draw": "ACME",
	"rve-logo-scale-rotate": "LOGO\nCompany Name",
	"rve-logo-split-reveal": "LO\nGO\nCompany Name",
	"rve-logo-typewriter": "ACME STUDIO",
	"rve-logo-blur-reveal": "LOGO\nCompany Name",
	"rve-bubble-pop-text": "HELLO",
	"rve-popping-text": "BINO!",
	"rve-floating-bubble-text": "Floating",
	"rve-glitch-text": "GLITCH",
	"rve-animated-text": "Hello Remotion",
	"rve-typewriter-subtitle": "I like typing...",
};

// "Motion" clips are animated/branded templates (rve-* + the card templates);
// plain "Text" clips are static caption presets (title/subtitle/stat/quote…).
// The timeline labels the two differently so a designed template reads apart
// from a bare text overlay at a glance.
const MOTION_CARD_PRESETS = new Set<string>(["explainer-card", "section-card", "motion-comp"]);
export function isMotionPreset(preset?: string): boolean {
	return Boolean(
		preset &&
		(preset.startsWith("rve-") || preset.startsWith("shape-") || MOTION_CARD_PRESETS.has(preset)),
	);
}

export function opensSceneEditorOnDoubleClick(track: TrackKind): boolean {
	return track === "video";
}

export type ClipInspectorKind =
	| "audio"
	| "text"
	| "shape"
	| "broll"
	| "infographic"
	| "effect"
	| "transition"
	| "scene";

export function defaultClipInspectorTab(kind: ClipInspectorKind): string {
	if (kind === "audio") return "levels";
	if (kind === "effect") return "effect";
	if (kind === "transition") return "transition";
	return "content";
}

export function inspectorSubjectLabel(input: {
	kind?: ClipInspectorKind;
	title?: string;
	selectedCount?: number;
}): string {
	if ((input.selectedCount ?? 0) > 1) return `${input.selectedCount} clips selected`;
	if (input.title?.trim()) return input.title.trim();
	if (!input.kind) return "No selection";
	if (input.kind === "scene") return "Scene";
	if (input.kind === "broll") return "Media overlay";
	if (input.kind === "infographic") return "Data callout";
	return input.kind[0]!.toUpperCase() + input.kind.slice(1);
}

export function nextTimelineFollowScroll(input: {
	scrollLeft: number;
	clientWidth: number;
	scrollWidth: number;
	gutterWidth: number;
	playheadX: number;
	padding: number;
}): number {
	const laneViewportWidth = Math.max(0, input.clientWidth - input.gutterWidth);
	if (laneViewportWidth <= 0) return input.scrollLeft;
	const maxScroll = Math.max(0, input.scrollWidth - input.clientWidth);
	const pad = Math.max(0, Math.min(input.padding, Math.floor(laneViewportWidth / 2) - 8));
	const playheadContentX = input.gutterWidth + input.playheadX;
	const leftBoundary = input.scrollLeft + input.gutterWidth + pad;
	const rightBoundary = input.scrollLeft + input.clientWidth - pad;
	if (playheadContentX < leftBoundary)
		return Math.max(0, Math.min(maxScroll, playheadContentX - input.gutterWidth - pad));
	if (playheadContentX > rightBoundary)
		return Math.max(0, Math.min(maxScroll, playheadContentX - input.clientWidth + pad));
	return input.scrollLeft;
}

export function fmtTC(sec: number): string {
	const v = Number.isFinite(sec) ? Math.max(0, sec) : 0;
	const m = Math.floor(v / 60);
	const s = Math.floor(v % 60);
	const cs = Math.floor((v % 1) * 100);
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(cs).padStart(2, "0")}`;
}
