/* Maleo — audio-overlay ops for the timeline editor: add voiceover/music clips,
 * patch/remove them, and regenerate TTS (which reflows every track by the new
 * clip duration). Owns the TTS busy map + provider status so the editor doesn't
 * carry the generation plumbing inline. */
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { generateTts } from "@api/media.ts";
import type { AudioOverlay, EffectClip, Scene, TextOverlay, VideoOverlay } from "@maleo/shared";
import { trimMediaTiming } from "@maleo/shared";
import type { AudioOverlayKind } from "@maleo/shared/audio-overlays";
import type { GlobalSettings } from "@models/presets/creative-settings.ts";
import { rippleAfterDurationChange } from "@models/timeline/timeline-clips.ts";
import { useTtsStatus } from "./use-tts-status.ts";
import type { MediaAssetSeed } from "@models/timeline/media-admission.ts";
import { seedForGeneratedAudio } from "@models/timeline/media-seeds.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { defaultAudioContent } from "@maleo/shared/audio-overlays";

export function useAudioOps(input: {
	projectId?: string | null;
	audioOverlays: AudioOverlay[];
	setAudioOverlays: Dispatch<SetStateAction<AudioOverlay[]>>;
	selectedAudioId: number | null;
	setSelectedAudioId: Dispatch<SetStateAction<number | null>>;
	setEditorSceneId: Dispatch<SetStateAction<number | undefined>>;
	setSelectedOverlayId: Dispatch<SetStateAction<number | null>>;
	playhead: PlayheadHandle;
	total: number;
	settings: GlobalSettings;
	setGenErr: Dispatch<SetStateAction<string | null>>;
	setVideoOverlays: Dispatch<SetStateAction<VideoOverlay[]>>;
	setOverlays: Dispatch<SetStateAction<TextOverlay[]>>;
	setEffects: Dispatch<SetStateAction<EffectClip[]>>;
	setScenes: Dispatch<SetStateAction<Scene[]>>;
	sceneStart: (id: number) => number;
	/** Admission, so a synthesised voiceover joins the project's media set the way
	 *  a placed one does. Generated media is media: without this a voiceover was
	 *  on the timeline and absent from the panel, and deleting its clip lost it. */
	ensureMediaAsset: (seed: MediaAssetSeed) => string;
}) {
	const {
		audioOverlays,
		setAudioOverlays,
		selectedAudioId,
		setSelectedAudioId,
		setEditorSceneId,
		setSelectedOverlayId,
		playhead,
		total,
		settings,
		setGenErr,
		setVideoOverlays,
		setOverlays,
		setEffects,
		setScenes,
		sceneStart,
		ensureMediaAsset,
	} = input;

	const [ttsBusy, setTtsBusy] = useState<Record<number, boolean>>({});
	const { ttsStatus, ttsVoiceOptions } = useTtsStatus(settings.voiceProvider);

	const addAudio = (kind: AudioOverlayKind, seed?: Partial<AudioOverlay>): void => {
		const id = Date.now();
		setAudioOverlays((a) => [
			...a,
			{
				id,
				kind,
				origin: seed?.origin,
				content: seed?.content ?? defaultAudioContent(kind),
				url: seed?.url,
				mediaAssetId: seed?.mediaAssetId,
				start: seed?.start ?? Math.max(0, Math.min(playhead.get(), Math.max(0, total - 2))),
				dur: seed?.dur ?? (seed?.url ? 5 : 2),
				...(seed?.track != null ? { track: seed.track } : {}),
				...(seed?.originalDur != null ? { originalDur: seed.originalDur } : {}),
			},
		]);
		setSelectedAudioId(id);
		setEditorSceneId(undefined);
		setSelectedOverlayId(null);
	};
	const updateAudio = (id: number, patch: Partial<AudioOverlay>): void =>
		setAudioOverlays((items) =>
			items.map((item) => {
				if (item.id !== id) return item;
				if (item.url && patch.dur != null && patch.mediaStartSec == null && patch.url == null) {
					const timing = trimMediaTiming(item, patch, item.originalDur);
					return timing ? { ...item, ...patch, ...timing } : item;
				}
				return { ...item, ...patch };
			}),
		);
	const regenAudio = async (id: number): Promise<void> => {
		const a = audioOverlays.find((x) => x.id === id);
		if (!a || a.kind !== "voiceover" || !a.content.trim()) return;
		// Effective provider/voice: Timeline Global Settings is the project default;
		// a clip's own voice overrides it. Provider "" follows the workspace default.
		const effProvider = settings.voiceProvider || ttsStatus?.effective_provider || "";
		/* Readiness comes off that provider's own entry in the list. It used to be
		 * a boolean named after each provider, which meant this branch had to grow
		 * an arm every time one was added. */
		const provReady = ttsStatus?.providers.find((p) => p.id === effProvider)?.health === "ready";
		if (ttsStatus && !provReady) {
			setGenErr(
				effProvider
					? `Voice provider "${effProvider}" is not ready. Set it up in Settings → Global Settings.`
					: "No voice provider is configured. Set one up in Settings → Global Settings.",
			);
			return;
		}
		const effVoice = a.voice || settings.voice || undefined;
		setTtsBusy((b) => ({ ...b, [id]: true }));
		try {
			const next = await generateTts(
				a.content,
				effVoice,
				settings.voiceProvider || undefined,
				input.projectId,
			);
			const nextDur =
				next.durationSec && next.durationSec > 0
					? Math.round(next.durationSec * 1000) / 1000
					: a.dur;
			const delta = nextDur - a.dur;
			const boundary = a.start;
			const mediaAssetId = ensureMediaAsset(
				seedForGeneratedAudio({
					url: next.url,
					content: a.content,
					kind: a.kind,
					durationSec: nextDur,
				}),
			);
			updateAudio(id, {
				origin: "tts",
				url: next.url,
				mediaAssetId,
				dur: nextDur,
				originalDur: nextDur,
				mediaStartSec: 0,
			});
			if (Math.abs(delta) >= 0.001) {
				setAudioOverlays((clips) => rippleAfterDurationChange(clips, id, boundary, delta));
				setVideoOverlays((clips) => rippleAfterDurationChange(clips, -1, boundary, delta));
				setOverlays((clips) => rippleAfterDurationChange(clips, -1, boundary, delta));
				setEffects((clips) => rippleAfterDurationChange(clips, -1, boundary, delta));
				setScenes((ss) =>
					ss.map((scene) => {
						const start = sceneStart(scene.id);
						return start > boundary + 1e-6
							? { ...scene, start: Math.max(0, Math.round((start + delta) * 1000) / 1000) }
							: scene;
					}),
				);
			}
		} catch (e) {
			setGenErr(`TTS failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setTtsBusy((b) => ({ ...b, [id]: false }));
		}
	};
	const removeAudio = (id: number): void => {
		setAudioOverlays((a) => a.filter((x) => x.id !== id));
		if (selectedAudioId === id) setSelectedAudioId(null);
	};
	const selectedAudio = audioOverlays.find((a) => a.id === selectedAudioId) ?? null;

	return {
		addAudio,
		updateAudio,
		regenAudio,
		removeAudio,
		selectedAudio,
		ttsBusy,
		ttsStatus,
		ttsVoiceOptions,
	};
}
