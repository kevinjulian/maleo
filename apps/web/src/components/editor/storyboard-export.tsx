/* Maleo — Content-First Create · exportable storyboard view.
 *
 * Renders the video storyboard as a print-style document (scene table with
 * frame, visual/action, dialog, camera and transition columns plus the
 * consistency rules) and exports each part as a PNG. The exported image is
 * what gets sent to an image-to-video generator; long storyboards are split
 * into parts (see storyboard-chunk.ts) that become sequential clips and are
 * concatenated after generation.
 */
import { useRef, useState } from "react";
import type { JSX } from "react";
import { toPng } from "html-to-image";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { fmtMMSS, gradFor } from "@models/core/measures.ts";
import { resolveVoice } from "@models/references/voice-library.ts";
import type { Config, RefsState, Scene } from "@maleo/shared";
import {
	MAX_CHUNK_DURATION_SEC,
	STORYBOARD_AVOID,
	STORYBOARD_RULES,
	chunkScenes,
	continuityNote,
	totalDurationSec,
} from "@models/storyboard/storyboard-chunk.ts";
import type { StoryboardChunk } from "@models/storyboard/storyboard-chunk.ts";
import { Button } from "@design-system/components/button.tsx";

/** Fixed export width so the PNG is crisp and layout-stable. */
const EXPORT_WIDTH_PX = 960;
const EXPORT_PIXEL_RATIO = 2;
/** 1x1 transparent PNG used when an <img> cannot be inlined (CORS). */
const IMAGE_PLACEHOLDER =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function exportNodeAsPng(node: HTMLElement, filename: string): Promise<void> {
	const dataUrl = await toPng(node, {
		pixelRatio: EXPORT_PIXEL_RATIO,
		backgroundColor: "#ffffff",
		imagePlaceholder: IMAGE_PLACEHOLDER,
		cacheBust: true,
	});
	const link = document.createElement("a");
	link.href = dataUrl;
	link.download = filename;
	link.click();
}

interface StoryboardViewProps {
	title: string;
	scenes: Scene[];
	config: Config;
	refs: RefsState;
}

