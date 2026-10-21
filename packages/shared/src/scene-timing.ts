/* Scene timing normalisation.
 *
 * Pure math over the shared `Scene` type: keep a scene's canonical fields and its
 * clip projections in sync, and lay a list of scenes end to end. It lived in the
 * editor's `data.tsx` — the 68-export module every surface imports — which meant
 * the storyboard decoder could not use it without reaching into `apps/web`.
 *
 * `data.tsx` re-exports both, so its consumers resolve unchanged. */
import type { Scene, SceneVisualClip, SceneAudioClip } from "./timeline-model.ts";
import { audioKindLabel } from "./audio-overlays.ts";

// Keep a scene's canonical fields and its timeline clip projections in sync.
// If the scene already carries explicit visual/audio clips those win (and the
// simple src/vo/sfx fields are derived from them); otherwise a single clip per
// track is seeded from src/vo/sfx. The clip arrays feed the render pipeline
// (core orchestrator reads visual_clips / audio_clips), so they are canonical
// once present. `startSec` inside visual/audio clips is local to the scene.
export function normalizeSceneClips(scene: Scene, startSec = 0): Scene {
	const dur = Math.max(1 / 30, Number(scene.dur) || 1);
	const localClipStart = (
		clip: { id?: string; startSec?: number; primary?: boolean },
		kind: "visual" | "audio",
	): number => {
		const raw = Math.max(0, Number(clip.startSec) || 0);
		if (startSec <= 0) return raw;
		const defaultPrefix =
			kind === "visual" ? `scene-${scene.id}-visual` : `scene-${scene.id}-audio`;
		const looksLikeDefaultSceneClip = Boolean(clip.primary || clip.id?.startsWith(defaultPrefix));
		if (looksLikeDefaultSceneClip && raw >= startSec && raw <= startSec + dur) {
			return Math.round((raw - startSec) * 1000) / 1000;
		}
		return raw;
	};
	// The seeded primary IS the scene's frame, so it carries the scene's asset
	// identity. Without that, normalising a scene invented a visual clip holding a
	// URL the project had admitted but this clip could not name.
	const seededVisuals: SceneVisualClip[] = scene.src
		? [
				{
					id: `scene-${scene.id}-visual-1`,
					kind: "image",
					label: scene.name || "Visual",
					url: scene.src,
					...(scene.mediaAssetId ? { mediaAssetId: scene.mediaAssetId } : {}),
					startSec: 0,
					durationSec: dur,
					primary: true,
				},
			]
		: [];
	const rawVisuals = scene.visualClips?.length ? scene.visualClips : seededVisuals;
	const hasExplicitPrimary = rawVisuals.some((clip) => clip.primary === true);
	const visualClips = rawVisuals
		.filter((clip) => clip.url.trim())
		.map((clip, index) => ({
			...clip,
			id: clip.id || `scene-${scene.id}-visual-${index + 1}`,
			kind: clip.kind,
			label: clip.label || `${clip.kind === "video" ? "Video" : "Image"} ${index + 1}`,
			url: clip.url.trim(),
			...(clip.mediaAssetId ? { mediaAssetId: clip.mediaAssetId } : {}),
			startSec: localClipStart(clip, "visual"),
			durationSec: Math.max(1 / 30, Number(clip.durationSec) || dur),
			primary: hasExplicitPrimary ? clip.primary === true : index === 0,
			motion: clip.motion ?? null,
			...(clip.reveal ? { reveal: clip.reveal } : {}),
		}));
	const seededAudio: SceneAudioClip[] = [
		scene.vo?.trim()
			? {
					id: `scene-${scene.id}-audio-voiceover`,
					kind: "voiceover" as const,
					label: "Voiceover",
					content: scene.vo,
					startSec: 0,
					durationSec: dur,
				}
			: null,
		scene.sfx?.trim()
			? {
					id: `scene-${scene.id}-audio-sfx`,
					kind: "sfx" as const,
					label: "SFX",
					content: scene.sfx,
					startSec: 0,
					durationSec: dur,
				}
			: null,
	].filter((clip) => clip !== null);
	const audioClips = (scene.audioClips?.length ? scene.audioClips : seededAudio)
		.filter((clip) => clip.content.trim())
		.map((clip, index) => ({
			...clip,
			id: clip.id || `scene-${scene.id}-audio-${index + 1}`,
			kind: clip.kind,
			label: clip.label || audioKindLabel(clip.kind),
			content: clip.content.trim(),
			startSec: localClipStart(clip, "audio"),
			durationSec: Math.max(1 / 30, Number(clip.durationSec) || dur),
		}));
	const primaryVisual = visualClips.find((clip) => clip.primary) ?? visualClips[0];
	const voiceover = audioClips
		.filter((clip) => clip.kind === "voiceover")
		.map((clip) => clip.content)
		.join(" ")
		.trim();
	const sfx = audioClips
		.filter((clip) => clip.kind !== "voiceover")
		.map((clip) => clip.content)
		.join(" · ")
		.trim();
	return {
		...scene,
		dur,
		src: primaryVisual?.url,
		img: Boolean(primaryVisual?.url),
		vo: voiceover,
		sfx: sfx || undefined,
		visualClips,
		audioClips,
	};
}

export function resequenceScenes(scenes: Scene[]): Scene[] {
	let cursor = 0;
	return scenes.map((scene) => {
		const normalized = normalizeSceneClips(scene, cursor);
		cursor += normalized.dur;
		return normalized;
	});
}
