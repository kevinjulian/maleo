/* The WYSIWYG preview surface.
 *
 * The editor's centre stage plays the SAME storyboard object export renders:
 * `buildRenderStoryboardFromDoc` over the canonical document. Everything the
 * Player needs — dimensions, duration, frame count, the brand palette the
 * template tiles echo — is derived here so the component does not recompute it
 * inline.
 */
import { useCallback, useEffect, useMemo, type RefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import { storyboardSeconds, type Storyboard } from "@maleo/video/composition";
import { buildRenderStoryboardFromDoc, type CaptionConfig } from "@maleo/shared";
import { aspectOf } from "@models/core/measures.ts";
import { decodableAudioUrl } from "@models/timeline/audio-decode-url.ts";
import type { PacingDevices, TrackFlags } from "@maleo/shared";
import { FORMAT_DIMS } from "@models/timeline/timeline-editor-model.ts";
import type { GlobalSettings } from "@models/presets/creative-settings.ts";
import { useRemotionPlayhead, type RemotionPlayhead } from "./use-remotion-playhead.ts";
import { usePendingMediaVersion } from "@hooks/editor/use-pending-media-version.ts";
import { withResolvedPending } from "@models/core/pending-media-sources.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";

const PREVIEW_FPS = 30;

export interface PreviewComposition {
	aspect: ReturnType<typeof aspectOf>;
	previewFps: number;
	previewDims: (typeof FORMAT_DIMS)[string];
	previewStoryboard: Storyboard;
	previewProps: Storyboard;
	previewForDoc: (doc: Parameters<typeof buildRenderStoryboardFromDoc>[2]) => Storyboard;
	brandPalette: {
		accentColor: Storyboard["accentColor"];
		bgColor: Storyboard["bgColor"];
		fgColor: Storyboard["fgColor"];
	};
	previewDuration: number;
	previewFrames: number;
	/** The position, as a handle: reading it costs no render, and a surface that
	 *  displays the time subscribes to it. See `playhead-handle.ts`. */
	playhead: PlayheadHandle;
	playing: boolean;
	stalled: boolean;
	seekPreview: (sec: number) => void;
	togglePlay: RemotionPlayhead["togglePlay"];
	/** Give this to the preview. Owned by the playhead hook, which has to observe
	 *  the player arriving — see `use-remotion-playhead.ts`. */
	playerRef: RefObject<PlayerRef | null>;
}

export function usePreviewComposition(args: {
	mediaAssets?: unknown;
	config: Parameters<typeof buildRenderStoryboardFromDoc>[0];
	refs: Parameters<typeof buildRenderStoryboardFromDoc>[1];
	getDoc: () => Parameters<typeof buildRenderStoryboardFromDoc>[2];
	settings: GlobalSettings;
	trackFlags: TrackFlags;
	captions: CaptionConfig;
	pacingDevices: PacingDevices;
	/** The derived arrays are dependencies only: they mirror the same store, so
	 *  listing them is what makes a document mutation recompute the memo. */
	deps: unknown[];
	/* Publishes the playhead to whoever needs to read it from outside.
	 *
	 * This hook creates the handle, so this hook hands it out — a consumer that
	 * observed it from further up would be a second owner of a position that has
	 * exactly one. The editor shell reads it when a chat command starts, to
	 * resolve what "this" refers to. */
	onPlayheadReady?: (playhead: PlayheadHandle) => void;
}): PreviewComposition {
	const {
		mediaAssets,
		config,
		refs,
		getDoc,
		settings,
		trackFlags,
		captions,
		pacingDevices,
		deps,
		onPlayheadReady,
	} = args;

	const format = settings.aspectRatio || config.format || "9:16";
	const aspect = aspectOf(format);
	const previewDims = FORMAT_DIMS[format] ?? FORMAT_DIMS["9:16"]!;

	const pendingVersion = usePendingMediaVersion();
	const previewForDoc = useCallback(
		(doc: Parameters<typeof buildRenderStoryboardFromDoc>[2]) => {
			const built = buildRenderStoryboardFromDoc(config, refs, doc, {
				mediaAssets,
				trackFlags,
				captions,
				pacingDevices,
				brand:
					settings.brandAccent || settings.brandFont || settings.brandLogoUrl
						? {
								accentColor: settings.brandAccent || undefined,
								fontFamily: settings.brandFont || undefined,
								logoUrl: settings.brandLogoUrl || undefined,
							}
						: undefined,
				backgroundFill: settings.backgroundFill || undefined,
			}).storyboard;
			/* Stock audio plays through this origin in the PREVIEW only.
			 *
			 * The hosts send no cache-control, so the browser re-downloaded the same
			 * effect on every session, and no CORS header, so the same file could be
			 * played but not decoded for a waveform. The passthrough fixes both — and
			 * it belongs here rather than in the shared builder, because the render
			 * worker fetches these hosts directly and has no origin to pass through.
			 * The document is untouched: this is how the preview READS a url. */
			const audioOverlays = built.audioOverlays?.map((a) =>
				a.url ? { ...a, url: decodableAudioUrl(a.url) } : a,
			);
			// Files still importing play from the session's copy, then the managed URL;
			// the document keeps its pending references either way.
			const resolved = withResolvedPending(audioOverlays ? { ...built, audioOverlays } : built);
			// SAFETY: the shared render builder supplies composition inputs; renderer
			// handles the same optional defaults used by the existing preview path.
			return resolved as Storyboard;
		},
		[
			pendingVersion,
			mediaAssets,
			config,
			refs,
			trackFlags,
			captions,
			pacingDevices,
			settings.brandAccent,
			settings.brandFont,
			settings.brandLogoUrl,
			settings.backgroundFill,
		],
	);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const previewStoryboard = useMemo(
		() => previewForDoc(getDoc()),
		[previewForDoc, getDoc, ...deps],
	);

	const previewProps = previewStoryboard;
	const brandPalette = {
		accentColor: previewProps.accentColor,
		bgColor: previewProps.bgColor,
		fgColor: previewProps.fgColor,
	};
	const previewDuration = Math.max(1, storyboardSeconds(previewProps));
	const previewFrames = Math.max(1, Math.ceil(previewDuration * PREVIEW_FPS));
	/* The ref comes from the hook rather than from the caller: it has to observe
	   the player ARRIVING. This surface happened to work anyway — its frame count
	   changes as the storyboard loads, which re-ran the listener effect after the
	   player attached — but that is luck, not wiring, and it is the same latent
	   defect that left both studios' transports dead. */
	const {
		playhead,
		playing,
		stalled,
		seek: seekPreview,
		togglePlay,
		playerRef,
	} = useRemotionPlayhead(PREVIEW_FPS, previewFrames);
	useEffect(() => {
		onPlayheadReady?.(playhead);
	}, [onPlayheadReady, playhead]);

	return {
		aspect,
		previewFps: PREVIEW_FPS,
		previewDims,
		previewStoryboard,
		previewProps,
		previewForDoc,
		brandPalette,
		previewDuration,
		previewFrames,
		playhead,
		playing,
		stalled,
		seekPreview,
		togglePlay,
		playerRef,
	};
}
