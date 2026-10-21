import { z } from "zod";
import {
	clipMaskSchema,
	CaptionClipSchema,
	clipColorSchema,
	clipBlendModeSchema,
	sourceCropSchema,
	clipAnimationSchema,
	audioAnimationSchema,
	textAnimationSchema,
	KEYFRAME_EASINGS,
} from "@maleo/shared";

// Custom keyframe motion (see lib/motion-keyframes.ts). Optional per-clip
// override of the named `movement` preset. Two or more keyframes, sorted by t.
export const motionEasingSchema = z.enum(["linear", "in", "out", "in-out", "bezier"]);
export const motionKeyframeSchema = z.object({
	t: z.number().min(0).max(1),
	scale: z.number(),
	x: z.number(),
	y: z.number(),
	rotate: z.number().optional(),
	easing: motionEasingSchema.optional(),
});
export const motionSchema = z.object({
	keyframes: z.array(motionKeyframeSchema).min(2),
});
export type MotionKeyframeData = z.infer<typeof motionKeyframeSchema>;
export type MotionData = z.infer<typeof motionSchema>;

export const visualRevealTypes = ["fade", "wipe", "spotlight", "sketch_draw"] as const;
export const visualRevealDirections = [
	"left",
	"right",
	"top",
	"bottom",
	"top_left_to_bottom_right",
	"draw_top_left_to_bottom_right",
	"center",
] as const;
export const visualRevealBlackDirections = ["none", "left", "right", "top", "bottom"] as const;
export const visualRevealPhases = ["dark_pixels_first", "black_then_color", "direct"] as const;
export const visualRevealTextures = ["clean", "paper", "ink", "dust", "glitch"] as const;
export const visualRevealColorBuilds = ["none", "muted_to_full"] as const;
export const visualRevealSchema = z
	.object({
		type: z.enum(visualRevealTypes),
		direction: z.enum(visualRevealDirections).optional(),
		blackDirection: z.enum(visualRevealBlackDirections).optional(),
		phase: z.enum(visualRevealPhases).optional(),
		texture: z.enum(visualRevealTextures).optional(),
		colorBuild: z.enum(visualRevealColorBuilds).optional(),
		// Undefined means Auto: resolve to the clip's full timeline span.
		durationSec: z.number().positive().optional(),
		delaySec: z.number().min(0).optional(),
		intensity: z.number().min(0).max(1).optional(),
	})
	.strict();
export type VisualRevealData = z.infer<typeof visualRevealSchema>;

// Overlay property animation: per-property single-value keyframe tracks
// (see lib/motion-keyframes.ts evalTrack). x/y are percent-of-frame offsets
// from the overlay's base layout; width/height are percent of frame; scale is a
// multiplier; rotate degrees; opacity/bgOpacity 0..1; blur px; fontSize px;
// letterSpacing px; lineHeight multiplier.
export const valueKeyframeSchema = z
	.object({
		t: z.number().min(0).max(1),
		v: z.number(),
		easing: z.enum(KEYFRAME_EASINGS).optional(),
	})
	.strict();
export const colorKeyframeSchema = z
	.object({
		t: z.number().min(0).max(1),
		v: z.string().min(1),
		easing: z.enum(KEYFRAME_EASINGS).optional(),
	})
	.strict();
export const overlayAnimSchema = z
	.object({
		tracks: z.object({
			x: z.array(valueKeyframeSchema).optional(),
			y: z.array(valueKeyframeSchema).optional(),
			scale: z.array(valueKeyframeSchema).optional(),
			rotate: z.array(valueKeyframeSchema).optional(),
			opacity: z.array(valueKeyframeSchema).optional(),
			width: z.array(valueKeyframeSchema).optional(),
			height: z.array(valueKeyframeSchema).optional(),
			blur: z.array(valueKeyframeSchema).optional(),
			bgOpacity: z.array(valueKeyframeSchema).optional(),
			fontSize: z.array(valueKeyframeSchema).optional(),
			letterSpacing: z.array(valueKeyframeSchema).optional(),
			lineHeight: z.array(valueKeyframeSchema).optional(),
		}),
		colorTracks: z
			.object({
				fill: z.array(colorKeyframeSchema).optional(),
				bodyFill: z.array(colorKeyframeSchema).optional(),
				accent: z.array(colorKeyframeSchema).optional(),
				background: z.array(colorKeyframeSchema).optional(),
			})
			.optional(),
	})
	.strict();
export type OverlayAnimData = z.infer<typeof overlayAnimSchema>;

