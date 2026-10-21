import type { TemplateField } from "./types.ts";

// Shared field schema for all 9 logo-reveal templates: an optional uploaded
// logo image (replaces the generated text badge when set), plus the
// name/tagline lines every logo animation renders around it.
export const LOGO_FIELDS: TemplateField[] = [
	{ key: "logoUrl", type: "image", label: "Logo image" },
	{ key: "logoText", type: "text", label: "Badge text (used when no image)", placeholder: "LOGO" },
	{ key: "name", type: "text", label: "Company name", placeholder: "Company Name" },
	{ key: "tagline", type: "text", label: "Tagline", placeholder: "Your tagline here" },
];
