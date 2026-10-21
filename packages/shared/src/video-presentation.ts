/** Viewer-facing presentation grammar. One beat chooses one primary clip family;
 * captions and base visuals remain supporting layers. Template ids stay plain
 * strings so dashboard can add templates without widening blueprint schemas. */
export const PRESENTATION_CATEGORIES = [
	"narrative",
	"headline",
	"explainer",
	"infographic",
	"transition",
] as const;
export type PresentationCategory = (typeof PRESENTATION_CATEGORIES)[number];
export type PresentationClipFamily = "none" | "text" | "infographic";

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
		defaultTemplateId: "title",
		compatibleTemplateIds: [
			"title",
			"rve-title-split",
			"rve-animated-text",
			"rve-typewriter-subtitle",
		],
	},
	explainer: {
		category: "explainer",
		clipFamily: "text",
		defaultTemplateId: "explainer-card",
		compatibleTemplateIds: ["explainer-card", "rve-quote-card", "rve-floating-bubble-text"],
	},
	infographic: {
		category: "infographic",
		clipFamily: "infographic",
		defaultTemplateId: "stat_reveal",
		compatibleTemplateIds: [
			"stat_reveal",
			"bar_chart",
			"line_chart",
			"area_chart",
			"pie_chart",
			"donut_chart",
			"progress_bars",
			"circular_progress",
			"table_build",
			"price_tag",
			"social_proof",
			"urgency",
		],
	},
	transition: {
		category: "transition",
		clipFamily: "text",
		defaultTemplateId: "section-card",
		compatibleTemplateIds: ["section-card", "rve-chapter-title", "rve-cinematic-title-intro"],
	},
};

export interface PresentationSource {
	onScreenText?: string;
	question?: string;
	claim?: string;
	evidence?: string;
	analogy?: string;
	sectionTransition?: { text?: string };
	motionGraphic?: { needed?: boolean; kind?: string };
}

/** Pick one primary visual explanation. Data wins when explicitly requested;
 * otherwise concise headline, explainer, and transition are mutually exclusive. */
export function presentationFor(source: PresentationSource): PresentationTemplateMapping {
	if (
		source.motionGraphic?.needed &&
		source.motionGraphic.kind &&
		source.motionGraphic.kind !== "none"
	)
		return PRESENTATION_TEMPLATE_MAP.infographic;
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