export const captionWordSchema = z.object({
	text: z.string(),
	startSec: z.number(),
	endSec: z.number(),
});

export const voiceoverSchema = z.object({
	text: z.string(),
	audioUrl: z.string().optional(),
	startSec: z.number().default(0),
	endSec: z.number().optional(),
	words: z.array(captionWordSchema).default([]),
});

export const productSchema = z.object({
	brand: z.string().default("Maleo"),
	title: z.string(),
	subtitle: z.string().optional(),
	price: z.string().optional(),
	currency: z.string().default("IDR"),
	bullets: z.array(z.string()).max(5).default([]),
	cta: z.string().default("Shop now"),
	images: z.array(z.string()).min(1),
	accentColor: z.string().default("#FF3E6C"),
	bgColor: z.string().default("#0B0B0F"),
	fgColor: z.string().default("#FFFFFF"),
	musicUrl: z.string().optional(),
	musicMood: z.enum(["upbeat", "chill", "luxury", "energetic", "minimal"]).default("upbeat"),
	voiceover: voiceoverSchema.optional(),
	captionCues: z.array(CaptionClipSchema).optional(),
	templateId: z.enum(["classic", "split-screen", "before-after", "testimonial"]).default("classic"),
});

export type Product = z.infer<typeof productSchema>;
export type Voiceover = z.infer<typeof voiceoverSchema>;
export type CaptionWord = z.infer<typeof captionWordSchema>;

// Shared clip placement/transform. Spatial values are percent of the canvas so
// the render matches the editor preview 1:1 (clip-first unified clip layout).
const clipLayoutShape = z.object({
	mask: clipMaskSchema.nullable().optional(),
	color: clipColorSchema.optional(),
	blendMode: clipBlendModeSchema.optional(),
	animation: clipAnimationSchema.optional(),
	xPct: z.number().default(0),
	yPct: z.number().default(0),
	widthPct: z.number().default(100),
	heightPct: z.number().nullish(),
	fit: z.enum(["contain", "cover", "stretch"]).default("cover"),
	rotationDeg: z.number().default(0),
	opacity: z.number().min(0).max(1).default(1),
	crop: sourceCropSchema.nullish(),
	flipX: z.boolean().optional(),
	flipY: z.boolean().optional(),
	playbackRate: z.number().default(1),
	reverse: z.boolean().default(false),
});
export const clipLayoutSchema = clipLayoutShape.partial().optional();
/** Text overlays animate box, style and colour properties (keyframe-animation registry). */
export const textLayoutSchema = clipLayoutShape
	.extend({ animation: textAnimationSchema.optional() })
	.partial()
	.optional();
export const clipTextStyleSchema = z
	.object({
		fontFamily: z.string().default("Inter"),
		fontSize: z.number().default(64),
		weight: z.number().default(800),
		fill: z.string().default("#ffffff"),
		background: z.string().optional(),
		accent: z.string().optional(),
		bodyFill: z.string().optional(),
		bgOpacity: z.number().optional(),
		scale: z.number().optional(),
		align: z.enum(["left", "center", "right"]).default("center"),
		casing: z.enum(["none", "upper"]).default("none"),
		lineHeight: z.number().optional(),
		letterSpacing: z.number().optional(),
	})
	.partial()
	.optional();

