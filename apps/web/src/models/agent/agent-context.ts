/* What the agent is told about a project's shape and voice. A plain record, so
 * the module that derives one does not depend on the module that posts it. */
import type { StyleKnobs } from "@maleo/shared";
export interface ChatAgentContext {
	audience?: string;
	targetDurationSec?: number;
	slideCount?: number;
	platform?: string;
	thread?: boolean;
	voiceProvider?: string;
	voice?: string;
	language?: string;
	style?: string;
	styleKnobs?: StyleKnobs;
	styleName?: string;
	timelineTemplateId?: string;
}
