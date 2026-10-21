import type { StyleKnob, TemplateItem } from "./types.ts";
import type { TextPreset } from "@maleo/shared";

import {
	barChart,
	lineChart,
	areaChart,
	pieChart,
	donutChart,
	progressBars,
	circularProgress,
	statCounter,
	comparisonChart,
} from "./data-templates.ts";
import {
	cinematicTitleIntro,
	lowerThird,
	endCard,
	chapterTitle,
	quoteCard,
	creditsRoll,
	countdownIntro,
	titleSplit,
	subscribeReminder,
} from "./intro-templates.ts";
import {
	logoFadeReveal,
	logoSpinReveal,
	logoGlitchReveal,
	logoBounceDrop,
	logoStrokeDraw,
	logoScaleRotate,
	logoSplitReveal,
	logoTypewriter,
	logoBlurReveal,
} from "./logo-templates.ts";
import {
	explainerCard,
	sectionCard,
	bubblePopText,
	poppingScaleText,
	floatingTextChip,
	glitchText,
	animatedText,
	typewriterSubtitle,
} from "./text-templates.ts";
import { shapeRect, shapeCircle } from "./shape-templates.ts";

export type { TemplateCategory, TemplateItem, TemplateField, StyleKnob } from "./types.ts";
export { TEMPLATE_CATEGORIES } from "./types.ts";

// Style knobs advertised per preset. Default = every knob; overrides trim knobs
// a template's renderer ignores so the edit popover stays honest (no dead
// controls). NO_BODY = single-line templates without a secondary/body line.
const DEFAULT_KNOBS: StyleKnob[] = ["fg", "bg", "accent", "body", "scale", "font"];
const NO_BODY: StyleKnob[] = ["fg", "bg", "accent", "scale", "font"];
const STYLE_KNOB_OVERRIDES: Record<string, StyleKnob[]> = {
	"rve-popping-text": NO_BODY,
	"rve-bubble-pop-text": NO_BODY,
	"rve-floating-bubble-text": NO_BODY,
	"rve-animated-text": NO_BODY,
	"rve-glitch-text": NO_BODY,
	"rve-typewriter-subtitle": NO_BODY,
	"rve-title-split": NO_BODY,
	"rve-countdown-intro": NO_BODY,
	"section-card": NO_BODY,
	// Shapes: color/size live in their own params; only scale applies.
	"shape-rect": ["scale"],
	"shape-circle": ["scale"],
};
export function styleKnobsFor(preset: string): StyleKnob[] {
	return STYLE_KNOB_OVERRIDES[preset] ?? DEFAULT_KNOBS;
}

// Templates are grouped by category into sibling modules; this registry is the
// only place that flattens them into the list the Templates panel renders.
export const TEMPLATE_ITEMS: TemplateItem[] = [
	barChart,
	lineChart,
	areaChart,
	pieChart,
	donutChart,
	progressBars,
	circularProgress,
	statCounter,
	comparisonChart,

	cinematicTitleIntro,
	lowerThird,
	endCard,
	chapterTitle,
	quoteCard,
	creditsRoll,
	countdownIntro,
	titleSplit,
	subscribeReminder,

	logoFadeReveal,
	logoSpinReveal,
	logoGlitchReveal,
	logoBounceDrop,
	logoStrokeDraw,
	logoScaleRotate,
	logoSplitReveal,
	logoTypewriter,
	logoBlurReveal,

	explainerCard,
	sectionCard,
	bubblePopText,
	poppingScaleText,
	floatingTextChip,
	glitchText,
	animatedText,
	typewriterSubtitle,

	shapeRect,
	shapeCircle,
];

// Lookup by preset for the text-overlay edit panel and for seeding a newly
// added overlay's `params` from the template's `defaultParams`.
export function findTextTemplate(
	preset: TextPreset,
): Extract<TemplateItem, { kind: "text" }> | undefined {
	return TEMPLATE_ITEMS.find(
		(item): item is Extract<TemplateItem, { kind: "text" }> =>
			item.kind === "text" && item.preset === preset,
	);
}
