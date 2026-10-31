/* Motion intent (motion-design-generation): what a model decides about one moment
 * of motion design — which primitive layers exist, their role and class, where
 * they rest, and which states change them. It holds no timing curves, delays or
 * easings; `compileMotion` derives all of those from the motion tokens.
 *
 * `parseMotionIntent` is the boundary a model's output crosses. A refusal names
 * the rule and the layer or state, so a retry can be told exactly what to fix. */
import { z } from "zod";
import { MOTION_CLASSES, MOTION_ROLES } from "./motion-tokens.ts";
import { VISUAL_PRIMITIVE_IDS } from "./visual-primitives.ts";

export const MOTION_DIRECTIONS = [
	"up",
	"down",
	"left",
	"right",
	"scale",
	"fade",
	"grow-x",
	"grow-y",
] as const;
export type MotionDirection = (typeof MOTION_DIRECTIONS)[number];

export const MAX_MOTION_LAYERS = 12;
export const MAX_MOTION_STATES = 8;

/** Ids are internal names, so a model's spelling is normalised rather than
 *  refused: the same rule runs wherever an id appears, so references still match. */
const slug = (value: unknown) =>
	typeof value === "string"
		? value
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "")
				.slice(0, 40)
		: value;
const id = z.preprocess(
	slug,
	z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Use lowercase letters, digits and dashes"),
);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a #rrggbb colour");
const position = z.number().finite().min(-50).max(150);
const size = z.number().finite().min(0.5).max(200);

const motionBoxSchema = z
	.object({ xPct: position, yPct: position, widthPct: size, heightPct: size })
	.strict();

const motionLayerSchema = z
	.object({
		id,
		primitive: z.enum(VISUAL_PRIMITIVE_IDS),
		content: z.string().trim().max(160).default(""),
		role: z.enum(MOTION_ROLES),
		class: z.enum(MOTION_CLASSES),
		box: motionBoxSchema,
		opacity: z.number().finite().min(0).max(1).default(1),
		text: z
			.object({
				fill: hex.optional(),
				fontSize: z.number().finite().min(8).max(400).optional(),
				weight: z.number().int().min(100).max(900).optional(),
				align: z.enum(["left", "center", "right"]).optional(),
				casing: z.enum(["none", "upper"]).optional(),
			})
			.strict()
			.optional(),
		shape: z
			.object({
				fill: hex.optional(),
				stroke: hex.optional(),
				strokeWidth: z.number().finite().min(0).max(40).optional(),
				radius: z.number().finite().min(0).max(200).optional(),
			})
			.strict()
			.optional(),
		enter: z
			.object({ state: id, from: z.enum(MOTION_DIRECTIONS) })
			.strict()
			.optional(),
		exit: z
			.object({ state: id, to: z.enum(MOTION_DIRECTIONS) })
			.strict()
			.optional(),
	})
	.strict();

/** Models name the changed layer several ways; the first present one is the layer. */
const LAYER_ALIASES = ["layer", "id", "target", "layerId"] as const;
const withLayerKey = (value: unknown): unknown => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
	const entries = Object.entries(value);
	const name = LAYER_ALIASES.map((key) => entries.find(([k]) => k === key)?.[1]).find(
		(v) => v !== undefined,
	);
	const rest = entries.filter(([k]) => !LAYER_ALIASES.some((alias) => alias === k));
	return Object.fromEntries(name === undefined ? rest : [["layer", name], ...rest]);
};

const motionChangeSchema = z.preprocess(
	withLayerKey,
	z
		.object({
			layer: id,
			xPct: position.optional(),
			yPct: position.optional(),
			widthPct: size.optional(),
			heightPct: size.optional(),
			scale: z.number().finite().min(0).max(10).optional(),
			rotationDeg: z.number().finite().min(-360).max(360).optional(),
			opacity: z.number().finite().min(0).max(1).optional(),
			fill: hex.optional(),
		})
		.strict(),
);

const motionStateSchema = z
	.object({
		id,
		atSec: z.number().finite().min(0),
		changes: z.array(motionChangeSchema).max(MAX_MOTION_LAYERS).default([]),
	})
	.strict();

export const motionIntentSchema = z
	.object({
		layers: z.array(motionLayerSchema).min(1).max(MAX_MOTION_LAYERS),
		states: z.array(motionStateSchema).min(1).max(MAX_MOTION_STATES),
	})
	.strict();

