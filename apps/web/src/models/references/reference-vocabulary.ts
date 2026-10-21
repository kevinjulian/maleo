/* Maleo — Content-First Create · Data, helpers, constants, types */
import { ROLES, roleOf, type Role, type RefsState } from "@maleo/shared";

import { hashHue } from "@models/core/measures.ts";

export interface KindMeta {
	label: string;
	iconName: string;
	hue: number;
	custom?: boolean;
}

export interface NoteKindMeta {
	label: string;
	hue: number;
	iconName: string;
	custom?: boolean;
}

const ROLE_PRESENTATION = {
	style: { label: "Style", iconName: "layers", hue: 210 },
	character: { label: "Character", iconName: "person", hue: 268 },
	location: { label: "Location", iconName: "scene", hue: 150 },
	product: { label: "Product", iconName: "box", hue: 28 },
	prop: { label: "Prop", iconName: "box", hue: 60 },
} satisfies Record<Role, { label: string; iconName: string; hue: number }>;

export const REF_KINDS: Record<string, KindMeta> = ROLE_PRESENTATION;

export const REF_KIND_ORDER: readonly string[] = ROLES;

/* A reference's role, resolved through the single shared resolver: the first tag
 * that names a role, else `kind`. Returns null when the ref carries no role —
 * callers decide explicitly instead of inheriting a fallback. */

export function roleOfRef(ref: { tags?: string[]; role?: string }): Role | null {
	// `role` is the entity's own column and is CHECK-constrained, so it answers
	// first. Tags are the pre-entity spelling and remain the fallback for a pool
	// item that predates the column.
	const declared = roleOf(ref.role);
	if (declared) return declared;
	for (const tag of ref.tags ?? []) {
		const role = roleOf(tag);
		if (role) return role;
	}
	return null;
}

export const NOTE_KIND_ORDER = ["tone", "visual", "audio", "structure", "cta", "claim"];

export function getKind(k: string): KindMeta {
	if (REF_KINDS[k]) return REF_KINDS[k];
	const label = k ? k.charAt(0).toUpperCase() + k.slice(1) : "Other";
	return { label, iconName: "layers", hue: hashHue(k), custom: true };
}

/* ════ Voice library ════ */

export const INIT_REFS: RefsState = {
	images: [],
	speakers: [],
	notes: [
		{
			id: "n-tone",
			label: "Tone & style",
			body: "Casual, authentic, relatable",
			default: true,
			tags: ["tone"],
		},
		{
			id: "n-pal",
			label: "Color palette",
			body: "Warm tones, natural light, clean background",
			default: false,
			tags: ["visual"],
		},
		{
			id: "n-music",
			label: "Music / mood",
			body: "Lo-fi chill beat, gentle & unobtrusive",
			default: false,
			tags: ["audio"],
		},
		{
			id: "n-hook",
			label: "3-second hook",
			body: "The first 3 seconds must hook, straight to the point",
			default: false,
			tags: ["structure"],
		},
	],
	style: {
		tone: "Casual, authentic, relatable",
		palette: "Warm tones, natural light",
		music: "Lo-fi chill, gentle beat",
	},
};

/* Tags are the source of truth for a reference's roles (style, character, location,
 * style, product + curated/custom tags like kitchen, warm-light). `kind` is a
 * legacy single-role mirror, used only as a fallback when tags are absent.
 * One reference can carry multiple roles — filter tabs are views over tags,
 * never a separate data model. */

export function referenceTags(ref: { tags?: string[]; kind?: string }): string[] {
	if (ref.tags && ref.tags.length) return ref.tags;
	return ref.kind ? [ref.kind] : [];
}

/* Group/colour key for display. Falls back to "style" ONLY for presentation —
 * never use this to decide what a reference binds as at generation; that is
 * roleOfRef, which returns null rather than guessing. */

export function referenceDisplayRole(ref: { tags?: string[]; role?: string }): string {
	return roleOfRef(ref) ?? "style";
}
