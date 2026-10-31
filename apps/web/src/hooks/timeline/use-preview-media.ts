import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { previewMediaDependencies, type RefsState, type TimelineDoc } from "@maleo/shared";
import { hasEditorEngine } from "@maleo/shared/editor";
import type { MediaAsset } from "@maleo/shared/editor";
import { mediaFetchTarget } from "@api/media.ts";
import { stockAudioHosts } from "@api/stock-audio.ts";
import { decodableAudioUrl } from "@models/timeline/audio-decode-url.ts";
import {
	isPendingMedia,
	pendingSourceKey,
	resolveMediaUrl,
} from "@models/core/pending-media-sources.ts";
import { createPreviewMediaSession } from "@services/preview-media/session.ts";
import { loadEditorEngine } from "@services/editor-engine/engine-loader.ts";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";
import { usePendingMediaVersion } from "@hooks/editor/use-pending-media-version.ts";
import type { PreviewReadiness } from "@models/timeline/preview-protocol.ts";

/** Complete-source ownership follows the editor scope, never the document/undo ledger. */
export function usePreviewMedia(args: {
	projectId: string | null;
	doc: TimelineDoc;
	refs: RefsState;
	mediaAssets: readonly MediaAsset[];
	pendingFiles: ReadonlyMap<string, File>;
	stop?: () => void;
}) {
	const stop = useRef(args.stop);
	stop.current = args.stop;
	const workspaceId = useActiveWorkspace();
	const pendingVersion = usePendingMediaVersion();
	const [localId] = useState(() => crypto.randomUUID());
	const projectId = args.projectId ?? localId;
	const [session, setSession] = useState<ReturnType<typeof createPreviewMediaSession>>();
	const [version, setVersion] = useState(0);
	const scope = JSON.stringify([workspaceId, projectId]);
	const [owner, setOwner] = useState("");
	useEffect(() => {
		let live = true;
		let next: ReturnType<typeof createPreviewMediaSession> | undefined;
		function open() {
			if (!live) return;
			next = createPreviewMediaSession({
				stop: () => stop.current?.(),
				changed: () => setVersion((value) => value + 1),
				resolve: async (source) => {
					const url = resolveMediaUrl(source.url);
					if (!url) throw new Error("Choose this pending file again before playback");
					return mediaFetchTarget(
						source.kinds.includes("audio") ? decodableAudioUrl(url, await stockAudioHosts()) : url,
					);
				},
			});
			setSession(next);
			setOwner(scope);
		}
		// Readiness runs in the editor engine. Hosts outside the editor route (Library's template
		// editor) can mount before anything has loaded it; Play stays unavailable until then.
		if (hasEditorEngine()) open();
		else
			loadEditorEngine().then(open, (error: unknown) =>
				console.error("Preview media cannot start without the editor engine", error),
			);
		return () => {
			live = false;
			void next?.dispose().catch((error) => console.error("Preview media cleanup failed", error));
		};
	}, [scope]);
	const dependencies = useMemo(
		() =>
			previewMediaDependencies({
				workspaceId,
				projectId,
				doc: args.doc,
				refs: args.refs,
				mediaAssets: args.mediaAssets,
				legacyGeneration: scope,
				pendingRevision: (url) =>
					isPendingMedia(url) ? resolveMediaUrl(url) || "pending-file-unavailable" : undefined,
			}),
		[workspaceId, projectId, scope, args.doc, args.refs, args.mediaAssets, pendingVersion],
	);
	// Strings stabilize projection identity when only geometry changes.
	const definition = useMemo(() => JSON.stringify(dependencies), [dependencies]);
	useEffect(() => {
		if (owner !== scope || !session) return;
		const files = new Map<string, File>();
		for (const source of dependencies.sources) {
			const key = pendingSourceKey(source.url);
			const file = key && isPendingMedia(source.url) ? args.pendingFiles.get(key) : undefined;
			if (file) files.set(source.url, file);
		}
		session.update(dependencies, files);
	}, [session, owner, scope, definition, args.pendingFiles]);
	const held = owner === scope && session?.isOpen() ? session : undefined;
	const snapshot = held && held.definition() === definition ? held.snapshot() : undefined;
	const retryClip = useCallback(
		(clipId: string) => {
			if (!held || held.definition() !== definition) return;
			const files = new Map<string, File>();
			for (const source of dependencies.sources) {
				const key = pendingSourceKey(source.url);
				const file = key && isPendingMedia(source.url) ? args.pendingFiles.get(key) : undefined;
				if (file) files.set(source.url, file);
			}
			for (const source of dependencies.sources) {
				if (
					source.clipIds.includes(clipId) &&
					held.snapshot().sources[source.id]?.state === "failed"
				)
					held.retry(source.id, files);
			}
		},
		[held, definition, dependencies, args.pendingFiles],
	);
	const readiness = useMemo<PreviewReadiness>(() => {
		const snapshot = held && held.definition() === definition ? held.snapshot() : undefined;
		return {
			revision: `${scope}:${definition}`,
			sequence: version,
			sourceGeneration: snapshot?.generation ?? 0,
			ready: snapshot?.ready ?? false,
			blockers:
				snapshot?.clips.flatMap((clip) =>
					clip.blockers.map((message) => ({ clipId: clip.id, message })),
				) ?? [],
		};
	}, [held, definition, scope, version]);
	return { session: held, version, dependencies, readiness, snapshot, retryClip };
}
