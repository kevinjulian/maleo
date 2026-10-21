import { z } from "zod";

/* Creative direction: the routed channels every generation stage reads.
 *
 * Channels exist so a directive for one dimension cannot leak into another:
 *   - story  → planning / research topic / narration
 *   - visual → image generation + style bible
 *   - voice  → voiceover synthesis (voice / language / pacing hints)
 *   - rules  → EVERY applicable stage, as hard constraints
 *
 * `rules` is not a fourth taste channel. The other three are guidance a stage may
 * interpret; rules are constraints a stage must obey, and a constraint that
 * reaches only some stages is not a constraint — which is why it is routed
 * everywhere rather than being folded into the other three.
 *
 * User-facing UI now expresses all four through Project Materials; this stays the
 * wire shape the generation stages read, so there is one routing mechanism rather
 * than one per surface. `raw` preserves an operator's original free text, which
 * the LLM router splits when the channels are not authored directly. */

export const creativeDirectionSchema = z
	.object({
		raw: z.string().trim().max(4000).default(""),
		story: z.string().trim().max(2000).default(""),
		visual: z.string().trim().max(2000).default(""),
		voice: z.string().trim().max(2000).default(""),
		/** Hard constraints, routed to every applicable stage. Defaulted rather than
		 *  required so every direction persisted before rules existed still parses. */
		rules: z.string().trim().max(2000).default(""),
	})
	.strict();

export type CreativeDirection = z.infer<typeof creativeDirectionSchema>;

export const EMPTY_CREATIVE_DIRECTION: CreativeDirection = {
	raw: "",
	story: "",
	visual: "",
	voice: "",
	rules: "",
};

/** True when no channel carries any direction (router/stages can no-op). */
export function isEmptyDirection(d: CreativeDirection | null | undefined): boolean {
	return (
		!d ||
		(!d.raw.trim() && !d.story.trim() && !d.visual.trim() && !d.voice.trim() && !d.rules.trim())
	);
}

/** True when the operator has authored channels directly (skip the LLM router). */
export function hasExplicitChannels(d: CreativeDirection | null | undefined): boolean {
	return Boolean(d && (d.story.trim() || d.visual.trim() || d.voice.trim() || d.rules.trim()));
}
