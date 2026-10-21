import { assetUrl } from "@models/core/asset-url.ts";

interface VideoScene {
	id: number;
	timing: string;
	duration: number;
	sceneName: string;
	shotType: string;
	movement: string;
	motion?: RenderMotion | null;
	transition?: string;
	visualDesc: string;
	actionDesc: string;
	voiceover: string;
	sfx: string;
	sceneImageUrl?: string | null;
	sceneEndImageUrl?: string | null;
	startSec?: number;
	layout?: unknown;
	generatingImage?: boolean;
	vignette?: boolean;
	grain?: boolean;
	visualClips?: Array<{
		url: string;
		primary?: boolean;
	}>;
}

type RenderTransition =
	| "cut"
	| "fade"
	| "slide"
	| "zoom"
	| "wipe"
	| "flip"
	| "clock_wipe"
	| "pixel";
type RenderMotionEasing = "linear" | "in" | "out" | "in-out" | "bezier";
type RenderMotionKeyframe = {
	t: number;
	scale: number;
	x: number;
	y: number;
	rotate?: number;
	easing?: RenderMotionEasing;
};
type RenderMotion = { keyframes: RenderMotionKeyframe[] };
type RenderInfographicPayload =
	| { type: "stat_reveal"; title: string; value: string; suffix?: string; comparison?: string }
	| {
			type: "bar_chart";
			title: string;
			rows: Array<{ label: string; value: number; color?: string }>;
			unit?: string;
	  }
	| {
			type: "line_chart";
			title: string;
			points: Array<{ label: string; value: number }>;
			unit?: string;
	  }
	| {
			type: "area_chart";
			title: string;
			points: Array<{ label: string; value: number }>;
			unit?: string;
	  }
	| {
			type: "pie_chart";
			title: string;
			slices: Array<{ label: string; value: number; color?: string }>;
			unit?: string;
	  }
	| {
			type: "donut_chart";
			title: string;
			slices: Array<{ label: string; value: number; color?: string }>;
			centerLabel?: string;
			unit?: string;
	  }
	| {
			type: "progress_bars";
			title: string;
			rows: Array<{ label: string; value: number; color?: string }>;
			unit?: string;
	  }
	| { type: "circular_progress"; title: string; value: number; label?: string; unit?: string }
	| {
			type: "table_build";
			title: string;
			columns: string[];
			rows: string[][];
			highlight?: { row?: number; col?: number };
			marks?: Array<Array<"tick" | "cross" | "none">>;
			rowSfx?: { tickUrl?: string; crossUrl?: string };
	  }
	| {
			type: "price_tag";
			title: string;
			price: string;
			compareAt?: string;
			note?: string;
			badge?: string;
			dropAnimation?: boolean;
	  }
	| {
			type: "social_proof";
			title: string;
			rating?: number;
			reviewCount?: string;
			soldCount?: string;
			badge?: string;
	  }
	| {
			type: "urgency";
			title: string;
			stockCount?: number;
			stockLabel?: string;
			deadlineText?: string;
			note?: string;
	  };