export function StoryboardView({ title, scenes, config, refs }: StoryboardViewProps): JSX.Element {
	const chunks = chunkScenes(scenes);
	const totalSec = totalDurationSec(scenes);
	const format = config.format || "9:16";
	const docRefs = useRef<Map<number, HTMLDivElement>>(new Map());
	const [exporting, setExporting] = useState<number | "all" | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const slug =
		(title || "storyboard")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/(^-|-$)/g, "") || "storyboard";

	const fileFor = (part: number): string =>
		chunks.length > 1 ? `${slug}-storyboard-part-${part}.png` : `${slug}-storyboard.png`;

	const exportPart = async (part: number): Promise<void> => {
		const node = docRefs.current.get(part);
		if (!node) return;
		setExporting(part);
		setExportError(null);
		try {
			await exportNodeAsPng(node, fileFor(part));
		} catch (err) {
			setExportError(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setExporting(null);
		}
	};

	const exportAll = async (): Promise<void> => {
		setExporting("all");
		setExportError(null);
		try {
			for (const chunk of chunks) {
				const node = docRefs.current.get(chunk.part);
				if (node) await exportNodeAsPng(node, fileFor(chunk.part));
			}
		} catch (err) {
			setExportError(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setExporting(null);
		}
	};

	return (
		<div className="cv-sbview">
			<div className="cv-sbview-bar">
				<div className="cv-sbview-info">
					<b>{chunks.length > 1 ? `${chunks.length} parts` : "1 part"}</b>
					<span>
						{" "}
						· {fmtMMSS(totalSec)} total · {format}
					</span>
					<span className="cv-sbview-hint">
						{chunks.length > 1
							? `Longer than ${MAX_CHUNK_DURATION_SEC}s, so the board is split into ${chunks.length} images. Generate one clip per image, in order, then concatenate the clips.`
							: "Export this image and send it to the video generator as a single clip."}
					</span>
				</div>
				<div className="cv-sbview-actions">
					{chunks.length > 1 && (
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void exportAll()}
							disabled={exporting !== null}
						>
							{Ic.image(ICON.sm)} {exporting === "all" ? "Exporting…" : "Export all parts"}
						</Button>
					)}
				</div>
			</div>
			{exportError && (
				<div role="alert" className="cv-sbview-err">
					{exportError}
				</div>
			)}
			<div className="cv-sbview-scroll">
				{chunks.map((chunk, chunkIdx) => (
					<div key={chunk.part} className="cv-sbview-part">
						<div className="cv-sbview-parthead">
							<span>
								{chunks.length > 1 ? `Part ${chunk.part}/${chunks.length} · ` : ""}
								{fmtMMSS(chunk.startSec)} – {fmtMMSS(chunk.endSec)}
							</span>
							<Button
								variant="primary"
								size="sm"
								onClick={() => void exportPart(chunk.part)}
								disabled={exporting !== null}
							>
								{Ic.image(ICON.sm)} {exporting === chunk.part ? "Exporting…" : "Export PNG"}
							</Button>
						</div>
						<div
							ref={(node) => {
								if (node) docRefs.current.set(chunk.part, node);
								else docRefs.current.delete(chunk.part);
							}}
						>
							<StoryboardDoc
								title={title}
								chunk={chunk}
								partCount={chunks.length}
								startIndex={chunks.slice(0, chunkIdx).reduce((n, c) => n + c.scenes.length, 0)}
								totalSec={totalSec}
								config={config}
								refs={refs}
							/>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

interface StoryboardDocProps {
	title: string;
	chunk: StoryboardChunk;
	partCount: number;
	/** Position of this chunk's first scene within the full storyboard (0-based). */
	startIndex: number;
	totalSec: number;
	config: Config;
	refs: RefsState;
}

function StoryboardDoc({
	title,
	chunk,
	partCount,
	startIndex,
	totalSec,
	config,
	refs,
}: StoryboardDocProps): JSX.Element {
	const format = config.format || "9:16";
	const theme = refs.style.tone;
	const note = continuityNote(chunk.part, partCount);
	const castOf = (scene: Scene) => resolveVoice(refs.speakers.find((c) => c.id === scene.castId));
	const additional = refs.notes.filter((n) => n.default).map((n) => `${n.label}: ${n.body}`);

	return (
		<div className="cv-sbdoc" style={{ width: EXPORT_WIDTH_PX }}>
			<header className="cv-sbdoc-head">
				<h1>
					Storyboard — {title || "Untitled"} — {fmtMMSS(totalSec)} ({format})
					{partCount > 1 ? ` — Part ${chunk.part}/${partCount}` : ""}
				</h1>
				{theme && <div className="cv-sbdoc-theme">Theme: {theme}</div>}
			</header>

			{note && <div className="cv-sbdoc-continuity">{note}</div>}

			<div className="cv-sbdoc-grid">
				<div className="cv-sbdoc-th">Scene &amp; Duration</div>
				<div className="cv-sbdoc-th">Frame</div>
				<div className="cv-sbdoc-th">Visual &amp; Action</div>
				<div className="cv-sbdoc-th">Dialog / Voice Over</div>
				<div className="cv-sbdoc-th">Camera &amp; Transition</div>

				{chunk.scenes.map((scene, i) => {
					const timing = chunk.timings[i];
					const isLastOfPart = i === chunk.scenes.length - 1;
					const voice = castOf(scene);
					const transition = scene.transition ?? "fade";
					return (
						<div key={scene.id} className="cv-sbdoc-row">
							<div className="cv-sbdoc-cell cv-sbdoc-scene">
								<span className="cv-sbdoc-num">{startIndex + i + 1}</span>
								<span className="cv-sbdoc-name">{scene.name}</span>
								<span className="cv-sbdoc-time">
									{fmtMMSS(timing.startSec)} – {fmtMMSS(timing.endSec)}
								</span>
							</div>
							<div className="cv-sbdoc-cell cv-sbdoc-frame">
								<div className="cv-sbdoc-framewrap">
									<div className="cv-sbdoc-frameone">
										{scene.endSrc && <span className="cv-sbdoc-framelbl">Start</span>}
										{scene.src ? (
											<img src={scene.src} alt={scene.name} crossOrigin="anonymous" />
										) : (
											<div
												className="cv-sbdoc-noframe"
												style={{ background: gradFor(scene.seed || scene.id) }}
											>
												no frame yet
											</div>
										)}
									</div>
									{scene.endSrc && (
										<div className="cv-sbdoc-frameone">
											<span className="cv-sbdoc-framelbl">End</span>
											<img src={scene.endSrc} alt={`${scene.name} end`} crossOrigin="anonymous" />
										</div>
									)}
								</div>
							</div>
							<div className="cv-sbdoc-cell">
								<p>
									<b>Visual:</b> {scene.vis || "—"}
								</p>
								{scene.action && (
									<p>
										<b>Action:</b> {scene.action}
									</p>
								)}
							</div>
							<div className="cv-sbdoc-cell">
								{scene.audioClips
									?.filter((clip) => clip.kind === "voiceover")
									.map((clip) => clip.content)
									.join(" ") || scene.vo ? (
									<>
										<p>
											<b>{voice.name !== "—" ? voice.name : "Voice over"}:</b>
										</p>
										<p className="cv-sbdoc-vo">
											“
											{scene.audioClips
												?.filter((clip) => clip.kind === "voiceover")
												.map((clip) => clip.content)
												.join(" ") || scene.vo}
											”
										</p>
									</>
								) : (
									<p>—</p>
								)}
								{(
									scene.audioClips
										?.filter((clip) => clip.kind !== "voiceover")
										.map((clip) => `${clip.label}: ${clip.content}`) ??
									(scene.sfx ? [`SFX: ${scene.sfx}`] : [])
								).map((line) => (
									<p key={line}>
										<b>Audio:</b> {line}
									</p>
								))}
								{scene.visualClips?.length ? (
									<p>
										<b>Visual clips:</b> {scene.visualClips.length}
									</p>
								) : null}
							</div>
							<div className="cv-sbdoc-cell">
								<p>
									<b>Camera:</b> {scene.shot}
								</p>
								<p>
									<b>Movement:</b> {scene.move}
								</p>
								<p>
									<b>Transition:</b>{" "}
									{isLastOfPart && chunk.part === partCount
										? `${transition} / fade out at the end`
										: `smooth ${transition} to next scene`}
								</p>
							</div>
						</div>
					);
				})}
			</div>

			<footer className="cv-sbdoc-rules">
				<div className="cv-sbdoc-rulebox cv-sbdoc-must">
					<h2>Rules (must follow)</h2>
					<ul>
						{STORYBOARD_RULES.map((rule) => (
							<li key={rule}>{rule}</li>
						))}
					</ul>
				</div>
				<div className="cv-sbdoc-rulebox cv-sbdoc-avoid">
					<h2>Must avoid</h2>
					<ul>
						{STORYBOARD_AVOID.map((rule) => (
							<li key={rule}>{rule}</li>
						))}
					</ul>
				</div>
				{(additional.length > 0 || refs.style.music) && (
					<div className="cv-sbdoc-rulebox cv-sbdoc-extra">
						<h2>Additional rules</h2>
						<ul>
							{refs.style.palette && <li>Palette: {refs.style.palette}</li>}
							{refs.style.music && <li>Sound: {refs.style.music}</li>}
							{additional.map((rule) => (
								<li key={rule}>{rule}</li>
							))}
						</ul>
					</div>
				)}
			</footer>

			<div className="cv-sbdoc-meta">
				<span>Part duration: {fmtMMSS(chunk.endSec - chunk.startSec)}</span>
				<span>Total: {fmtMMSS(totalSec)}</span>
				<span>Ratio: {format}</span>
				{config.platform && <span>Format: {config.platform}</span>}
			</div>
		</div>
	);
}
