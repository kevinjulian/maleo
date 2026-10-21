/* The project vocabulary shared across families: the status and type unions and
 * the brief. Kept in its own module so a family never imports the barrel that
 * imports it. */

export type CampaignStatus = "draft" | "active" | "paused" | "done" | "archived";
export type ContentProjectType = "video" | "image" | "text";
export type ContentProjectStatus =
	| "brief"
	| "storyboard"
	| "assets"
	| "rendering"
	| "ready"
	| "archived";

export type { ContentProjectBrief } from "@maleo/shared";
