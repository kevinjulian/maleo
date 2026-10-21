/* The nine logo-reveal animations. All share LOGO_FIELDS and the same
 * three default params; only the preset and the wording differ. */
import type { TemplateItem } from "./types.ts";
import { LOGO_FIELDS } from "./logo-fields.ts";

export const logoFadeReveal: TemplateItem = {
	kind: "text",
	preset: "rve-logo-fade-reveal",
	label: "Logo Fade Reveal",
	category: "logo",
	intent: "Fade + scale logo reveal",
	fields: LOGO_FIELDS,
	defaultParams: { logoText: "LOGO", name: "Company Name", tagline: "Your tagline here" },
};

export const logoSpinReveal: TemplateItem = {
	kind: "text",
	preset: "rve-logo-spin-reveal",
	label: "Logo Spin Reveal",
	category: "logo",
	intent: "3D Y-axis logo spin",
	fields: LOGO_FIELDS,
	defaultParams: { logoText: "LOGO", name: "Company Name", tagline: "Your tagline here" },
};

export const logoGlitchReveal: TemplateItem = {
	kind: "text",
	preset: "rve-logo-glitch-reveal",
	label: "Logo Glitch Reveal",
	category: "logo",
	intent: "RGB split logo glitch",
	fields: LOGO_FIELDS,
	defaultParams: { logoText: "LOGO", name: "Company Name", tagline: "Your tagline here" },
};

export const logoBounceDrop: TemplateItem = {
	kind: "text",
	preset: "rve-logo-bounce-drop",
	label: "Logo Bounce Drop",
	category: "logo",
	intent: "Logo drops and settles",
	fields: LOGO_FIELDS,
	defaultParams: { logoText: "LOGO", name: "Company Name", tagline: "" },
};

export const logoStrokeDraw: TemplateItem = {
	kind: "text",
	preset: "rve-logo-stroke-draw",
	label: "Logo Stroke Draw",
	category: "logo",
	intent: "SVG stroke logo draw",
	fields: LOGO_FIELDS,
	defaultParams: { logoText: "ACME", name: "", tagline: "" },
};

export const logoScaleRotate: TemplateItem = {
	kind: "text",
	preset: "rve-logo-scale-rotate",
	label: "Logo Scale Rotate",
	category: "logo",
	intent: "Scale + rotate mark",
	fields: LOGO_FIELDS,
	defaultParams: { logoText: "LOGO", name: "Company Name", tagline: "" },
};

export const logoSplitReveal: TemplateItem = {
	kind: "text",
	preset: "rve-logo-split-reveal",
	label: "Logo Split Reveal",
	category: "logo",
	intent: "Two-half logo reveal",
	fields: LOGO_FIELDS,
	defaultParams: { logoText: "LOGO", name: "Company Name", tagline: "" },
};

export const logoTypewriter: TemplateItem = {
	kind: "text",
	preset: "rve-logo-typewriter",
	label: "Logo Typewriter",
	category: "logo",
	intent: "Logo + typed name",
	fields: LOGO_FIELDS,
	defaultParams: { logoText: "ACME STUDIO", name: "ACME STUDIO", tagline: "" },
};

export const logoBlurReveal: TemplateItem = {
	kind: "text",
	preset: "rve-logo-blur-reveal",
	label: "Logo Blur Reveal",
	category: "logo",
	intent: "Blur-to-sharp logo",
	fields: LOGO_FIELDS,
	defaultParams: { logoText: "LOGO", name: "Company Name", tagline: "" },
};