export const storyboardSceneSchema = z.object({
	image: z.string(),
	layout: clipLayoutSchema,
	// Optional end frame. When present, an image-to-video generator can
	// interpolate motion from `image` to `endImage`; the static Remotion
	// compositor ignores it and animates `image` alone.
	endImage: z.string().nullish(),
	label: z.string().default(""),
	// The chapter this scene is in. Chapter pills group RUNS of scenes sharing it,
	// so the storyboard carries no separate chapter list to fall out of step.
	chapter: z.string().optional(),
	movement: z.string().default("Slow Zoom In"),
	// Custom keyframe motion. When present, overrides the `movement` preset.
	motion: motionSchema.nullish(),
	// Product focal point (percent of the image) — zooms/pans anchor here instead
	// of frame center, so camera motion always drives INTO the product.
	focalPoint: z
		.object({ xPct: z.number().min(0).max(100), yPct: z.number().min(0).max(100) })
		.nullish(),
	transition: z
		.enum(["cut", "fade", "slide", "zoom", "wipe", "flip", "clock_wipe", "pixel"])
		.default("fade"),
	transitionDurSec: z.number().nullish(),
	durationSec: z.number().min(1).max(60).default(4),
	// Absolute timeline start (seconds). When any scene sets this, the compositor
	// positions scenes absolutely over black, honoring gaps. When all are absent it
	// falls back to packed sequential layout with cross-scene transitions.
	startSec: z.number().nullish(),
	voiceover: z.string().default(""),
	visual: z.string().default(""),
	camera: z.string().default(""),
	explainer: z
		.object({
			question: z.string().optional(),
			claim: z.string().optional(),
			evidence: z.string().optional(),
			sourceEvidence: z.array(z.object({ url: z.string(), quote: z.string() })).optional(),
			analogy: z.string().optional(),
			visualType: z
				.enum([
					"scene",
					"contrast",
					"timeline",
					"map",
					"diagram",
					"evidence",
					"metaphor",
					"joke",
					"reveal",
				])
				.default("scene"),
			onScreenText: z.string().optional(),
		})
		.partial()
		.optional(),
	sectionTransition: z
		.object({
			type: z
				.enum([
					"question_card",
					"timeline_advance",
					"evidence_stamp",
					"diagram_wipe",
					"match_cut",
					"chapter_card",
				])
				.default("question_card"),
			plateId: z.string().default("thread"),
			text: z.string().default(""),
			motion: z
				.enum(["line_draw", "paper_wipe", "stamp", "push", "zoom_cut", "none"])
				.default("line_draw"),
			durationSec: z.number().min(0.4).max(1.5).default(0.9),
			plateImageUrl: z.string().optional(),
			sfx: z.string().optional(),
		})
		.partial()
		.optional(),
	sfxUrl: z.string().optional(),
	visualClips: z
		.array(
			z.object({
				volume: z.number().min(0).max(1).optional(),
				mediaStartSec: z.number().finite().min(0).optional(),
				sourceDurationSec: z.number().finite().positive().optional(),
				layout: clipLayoutSchema,
				url: z.string(),
				primary: z.boolean().optional(),
				kind: z.enum(["image", "video"]).optional(),
				label: z.string().optional(),
				startSec: z.number().optional(),
				durationSec: z.number().optional(),
				motion: motionSchema.nullish(),
				// Incoming transition for this visual within the beat (image A -> image B).
				transition: z
					.enum(["cut", "fade", "slide", "zoom", "wipe", "flip", "clock_wipe", "pixel"])
					.nullish(),
				transitionDurSec: z.number().nullish(),
				reveal: visualRevealSchema.optional(),
			}),
		)
		.optional(),
	audioClips: z
		.array(
			z.object({
				kind: z.enum(["voiceover", "sfx", "music"]),
				label: z.string().optional(),
				content: z.string(),
				startSec: z.number().optional(),
				durationSec: z.number().optional(),
				url: z.string().optional(),
			}),
		)
		.optional(),
	vignette: z.boolean().default(false),
	grain: z.boolean().default(false),
});

// Free-form timeline overlays composited over the base scene reel. Times are
// absolute seconds from the start of the video.
/* A text template's parameters, as JSON.
 *
 * MUST match `TemplateParams` in @maleo/shared, which this package cannot
 * import — see `src/exports.ts`. Params are written to a document and read back
 * from JSON, so JSON is what they are; `motion-comp` stores a whole composition
 * bundle here rather than field values, which is why the value type is
 * recursive rather than a scalar union. */
export const templateParamValueSchema: z.ZodType<TemplateParamValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(templateParamValueSchema),
		z.record(z.string(), templateParamValueSchema),
	]),
);
export type TemplateParamValue =
	| string
	| number
	| boolean
	| null
	| TemplateParamValue[]
	| { [key: string]: TemplateParamValue };
export type TemplateParams = Record<string, TemplateParamValue>;

