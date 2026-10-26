/** Viewer-facing presentation grammar. One beat chooses one primary clip family;
 * captions and base visuals remain supporting layers. Template ids stay plain
 * strings so dashboard can add templates without widening blueprint schemas. */
export const PRESENTATION_CATEGORIES = [
	"narrative",
	"headline",
	"explainer",
	"transition",
] as const;
export type PresentationCategory = (typeof PRESENTATION_CATEGORIES)[number];
export type PresentationClipFamily = "none" | "text";

export interface PresentationTemplateMapping {
	category: PresentationCategory;
	clipFamily: PresentationClipFamily;
	defaultTemplateId?: string;
	compatibleTemplateIds: readonly string[];
}

export const PRESENTATION_TEMPLATE_MAP: Readonly<
	Record<PresentationCategory, PresentationTemplateMapping>
> = {
	narrative: { category: "narrative", clipFamily: "none", compatibleTemplateIds: [] },
	headline: {
		category: "headline",
		clipFamily: "text",
		defaultTemplateId: "plain",
		compatibleTemplateIds: ["plain"],
	},
	explainer: {
		category: "explainer",
		clipFamily: "text",
		defaultTemplateId: "plain",
		compatibleTemplateIds: ["plain"],
	},
	transition: {
		category: "transition",
		clipFamily: "text",
		defaultTemplateId: "plain",
		compatibleTemplateIds: ["plain"],
	},
};

export interface PresentationSource {
	onScreenText?: string;
	question?: string;
	claim?: string;
	evidence?: string;
	analogy?: string;
	sectionTransition?: { text?: string };
}

/** Pick one primary visual explanation. Headline, explainer, and transition are
 * mutually exclusive. */
export function presentationFor(source: PresentationSource): PresentationTemplateMapping {
	if (
		source.claim?.trim() ||
		source.evidence?.trim() ||
		source.analogy?.trim() ||
		source.question?.trim()
	)
		return PRESENTATION_TEMPLATE_MAP.explainer;
	if (source.onScreenText?.trim()) return PRESENTATION_TEMPLATE_MAP.headline;
	if (source.sectionTransition?.text?.trim()) return PRESENTATION_TEMPLATE_MAP.transition;
	return PRESENTATION_TEMPLATE_MAP.narrative;
}

export function templateCompatibleWithPresentation(
	category: PresentationCategory,
	templateId: string,
): boolean {
	return PRESENTATION_TEMPLATE_MAP[category].compatibleTemplateIds.includes(templateId);
}
