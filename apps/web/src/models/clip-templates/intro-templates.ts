/* Titles, cards and the intro/outro beats that frame a video. */
import type { TemplateItem } from "./types.ts";

export const cinematicTitleIntro: TemplateItem = {
	kind: "text",
	preset: "rve-cinematic-title-intro",
	label: "Cinematic Title Intro",
	category: "intro",
	intent: "Title + underline + subtitle",
	fields: [
		{ key: "title", type: "text", label: "Title", placeholder: "Your Story Begins" },
		{ key: "subtitle", type: "text", label: "Subtitle", placeholder: "A Cinematic Experience" },
	],
	defaultParams: { title: "Your Story Begins", subtitle: "A Cinematic Experience" },
};

export const lowerThird: TemplateItem = {
	kind: "text",
	preset: "rve-lower-third",
	label: "Lower Third",
	category: "intro",
	intent: "Broadcast name/title overlay",
	fields: [
		{ key: "name", type: "text", label: "Name", placeholder: "John Smith" },
		{ key: "role", type: "text", label: "Role", placeholder: "Senior Producer" },
	],
	defaultParams: { name: "John Smith", role: "Senior Producer" },
};

export const endCard: TemplateItem = {
	kind: "text",
	preset: "rve-end-card",
	label: "End Card",
	category: "intro",
	intent: "Subscribe/social outro",
	fields: [
		{ key: "title", type: "text", label: "Title", placeholder: "Thanks for Watching" },
		{ key: "cta", type: "text", label: "Call to action", placeholder: "Subscribe for More" },
		{ key: "studio", type: "text", label: "Studio credit", placeholder: "STUDIO CREATIVE" },
	],
	defaultParams: {
		title: "Thanks for Watching",
		cta: "Subscribe for More",
		studio: "STUDIO CREATIVE",
	},
};

export const chapterTitle: TemplateItem = {
	kind: "text",
	preset: "rve-chapter-title",
	label: "Chapter Title",
	category: "intro",
	intent: "Chapter number card",
	fields: [
		{ key: "number", type: "text", label: "Number", placeholder: "1" },
		{ key: "label", type: "text", label: "Label", placeholder: "The Beginning" },
	],
	defaultParams: { number: "1", label: "The Beginning" },
};

export const quoteCard: TemplateItem = {
	kind: "text",
	preset: "rve-quote-card",
	label: "Quote Card",
	category: "intro",
	intent: "Quote + attribution",
	fields: [
		{
			key: "quote",
			type: "textarea",
			label: "Quote",
			placeholder: "Design is not just what it looks like. Design is how it works.",
		},
		{ key: "author", type: "text", label: "Author", placeholder: "Steve Jobs" },
	],
	defaultParams: {
		quote: "Design is not just what it looks like. Design is how it works.",
		author: "Steve Jobs",
	},
};

export const creditsRoll: TemplateItem = {
	kind: "text",
	preset: "rve-credits-roll",
	label: "Credits Roll",
	category: "intro",
	intent: "Movie-style credits",
	fields: [
		{
			key: "rows",
			type: "list",
			label: "Credits",
			itemLabel: "Credit",
			itemFields: [
				{ key: "role", type: "text", label: "Role", placeholder: "DIRECTOR" },
				{ key: "name", type: "text", label: "Name", placeholder: "Jane Smith" },
			],
		},
	],
	defaultParams: {
		rows: [
			{ role: "DIRECTOR", name: "Jane Smith" },
			{ role: "PRODUCER", name: "John Doe" },
			{ role: "EDITOR", name: "Maleo Studio" },
		],
	},
};

export const countdownIntro: TemplateItem = {
	kind: "text",
	preset: "rve-countdown-intro",
	label: "Countdown Intro",
	category: "intro",
	intent: "Countdown ring + GO",
	fields: [{ key: "seconds", type: "number", label: "Count from", min: 1, max: 10, step: 1 }],
	defaultParams: { seconds: 3 },
};

export const titleSplit: TemplateItem = {
	kind: "text",
	preset: "rve-title-split",
	label: "Title Split",
	category: "intro",
	intent: "Split outlined/filled title",
	fields: [{ key: "text", type: "text", label: "Text", placeholder: "REVEALED" }],
	defaultParams: { text: "REVEALED" },
};

export const subscribeReminder: TemplateItem = {
	kind: "text",
	preset: "rve-subscribe-reminder",
	label: "Subscribe Reminder",
	category: "intro",
	intent: "Floating subscribe pill",
	fields: [
		{ key: "label", type: "text", label: "Label", placeholder: "Subscribe" },
		{ key: "handle", type: "text", label: "Handle", placeholder: "@CreativeStudio" },
	],
	defaultParams: { label: "Subscribe", handle: "@CreativeStudio" },
};