export const textOverlaySchema = z.object({
	content: z.string(),
	startSec: z.number().default(0),
	durationSec: z.number().default(2),
	preset: z.string().optional(),
	/** Editor row index — drives stacking (lower row renders in front). */
	track: z.number().optional(),
	layout: textLayoutSchema,
	style: clipTextStyleSchema,
	/** Structured per-template content fields (see dashboard clip-templates/*.ts).
	 *  Absent on legacy/plain-text presets, which render from `content` alone. */
	params: z.record(z.string(), templateParamValueSchema).optional(),
	/** Normalized animation of a Motion Studio preview layer; timeline text uses `layout.animation`. */
	anim: overlayAnimSchema.nullish(),
});
export const infographicPayloadSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("stat_reveal"),
		title: z.string(),
		value: z.string(),
		suffix: z.string().optional(),
		comparison: z.string().optional(),
	}),
	z.object({
		type: z.literal("bar_chart"),
		title: z.string(),
		rows: z
			.array(z.object({ label: z.string(), value: z.number(), color: z.string().optional() }))
			.min(1),
		unit: z.string().optional(),
	}),
	z.object({
		type: z.literal("line_chart"),
		title: z.string(),
		points: z.array(z.object({ label: z.string(), value: z.number() })).min(2),
		unit: z.string().optional(),
	}),
	z.object({
		type: z.literal("area_chart"),
		title: z.string(),
		points: z.array(z.object({ label: z.string(), value: z.number() })).min(2),
		unit: z.string().optional(),
	}),
	z.object({
		type: z.literal("pie_chart"),
		title: z.string(),
		slices: z
			.array(z.object({ label: z.string(), value: z.number(), color: z.string().optional() }))
			.min(1),
		unit: z.string().optional(),
	}),
	z.object({
		type: z.literal("donut_chart"),
		title: z.string(),
		slices: z
			.array(z.object({ label: z.string(), value: z.number(), color: z.string().optional() }))
			.min(1),
		centerLabel: z.string().optional(),
		unit: z.string().optional(),
	}),
	z.object({
		type: z.literal("progress_bars"),
		title: z.string(),
		rows: z
			.array(z.object({ label: z.string(), value: z.number(), color: z.string().optional() }))
			.min(1),
		unit: z.string().optional(),
	}),
	z.object({
		type: z.literal("circular_progress"),
		title: z.string(),
		value: z.number(),
		label: z.string().optional(),
		unit: z.string().optional(),
	}),
	z.object({
		type: z.literal("table_build"),
		title: z.string(),
		columns: z.array(z.string()).min(1),
		rows: z.array(z.array(z.string())).min(1),
		highlight: z.object({ row: z.number().optional(), col: z.number().optional() }).optional(),
		// Per-cell verdict marks (tick/cross), same shape as `rows`. A marked cell
		// renders the icon instead of text-only styling — comparison-table device.
		marks: z.array(z.array(z.enum(["tick", "cross", "none"]))).optional(),
		// One-shot SFX per revealed row: tick rows play tickUrl, cross rows crossUrl.
		rowSfx: z
			.object({ tickUrl: z.string().optional(), crossUrl: z.string().optional() })
			.optional(),
	}),
	z.object({
		type: z.literal("price_tag"),
		title: z.string(),
		price: z.string(),
		// Anchor/original price rendered struck-through next to `price`.
		compareAt: z.string().optional(),
		note: z.string().optional(),
		// Urgency pill ("Today only", "-40%") popped in after the price lands.
		badge: z.string().optional(),
		// Animate the number falling from compareAt down to price (both numeric).
		dropAnimation: z.boolean().optional(),
	}),
	z.object({
		// Social proof: star rating fly-in + sold/review count-ups from product metadata.
		type: z.literal("social_proof"),
		title: z.string(),
		rating: z.number().min(0).max(5).optional(),
		reviewCount: z.string().optional(),
		soldCount: z.string().optional(),
		badge: z.string().optional(),
	}),
	z.object({
		// Scarcity/urgency: stock counter and/or deadline line. Values may be
		// refreshed at render time from a live product feed before validation.
		type: z.literal("urgency"),
		title: z.string(),
		stockCount: z.number().optional(),
		stockLabel: z.string().optional(),
		deadlineText: z.string().optional(),
		note: z.string().optional(),
	}),
]);
export const infographicOverlaySchema = z.object({
	startSec: z.number().default(0),
	durationSec: z.number().default(3),
	// Absolute video time (seconds) when the main build/count animation starts.
	// Before it, the panel sits entered-but-idle — lets a stat pop exactly on the
	// voiceover word instead of the clip edge. Absent → build starts at startSec.
	revealAtSec: z.number().nullish(),
	track: z.number().default(0),
	layout: clipLayoutSchema,
	animation: z
		.object({
			in: z.enum(["fade", "slide_up", "scale"]).default("fade"),
			main: z.enum(["build", "count", "highlight"]).default("build"),
			out: z.enum(["fade"]).default("fade"),
		})
		.partial()
		.optional(),
	payload: infographicPayloadSchema,
	style: z
		.object({
			bgColor: z.string().optional(),
			bgOpacity: z.number().min(0).max(1).optional(),
			borderColor: z.string().optional(),
			borderOpacity: z.number().min(0).max(1).optional(),
			borderRadius: z.number().min(0).max(40).optional(),
			blur: z.number().min(0).max(30).optional(),
			dataColor: z.string().optional(),
			labelColor: z.string().optional(),
		})
		.optional(),
});
export const audioOverlaySchema = z.object({
	animation: audioAnimationSchema.optional(),
	loopSource: z.boolean().optional(),
	// Audio Director kinds: narration, music bed, ambient pad, one-shot SFX, and
	// accent hits (stingers). Renderer mixes each at a kind-appropriate level.
	kind: z.enum(["voiceover", "music", "sfx", "ambient", "accent_hit"]).default("voiceover"),
	content: z.string().default(""),
	url: z.string().optional(),
	startSec: z.number().default(0),
	durationSec: z.number().default(2),
	volume: z.number().min(0).max(1).default(1),
	// How far this clip drops under narration, as a fraction of its own volume.
	// Absent means the kind default in music.ts; 1 disables ducking for this clip.
	duckUnderVoice: z.number().min(0).max(1).optional(),
	fadeInSec: z.number().min(0).default(0),
	fadeOutSec: z.number().min(0).default(0),
	// Media in-point (seconds) skipped from the source's start — for split / trim.
	mediaStartSec: z.number().min(0).optional(),
});
export const videoOverlaySchema = z.object({
	url: z.string(),
	thumb: z.string().optional(),
	kind: z.enum(["image", "video"]).default("image"),
	track: z.number().default(0),
	startSec: z.number().default(0),
	durationSec: z.number().default(3),
	layout: clipLayoutSchema,
	// Incoming transition: plays as an entrance effect when another visual
	// clip touches this one. Null/cut = hard appearance.
	transition: z
		.enum(["cut", "fade", "slide", "zoom", "wipe", "flip", "clock_wipe", "pixel"])
		.nullish(),
	transitionDurSec: z.number().nullish(),
	// Media in-point (seconds) skipped from the source video's start — for split / trim.
	mediaStartSec: z.number().min(0).optional(),
	// Source-audio gain for video overlays. Default 0 keeps the historical
	// muted-b-roll behavior; > 0 plays the clip's own soundtrack at that gain.
	volume: z.number().min(0).max(1).default(0),
	reveal: visualRevealSchema.optional(),
});
export const effectClipSchema = z.object({
	// flash / zoom_punch / whip_pan are pattern interrupts: short attention-reset
	// spikes injected between beats (retention devices).
	effect: z.enum(["fade_in", "fade_out", "zoom_out_from_black", "flash", "zoom_punch", "whip_pan"]),
	startSec: z.number().default(0),
	durationSec: z.number().default(1),
	intensity: z.number().min(0).max(1).default(1),
});
export const captionsConfigSchema = z
	.object({
		enabled: z.boolean().default(false),
		fontFamily: z.string().default("Inter"),
		fontSize: z.number().default(72),
		weight: z.string().default("Black"),
		italic: z.boolean().default(false),
		allCaps: z.boolean().default(false),
		style: z.string().default("Standard"),
		lines: z.enum(["Single Line", "Two Lines"]).default("Single Line"),
		chunkDuration: z.string().default("1,2"),
		maxWords: z.number().min(1).max(12).default(4),
		maxChars: z.number().min(8).max(80).default(26),
		maxPauseMs: z.number().min(80).max(1500).default(260),
		verticalPosition: z.number().default(100),
		maxWidth: z.number().min(40).max(100).default(86),
		fill: z.string().default("#ffffff"),
		activeColor: z.string().default("#ffd400"),
		background: z.string().default("transparent"),
		stroke: z.string().default("transparent"),
		shadow: z.string().default("transparent"),
		shadowOpacity: z.number().min(0).max(100).default(78),
		shadowBlur: z.number().min(0).max(80).default(18),
		shadowDistance: z.number().min(0).max(40).default(5),
		shadowAngle: z.number().min(0).max(360).default(90),
		inactiveOpacity: z.number().min(0).max(100).default(55),
		motion: z.enum(["None", "Fade", "Pop", "Slide Up"]).default("Fade"),
		preset: z.string().default("standard"),
	})
	.partial()
	.optional();