export type MotionIntent = z.infer<typeof motionIntentSchema>;
export type MotionLayer = MotionIntent["layers"][number];
export type MotionState = MotionIntent["states"][number];
export type MotionChange = MotionState["changes"][number];
export type MotionBox = z.infer<typeof motionBoxSchema>;

export type MotionIntentResult = { ok: true; intent: MotionIntent } | { ok: false; error: string };

const normalized = (text: string) => text.toLocaleLowerCase().replace(/\s+/gu, " ").trim();

/** Layers that move in a state: entering, exiting or changed there. */
export function layersMovingIn(intent: MotionIntent, stateId: string): MotionLayer[] {
	const changed = new Set(
		intent.states.find((s) => s.id === stateId)?.changes.map((c) => c.layer) ?? [],
	);
	return intent.layers.filter(
		(l) => l.enter?.state === stateId || l.exit?.state === stateId || changed.has(l.id),
	);
}

function layerError(layer: MotionLayer, sourceText: string | undefined): string | undefined {
	const label = `layer "${layer.id}"`;
	if (layer.primitive === "plain") {
		if (!layer.content) return `${label}: plain text needs content`;
		if (layer.shape) return `${label}: plain text takes text settings, not shape settings`;
		if (sourceText !== undefined && !normalized(sourceText).includes(normalized(layer.content)))
			return `${label}: text "${layer.content}" must be quoted from the source text`;
		return undefined;
	}
	if (layer.content) return `${label}: a shape has no text content`;
	if (layer.text) return `${label}: a shape takes shape settings, not text settings`;
	if (layer.shape?.radius !== undefined && layer.primitive !== "shape-rect")
		return `${label}: corner radius applies only to shape-rect`;
	return undefined;
}

function referenceError(intent: MotionIntent, spanSec: number): string | undefined {
	const layerIds = new Set<string>();
	for (const layer of intent.layers) {
		if (layerIds.has(layer.id)) return `layer "${layer.id}" is declared twice`;
		layerIds.add(layer.id);
	}
	const stateAt = new Map<string, number>();
	let previous = -1;
	for (const state of intent.states) {
		if (stateAt.has(state.id)) return `state "${state.id}" is declared twice`;
		if (state.atSec <= previous) return `state "${state.id}" must come after the previous state`;
		if (state.atSec >= spanSec)
			return `state "${state.id}" at ${state.atSec}s is outside the ${spanSec}s moment`;
		stateAt.set(state.id, state.atSec);
		previous = state.atSec;
		for (const change of state.changes) {
			const layer = intent.layers.find((l) => l.id === change.layer);
			if (!layer) return `state "${state.id}" changes unknown layer "${change.layer}"`;
			if (change.fill !== undefined && layer.primitive !== "plain")
				return `state "${state.id}": fill can change only on text layers`;
		}
	}
	for (const layer of intent.layers) {
		const enter = layer.enter && stateAt.get(layer.enter.state);
		const exit = layer.exit && stateAt.get(layer.exit.state);
		if (layer.enter && enter === undefined)
			return `layer "${layer.id}" enters at unknown state "${layer.enter.state}"`;
		if (layer.exit && exit === undefined)
			return `layer "${layer.id}" exits at unknown state "${layer.exit.state}"`;
		if (enter !== undefined && exit !== undefined && exit <= enter)
			return `layer "${layer.id}" must exit after it enters`;
	}
	return undefined;
}

/** A state must move something, and at most one hero. When the hero stays still,
 *  the first layer the state moves leads it (`stateStarts`). */
function heroError(intent: MotionIntent): string | undefined {
	for (const state of intent.states) {
		const moving = layersMovingIn(intent, state.id);
		if (!moving.length) return `state "${state.id}" moves no layer`;
		const heroes = moving.filter((l) => l.role === "hero");
		if (heroes.length > 1)
			return `state "${state.id}" must move at most one hero layer, found ${heroes.length}`;
	}
	return undefined;
}

/** Validates a model's intent for a moment of `spanSec`. With `sourceText`, every
 *  text layer must quote it, so authoring cannot add claims the source lacks. */
export function parseMotionIntent(
	raw: unknown,
	spanSec: number,
	sourceText?: string,
): MotionIntentResult {
	const parsed = motionIntentSchema.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0]!;
		return { ok: false, error: `${issue.path.join(".") || "intent"}: ${issue.message}` };
	}
	const intent = parsed.data;
	for (const layer of intent.layers) {
		const error = layerError(layer, sourceText);
		if (error) return { ok: false, error };
	}
	const error = referenceError(intent, spanSec) ?? heroError(intent);
	return error ? { ok: false, error } : { ok: true, intent };
}
