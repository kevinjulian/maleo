// Library surface for embedding the render composition elsewhere (e.g. the
// dashboard preview via @remotion/player). Deliberately does NOT import ./index,
// which calls registerRoot — that belongs only to the Remotion render bundle.
// Consumers get the SAME composition the renderer uses, so preview == render.
export { StoryboardReel } from "./compositions/StoryboardReel";
export {
	storyboardSchema,
	aspectMap,
	visualRevealTypes,
	visualRevealDirections,
	visualRevealBlackDirections,
	visualRevealPhases,
	visualRevealTextures,
	visualRevealColorBuilds,
	visualRevealSchema,
	type Storyboard,
	type Aspect,
	type TemplateParams,
	type TemplateParamValue,
	type VisualRevealData,
} from "./schema";
export {
	effectiveRevealDurationFrames,
	revealClipStyle,
	revealColorBuildStyle,
	revealColorPhaseStyle,
	revealDarkPhaseStyle,
	revealTextureStyle,
} from "./components/RevealEffect";
export { storyboardSeconds } from "./lib/duration";
// The transition resolver, exported so the web client's render-option-parity
// check can call it for every transition the UI offers and confirm each one
// resolves to something other than the default arm. An id with no case falls
// through to `fade`, which is indistinguishable from choosing fade.
export { resolveTransition, type TransitionId } from "./lib/transitions";
export {
	assertRenderStoryboard,
	validateRenderStoryboard,
	type RenderValidationFinding,
	type RenderValidationReport,
} from "./lib/validate-storyboard";
export { ensureFonts, FONT_FAMILY } from "./fonts";
// Camera-motion parameters (Ken Burns presets) — the dashboard's client-side
// draft exporter replays the same movement the renderer uses.
export { resolveMotion, MOTION_PRESETS, type MotionParams } from "./lib/motion-presets";
// Keyframe motion engine — the SAME evaluator the renderer samples, so the
// dashboard motion editor's live preview matches the export exactly.
export {
	evalMotion,
	evalColorTrack,
	evalTrack,
	fromLegacy,
	presetKeyframes,
	resolveMotionKeyframes,
	type EasingId,
	type MotionKeyframe,
	type KeyframeMotion,
	type MotionSample,
	type OverlayAnim,
	type ColorKeyframe,
	type ColorOverlayProp,
	type ValueKeyframe,
} from "./lib/motion-keyframes";
// The duck table the renderer mixes with, exported so the editor can show an
// operator what a clip is doing before they change it — and so the copy that
// lives in @maleo/shared (which this package cannot import) can be asserted
// equal to it rather than trusted.
export { DEFAULT_DUCK_UNDER_VOICE, dialoguePriorityEnvelope } from "./lib/music";
