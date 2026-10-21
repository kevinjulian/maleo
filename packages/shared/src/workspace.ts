// Workspace-config zod schemas for blocks both core + dashboard validate.

import { z } from "zod";

export const AutomationFlagsSchema = z.object({
	auto_post: z.boolean().default(true),
	auto_reply: z.boolean().default(true),
});

export type AutomationFlagsParsed = z.infer<typeof AutomationFlagsSchema>;

export const ActivationRowZ = z.object({
	text: z.boolean().default(true),
	image: z.boolean().default(false),
	video: z.boolean().default(false),
});

export const ChannelActivationsZ = z.object({
	post: ActivationRowZ.default({ text: true, image: false, video: false }),
	reply: ActivationRowZ.default({ text: true, image: false, video: false }),
	overrides: z
		.object({
			image_aspect: z.enum(["1:1", "16:9", "9:16", "4:5"]).nullable().default(null),
			video_aspect: z.enum(["1:1", "16:9", "9:16", "4:5"]).nullable().default(null),
		})
		.default({ image_aspect: null, video_aspect: null }),
	automation: AutomationFlagsSchema.optional(),
});

/* The workspace as a chooser sees it — the wire shape of `GET /api/workspaces`.
 *
 * Declared here rather than in the route because the switcher and the endpoint
 * have to agree on branding and counts, and this is the contract they agree on.
 * Branding is non-nullable here even though the registry columns are nullable:
 * the API derives a name-hashed fallback (see `deriveBranding`), so a chooser
 * never has to decide what colour an unbranded workspace is. */
export interface WorkspaceSummary {
	name: string;
	display_name: string;
	status: "active" | "paused" | "archived";
	color: string;
	color_bright: string;
	color_deep: string;
	tagline: string;
	initials: string;
	/** How many content projects this workspace owns. Lets the switcher show
	 *  which workspaces hold work BEFORE one is entered, so an empty workspace is
	 *  expected rather than discovered. */
	project_count: number;
}
