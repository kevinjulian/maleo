// Pure shape helpers for channel-activations parsing. Both core and
// dashboard reuse these. IO (config.yaml read/write) stays in each
// repo since they use different config-loading paths.

import type { Aspect, ChannelManifest, MediaType } from "./channel.ts";
import { pickAspect } from "./channel.ts";
import { fieldOf } from "./object-keys.ts";

export type Kind = "post" | "reply";

export interface ActivationRow {
	text: boolean;
	image: boolean;
	video: boolean;
}

export interface ChannelOverrides {
	image_aspect: Aspect | null;
	video_aspect: Aspect | null;
}

export interface ChannelActivations {
	post: ActivationRow;
	reply: ActivationRow;
	overrides: ChannelOverrides;
}

/** What `mergeActivations` actually accepts.
 *
 *  Not `Partial<ChannelActivations>`: that says each ROW is whole-or-absent,
 *  and the merge spreads `updates.post` over `current.post`, so a body naming
 *  one flag has always worked. The looser type is the true one. */
export interface ChannelActivationsPatch {
	post?: Partial<ActivationRow>;
	reply?: Partial<ActivationRow>;
	overrides?: Partial<ChannelOverrides>;
}

const DEFAULT_ROW: ActivationRow = {
	text: true,
	image: false,
	video: false,
};

function pickBool(v: unknown, fb: boolean): boolean {
	return typeof v === "boolean" ? v : fb;
}

// Parse one activation row; clamp media types the channel manifest
// doesn't support to false.
function effectiveRow(
	raw: unknown,
	manifest: Pick<ChannelManifest, "content_types"> | null,
): ActivationRow {
	// `pickBool` already falls back on anything that is not a boolean, so reading
	// the fields as `unknown` is the type it was written for.
	const out: ActivationRow = {
		text: pickBool(fieldOf(raw, "text"), DEFAULT_ROW.text),
		image: pickBool(fieldOf(raw, "image"), DEFAULT_ROW.image),
		video: pickBool(fieldOf(raw, "video"), DEFAULT_ROW.video),
	};
	if (manifest) {
		const supported = new Set<MediaType>(manifest.content_types);
		if (!supported.has("text")) out.text = false;
		if (!supported.has("image")) out.image = false;
		if (!supported.has("video")) out.video = false;
	}
	return out;
}

function parseOverrides(raw: unknown): ChannelOverrides {
	return {
		image_aspect: pickAspect(fieldOf(raw, "image_aspect")),
		video_aspect: pickAspect(fieldOf(raw, "video_aspect")),
	};
}

// Build a full ChannelActivations from raw YAML node + manifest lookup.
export function parseChannelActivations(
	raw: unknown,
	manifest: ChannelManifest | null,
): ChannelActivations {
	const acts = fieldOf(raw, "activations");
	return {
		post: effectiveRow(fieldOf(acts, "post"), manifest),
		reply: effectiveRow(fieldOf(acts, "reply"), manifest),
		overrides: parseOverrides(fieldOf(raw, "overrides")),
	};
}

export function mergeActivations(
	current: ChannelActivations,
	updates: ChannelActivationsPatch,
	manifest: ChannelManifest | null,
): ChannelActivations {
	const merged: ChannelActivations = {
		post: { ...current.post, ...updates.post },
		reply: { ...current.reply, ...updates.reply },
		overrides: { ...current.overrides, ...updates.overrides },
	};
	if (manifest) {
		const supported = new Set<MediaType>(manifest.content_types);
		for (const k of ["post", "reply"] as const) {
			if (!supported.has("text")) merged[k].text = false;
			if (!supported.has("image")) merged[k].image = false;
			if (!supported.has("video")) merged[k].video = false;
		}
	}
	return merged;
}

export function activeMediaTypes(activations: ChannelActivations, kind: Kind): MediaType[] {
	const r = activations[kind];
	const out: MediaType[] = [];
	if (r.text) out.push("text");
	if (r.image) out.push("image");
	if (r.video) out.push("video");
	return out;
}
