/* Animated text and explainer cards placed on the text-overlay track. */
import type { TemplateItem } from "./types.ts";

export const explainerCard: TemplateItem = {
	kind: "text",
	preset: "explainer-card",
	label: "Explainer Card",
	category: "text",
	intent: "Claim + analogy card",
	fields: [
		{
			key: "claim",
			type: "text",
			label: "Claim",
			placeholder: "A forbidden object instantly creates curiosity.",
		},
		{
			key: "analogy",
			type: "textarea",
			label: "Analogy",
			placeholder: "It is like a wet paint sign.",
		},
	],
	defaultParams: {
		claim: "A forbidden object instantly creates curiosity.",
		analogy: "It is like a wet paint sign.",
	},
};

export const sectionCard: TemplateItem = {
	kind: "text",
	preset: "section-card",
	label: "Section Card",
	category: "text",
	intent: "Section transition plate",
	fields: [{ key: "question", type: "textarea", label: "Question", placeholder: "Can he resist?" }],
	defaultParams: { question: "Can he resist?" },
};

export const bubblePopText: TemplateItem = {
	kind: "text",
	preset: "rve-bubble-pop-text",
	label: "Bubble Pop Text",
	category: "text",
	intent: "Characters pop in bubbles",
	fields: [{ key: "text", type: "text", label: "Text", placeholder: "HELLO" }],
	defaultParams: { text: "HELLO" },
};

export const poppingScaleText: TemplateItem = {
	kind: "text",
	preset: "rve-popping-text",
	label: "Popping Scale Text",
	category: "text",
	intent: "Spring letter pop",
	fields: [{ key: "text", type: "text", label: "Text", placeholder: "BINO!" }],
	defaultParams: { text: "BINO!" },
};

export const floatingTextChip: TemplateItem = {
	kind: "text",
	preset: "rve-floating-bubble-text",
	label: "Floating Text Chip",
	category: "text",
	intent: "Floating gradient chip",
	fields: [{ key: "text", type: "text", label: "Text", placeholder: "Floating" }],
	defaultParams: { text: "Floating" },
};

export const glitchText: TemplateItem = {
	kind: "text",
	preset: "rve-glitch-text",
	label: "Glitch Text",
	category: "text",
	intent: "RGB split text",
	fields: [{ key: "text", type: "text", label: "Text", placeholder: "GLITCH" }],
	defaultParams: { text: "GLITCH" },
};

export const animatedText: TemplateItem = {
	kind: "text",
	preset: "rve-animated-text",
	label: "Animated Text",
	category: "text",
	intent: "Character reveal",
	fields: [{ key: "text", type: "text", label: "Text", placeholder: "Hello Remotion" }],
	defaultParams: { text: "Hello Remotion" },
};

export const typewriterSubtitle: TemplateItem = {
	kind: "text",
	preset: "rve-typewriter-subtitle",
	label: "Typewriter Subtitle",
	category: "text",
	intent: "Typed subtitle line",
	fields: [{ key: "text", type: "text", label: "Text", placeholder: "I like typing..." }],
	defaultParams: { text: "I like typing..." },
};