export type CaptionsConfig = z.infer<typeof captionsConfigSchema>;

// Retention/pacing devices layered over the reel: chapter pills ("2/5 · Label")
// counting the storyboard's CHAPTERS, and a thin top progress bar. They counted
// scenes until chapters existed, so "Chapter 2 of 5" meant scene 2 of 5. All colors come from
// the storyboard's palette tokens — the devices carry no palette of their own.
export const pacingDevicesSchema = z
	.object({
		chapterPills: z.boolean().default(false),
		progressBar: z.boolean().default(false),
		variant: z.enum(["pill", "minimal"]).default("pill"),
	})
	.partial()
	.optional();
export type PacingDevicesConfig = z.infer<typeof pacingDevicesSchema>;

export const storyboardSchema = z.object({
	scenes: z.array(storyboardSceneSchema),
	accentColor: z.string().default("#FF3E6C"),
	bgColor: z.string().default("#0B0B0F"),
	fgColor: z.string().default("#FFFFFF"),
	musicUrl: z.string().optional(),
	musicMood: z.enum(["upbeat", "chill", "luxury", "energetic", "minimal"]).default("chill"),
	voiceover: voiceoverSchema.optional(),
	captionCues: z.array(CaptionClipSchema).optional(),
	showLabels: z.boolean().default(false),
	// Base scene track (timeline key -1) toggles: hide blanks the scene reel (timing
	// kept, overlays still play); mute silences scene voiceover + scene audio + music.
	hideBase: z.boolean().optional(),
	muteBase: z.boolean().optional(),
	textOverlays: z.array(textOverlaySchema).default([]),
	infographicOverlays: z.array(infographicOverlaySchema).default([]),
	audioOverlays: z.array(audioOverlaySchema).default([]),
	videoOverlays: z.array(videoOverlaySchema).default([]),
	effects: z.array(effectClipSchema).default([]),
	// Fully-decoupled visual timeline (pure clip render): when present, ALL base
	// visuals — primary scene frames AND promoted beat extras — render as top-level
	// absolute Sequences here, NOT nested in scene Sequences. Scenes then carry only
	// audio/caption/marker timing. Absent → legacy scene-reel render.
	visualTimeline: z
		.array(
			z.object({
				volume: z.number().min(0).max(1).optional(),
				mediaStartSec: z.number().finite().min(0).optional(),
				sourceDurationSec: z.number().finite().positive().optional(),
				url: z.string(),
				kind: z.enum(["image", "video"]).default("image"),
				startSec: z.number().default(0),
				durationSec: z.number().default(2),
				movement: z.string().optional(),
				motion: motionSchema.nullish(),
				focalPoint: z
					.object({ xPct: z.number().min(0).max(100), yPct: z.number().min(0).max(100) })
					.nullish(),
				layout: clipLayoutSchema,
				transition: z
					.enum(["cut", "fade", "slide", "zoom", "wipe", "flip", "clock_wipe", "pixel"])
					.nullish(),
				transitionDurSec: z.number().nullish(),
				reveal: visualRevealSchema.optional(),
			}),
		)
		.optional(),
	captions: captionsConfigSchema,
	pacingDevices: pacingDevicesSchema,
	infographicStyle: z
		.object({
			bgColor: z.string().optional(),
			bgOpacity: z.number().min(0).max(1).optional(),
			borderColor: z.string().optional(),
			borderOpacity: z.number().min(0).max(1).optional(),
			borderRadius: z.number().min(0).max(40).optional(),
			blur: z.number().min(0).max(30).optional(),
			dataColor: z.string().optional(),
			labelColor: z.string().optional(),
		})
		.optional(),
	// Desired total duration. When set (and there's no audio to time against),
	// scene durations scale to fill this so the video matches the requested length
	// instead of a flat per-scene default.
	targetDurationSec: z.number().positive().optional(),
});

export type StoryboardSceneData = z.infer<typeof storyboardSceneSchema>;
export type Storyboard = z.infer<typeof storyboardSchema>;
export type TextOverlayData = z.infer<typeof textOverlaySchema>;
export type InfographicPayload = z.infer<typeof infographicPayloadSchema>;
export type InfographicOverlayData = z.infer<typeof infographicOverlaySchema>;
export type InfographicStyleData = NonNullable<
	z.infer<typeof storyboardSchema>["infographicStyle"]
>;
export type AudioOverlayData = z.infer<typeof audioOverlaySchema>;
export type VideoOverlayData = z.infer<typeof videoOverlaySchema>;

export const aspectMap = {
	vertical: { width: 1080, height: 1920 },
	square: { width: 1080, height: 1080 },
	horizontal: { width: 1920, height: 1080 },
} as const;

export type Aspect = keyof typeof aspectMap;
