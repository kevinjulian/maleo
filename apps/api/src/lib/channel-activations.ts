// Per-workspace, per-channel activation matrix. Lives in config.yaml:
//
// channels:
//   threads:
//     activations:
//       post:  { text: true,  image: true,  video: false }
//       reply: { text: true,  image: false, video: false }
//     overrides:
//       image_aspect: "1:1"
//       video_aspect: null
//
// Pure shape helpers (parse / merge / clamp) live in @maleo/shared so
// core uses the exact same logic. This file only owns the dashboard's
// YAML IO via config-yaml.ts.

import YAML from "yaml";
import {
	activeMediaTypes,
	mergeActivations,
	parseChannelActivations,
	type ChannelActivations,
	type ChannelActivationsPatch,
	type Kind,
	type MediaType,
} from "@maleo/shared";
import type { Workspace } from "./workspace/schema.ts";
import {
	readWorkspaceConfig,
	readWorkspaceConfigText,
	writeWorkspaceConfigText,
} from "./config-yaml.ts";
import { getChannelManifest, type ChannelId } from "./channel-caps.ts";

export type {
	ActivationRow,
	ChannelActivations,
	ChannelActivationsPatch,
	ChannelOverrides,
	Kind,
} from "@maleo/shared";

async function readBlock(workspace: string): Promise<NonNullable<Workspace["channels"]>> {
	try {
		return (await readWorkspaceConfig(workspace)).channels ?? {};
	} catch {
		return {};
	}
}

export async function readChannelActivations(
	workspace: string,
	channel: ChannelId,
): Promise<ChannelActivations> {
	const all = await readBlock(workspace);
	const manifest = getChannelManifest(channel);
	return parseChannelActivations(all[channel], manifest);
}

export async function writeChannelActivations(
	workspace: string,
	channel: ChannelId,
	updates: ChannelActivationsPatch,
): Promise<ChannelActivations> {
	const current = await readChannelActivations(workspace, channel);
	const manifest = getChannelManifest(channel);
	const merged = mergeActivations(current, updates, manifest);

	const text = await readWorkspaceConfigText(workspace);
	const doc = YAML.parseDocument(text);
	doc.setIn(["channels", channel, "activations", "post"], merged.post);
	doc.setIn(["channels", channel, "activations", "reply"], merged.reply);
	doc.setIn(["channels", channel, "overrides"], merged.overrides);
	await writeWorkspaceConfigText(workspace, String(doc));
	return merged;
}

// Which (channel, kind) combos have ≥1 content type active. Used by
// the behavior tab to know where a mix decision is needed.
export async function activeMatrix(workspace: string): Promise<
	Array<{
		channel: ChannelId;
		kind: Kind;
		active: MediaType[];
	}>
> {
	const out: Array<{ channel: ChannelId; kind: Kind; active: MediaType[] }> = [];
	// SAFETY: unchecked here; each key is checked against getChannelManifest
	// below before it is used.
	const channels = Object.keys(await readBlock(workspace)) as ChannelId[];
	for (const ch of channels) {
		if (!getChannelManifest(ch)) continue;
		const acts = await readChannelActivations(workspace, ch);
		for (const k of ["post", "reply"] as const) {
			const active = activeMediaTypes(acts, k);
			if (active.length > 0) out.push({ channel: ch, kind: k, active });
		}
	}
	return out;
}
