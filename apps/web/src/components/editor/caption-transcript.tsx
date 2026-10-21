import { captionReadiness } from "@api/caption-jobs.ts";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";
import {
	useEffect,
	useRef,
	useState,
	type ComponentProps,
	type JSX,
	type KeyboardEvent,
} from "react";
import {
	DEFAULT_CAPTIONS,
	captionTrackFor,
	timelineAudioSources,
	type Clip,
	type CaptionConfig,
} from "@maleo/shared";
import { batch, editCaptions, applyCommand, type CaptionEdit } from "@maleo/shared/editor";
import { CaptionsPanel } from "./editor-captions.tsx";
import { CaptionGenerateForm, type CaptionAvailability } from "./caption-generate-form.tsx";
import { CaptionFindReplace } from "./caption-find-replace.tsx";
import { Input, Textarea } from "@design-system/components/input.tsx";
import { Switch } from "@design-system/components/switch.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Note } from "@design-system/components/note.tsx";
import { InspectorSection, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { Toolbar, ToolbarAction } from "@design-system/patterns/toolbar.tsx";
import {
	GenerationCard,
	GenerationProgress,
	GenerationError,
} from "@design-system/patterns/generation.tsx";
import {
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import { useSelectionValue, type SelectionStore } from "@stores/selection-store.ts";
import { EMPTY_SELECTION, primaryClipKey } from "@models/timeline/selection-model.ts";
import { usePlayheadEffect } from "@hooks/timeline/use-playhead.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { CaptionJobControls } from "@hooks/editor/use-caption-jobs.ts";
import type { ReferenceLibraryState } from "@hooks/editor/use-reference-library.ts";
import { withReadyPending } from "@models/core/pending-media-sources.ts";
import { usePendingMediaVersion } from "@hooks/editor/use-pending-media-version.ts";
import {
	captionClockTenths,
	captionRangeLabel,
	captionSourceLabels,
} from "@models/captions/caption-labels.ts";
import { captionSplitTime } from "@models/captions/caption-keys.ts";

type Props = ComponentProps<typeof CaptionsPanel> & {
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	selectionStore: SelectionStore;
	jobs: CaptionJobControls;
	playhead: PlayheadHandle;
	seek: (sec: number) => void;
	mediaAssets: ReferenceLibraryState["mediaAssets"];
	projectId: string | null;
};

/** Transcript and style share canonical document/selection; rows hold only uncommitted input. */
export function CaptionTranscriptPanel(props: Props): JSX.Element {
	const { store, writers, selectionStore, jobs, playhead, seek, mediaAssets, projectId } = props;
	const doc = useDocumentSelector(store, (snapshot) => snapshot.getDoc());
	const selection = useSelectionValue(selectionStore);
	const cues = doc.clips
		.filter((clip) => clip.type === "caption" && clip.caption)
		.sort((a, b) => a.startSec - b.startSec);
	const selected = cues.find((cue) => selection.freeIds.has(cue.id));
	usePendingMediaVersion();
	const sources = timelineAudioSources(withReadyPending(doc), doc.trackFlags).filter((source) =>
		/^\/api\/media\/[0-9a-f-]{36}$/.test(source.url),
	);
	const selectedSource = sources.find(
		(source) => selection.freeIds.has(source.clipId) || primaryClipKey(selection) === source.clipId,
	);
	const sourceKey = (source: (typeof sources)[number]) =>
		JSON.stringify([source.clipId, source.visualId ?? null]);
	const [sourceValue, setSourceChoice] = useState(() =>
		selectedSource ? sourceKey(selectedSource) : "all",
	);
	const chosenSources = sources.filter(
		(source) => sourceValue === "all" || sourceKey(source) === sourceValue,
	);
	const sourceLabels = captionSourceLabels(sources, withReadyPending(mediaAssets));
	const rangeLabel = captionRangeLabel(chosenSources);
	const workspace = useActiveWorkspace();
	const [readiness, setReadiness] = useState<{
		project: string;
		workspace: string;
		available: boolean;
		reason?: string;
	} | null>(null);
	const ready =
		readiness?.project === projectId && readiness.workspace === workspace ? readiness : null;
	useEffect(() => {
		if (!projectId) return;
		const controller = new AbortController();
		void captionReadiness(projectId, workspace, controller.signal)
			.then((value) => {
				if (!controller.signal.aborted)
					setReadiness({
						project: projectId,
						workspace,
						available: value.available,
						reason: value.reason ?? value.captions?.reason,
					});
			})
			.catch((error) => {
				if (!controller.signal.aborted)
					setReadiness({
						project: projectId,
						workspace,
						available: false,
						reason: error instanceof Error ? error.message : "Caption worker unavailable.",
					});
			});
		return () => controller.abort();
	}, [projectId, workspace]);
	const [language, setLanguage] = useState("auto");
	const [replaceEdited, setReplaceEdited] = useState(false);
	const [regenerating, setRegenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [follow, setFollow] = useState(false);
	const browsing = useRef(false);
	const region = useRef<HTMLDivElement>(null);
	const activeId = useRef<string | null>(null);
	usePlayheadEffect(playhead, (sec) => {
		const cue = cues.find((item) => sec >= item.startSec && sec < item.startSec + item.durationSec);
		for (const row of region.current?.querySelectorAll<HTMLElement>("[data-caption-row]") ?? []) {
			const active = row.dataset.captionRow === cue?.id;
			row.toggleAttribute("data-active", active);
			if (
				active &&
				activeId.current !== cue?.id &&
				follow &&
				!browsing.current &&
				!region.current?.contains(document.activeElement)
			)
				row.scrollIntoView({ block: "nearest" });
		}
		activeId.current = cue?.id ?? null;
	});
	function edit(action: CaptionEdit): void {
		try {
			writers.apply((scope) => {
				const command = editCaptions(action);
				applyCommand(scope, command);
				return command;
			});
			setError(null);
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Cannot edit this caption. Unlock its track and retry.",
			);
		}
	}
	function replaceTexts(updates: Array<{ id: string; text: string }>): string | null {
		try {
			writers.apply((scope) => {
				const command = batch(
					updates.map((update) => editCaptions({ action: "update", ...update })),
					"captions.replace",
				);
				applyCommand(scope, command);
				return command;
			});
			return null;
		} catch (failure) {
			return failure instanceof Error ? failure.message : "Cannot replace caption text.";
		}
	}
	function choose(cue: Clip): void {
		selectionStore.set({ ...EMPTY_SELECTION, freeIds: new Set([cue.id]) });
		seek(cue.startSec);
	}
	function generate(): void {
		const source = sources.find((item) => sourceKey(item) === sourceValue);
		if (sourceValue !== "all" && !source) {
			setError("Selected source changed. Select an audible source and retry.");
			return;
		}
		const sourceRevisions: Record<string, string> = {};
		const admittedIds = new Set(
			(source ? [source] : sources).map(
				(item) => /^\/api\/media\/([0-9a-f-]{36})$/.exec(item.url)?.[1],
			),
		);
		for (const asset of withReadyPending(mediaAssets)) {
			const id = /^\/api\/media\/([0-9a-f-]{36})$/.exec(asset.url ?? "")?.[1];
			if (id && admittedIds.has(id)) sourceRevisions[id] = asset.importedSource?.revision ?? id;
		}
		const track = captionTrackFor(doc);
		void jobs.generate({
			source: source
				? { clipId: source.clipId, ...(source.visualId ? { visualId: source.visualId } : {}) }
				: "all",
			sourceRevisions,
			language,
			captionTrack: track,
			replaceEdited,
		});
		setRegenerating(false);
	}
	const effective = { ...(doc.captions ?? DEFAULT_CAPTIONS), ...selected?.caption?.style };
	const selectedStyle = selected
		? {
				value: effective,
				onChange: (patch: Partial<CaptionConfig>) =>
					edit({
						action: "style",
						ids: [selected.id],
						style: { ...selected.caption?.style, ...patch },
					}),
				onReset: () => edit({ action: "style", ids: [selected.id], style: null }),
			}
		: undefined;
	const availability: CaptionAvailability = jobs.busy
		? { state: "busy" }
		: !projectId
			? { state: "unavailable", reason: "Open a saved project to generate captions.", setup: false }
			: !ready
				? { state: "checking" }
				: !ready.available
					? {
							state: "unavailable",
							reason: ready.reason ?? "Configure caption recognition on the media worker.",
							setup: true,
						}
					: !sources.length
						? {
								state: "unavailable",
								reason: "Add or import media with speech to generate captions.",
								setup: false,
							}
						: { state: "ready" };
	const showForm = !cues.length || regenerating;
	return (
		<CaptionsPanel
			{...props}
			selectedStyle={selectedStyle}
			onRegenerate={() => {
				setReplaceEdited(false);
				setRegenerating(true);
			}}
			transcript={({ importSrt }) => (
				<>
					{jobs.status && (
						<GenerationCard
							phase={jobs.job?.status ?? (jobs.busy ? "submitting" : "settled")}
							busy={jobs.busy}
							status={
								<GenerationProgress
									label={jobs.status}
									running={jobs.busy}
									announce
									action={
										jobs.busy ? (
											<Button size="xs" onClick={() => void jobs.cancel()}>
												Cancel
											</Button>
										) : jobs.id ? (
											<Button
												size="xs"
												onClick={jobs.job?.status === "done" ? jobs.apply : jobs.resume}
											>
												{jobs.job?.status === "done" ? "Apply held result" : "Resume"}
											</Button>
										) : undefined
									}
								/>
							}
						/>
					)}
					{jobs.error && (
						<GenerationError title="Caption generation stopped" message={jobs.error} />
					)}
					{error && (
						<Note tone="error" role="alert">
							{error}
						</Note>
					)}
					{showForm ? (
						<CaptionGenerateForm
							mode={cues.length || doc.captionSet?.deletedRanges.length ? "regenerate" : "first"}
							sourceOptions={sources.map((source, index) => ({
								value: sourceKey(source),
								label: sourceLabels[index]!,
							}))}
							sourceValue={sourceValue}
							onSourceChange={setSourceChoice}
							rangeLabel={rangeLabel}
							language={language}
							onLanguageChange={setLanguage}
							replaceEdited={replaceEdited}
							onReplaceEditedChange={setReplaceEdited}
							availability={availability}
							onGenerate={generate}
							onCancel={cues.length ? () => setRegenerating(false) : undefined}
							secondary={
								cues.length ? undefined : (
									<Button variant="secondary" size="sm" onClick={importSrt}>
										Import SRT
									</Button>
								)
							}
						/>
					) : (
						<InspectorSection title={`Transcript · ${cues.length} cues`} defaultOpen>
							<PropertyRow label="Follow playback" as="div">
								<Switch
									aria-label="Follow caption playback"
									checked={follow}
									onCheckedChange={(enabled) => {
										browsing.current = false;
										setFollow(enabled);
									}}
								/>
							</PropertyRow>
							<CaptionFindReplace
								cues={cues}
								locked={(track) => Boolean(doc.trackFlags?.[track]?.locked)}
								apply={replaceTexts}
							/>
							<div
								ref={region}
								onWheel={() => {
									browsing.current = true;
								}}
								onTouchMove={() => {
									browsing.current = true;
								}}
							>
								{cues.map((cue, index) => (
									<CueRow
										key={cue.id}
										cue={cue}
										previous={cues[index - 1]}
										next={cues[index + 1]}
										selected={selected?.id === cue.id}
										locked={Boolean(doc.trackFlags?.[cue.track]?.locked)}
										choose={() => choose(cue)}
										edit={edit}
										playhead={playhead}
										latest={() => store.getDoc().clips.find((clip) => clip.id === cue.id)}
									/>
								))}
							</div>
						</InspectorSection>
					)}
				</>
			)}
		/>
	);
}

function CueRow({
	cue,
	previous,
	next,
	selected,
	locked,
	choose,
	edit,
	playhead,
	latest,
}: {
	cue: Clip;
	previous?: Clip;
	next?: Clip;
	selected: boolean;
	locked: boolean;
	choose: () => void;
	edit: (action: CaptionEdit) => void;
	playhead: PlayheadHandle;
	/** The committed cue after a pending text edit lands. */
	latest: () => Clip | undefined;
}): JSX.Element {
	const caption = cue.caption!;
	const [text, setText] = useState(caption.text);
	const editing = useRef(false);
	const committed = useRef(caption.text);
	const pending = useRef(text);
	pending.current = text;
	useEffect(() => {
		// A focused field keeps unsent typing; with nothing pending it follows the
		// document, so a keyboard split, undo or agent change shows at once.
		if (!editing.current || pending.current === committed.current) setText(caption.text);
		committed.current = caption.text;
	}, [caption.text]);
	function commitText(): void {
		if (text === caption.text) return;
		// Sent text is the new baseline: a split in the same handler batches with
		// this update, and the field must then follow the split, not keep this text.
		committed.current = text;
		edit({ action: "update", id: cue.id, text });
	}
	function timing(edge: "start" | "end", value: string): void {
		const number = value.trim() ? Number(value) : NaN;
		if (!Number.isFinite(number)) return;
		edit({
			action: "timing",
			id: cue.id,
			startSec: edge === "start" ? number : cue.startSec,
			durationSec:
				edge === "start" ? cue.startSec + cue.durationSec - number : number - cue.startSec,
		});
	}
	function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
		if (event.nativeEvent.isComposing || event.keyCode === 229 || locked) return;
		const field = event.currentTarget;
		const collapsed = field.selectionStart === field.selectionEnd;
		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			!event.altKey &&
			!event.metaKey &&
			!event.ctrlKey
		) {
			event.preventDefault();
			if (!collapsed) return;
			commitText();
			const current = latest();
			const at = current?.caption
				? captionSplitTime({ ...current, caption: current.caption }, field.selectionStart)
				: null;
			if (at == null) return;
			edit({ action: "split", id: cue.id, at, newId: `caption:${crypto.randomUUID()}` });
			return;
		}
		if (event.key === "Backspace" && collapsed && field.selectionStart === 0 && previous) {
			event.preventDefault();
			commitText();
			edit({ action: "merge", ids: [previous.id, cue.id] });
		}
	}
	return (
		<section
			data-caption-row={cue.id}
			data-selected={selected ? "" : undefined}
			aria-label={`Caption at ${captionClockTenths(cue.startSec)}`}
			className="tw:my-1 tw:space-y-1 tw:rounded-md tw:border tw:border-transparent tw:px-2 tw:py-1 tw:data-active:border-ai tw:data-selected:border-border tw:data-selected:bg-secondary"
		>
			<div className="tw:flex tw:items-center tw:gap-2">
				<Button
					size="xs"
					variant="ghost"
					aria-pressed={selected}
					aria-label={`Select caption at ${captionClockTenths(cue.startSec)}`}
					onClick={choose}
				>
					<span className="tw:tabular-nums">{captionClockTenths(cue.startSec)}</span>
				</Button>
				{caption.status === "needs-refresh" && (
					<Note as="span" tone="warn">
						Needs refresh
					</Note>
				)}
				{locked && (
					<Note as="span" tone="muted">
						Locked
					</Note>
				)}
			</div>
			<Textarea
				aria-label="Caption text"
				aria-describedby={selected ? `${cue.id}:keys` : undefined}
				rows={1}
				data-document-undo={text === caption.text ? "clean" : undefined}
				value={text}
				disabled={locked}
				onFocus={() => {
					editing.current = true;
					if (!selected) choose();
				}}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={onKeyDown}
				onBlur={() => {
					editing.current = false;
					commitText();
				}}
			/>
			{selected && (
				<>
					<Note id={`${cue.id}:keys`} tone="muted">
						Enter splits · Backspace at start merges · Shift+Enter adds a line break
					</Note>
					{caption.status === "needs-refresh" && (
						<Note tone="warn">Regenerate this source or unlink the caption.</Note>
					)}
					{caption.provenance.wordTimingOrigin === "estimated" && (
						<Note>Estimated word timing</Note>
					)}
					<div className="tw:flex tw:gap-2">
						<Input
							key={`start:${cue.startSec}`}
							size="xs"
							type="number"
							step="0.01"
							min="0"
							aria-label="Caption start seconds"
							defaultValue={cue.startSec}
							disabled={locked}
							onBlur={(event) => {
								if (Number(event.target.value) !== cue.startSec)
									timing("start", event.target.value);
							}}
						/>
						<Input
							key={`end:${cue.startSec + cue.durationSec}`}
							size="xs"
							type="number"
							step="0.01"
							min="0"
							aria-label="Caption end seconds"
							defaultValue={cue.startSec + cue.durationSec}
							disabled={locked}
							onBlur={(event) => {
								if (Number(event.target.value) !== cue.startSec + cue.durationSec)
									timing("end", event.target.value);
							}}
						/>
					</div>
					<Toolbar label="Caption cue actions">
						<ToolbarAction
							label="Split caption at playhead"
							disabled={locked}
							onAction={() =>
								edit({
									action: "split",
									id: cue.id,
									at: playhead.get(),
									newId: `caption:${crypto.randomUUID()}`,
								})
							}
						>
							Split at playhead
						</ToolbarAction>
						<ToolbarAction
							label="Merge with next caption"
							disabled={locked || !next}
							onAction={() => {
								if (next) edit({ action: "merge", ids: [cue.id, next.id] });
							}}
						>
							Merge next
						</ToolbarAction>
						<ToolbarAction
							label="Delete caption"
							danger
							disabled={locked}
							onAction={() => edit({ action: "delete", ids: [cue.id] })}
						>
							Delete
						</ToolbarAction>
						{caption.sources.length > 0 && (
							<ToolbarAction
								label="Unlink caption from source"
								disabled={locked}
								onAction={() => edit({ action: "unlink", ids: [cue.id] })}
							>
								Unlink
							</ToolbarAction>
						)}
					</Toolbar>
				</>
			)}
		</section>
	);
}
