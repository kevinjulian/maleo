/* The story arc, projected onto the script's chapters.
 *
 * A chapter is the CONTAINER — a span with a title, derived by `seedChapters`
 * from the scenes' own `sectionId`. A chapter function is the narrative JOB the
 * container holds, and it lives on the plan section, not on the chapter. This
 * module joins the two for display and does nothing else: it derives no chapter,
 * changes no ordering, and writes nothing back.
 *
 * The join key is that `seedChapters` gives a run the agent already grouped the
 * plan section's own id, so a chapter's id and its section's id are the same
 * string. A document whose chapters were grouped by beat or by nothing gets a
 * positional `ch-N` id instead, matches no section, and renders exactly as it did
 * before — which is also what every plan made before arcs existed does.
 */
import { payloadOfKind, storyPlanArtifact } from "@maleo/shared";
import type { StoryPlanPayload } from "@maleo/shared/agent-wire";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import type { StoryArc } from "@maleo/shared";

export interface ChapterArcRole {
	chapterFunction: string;
	/** What the arc says this chapter must do. Absent on a plan that recorded the
	 *  function before obligations were carried. */
	obligation?: string;
}

export interface ScriptArcRoles {
	/** The plan's arc, named once for the whole script. */
	arc?: StoryArc;
	byChapterId: ReadonlyMap<string, ChapterArcRole>;
}

const EMPTY: ScriptArcRoles = { byChapterId: new Map() };

/* The newest story plan in the log wins.
 *
 * A run replaces its plan artifact in place, but the log keeps every message, so
 * a re-planned project carries an older plan earlier in the list. Reading the
 * last one is what makes the script agree with the plan card rather than with a
 * superseded draft. */
export function scriptArcRoles(messages: readonly ChatLogMessage[]): ScriptArcRoles {
	let plan: StoryPlanPayload | undefined;
	for (const message of messages) {
		plan = payloadOfKind(message.artifact, storyPlanArtifact) ?? plan;
	}
	if (!plan || !Array.isArray(plan.sections)) return EMPTY;
	const byChapterId = new Map<string, ChapterArcRole>();
	for (const section of plan.sections) {
		const chapterId = section?.sectionId ?? section?.id;
		if (!chapterId || !section.chapterFunction) continue;
		byChapterId.set(chapterId, {
			chapterFunction: section.chapterFunction,
			obligation: section.chapterObligation,
		});
	}
	// A plan with an arc but no chapter functions still names its arc: the arc is a
	// property of the plan, not of any one section.
	return byChapterId.size > 0 || plan.arc ? { arc: plan.arc, byChapterId } : EMPTY;
}

/** The function label as an operator reads it: `inciting_crisis` → "inciting crisis". */
export function readableArcTerm(value: string): string {
	return value.replace(/_/g, " ");
}
