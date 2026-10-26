import { z } from "zod";
import { compositionConfigSchema, compositionOverlaySchema } from "./composition-schema.ts";
import { classifyVisualPreset } from "./visual-primitives.ts";

export interface VisualCleanupCounts {
	removedClips: number;
	removedLayers: number;
	removedTemplates: number;
}
const counts = (): VisualCleanupCounts => ({
	removedClips: 0,
	removedLayers: 0,
	removedTemplates: 0,
});

/** Only structural cleanup slots are decoded. Other project/record fields survive. */
const cleanupEnvelopeSchema = z
	.object({
		clips: z.array(z.unknown()).optional(),
		text_overlays: z.array(z.unknown()).optional(),
		overlays: z.array(z.unknown()).optional(),
		preset: z.unknown().optional(),
		params: z.unknown().optional(),
		kind: z.unknown().optional(),
		base: z.unknown().optional(),
		config: z.unknown().optional(),
		schemaVersion: z.unknown().optional(),
	})
	.passthrough();
type CleanupEnvelope = z.infer<typeof cleanupEnvelopeSchema>;

function object(value: unknown, path: string): CleanupEnvelope {
	const checked = cleanupEnvelopeSchema.safeParse(value);
	if (!checked.success)
		throw new Error(
			`${path}: expected a valid cleanup envelope. Repair data before visual cleanup.`,
		);
	// SAFETY: the schema validates these structural slots without coercion. Keep
	// the original object so unchanged data retains identity and every extra field.
	return value as CleanupEnvelope;
}

function cleanComposition(
	value: unknown,
	path: string,
	tally: VisualCleanupCounts,
): CleanupEnvelope | null {
	const config = object(value, path);
	if (config.schemaVersion !== undefined && config.schemaVersion !== 1)
		throw new Error(
			`${path}.schemaVersion: unsupported composition version. Repair data before visual cleanup.`,
		);
	if (!Array.isArray(config.overlays))
		throw new Error(`${path}.overlays: expected layers. Repair data before visual cleanup.`);
	const overlays = config.overlays.filter((value, i) => {
		const layer = object(value, `${path}.overlays[${i}]`);
		const kind = classifyVisualPreset(layer.preset);
		if (kind === "retired") {
			tally.removedLayers++;
			return false;
		}
		if (kind !== "primitive")
			throw new Error(
				`${path}.overlays[${i}].preset: unsupported primitive. Repair data before visual cleanup.`,
			);
		return true;
	});
	if (!overlays.length) return null;
	const cleaned = { ...config, schemaVersion: 1, overlays };
	const parsed = compositionConfigSchema.safeParse(cleaned);
	if (!parsed.success)
		throw new Error(
			`${path}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
		);
	return config.schemaVersion === 1 && overlays.length === config.overlays.length
		? config
		: cleaned;
}

function cleanText(
	value: unknown,
	path: string,
	tally: VisualCleanupCounts,
): CleanupEnvelope | null {
	const text = object(value, path);
	const kind = classifyVisualPreset(text.preset);
	if (kind === "retired") {
		tally.removedClips++;
		return null;
	}
	if (kind === "unknown")
		throw new Error(`${path}.preset: unknown visual preset. Repair data before visual cleanup.`);
	if (kind === "primitive") return text;
	const params = cleanComposition(text.params, `${path}.params`, tally);
	if (!params) {
		tally.removedClips++;
		return null;
	}
	return params === text.params ? text : { ...text, params };
}

/** Visit only project text payloads. Retained fields and timeline gaps stay exact. */
export function cleanRetiredProjectVisuals(value: unknown) {
	const input = object(value, "project");
	let document = input;
	const tally = counts();
	if (Array.isArray(input.clips)) {
		const original = input.clips;
		const clips = original.flatMap((value, i) => {
			const clip = object(value, `clips[${i}]`);
			if (clip.type !== "text") return [clip];
			const text = cleanText(clip.text, `clips[${i}].text`, tally);
			return !text ? [] : [text === clip.text ? clip : { ...clip, text }];
		});
		if (clips.length !== original.length || clips.some((clip, i) => clip !== original[i]))
			document = { ...document, clips };
	}
	if (Array.isArray(input.text_overlays)) {
		const original = input.text_overlays;
		const overlays = original.flatMap((value, i) => {
			const text = cleanText(value, `text_overlays[${i}]`, tally);
			return text ? [text] : [];
		});
		if (overlays.length !== original.length || overlays.some((text, i) => text !== original[i]))
			document = { ...document, text_overlays: overlays };
	}
	return { value: document, changed: document !== input, counts: tally };
}

/** Saved records keep identity and ownership. Empty/retired-base records vanish. */
export function cleanRetiredVisualTemplate(value: unknown) {
	const input = object(value, "template");
	const tally = counts();
	let record: CleanupEnvelope | null = input;
	if (input.kind === "composition") {
		const config = cleanComposition(input.config, "template.config", tally);
		record = config ? (config === input.config ? input : { ...input, config }) : null;
	} else if (input.kind === "text") {
		const kind = classifyVisualPreset(input.base);
		if (kind === "retired") record = null;
		else if (kind !== "primitive")
			throw new Error(
				"template.base: unknown visual primitive. Repair data before visual cleanup.",
			);
	} else
		throw new Error("template.kind: unsupported template kind. Repair data before visual cleanup.");
	if (record) {
		const category =
			record.kind === "composition" ? "motion" : record.base === "plain" ? "text" : "shape";
		if (record.category !== category) record = { ...record, category };
	}
	if (record?.kind === "text") {
		const parsed = compositionOverlaySchema.safeParse({
			preset: record.base,
			params: record.config,
			content: "",
			relStart: 0,
			dur: 1,
		});
		if (!parsed.success)
			throw new Error(
				`template.config: invalid retained primitive parameters. Repair data before visual cleanup. ${parsed.error.message}`,
			);
	}
	if (!record) tally.removedTemplates++;
	return { value: record, changed: record !== input, counts: tally };
}

export class VisualContractError extends Error {
	override name = "VisualContractError";
}

/** Ordinary writes validate only. Deletion belongs exclusively to cleanup/restore. */
export function retainedProjectVisuals(value: unknown): CleanupEnvelope {
	try {
		const checked = cleanRetiredProjectVisuals(value);
		if (checked.counts.removedClips || checked.counts.removedLayers)
			throw new Error(
				"Retired visual presets cannot be saved. Reload the project and repair pending edits.",
			);
		return checked.value;
	} catch (error) {
		throw new VisualContractError(
			error instanceof Error
				? error.message
				: "Invalid visual elements. Reload and repair this project.",
		);
	}
}
