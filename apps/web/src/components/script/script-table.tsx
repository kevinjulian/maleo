import { Input, Textarea } from "@design-system/components/input.tsx";
/* The script, as an AV script table.
 *
 * Props in, markup out. Every edit goes straight to the scene the row renders —
 * there is no local copy of any text here, which is what makes "the script and
 * the timeline cannot disagree" true by construction rather than by a sync step.
 *
 * The table is one CSS grid for the whole document, with chapter headers and
 * footers spanning every column. That is what keeps columns aligned across a
 * chapter break; a table element per chapter would size its columns
 * independently and the page would read as broken.
 */
import { useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { SourceLinks } from "@components/research/source-links.tsx";
import {
	audioLines,
	showsColumn,
	type ScriptChapterRows,
	type ScriptDensity,
	type ScriptRow,
} from "@models/script/script-rows.ts";
import { readableArcTerm, type ScriptArcRoles } from "@models/script/arc-chapters.ts";
import type { Scene } from "@maleo/shared";
import "./script-table.css";

/** Which of a scene's fields a row edit touches. */
export type SceneField = "name" | "vo" | "vis";

export interface ScriptTableProps {
	chapters: ScriptChapterRows[];
	density: ScriptDensity;
	/** The scene the caller already considers current, when it has an opinion.
	 *  Absent lets the table track its own — which is the usual case, because the
	 *  editor deliberately does not subscribe to it. */
	currentSceneId?: number;
	onEdit: (sceneId: number, field: SceneField, value: string) => void;
	onSelect?: (sceneId: number) => void;
	/* Per row, and per KIND separately — not one handler for both. The editor can
	 * regenerate a frame but has no per-scene speech path, and a single prop would
	 * have made the surface offer an action it cannot perform. There is
	 * deliberately no bulk equivalent either: regenerating everything stale in one
	 * step spends credits without a decision. */
	onRegenerateFrame?: (sceneId: number) => void;
	onRegenerateSpeech?: (sceneId: number) => void;
	/** Scenes currently generating, so a row can say so instead of looking idle. */
	generating?: Readonly<Record<number, boolean>>;
	/** The project's default voice, named once so per-row cues can stay absent. */
	defaultVoice?: string;
	/** Rename a chapter or write its brief. Absent makes both read-only. */
	onChapterEdit?: (chapterId: string, field: "title" | "brief", value: string) => void;
	/* The plan's arc functions, keyed by chapter id. Read-only and additive: the
	 * chapter's own title and operator-written brief are untouched, and a chapter
	 * with no matching section renders exactly as it did before arcs existed. */
	arcRoles?: ScriptArcRoles;
	/** Remove a scene. The caller owns the confirmation, because it owns what else
	 *  the removal would take with it. Absent hides the control. */
	onDelete?: (sceneId: number) => void;
}

function mmss(totalSec: number): string {
	const whole = Math.max(0, Math.round(totalSec));
	return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function shotNote(scene: Scene): string {
	return [scene.shot, scene.move]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(" · ");
}

/** What overlaps this row that the script does not own — shown, never edited.
 *
 *  Audio is deliberately NOT counted here. The audio cell now names every clip
 *  crossing the row, so a count beside it was the same fact told twice and told
 *  worse. `overlaps.music` still exists for the delete confirmation, which needs
 *  to know something is there rather than what it is. */
function ownedElsewhere(row: ScriptRow): string {
	const parts: string[] = [];
	if (row.overlaps.overlays)
		parts.push(`${row.overlaps.overlays} overlay${row.overlaps.overlays > 1 ? "s" : ""}`);
	if (row.overlaps.transitions)
		parts.push(`${row.overlaps.transitions} transition${row.overlaps.transitions > 1 ? "s" : ""}`);
	return parts.join(" · ");
}

function Prose({
	value,
	label,
	onCommit,
	capped,
}: {
	value: string;
	label: string;
	onCommit: (next: string) => void;
	capped?: boolean;
}): JSX.Element {
	return (
		<Textarea
			/* Capped fields still GROW with their content — they stop growing at a
			 * height and scroll instead. A generated visual prompt runs to a
			 * paragraph, and letting it set the row height made one scene taller
			 * than the four around it. */
			className={capped ? "sc-prose sc-prose-capped" : "sc-prose"}
			aria-label={label}
			defaultValue={value}
			/* Committed on blur rather than per keystroke: an auto scene's duration
			 * follows its speech, and rewriting the document on every character would
			 * make the timeline reflow while the operator is still typing. */
			onBlur={(e) => {
				if (e.target.value !== value) onCommit(e.target.value);
			}}
		/>
	);
}

/** The scene's frame, sized by the shape it turns out to be.
 *
 *  The orientation is not in the document — a scene records a URL, not the
 *  dimensions behind it — so it is read off the decoded image and applied as a
 *  data attribute the sheet sizes against. A portrait frame takes half the
 *  column and a landscape or square one takes all of it, so that neither ends up
 *  driving the row's height on its own.
 *
 *  Until it loads, the frame is assumed portrait: that is what the generation
 *  pipeline produces, so the common case reserves the right box and the
 *  uncommon one corrects itself once. */
function Frame({ src, alt }: { src: string; alt: string }): JSX.Element {
	const [orient, setOrient] = useState<"portrait" | "wide">("portrait");
	return (
		<img
			className="sc-image"
			data-orient={orient}
			src={src}
			alt={alt}
			loading="lazy"
			onLoad={(e) => {
				const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
				if (w && h) setOrient(h > w ? "portrait" : "wide");
			}}
		/>
	);
}

/** One chapter-footer statistic, as a stacked label-over-value pair. */
function Stat({ label, value }: { label: string; value: string | number }): JSX.Element {
	return (
		<div className="sc-stat">
			<span className="sc-stat-label">{label}</span>
			<b className="sc-stat-value">{value}</b>
		</div>
	);
}

function Row(props: {
	row: ScriptRow;
	density: ScriptDensity;
	current: boolean;
	onEdit: ScriptTableProps["onEdit"];
	onSelect?: ScriptTableProps["onSelect"];
	onRegenerateFrame?: ScriptTableProps["onRegenerateFrame"];
	onRegenerateSpeech?: ScriptTableProps["onRegenerateSpeech"];
	onDelete?: ScriptTableProps["onDelete"];
	defaultVoice?: ScriptTableProps["defaultVoice"];
	busy?: boolean;
}): JSX.Element {
	const { row, density, current } = props;
	const scene = row.scene;
	const owned = ownedElsewhere(row);
	return (
		<div
			className="sc-row"
			data-current={current}
			data-frame-stale={row.frameStale}
			onFocus={() => props.onSelect?.(scene.id)}
		>
			{showsColumn(density, "label") && <div className="sc-label">{row.label}</div>}

			{showsColumn(density, "name") && !showsColumn(density, "audio") && (
				<div className="sc-name">{scene.name}</div>
			)}

			{showsColumn(density, "audio") && (
				<div className="sc-cell">
					{/* Every audio element the scene carries, cues before the words that
					    sit under them. Music and effects are read-only: they project
					    clips the script does not own, and an edit that writes nowhere is
					    worse than no edit at all. */}
					{audioLines(scene, props.defaultVoice, row.timelineAudio).map((line, index) => {
						if (line.kind === "vo") {
							return (
								<div key={`vo-${index}`} className="sc-audio-line">
									<div className="sc-cue">VO ({line.speaker})</div>
									{line.editable ? (
										<Prose
											value={scene.vo ?? ""}
											label={`Narration for ${scene.name}`}
											onCommit={(v) => props.onEdit(scene.id, "vo", v)}
										/>
									) : (
										<div className="sc-audio-text">{line.text}</div>
									)}
								</div>
							);
						}
						/* The rendered speech, with its measured length. Its own line
						   rather than a mark on the narration: it can drift from the
						   words above it, and a mark cannot show that. */
						if (line.kind === "speech") {
							return (
								<div key={`speech-${index}`} className="sc-audio-line sc-audio-cue">
									<span className="sc-audio-kind">Speech:</span> {line.text}
									<span className="sc-audio-meta">
										{[line.origin, `${line.durationSec.toFixed(2)}s`].filter(Boolean).join(", ")}
									</span>
								</div>
							);
						}
						return (
							<div key={`${line.kind}-${index}`} className="sc-audio-line sc-audio-cue">
								<span className="sc-audio-kind">{line.kind === "music" ? "Music" : "SFX"}:</span>{" "}
								{line.title}
								{/* Runs past this row. Stated once, where it starts. */}
								{line.continues && (
									<span className="sc-audio-on" title="continues past this scene">
										{Ic.chevronRight(ICON.xs)}
									</span>
								)}
							</div>
						);
					})}
					{/* The ACTION only when something can act on it. A button wired to
					    nothing is worse than no button: it reads as offered and does
					    nothing, and the operator cannot tell which. Without a handler the
					    staleness is still stated, because that part is information. */}
					{row.speechStale &&
						(props.onRegenerateSpeech ? (
							<button
								type="button"
								className="sc-flag"
								onClick={() => props.onRegenerateSpeech?.(scene.id)}
							>
								{Ic.spark(ICON.xs)} text changed since generated — regenerate
							</button>
						) : (
							<div className="sc-flag">
								{Ic.spark(ICON.xs)} text changed since this speech was generated
							</div>
						))}
					{row.overflowSec > 0 && (
						<div className="sc-flag">
							{Ic.spark(ICON.xs)} speech runs {row.overflowSec.toFixed(1)}s past this shot
						</div>
					)}
					{/* What this narration is grounded in, beside the words it justifies —
					    a citation is about the narration, not the shot or the frame.
					    Only at `write`, where prose is actually being judged: a
					    citation list on every row of an outline is noise.

					    Nothing is shown when a scene carries no evidence. The absence
					    is NOT a verdict — `Scene` does not record whether the line was
					    supposed to be grounded, so a fiction beat and an unsupported
					    factual claim would get the same mark, which makes the mark
					    worse than silence. The story plan card carries that state, at
					    approval, where it is known. */}
					{density === "write" && scene.sourceEvidence && scene.sourceEvidence.length > 0 && (
						<SourceLinks
							urls={scene.sourceEvidence.map((item) => item.url)}
							evidence={scene.sourceEvidence}
						/>
					)}
				</div>
			)}

			{showsColumn(density, "visual") && (
				<div className="sc-cell">
					{shotNote(scene) && <div className="sc-note">{shotNote(scene)}</div>}
					<Prose
						capped
						value={scene.vis ?? ""}
						label={`Visual prompt for ${scene.name}`}
						onCommit={(v) => props.onEdit(scene.id, "vis", v)}
					/>
					{owned && <div className="sc-owned">+ {owned}</div>}
				</div>
			)}

			{showsColumn(density, "image") && (
				<div className="sc-cell">
					{scene.src ? (
						<Frame src={scene.src} alt={`Frame for ${scene.name}`} />
					) : (
						<div className="sc-image sc-image-empty" data-orient="portrait">
							no frame
						</div>
					)}
					{props.busy ? (
						<div className="sc-flag">{Ic.spark(ICON.xs)} generating…</div>
					) : (
						row.frameStale &&
						(props.onRegenerateFrame ? (
							<button
								type="button"
								className="sc-flag"
								onClick={() => props.onRegenerateFrame?.(scene.id)}
							>
								{Ic.spark(ICON.xs)} regenerate
							</button>
						) : (
							<div className="sc-flag">{Ic.spark(ICON.xs)} prompt changed</div>
						))
					)}
				</div>
			)}

			{showsColumn(density, "duration") && (
				<div className="sc-time">
					{/* The duration alone. A start offset is a fact about the timeline,
					    not about the writing, and the row it sat on is the one place it
					    was never acted on. */}
					{mmss(row.durationSec)}
					{props.onDelete && (
						<button
							type="button"
							className="sc-delete"
							aria-label={`Delete ${scene.name}`}
							title={owned ? `Deleting this also affects ${owned}` : "Delete this scene"}
							onClick={() => props.onDelete?.(scene.id)}
						>
							{Ic.trash(ICON.xs)}
						</button>
					)}
				</div>
			)}
		</div>
	);
}

export function ScriptTable(props: ScriptTableProps): JSX.Element {
	const { chapters, density } = props;
	const arcRole = (chapterId: string) => props.arcRoles?.byChapterId.get(chapterId);
	/* Marked HERE rather than in the editor. The current row changes as the cursor
	 * moves, and holding it above this component would re-render the whole editor
	 * on every tab keypress; the shell only needs to be told, so it can hand the
	 * scene over when the operator switches to the timeline. */
	const [current, setCurrent] = useState<number | undefined>(props.currentSceneId);
	const markCurrent = (sceneId: number): void => {
		setCurrent(sceneId);
		props.onSelect?.(sceneId);
	};
	return (
		<div className="sc-doc" data-density={density}>
			<div className="sc-head" aria-hidden="true">
				{showsColumn(density, "label") && <span>#</span>}
				{showsColumn(density, "name") && !showsColumn(density, "audio") && <span>Scene</span>}
				{/* The default voice is NOT named here. Every voiceover line already
				    names its own speaker, so a name in the header was the same fact
				    stated twice — and the wrong one on any row that chose differently. */}
				{showsColumn(density, "audio") && <span>Audio / Voiceover</span>}
				{showsColumn(density, "visual") && <span>Visual</span>}
				{showsColumn(density, "image") && <span>Image</span>}
				{showsColumn(density, "duration") && <span>Duration</span>}
			</div>

			{chapters.map((group, index) => (
				<div key={group.chapter.id || `unassigned-${index}`} style={{ display: "contents" }}>
					<div className="sc-chapter">
						<div className="sc-chapter-eyebrow">
							Chapter {index + 1}
							{arcRole(group.chapter.id) && (
								<> · {readableArcTerm(arcRole(group.chapter.id)!.chapterFunction)}</>
							)}
						</div>
						{props.onChapterEdit ? (
							<>
								{/* Keyed on the value it defaults to. These are UNCONTROLLED —
									    committed on blur, like the prose, so the document is not
									    rewritten on every keystroke — and React never updates
									    `defaultValue` on re-render. Without the key, a title changed
									    in the DOCUMENT rather than in this field (regrouping replaces
									    every one of them) leaves the old text on screen until reload,
									    with the input disagreeing with the document behind it. */}
								<Input
									key={`title:${group.chapter.title}`}
									className="sc-chapter-title sc-chapter-input"
									aria-label={`Title of chapter ${index + 1}`}
									defaultValue={group.chapter.title}
									onBlur={(e) => {
										if (e.target.value !== group.chapter.title)
											props.onChapterEdit?.(group.chapter.id, "title", e.target.value);
									}}
								/>
								{/* Writable, and empty until someone writes it — the placeholder
									    is the invitation, and it costs nothing when ignored. Nothing
									    generates a brief, so an always-visible field would otherwise
									    be a permanently blank one. */}
								<Textarea
									key={`brief:${group.chapter.brief ?? ""}`}
									className="sc-chapter-brief sc-chapter-input"
									aria-label={`Brief for chapter ${index + 1}`}
									placeholder="What is this chapter for?"
									defaultValue={group.chapter.brief ?? ""}
									onBlur={(e) => {
										if (e.target.value !== (group.chapter.brief ?? ""))
											props.onChapterEdit?.(group.chapter.id, "brief", e.target.value);
									}}
								/>
							</>
						) : (
							<>
								<h2 className="sc-chapter-title">{group.chapter.title}</h2>
								{/* No brief means no brief. A placeholder on a read-only chapter
									    would promise an edit that is not on offer. */}
								{group.chapter.brief && <p className="sc-chapter-brief">{group.chapter.brief}</p>}
							</>
						)}
						{/* What the arc says this chapter must DO. Its own line, never merged
						    into the brief: the brief is the operator's, and nothing generates
						    one. This is derived, so it is stated and not editable. */}
						{arcRole(group.chapter.id)?.obligation && (
							<p className="sc-chapter-obligation">{arcRole(group.chapter.id)!.obligation}</p>
						)}
					</div>

					{group.rows.length === 0 ? (
						<div className="sc-empty">No scenes in this chapter yet.</div>
					) : (
						group.rows.map((row) => (
							<Row
								key={row.scene.id}
								row={row}
								density={density}
								current={(props.currentSceneId ?? current) === row.scene.id}
								onEdit={props.onEdit}
								onSelect={markCurrent}
								onRegenerateFrame={props.onRegenerateFrame}
								onRegenerateSpeech={props.onRegenerateSpeech}
								onDelete={props.onDelete}
								defaultVoice={props.defaultVoice}
								busy={props.generating?.[row.scene.id] === true}
							/>
						))
					)}

					{/* Computed on render, never stored: a persisted total could outlive
					    the scenes it summarised. */}
					{/* Label above value, not beside it: the values are what the reader
					    is scanning for, and inline they were the second half of a
					    run-on line. */}
					<div className="sc-footer">
						<Stat label="End of chapter" value={group.chapter.title} />
						<Stat label="Segment RT" value={mmss(group.segmentSec)} />
						<Stat label="Segment words" value={group.segmentWords} />
						<Stat label="Total RT" value={mmss(group.totalSec)} />
						<Stat label="Total words" value={group.totalWords} />
					</div>
				</div>
			))}
		</div>
	);
}
