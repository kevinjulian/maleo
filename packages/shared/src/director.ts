/* Video Director — applies a style's knobs to a scene list.
 *
 * The deterministic "decision layer": given generated scenes + a style's knobs,
 * resolve each scene's emotion (from its beat, inferred by position when unset)
 * into a concrete camera move, and each boundary into a transition, using the
 * shared mapping tables. No style → scenes returned untouched (opt-in).
 */
import {
	cameraForEmotion,
	contextForBeats,
	emotionForBeat,
	rhythmTransition,
	transitionForContext,
	varyCamera,
	type CameraMove,
	type Emotion,
	type StoryBeat,
	type StyleKnobs,
} from "./video-style.ts";
import { inferBeat } from "./video-blueprint.ts";
import type { Scene } from "./timeline-model.ts";

/** Identity of the preset a knob set came from. Carried separately because the
 *  knobs themselves are anonymous — the ContentPreset row owns the name. */
export interface StyleMeta {
	name: string;
	description: string;
}

// A compact natural-language directive describing the chosen style, fed to the
// generation agent so it can plan scene beats/emotions/pacing to match. No bare
// identifier is emitted: an operator-authored style has none worth sending, and
// a shipped one would only invite the model's own associations with the name.
export function styleDirective(style?: StyleKnobs, meta?: StyleMeta): string | undefined {
	if (!style) return undefined;
	const named = meta?.name?.trim()
		? `Style direction: ${meta.name}${meta.description?.trim() ? ` — ${meta.description}` : ""}`
		: undefined;
	return [
		named,
		`Pacing: ${style.pacing} (~${style.avgSceneDurationSec}s per scene).`,
		`Color mood: ${style.colorMood}. Music: ${style.musicDescription}.`,
		'For EACH scene also set: "beat" (one of hook, setup, conflict, twist, resolution, cta), a one-word "emotion", and a short "intent". Shape the emotional arc to fit this style.',
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}

// Apply a style's knobs to scenes: fills beat/emotion (keeping generator-supplied),
// then overrides camera movement + scene→scene transition from the mapping tables.
export function applyDirector(scenes: Scene[], style?: StyleKnobs): Scene[] {
	if (!style) return scenes;
	const total = scenes.length;
	const beatAt = (i: number): StoryBeat => scenes[i]!.beat ?? inferBeat(i, total);
	const emotionAt = (i: number): Emotion => scenes[i]!.emotion ?? emotionForBeat(beatAt(i));
	let prevMove: CameraMove | undefined;
	return scenes.map((scene, index): Scene => {
		const beat: StoryBeat = beatAt(index);
		const emotion: Emotion = emotionAt(index);
		const move = varyCamera(cameraForEmotion(emotion, style), prevMove);
		prevMove = move;
		const transition =
			index < total - 1
				? rhythmTransition(
						transitionForContext(contextForBeats(beat, beatAt(index + 1)), style),
						emotionAt(index + 1),
					)
				: scene.transition;
		return { ...scene, beat, emotion, move, transition };
	});
}
