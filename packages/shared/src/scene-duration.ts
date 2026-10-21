/* How long a scene occupies the timeline, and who decided.
 *
 * A scene's duration is either PINNED — the operator set it, and generated
 * speech running longer is an overflow to report rather than a reason to retime
 * — or AUTO, meaning it should follow the measured speech.
 *
 * Deriving an auto duration is NOT here. It would need speech to be measured,
 * and the editor has no per-scene synthesis path — only the agent's
 * whole-storyboard pass. A deriver shipped ahead of the thing that would call it
 * is a deriver nobody runs; the semantic-gap table that fed it duplicated
 * `narrationBoundaryAfter` in the API, which is where it should live when there
 * is something to run it.
 *
 * Absence reads as pinned. Every document written before this existed set `dur`
 * explicitly, so any other default would silently retime every project on its
 * first read. That rule lives here rather than in the document parse because the
 * parse carries a scene's payload verbatim; the meaning of a missing field is
 * the reader's, not the decoder's.
 */
import type { Scene, SceneDurationMode } from "./timeline-model.ts";

/** A scene's duration mode. Absent means pinned — see the module header. */
export function durationModeOf(scene: Pick<Scene, "durMode">): SceneDurationMode {
	return scene.durMode === "auto" ? "auto" : "pinned";
}

/** How much longer a pinned scene's measured content runs than the scene does.
 *
 *  Zero when it fits, when nothing has been measured, or when the scene is auto
 *  — an auto scene cannot overflow, because its duration is derived from the
 *  content in the first place. A positive number is speech that would be cut.  */
export function contentOverflowSec(scene: Pick<Scene, "durMode" | "dur" | "contentDur">): number {
	if (durationModeOf(scene) === "auto" || scene.contentDur === undefined) return 0;
	return Math.max(0, scene.contentDur - scene.dur);
}
