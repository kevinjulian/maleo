import { fieldOf } from "@maleo/shared";
import type { Workspace } from "./workspace/schema.ts";
import { readWorkspaceConfig } from "./config-yaml.ts";
import type { CharacterLock, StyleProfile } from "@maleo/shared";

const STR_FIELDS = [
	"style",
	"camera",
	"post_processing",
	"aspect_ratio",
	"lighting_default",
	"mood_default",
	"color_palette",
	"depth_of_field",
	"global_tokens",
	"scene_extras",
	"negative",
] as const;

export async function getWorkspaceImageStyle(workspace: string): Promise<StyleProfile | undefined> {
	let cfg: Workspace;
	try {
		cfg = await readWorkspaceConfig(workspace);
	} catch {
		return undefined;
	}
	// `image_style` is declared as a record of `unknown`, so the block itself is
	// typed but its fields are not — the narrowing below is the real check and
	// stays.
	const b = cfg.image_style;
	if (!b) return undefined;

	const character = (() => {
		const c = b.character;
		if (!c || typeof c !== "object") return undefined;
		const lock: CharacterLock = {};
		for (const k of ["subject", "hair", "outfit", "face", "body", "expression"] as const) {
			const v = fieldOf(c, k);
			if (typeof v === "string" && v.trim()) lock[k] = v.trim();
		}
		return Object.keys(lock).length > 0 ? lock : undefined;
	})();

	const out: StyleProfile = {};
	for (const k of STR_FIELDS) {
		const v = b[k];
		if (typeof v === "string" && v.trim()) out[k] = v.trim();
	}
	if (character) out.character = character;
	return Object.keys(out).length > 0 ? out : undefined;
}