export interface StoryboardForRender {
	scenes: Array<{
		image: string;
		/** Optional end frame: when set, the clip interpolates from `image` to this. */
		endImage?: string | null;
		label: string;
		movement: string;
		/** Custom keyframe motion — overrides `movement` when present. */
		motion?: RenderMotion | null;
		/** Camera zoom/pan anchor (percent of the image) — defaults to center. */
		focalPoint?: { xPct: number; yPct: number };
		transition: RenderTransition;
		transitionDurSec?: number;
		durationSec: number;
		voiceover: string;
		visual: string;
		camera: string;
		explainer?: {
			question?: string;
			claim?: string;
			evidence?: string;
			sourceEvidence?: Array<{ url: string; quote: string }>;
			analogy?: string;
			visualType?: string;
			onScreenText?: string;
		};
		sectionTransition?: {
			type?:
				| "question_card"
				| "timeline_advance"
				| "evidence_stamp"
				| "diagram_wipe"
				| "match_cut"
				| "chapter_card";
			plateId?: string;
			text?: string;
			motion?: "line_draw" | "paper_wipe" | "stamp" | "push" | "zoom_cut" | "none";
			durationSec?: number;
			plateImageUrl?: string;
			sfx?: string;
		};
		startSec?: number;
		layout?: unknown;
		sfxUrl?: string;
		visualClips?: Array<{
			url: string;
			primary?: boolean;
			kind?: "image" | "video";
			label?: string;
			startSec?: number;
			durationSec?: number;
			movement?: string;
			motion?: RenderMotion | null;
			layout?: unknown;
		}>;
		audioClips?: Array<{
			kind: "voiceover" | "sfx" | "music";
			content: string;
			label?: string;
			url?: string;
			startSec?: number;
			durationSec?: number;
		}>;
		vignette: boolean;
		grain: boolean;
	}>;
	accentColor: string;
	bgColor: string;
	fgColor: string;
	musicUrl?: string;
	musicMood: "upbeat" | "chill" | "luxury" | "energetic" | "minimal";
	showLabels: boolean;
	// Base scene track (timeline key -1): hide blanks the scene reel; mute silences
	// scene voiceover + scene audio + music. Overlays/overlay-audio unaffected.
	hideBase?: boolean;
	muteBase?: boolean;
	targetDurationSec?: number;
	// Timeline overlays composited at render time (Phase D — backend compositing
	// of these in packages/video is the remaining implementation).
	textOverlays?: Array<{
		content: string;
		startSec: number;
		durationSec: number;
		preset?: string;
		track?: number;
		layout?: unknown;
		style?: unknown;
		params?: Record<string, unknown>;
		anim?: {
			tracks: Partial<
				Record<
					| "x"
					| "y"
					| "scale"
					| "rotate"
					| "opacity"
					| "width"
					| "height"
					| "blur"
					| "bgOpacity"
					| "fontSize"
					| "letterSpacing"
					| "lineHeight",
					Array<{ t: number; v: number; easing?: RenderMotionEasing }>
				>
			>;
			colorTracks?: Partial<
				Record<
					"fill" | "bodyFill" | "accent" | "background",
					Array<{ t: number; v: string; easing?: RenderMotionEasing }>
				>
			>;
		} | null;
	}>;
	infographicOverlays?: Array<{
		startSec: number;
		durationSec: number;
		// Absolute video time (sec) when the main build/count starts (word-timed reveal).
		revealAtSec?: number;
		track?: number;
		layout?: unknown;
		animation?: {
			in?: "fade" | "slide_up" | "scale";
			main?: "build" | "count" | "highlight";
			out?: "fade";
		};
		style?: {
			bgColor?: string;
			bgOpacity?: number;
			borderColor?: string;
			borderOpacity?: number;
			borderRadius?: number;
			blur?: number;
			dataColor?: string;
			labelColor?: string;
		};
		payload: RenderInfographicPayload;
	}>;
	audioOverlays?: Array<{
		kind: "voiceover" | "music" | "sfx" | "ambient" | "accent_hit";
		content: string;
		url?: string;
		startSec: number;
		durationSec: number;
		volume?: number;
		duckUnderVoice?: number;
		fadeInSec?: number;
		fadeOutSec?: number;
		mediaStartSec?: number;
	}>;
	videoOverlays?: Array<{
		url: string;
		thumb?: string;
		kind: "image" | "video";
		track?: number;
		startSec: number;
		durationSec: number;
		layout?: unknown;
		transition?: RenderTransition;
		transitionDurSec?: number;
		mediaStartSec?: number;
	}>;
	visualTimeline?: Array<{
		url: string;
		kind: "image" | "video";
		startSec: number;
		durationSec: number;
		movement?: string;
		motion?: RenderMotion | null;
		focalPoint?: { xPct: number; yPct: number };
		layout?: unknown;
		transition?: RenderTransition;
		transitionDurSec?: number;
	}>;
	effects?: Array<{
		effect: "fade_in" | "fade_out" | "zoom_out_from_black" | "flash" | "zoom_punch" | "whip_pan";
		startSec: number;
		durationSec: number;
		intensity?: number;
	}>;
	captions?: Record<string, unknown> | null;
	// Retention devices layered over the reel (chapter pill / progress bar), palette-driven.
	pacingDevices?: { chapterPills?: boolean; progressBar?: boolean; variant?: "pill" | "minimal" };
	// Global visual style for all infographic/data callout panels.
	infographicStyle?: {
		bgColor?: string;
		bgOpacity?: number;
		borderColor?: string;
		borderOpacity?: number;
		borderRadius?: number;
		blur?: number;
		dataColor?: string;
		labelColor?: string;
	};
	// Whole-video narration track with absolute-time word timings — drives the
	// renderer's kinetic captions (StoryboardReel reads storyboard.voiceover.words).
	voiceover?: {
		text: string;
		startSec?: number;
		words: Array<{ text: string; startSec: number; endSec: number }>;
	};
}

export interface VideoStoryboardInput {
	title: string;
	duration: number;
	format: string;
	scenes: VideoScene[];
	creativeNotes: { tone: string; colors: string; target: string; music: string };
}

// The api serves media on a separate origin, but persisted/render storyboards
// keep asset URLs relative. absolutizeStoryboard resolves every media URL
// against the api origin for in-browser playback ONLY — callers pass the result
// to <Player>, never back to persistence or the render endpoint. assetUrl is a
// no-op for absolute/blob/data URLs, so this is safe to apply idempotently.
export function absolutizeStoryboard<T>(sb: T): T {
	const s = sb as unknown as StoryboardForRender;
	if (!s || !Array.isArray(s.scenes)) return sb;
	const abs = (u: string | null | undefined): string | undefined =>
		u ? assetUrl(u) : (u ?? undefined);
	const out: StoryboardForRender = {
		...s,
		musicUrl: abs(s.musicUrl),
		scenes: s.scenes.map((sc) => ({
			...sc,
			image: abs(sc.image) ?? "",
			endImage: sc.endImage == null ? sc.endImage : abs(sc.endImage),
			sfxUrl: abs(sc.sfxUrl),
			sectionTransition: sc.sectionTransition
				? { ...sc.sectionTransition, plateImageUrl: abs(sc.sectionTransition.plateImageUrl) }
				: sc.sectionTransition,
			visualClips: sc.visualClips?.map((c) => ({ ...c, url: abs(c.url) ?? "" })),
			audioClips: sc.audioClips?.map((c) => ({ ...c, url: abs(c.url) })),
		})),
	};
	return out as unknown as T;
}
