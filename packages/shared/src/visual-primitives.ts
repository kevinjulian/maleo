/** Authoring vocabulary. `motion-comp` is a container, never a primitive. */
export const VISUAL_PRIMITIVE_IDS = [
	"plain",
	"shape-rect",
	"shape-circle",
	"shape-triangle",
	"shape-star",
	"shape-cross",
] as const;
export type VisualPrimitiveId = (typeof VISUAL_PRIMITIVE_IDS)[number];

export const SHAPE_PRIMITIVES = [
	{
		preset: "shape-rect",
		label: "Rectangle",
		kind: "Shape",
		defaultParams: { fill: "", stroke: "", strokeWidth: 0, radius: 12, opacity: 1 },
	},
	{
		preset: "shape-circle",
		label: "Circle",
		kind: "Shape",
		defaultParams: { fill: "", stroke: "", strokeWidth: 0, opacity: 1 },
	},
	{
		preset: "shape-triangle",
		label: "Triangle",
		kind: "Shape",
		defaultParams: { fill: "", stroke: "", strokeWidth: 0, opacity: 1 },
	},
	{
		preset: "shape-star",
		label: "Star",
		kind: "Shape",
		defaultParams: { fill: "", stroke: "", strokeWidth: 0, opacity: 1 },
	},
	{
		preset: "shape-cross",
		label: "Cross",
		kind: "Shape",
		defaultParams: { fill: "", stroke: "", strokeWidth: 0, opacity: 1 },
	},
] as const;
export type ShapePrimitiveId = (typeof SHAPE_PRIMITIVES)[number]["preset"];
export function shapePrimitiveOf(preset: unknown) {
	return SHAPE_PRIMITIVES.find((shape) => shape.preset === preset);
}
export const PLAIN_TEXT_STYLE = {
	fontSize: 64,
	fontWeight: 400,
	textAlign: "center",
	lineHeight: 1.2,
} as const;
export type ShapePoint = readonly [number, number];

/** Explicit authored defaults for newly generated plain-text overlays. */
export const PLAIN_TEXT_AUTHOR_STYLE = {
	fontFamily: "Inter",
	fontSize: 64,
	weight: 400,
	fill: "#FFFFFF",
	align: "center",
	lineHeight: 1.2,
} as const;

/** Unit-box paths. Star's inner radius is half its outer radius. */
export const SHAPE_POLYGONS: Readonly<
	Record<"shape-triangle" | "shape-star" | "shape-cross", readonly ShapePoint[]>
> = {
	"shape-triangle": [
		[0.5, 0],
		[1, 1],
		[0, 1],
	],
	"shape-star": Array.from({ length: 10 }, (_, i): ShapePoint => {
		const angle = -Math.PI / 2 + (i * Math.PI) / 5;
		const radius = i % 2 === 0 ? 0.5 : 0.25;
		return [0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius];
	}),
	"shape-cross": [
		[1 / 3, 0],
		[2 / 3, 0],
		[2 / 3, 1 / 3],
		[1, 1 / 3],
		[1, 2 / 3],
		[2 / 3, 2 / 3],
		[2 / 3, 1],
		[1 / 3, 1],
		[1 / 3, 2 / 3],
		[0, 2 / 3],
		[0, 1 / 3],
		[1 / 3, 1 / 3],
	],
};

/** Inset a centred stroke by half its width; round joins keep it in the box.
 * Zero dimensions draw nothing. Nonsquare boxes scale both axes independently. */
export function shapeGeometry(
	preset: ShapePrimitiveId,
	width: number,
	height: number,
	strokeWidth = 0,
	radius = 0,
) {
	if (![width, height, strokeWidth, radius].every((n) => Number.isFinite(n) && n >= 0))
		throw new RangeError(
			"Shape dimensions, stroke width and radius must be finite and non-negative",
		);
	const stroke = Math.min(strokeWidth, width, height);
	const inset = stroke / 2;
	const w = width - stroke;
	const h = height - stroke;
	if (preset === "shape-rect")
		return {
			kind: "rect" as const,
			x: inset,
			y: inset,
			width: w,
			height: h,
			radius: Math.min(radius, w / 2, h / 2),
			strokeWidth: stroke,
		};
	if (preset === "shape-circle")
		return {
			kind: "ellipse" as const,
			cx: width / 2,
			cy: height / 2,
			rx: w / 2,
			ry: h / 2,
			strokeWidth: stroke,
		};
	return {
		kind: "polygon" as const,
		points: SHAPE_POLYGONS[preset].map(([x, y]): ShapePoint => [inset + x * w, inset + y * h]),
		strokeWidth: stroke,
	};
}

/** Explicit historical IDs: unknown input must fail, never become deletion. */
export const RETIRED_VISUAL_PRESET_IDS = [
	"title",
	"subtitle",
	"lower-third",
	"stat",
	"quote",
	"location",
	"timeline",
	"chapter",
	"explainer-card",
	"section-card",
	"rve-cinematic-title-intro",
	"rve-lower-third",
	"rve-end-card",
	"rve-chapter-title",
	"rve-quote-card",
	"rve-credits-roll",
	"rve-countdown-intro",
	"rve-title-split",
	"rve-subscribe-reminder",
	"rve-logo-fade-reveal",
	"rve-logo-spin-reveal",
	"rve-logo-glitch-reveal",
	"rve-logo-bounce-drop",
	"rve-logo-stroke-draw",
	"rve-logo-scale-rotate",
	"rve-logo-split-reveal",
	"rve-logo-typewriter",
	"rve-logo-blur-reveal",
	"rve-bubble-pop-text",
	"rve-popping-text",
	"rve-floating-bubble-text",
	"rve-glitch-text",
	"rve-animated-text",
	"rve-typewriter-subtitle",
] as const;

/** Only historical readers use this default. New writes require an explicit ID. */
export function oldEffectiveVisualPreset(id: unknown): unknown {
	return id === undefined || id === null || id === "" ? "title" : id;
}

export function isVisualPrimitive(id: unknown): id is VisualPrimitiveId {
	return VISUAL_PRIMITIVE_IDS.some((value) => value === id);
}

export function classifyVisualPreset(
	id: unknown,
): "primitive" | "composition" | "retired" | "unknown" {
	const effective = oldEffectiveVisualPreset(id);
	if (isVisualPrimitive(effective)) return "primitive";
	if (effective === "motion-comp") return "composition";
	if (RETIRED_VISUAL_PRESET_IDS.some((value) => value === effective)) return "retired";
	return "unknown";
}
