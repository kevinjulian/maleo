import { codexImageHealth } from "./health.ts";
import type { Capability } from "../capabilities.ts";
import type { ProviderMeta } from "../types.ts";

export const codexMeta: ProviderMeta = {
	id: "codex",
	label: "Codex Imagegen",
	capabilities: ["image"],
	models: { image: "codex-imagegen" },
	image: { references: { mode: "native", maxImages: 4 } },
	// Capability-aware: only image runs through the Codex runner boundary.
	async health(capability?: Capability) {
		if (capability && capability !== "image") return "unconfigured";
		return codexImageHealth();
	},
};
