// `enabled` flag per capability, stored in config.yaml under
// `capabilities.<id>.enabled`. Defaults to inferred-enabled when the
// capability inspects as "ok" (so pre-existing workspaces don't need
// migration).

import YAML from "yaml";
import type { Workspace } from "../workspace/schema.ts";
import {
	readWorkspaceConfig,
	readWorkspaceConfigText,
	writeWorkspaceConfigText,
} from "../config-yaml.ts";
import type { CapabilityId } from "./types.ts";

export async function getEnabled(
	workspace: string,
	id: CapabilityId,
	fallback: boolean,
): Promise<boolean> {
	let cfg: Workspace;
	try {
		cfg = await readWorkspaceConfig(workspace);
	} catch {
		return fallback;
	}
	const block = cfg.capabilities;
	if (!block) return fallback;
	const entry = block[id];
	if (!entry || typeof entry.enabled !== "boolean") return fallback;
	return entry.enabled;
}

export async function setEnabled(
	workspace: string,
	id: CapabilityId,
	enabled: boolean,
): Promise<void> {
	const text = await readWorkspaceConfigText(workspace);
	const doc = YAML.parseDocument(text);
	doc.setIn(["capabilities", id, "enabled"], enabled);
	await writeWorkspaceConfigText(workspace, String(doc));
}
