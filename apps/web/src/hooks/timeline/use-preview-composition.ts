/* The WYSIWYG preview surface.
 *
 * The editor's centre stage plays the SAME storyboard object export renders:
 * `buildRenderStoryboardFromDoc` over the canonical document. Everything the
 * Player needs — dimensions, duration, frame count, the brand palette the
 * template tiles echo — is derived here so the component does not recompute it
 * inline.
 */
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import { storyboardSeconds, type Storyboard } from "@maleo/video/composition";
import { buildRenderStoryboardFromDoc, type CaptionConfig } from "@maleo/shared";
import { aspectOf } from "@models/core/measures.ts";
import { withPreviewLocalSources } from "@models/timeline/preview-local-sources.ts";
import { usePreviewMedia } from "./use-preview-media.ts";
import type { MediaAsset } from "@maleo/shared/editor";
import type { PacingDevices, TrackFlags } from "@maleo/shared";
import { FORMAT_DIMS } from "@models/timeline/timeline-editor-model.ts";
import type { GlobalSettings } from "@models/presets/creative-settings.ts";
import { useRemotionPlayhead, type RemotionPlayhead } from "./use-remotion-playhead.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";

const PREVIEW_FPS = 30;
const NO_ASSETS: readonly MediaAsset[] = [];
const NO_FILES: ReadonlyMap<string, File> = new Map();

export interface PreviewComposition {
	previewMedia: ReturnType<typeof usePreviewMedia>;
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
	projectId?: string | null;
	pendingFiles?: ReadonlyMap<string, File>;
	mediaAssets?: readonly MediaAsset[];
	config: Parameters<typeof buildRenderStoryboardFromDoc>[0];
	refs: Parameters<typeof buildRenderStoryboardFromDoc>[1];
	getDoc: () => Parameters<typeof buildRenderStoryboardFromDoc>[2];
	settings: GlobalSettings;
	trackFlags: TrackFlags;
	captions: CaptionConfig;
	pacingDevices: PacingDevices;
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
		onPlayheadReady,
	} = args;

	const format = settings.aspectRatio || config.format || "9:16";
	const aspect = aspectOf(format);
	const previewDims = FORMAT_DIMS[format] ?? FORMAT_DIMS["9:16"]!;

	const doc = getDoc();
	const stop = useRef<() => void>(() => {});
	const media = usePreviewMedia({
		stop: () => stop.current(),
		projectId: args.projectId ?? null,
		pendingFiles: args.pendingFiles ?? NO_FILES,
		doc,
		refs,
		mediaAssets: mediaAssets ?? NO_ASSETS,
	});
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
			const resolved = withPreviewLocalSources(built, (url) => media.session?.resolve(url));
			// SAFETY: builder supplies composition inputs; preview only substitutes local media.
			return resolved as Storyboard;
		},
		[
			media.session,
			media.version,
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
	const previewStoryboard = useMemo(() => previewForDoc(doc), [previewForDoc, doc]);

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
	} = useRemotionPlayhead(
		PREVIEW_FPS,
		previewFrames,
		media.readiness.revision,
		media.readiness.ready,
	);
	stop.current = () => playerRef.current?.pause();
	useEffect(() => {
		onPlayheadReady?.(playhead);
	}, [onPlayheadReady, playhead]);

	return {
		previewMedia: media,
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
