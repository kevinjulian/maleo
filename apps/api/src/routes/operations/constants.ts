/* Shared constants + row shapes for the operations route groups. */
import type {
	CampaignStatus,
	ContentProjectStatus,
	ContentProjectType,
} from "@maleo/db/content-types";

export const CAMPAIGN_STATUSES = new Set<CampaignStatus>([
	"draft",
	"active",
	"paused",
	"done",
	"archived",
]);

/* CONTENT_VOICE_LIBRARY is gone. It mapped one provider and nothing else,
 * and both routes that served it hardcoded sample provider —
 * so an operator running Canvas was shown six voices that could not be
 * synthesized and none of the eight that could. The catalogue now resolves for
 * the effective provider in lib/voice-catalogue-source.ts. */

/** The same members as the sets below, as arrays, so a query string can be
 *  CHECKED against them with `oneOf` rather than asserted into them. */
export const CONTENT_PROJECT_TYPE_LIST = [
	"video",
	"image",
	"text",
] as const satisfies readonly ContentProjectType[];
export const CONTENT_PROJECT_STATUS_LIST = [
	"brief",
	"storyboard",
	"assets",
	"rendering",
	"ready",
	"archived",
] as const satisfies readonly ContentProjectStatus[];

export const CONTENT_PROJECT_TYPES = new Set<ContentProjectType>(CONTENT_PROJECT_TYPE_LIST);

export const CONTENT_PROJECT_STATUSES = new Set<ContentProjectStatus>(CONTENT_PROJECT_STATUS_LIST);

// Draft fields surfaced to the dashboard Content view. The draft is now the
// content record of record — there is no parallel ticket row.
