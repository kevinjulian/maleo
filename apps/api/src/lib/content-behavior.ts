// behavior.content layer. Pure logic (parsing, rule eval, weighted
// pick, decideContentFromBehavior) lives in @maleo/shared. This
// module owns the dashboard's YAML IO + the workspace-name-keyed
// wrapper functions used by routes.

import YAML from "yaml";
import {
	decideContentFromBehavior,
	parseContentBehavior,
	type ContentBehavior,
	type ContentDecision,
	type ContextSnapshot,
	type Kind,
} from "@maleo/shared";
import {
	readWorkspaceConfig,
	readWorkspaceConfigText,
	writeWorkspaceConfigText,
} from "./config-yaml.ts";
import { readChannelActivations } from "./channel-activations.ts";
import type { ChannelId } from "./channel-caps.ts";

export type { ContentBehavior, ContentDecision, ContextSnapshot, Mix, Rule } from "@maleo/shared";

export async function readContentBehavior(workspace: string): Promise<ContentBehavior> {
	let cfg: unknown;
	try {
		cfg = await readWorkspaceConfig(workspace);
	} catch {
		return { mix: {}, rules: [] };
	}
	return parseContentBehavior(cfg);
}

export async function writeContentBehavior(
	workspace: string,
	next: ContentBehavior,
): Promise<void> {
	const text = await readWorkspaceConfigText(workspace);
	const doc = YAML.parseDocument(text);
	doc.setIn(["behavior", "content"], next);
	await writeWorkspaceConfigText(workspace, String(doc));
}

export async function decideContent(
	workspace: string,
	kind: Kind,
	channel: ChannelId,
	ctx: ContextSnapshot = {},
): Promise<ContentDecision> {
	const activations = await readChannelActivations(workspace, channel);
	const behavior = await readContentBehavior(workspace);
	return decideContentFromBehavior(activations, behavior, kind, channel, ctx);
}
