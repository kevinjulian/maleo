/* The one place a material group's user-facing words live.
 *
 * Library nav, the preset editor, the create flow and the editor drawer all name
 * the same four groups. Spelling them at each surface is how "Visual" becomes
 * "Visuals" in one place and "Look" in another, and how an operator stops trusting
 * that two screens mean the same thing.
 *
 * Group labels are deliberately plain nouns, not the internal category names the
 * old surfaces exposed (Image refs, Story refs, Brand refs, Audience refs, Voice
 * refs, Asset prompts, Evidence refs, Constraint refs). Those eight told an
 * operator about the storage, not about the decision they were making.
 */
import { MATERIAL_GROUPS, type MaterialGroup } from "@maleo/shared";

export interface MaterialGroupCopy {
	/** Title case, used as a heading or row label. */
	label: string;
	/** One line explaining what belongs in the group. */
	hint: string;
	/** Placeholder shown in the group's body field. */
	placeholder: string;
	/** Icon key in `Ic`. Kept here so every surface draws the same group the same. */
	icon: "book" | "palette" | "mic" | "shield";
}

export const MATERIAL_GROUP_COPY = {
	story: {
		label: "Story",
		hint: "Narrative source and framing — notes, transcripts, claims, audience.",
		placeholder: "What this video is about, who it is for, what it must say",
		icon: "book",
	},
	visual: {
		label: "Visual",
		hint: "Assets and look — images, logos, brand look, image guidance.",
		placeholder: "How scenes should look: subject, palette, framing, brand cues",
		icon: "palette",
	},
	voice: {
		label: "Voice",
		hint: "Narration and speech — tone, pace, pronunciation, voice style.",
		placeholder: "How narration should sound, and how to pronounce names",
		icon: "mic",
	},
	rules: {
		label: "Rules",
		hint: "Hard constraints every stage must obey.",
		placeholder: "no captions\nkeep the logo exact\nno humans on screen",
		icon: "shield",
	},
} satisfies Record<MaterialGroup, MaterialGroupCopy>;

/** Groups in display order. Story first because it is what a person decides first. */
export const MATERIAL_GROUP_ORDER: readonly MaterialGroup[] = MATERIAL_GROUPS;

/** A short one-line preview of a body, for scan rows that cannot show all of it. */
export function materialSummary(body: string, assetCount = 0, limit = 68): string {
	const flat = body.replace(/\s+/g, " ").trim();
	const assets = assetCount > 0 ? `${assetCount} reference${assetCount === 1 ? "" : "s"}` : "";
	if (!flat) return assets || "Empty";
	const text = flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
	return assets ? `${text} · ${assets}` : text;
}

/* What the Rules group shows above its constraints, read-only.
 *
 * Duration, aspect and language are decided by project settings, which stay the
 * single writer. Rules SHOWS them because a constraint list that omits "this is a
 * 9:16 video" is missing the constraint operators most often forget — but it does
 * not EDIT them, because two writers for one value is how the two disagree. */
export function rulesSettingsSummary(settings: {
	aspectRatio?: string;
	language?: string;
	voice?: string;
}): string {
	const parts = [
		settings.aspectRatio?.trim() || null,
		settings.language?.trim() || null,
		settings.voice?.trim() ? `voice ${settings.voice.trim()}` : null,
	].filter((part): part is string => Boolean(part));
	return parts.length ? parts.join(" · ") : "No output constraints set";
}
