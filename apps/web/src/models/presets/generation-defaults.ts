/* Maleo — Content-First Create · Data, helpers, constants, types */

import type { PacingDevices } from "@maleo/shared";

// A file in the project's media library ("All Media"). Stock/uploads land here
// first; only library assets can be placed on the timeline.

export const DEFAULT_PACING_DEVICES: PacingDevices = {
	chapterPills: false,
	progressBar: false,
	variant: "pill",
};
