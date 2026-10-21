/* An editor scene as the agent receives it.
 *
 * The web sends its live scenes this way when it starts a run, and the API reads a
 * saved timeline the same way when a run starts without them (an MCP client, a
 * read). One mapping, so both see the same scene. */
import type { AgentScene } from "./agent-wire.ts";
import { effectiveRefIds } from "./reference-roster.ts";
import type { Scene } from "./timeline-model.ts";

export function agentSceneFromScene(s: Scene): AgentScene {
	return {
		id: s.id,
		startSec: s.start,
		track: s.track,
		...(s.visualClips ? { visualClips: s.visualClips } : {}),
		...(s.layout ? { layout: s.layout } : {}),
		name: s.name,
		durationSec: s.dur,
		contentDurationSec: s.contentDur,
		shot: s.shot,
		move: s.move,
		transition: s.transition ?? "fade",
		visual: s.vis,
		voiceover: s.vo,
		action: s.action,
		sfx: s.sfx,
		image: s.src,
		refIds: effectiveRefIds({ prompt: "", entityIds: [] }, s),
		useGlobalReferences: s.useGlobalReferences,
		beat: s.beat,
		emotion: s.emotion,
		intent: s.intent,
		question: s.question,
		claim: s.claim,
		evidence: s.evidence,
		sourceEvidence: s.sourceEvidence,
		analogy: s.analogy,
		visualType: s.visualType,
		onScreenText: s.onScreenText,
		motionGraphic: s.motionGraphic,
		sectionTransition: s.sectionTransition,
		sceneKind: s.sceneKind,
		sceneKey: s.sceneKey,
		logicalSceneId: s.logicalSceneId,
		sectionId: s.sectionId,
		storyBeatId: s.storyBeatId,
		sourceRevisionId: s.sourceRevisionId,
		storyboardSceneId: s.storyboardSceneId,
		imageSourceStoryboardSceneId: s.imageSourceStoryboardSceneId,
		editorialPatternId: s.editorialPatternId,
		information: s.information,
	};
}
