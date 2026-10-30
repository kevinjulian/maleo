import { createContext, useContext, useMemo, type JSX, type ReactNode } from "react";
import type { usePreviewMedia } from "@hooks/timeline/use-preview-media.ts";
import { Button } from "@design-system/components/button.tsx";
import { Note } from "@design-system/components/note.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import {
	ClipPreviewBadge,
	previewLoadingLabel,
	previewReadinessMessage,
	previewReadinessShort,
	type ClipReadiness,
} from "./preview-loading.tsx";

interface ClipPreviewState {
	ready: boolean;
	mediaIds: ReadonlySet<string>;
	clips: ReadonlyMap<string, ClipReadiness>;
	canRetry: ReadonlySet<string>;
	retry(id: string): void;
}
const ClipPreviewContext = createContext<ClipPreviewState | null>(null);

/** Preview notifications never enter the document or its undo stack. */
export function PreviewClipProvider({
	media,
	children,
}: {
	media: ReturnType<typeof usePreviewMedia>;
	children: ReactNode;
}): JSX.Element {
	const value = useMemo<ClipPreviewState>(
		() => ({
			ready: media.readiness.ready,
			mediaIds: new Set(media.dependencies.clips.map((clip) => clip.id)),
			clips: new Map(
				(
					media.snapshot?.clips ??
					media.dependencies.clips.map((clip) => ({
						id: clip.id,
						state: { state: "queued" as const },
						loaded: 0,
						total: null,
						blockers: [],
					}))
				).map((clip) => [clip.id, clip]),
			),
			canRetry: new Set(
				media.dependencies.sources.flatMap((source) =>
					media.snapshot?.sources[source.id]?.state === "failed" ? source.clipIds : [],
				),
			),
			retry: media.retryClip,
		}),
		[media.snapshot, media.dependencies, media.retryClip, media.readiness.ready],
	);
	return <ClipPreviewContext.Provider value={value}>{children}</ClipPreviewContext.Provider>;
}

export function PreviewClipBadge({ id }: { id: string }): JSX.Element | null {
	const preview = useContext(ClipPreviewContext);
	const clip = preview?.mediaIds.has(id) ? preview.clips.get(id) : undefined;
	return clip ? <ClipPreviewBadge clip={clip} /> : null;
}

/**
 * Readiness beside the transport, in the toolbar row, so it never moves the timeline. The
 * visible text is short; the full sentence is the Play button's description.
 */
export function PreviewReadinessStatus({
	id,
	compact = false,
}: {
	id: string;
	/** Phone toolbars have no room for words beside the transport: an icon stands in. */
	compact?: boolean;
}): JSX.Element | null {
	const preview = useContext(ClipPreviewContext);
	if (!preview || preview.ready) return null;
	const clips = [...preview.clips.values()];
	const failed = clips.some((clip) => clip.state.state === "failed");
	const message = previewReadinessMessage(clips);
	const full = failed
		? `${message.replace(/[.!?]$/, "")}. Select a marked clip for recovery actions.`
		: message;
	return (
		<Note
			id={id}
			as="span"
			role="status"
			tone={failed ? "error" : "muted"}
			title={full}
			className="tw:shrink tw:truncate tw:whitespace-nowrap tw:px-1"
		>
			<span aria-hidden="true" className="tw:inline-flex tw:items-center">
				{compact
					? failed
						? Ic.warning(ICON.sm)
						: Ic.loader(ICON.sm)
					: previewReadinessShort(clips)}
			</span>
			<span className="tw:sr-only">{full}</span>
		</Note>
	);
}

/** Same recovery in desktop clip menus and the phone actions Sheet. */
export function PreviewClipActions({
	ids,
	onDone,
	menu = false,
}: {
	ids: readonly string[];
	onDone(): void;
	menu?: boolean;
}): JSX.Element | null {
	const preview = useContext(ClipPreviewContext);
	if (!preview) return null;
	const selected = new Set(ids);
	for (const id of ids) {
		if (!id.startsWith("scene:")) continue;
		const prefix = `vis:${id.slice("scene:".length)}:`;
		for (const key of preview.clips.keys()) if (key.startsWith(prefix)) selected.add(key);
	}
	const clips = [...selected].flatMap((id) => preview.clips.get(id) ?? []);
	if (!clips.length) return null;
	const retry = [...selected].filter((id) => preview.canRetry.has(id));
	return (
		<>
			{clips.map((clip) => (
				// Plain text: the toolbar notice is the one live region for readiness.
				<Note key={clip.id}>{previewLoadingLabel(clip)}</Note>
			))}
			{retry.length > 0 && (
				<Button
					size="sm"
					variant="secondary"
					role={menu ? "menuitem" : undefined}
					onClick={() => {
						for (const id of retry) preview.retry(id);
						onDone();
					}}
				>
					Retry preview
				</Button>
			)}
		</>
	);
}
