/* Maleo — Content-First Create · App shell screens (launcher → setup → done) */
import { useEffect, useId, useLayoutEffect, useState } from "react";
import type { ButtonHTMLAttributes, JSX, ReactNode } from "react";
import { get } from "@api/client.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { ML } from "@design-system/components/field-label.tsx";
import { CREATABLE_TYPES, TYPES } from "@models/content/content-types.ts";
import type { Config, ContentType, ContentPreset } from "@maleo/shared";
import { shouldPollRenderJob, type RenderQueueStatus } from "@models/render/render-queue.ts";
export { shouldPollRenderJob };
export type { RenderQueueStatus };
import { PresetPickerModal } from "./preset-picker.tsx";
import { Button } from "@design-system/components/button.tsx";
import { PageTitle } from "@design-system/components/page.tsx";
import { Field } from "@design-system/components/field.tsx";
import { Input, Textarea } from "@design-system/components/input.tsx";
import { Callout } from "@design-system/components/note.tsx";

/* ── Launcher: content first, no workspace ── */
interface LauncherProps {
	onPick: (key: ContentType) => void;
}
export function Launcher({ onPick }: LauncherProps): JSX.Element {
	return (
		<div className="cv-launch">
			<div className="cv-launch-head">
				<div className="cv-mono-eyebrow">Create</div>
				<PageTitle>What do you want to create?</PageTitle>
				<p className="cv-launch-sub">
					Start from the content — references (images &amp; voices) get attached later, whenever you
					need them.
				</p>
			</div>
			<div className="cv-type-grid">
				{CREATABLE_TYPES.map((t) => (
					<button key={t.key} type="button" className="cv-typecard" onClick={() => onPick(t.key)}>
						<span className="cv-typecard-ic">{Ic[t.iconName]?.(22)}</span>
						<span className="cv-typecard-title">{t.label}</span>
						<span className="cv-typecard-blurb">{t.blurb}</span>
						<span className="cv-typecard-meta">
							{t.meta.map((m, i) => (
								<span key={i}>
									<span className="cv-bullet" />
									{m}
								</span>
							))}
						</span>
						<span className="cv-typecard-go">{Ic.chevR(ICON.md)}</span>
					</button>
				))}
			</div>
		</div>
	);
}

/* ── Setup: project shell only ── */
interface SetupProps {
	type: ContentType;
	onBack: () => void;
	onGenerate: (cfg: Config) => void;
	// True while the project is being created — disables Generate to avoid a
	// double-submit creating two projects.
	busy?: boolean;
	error?: string | null;
	// Preset seeded into the new project (null = none). Parent applies the bundle.
	selectedPreset?: ContentPreset | null;
	onSelectPreset?: (preset: ContentPreset | null) => void;
	/* Materials and Video Template, rendered right under the preset that seeds
	 * them. Passed in rather than owned here: the parent holds the project state
	 * these controls override, and a form component that reached for it would need
	 * the whole create-flow model to render a text field. */
	materialsSlot?: ReactNode;
}
export function Setup({
	type,
	onBack,
	onGenerate,
	busy,
	error,
	selectedPreset,
	onSelectPreset,
	materialsSlot,
}: SetupProps): JSX.Element {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	/* The visible label names the field: a placeholder is not a name, and it is
	 * gone the moment something is typed. */
	const descriptionId = useId();
	const [vfmt, setVfmt] = useState("9:16");
	const [presetPickerOpen, setPresetPickerOpen] = useState(false);
	useLayoutEffect(() => {
		if (!error) return;
		document.querySelector(".cv-create-error")?.scrollIntoView({ block: "nearest" });
	}, [error]);

	const t = TYPES.find((x) => x.key === type)!;
	const fmt = vfmt;
	const titleReady = title.trim().length > 0;
	const go = (): void =>
		onGenerate({
			title,
			description,
			format: fmt,
			slides: 4,
			platform: "twitter",
			thread: true,
		});

	const Chip = ({
		on,
		...p
	}: { on: boolean } & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element => (
		<button type="button" className={`cv-chip ${on ? "on" : ""}`} aria-pressed={on} {...p} />
	);

	return (
		<div className="cv-setup">
			<div className="cv-setup-id">
				<span className="cv-setup-ic">{Ic[t.iconName]?.(20)}</span>
				<div>
					<div className="cv-mono-eyebrow">New {t.label.toLowerCase()}</div>
					<PageTitle level="sub">Project setup</PageTitle>
				</div>
			</div>

			<div className="form">
				<Field as="div">
					<div className="cv-field-head">
						<ML flush>Project title</ML>
						<span className="cv-field-tag required">Required</span>
					</div>
					<Input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Name this project"
						aria-label="Project title"
						autoFocus
					/>
				</Field>

				<Field as="div">
					<div className="cv-field-head">
						<ML flush htmlFor={descriptionId}>
							Description
						</ML>
						<span className="cv-field-tag">Optional</span>
					</div>
					<Textarea
						id={descriptionId}
						rows={4}
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Internal note for this project. Not used for generation."
						style={{ minHeight: 104, resize: "vertical" }}
					/>
				</Field>

				{type === "video" && (
					<Field as="div">
						<ML>Format</ML>
						<div className="cv-chiprow" role="group" aria-label="Video format">
							{(
								[
									["9:16", "Story 9:16"],
									["16:9", "Landscape"],
									["1:1", "Square"],
								] as const
							).map(([v, l]) => (
								<Chip key={v} on={vfmt === v} onClick={() => setVfmt(v)}>
									{l}
								</Chip>
							))}
						</div>
					</Field>
				)}

				{onSelectPreset && (
					<Field as="div">
						<ML>Preset</ML>
						{selectedPreset ? (
							<div className="cv-preset-chosen">
								<span className="cv-preset-chosen-name">
									{Ic.spark(ICON.sm)} {selectedPreset.name}
								</span>
								<span className="cv-preset-chosen-actions">
									<button
										type="button"
										className="cv-textbtn"
										onClick={() => setPresetPickerOpen(true)}
									>
										Change
									</button>
									<button type="button" className="cv-textbtn" onClick={() => onSelectPreset(null)}>
										Remove
									</button>
								</span>
							</div>
						) : (
							<button
								type="button"
								className="cv-preset-empty"
								onClick={() => setPresetPickerOpen(true)}
							>
								<span>No preset selected</span>
								<span className="cv-preset-empty-cta">Choose preset</span>
							</button>
						)}
					</Field>
				)}

				{materialsSlot}

				<div className="cv-setup-actions">
					<Button variant="primary" disabled={!titleReady || busy} onClick={go}>
						{busy ? (
							<>
								<span className="cv-spin" /> Creating…
							</>
						) : type === "video" ? (
							"Create video project"
						) : (
							`Create ${type === "image" ? "carousel project" : "draft project"}`
						)}
					</Button>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
				</div>
				{error && (
					<Callout as="div" tone="error" className="cv-create-error" role="alert">
						Could not create project. Please try again.
					</Callout>
				)}

				{presetPickerOpen && onSelectPreset && (
					<PresetPickerModal
						sub="Seeds this new project's Materials and Video Template."
						onClose={() => setPresetPickerOpen(false)}
						onPick={(preset) => {
							onSelectPreset(preset);
							setPresetPickerOpen(false);
						}}
					/>
				)}
			</div>
		</div>
	);
}

/* ── Done ── */
interface DoneViewProps {
	type: ContentType;
	onAnother: () => void;
	onViewQueue: () => void;
	renderJobId?: string | null;
}

const RENDER_PHASE_LABELS: Record<string, string> = {
	queued: "Queued",
	validating: "Validating",
	preparing_images: "Preparing images",
	synthesizing_audio: "Synthesizing voiceover",
	bundling: "Bundling render bundle",
	rendering: "Rendering video",
	finalizing: "Finalizing output",
	done: "Done",
	failed: "Failed",
};

export function describeRenderState(job: RenderQueueStatus | null): string {
	if (!job) return "Waiting for render worker";
	if (job.status === "done") return "Render complete";
	// Degraded: phase_detail names the actual cause(s) (silent audio and/or
	// placeholder art). Don't assume silent-audio.
	if (job.status === "done_with_fallback")
		return job.phase_detail?.trim()
			? `Render complete — ${job.phase_detail.trim()}`
			: "Render complete (degraded)";
	if (job.status === "error") return job.error?.trim() || "Render failed";
	if (job.status === "cancelled") return "Render cancelled";
	if (job.phase_detail?.trim()) return job.phase_detail.trim();
	if (job.phase && RENDER_PHASE_LABELS[job.phase]) return RENDER_PHASE_LABELS[job.phase];
	return job.status === "running" ? "Rendering" : "Waiting for render worker";
}

function QueueStatusPanel({ renderJobId }: { renderJobId: string }): JSX.Element {
	const [job, setJob] = useState<RenderQueueStatus | null>(null);
	const [pollError, setPollError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const poll = async (): Promise<void> => {
			try {
				const next = await get<RenderQueueStatus>(`/api/video/render/${renderJobId}`);
				if (!alive) return;
				setJob(next);
				setPollError(null);
				if (shouldPollRenderJob(next.status)) {
					timer = setTimeout(() => {
						void poll();
					}, 2000);
				}
			} catch (error) {
				if (!alive) return;
				setPollError(error instanceof Error ? error.message : String(error));
				timer = setTimeout(() => {
					void poll();
				}, 4000);
			}
		};
		void poll();
		return () => {
			alive = false;
			if (timer) clearTimeout(timer);
		};
	}, [renderJobId]);

	const progressPct = Math.max(0, Math.min(100, Math.round((job?.progress ?? 0) * 100)));
	const status = job?.status ?? "queued";
	const statusTone =
		status === "done" || status === "done_with_fallback"
			? "#43c78f"
			: status === "error" || status === "cancelled"
				? "#ff7b72"
				: status === "running"
					? "#ffd166"
					: "#8b93a7";

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 460,
				marginTop: 18,
				padding: 16,
				borderRadius: 16,
				background: "rgba(255,255,255,0.04)",
				border: "1px solid rgba(255,255,255,0.08)",
				display: "grid",
				gap: 10,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						padding: "4px 10px",
						borderRadius: 999,
						background: `${statusTone}22`,
						color: statusTone,
						fontSize: 12,
						fontWeight: 700,
						textTransform: "capitalize",
					}}
				>
					{status.replace(/_/g, " ")}
				</span>
				<span style={{ fontSize: 11, color: "var(--muted)" }}>job {renderJobId.slice(0, 8)}</span>
				{(status === "done" || status === "done_with_fallback") && (
					<a
						href={`/api/video/render/${renderJobId}/file`}
						target="_blank"
						rel="noreferrer"
						style={{ marginLeft: "auto", color: "var(--fg)", fontSize: 12, fontWeight: 600 }}
					>
						Open MP4
					</a>
				)}
			</div>
			<div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)" }}>
				{describeRenderState(job)}
			</div>
			<div
				style={{
					height: 6,
					borderRadius: 999,
					background: "rgba(255,255,255,0.08)",
					overflow: "hidden",
				}}
			>
				<div
					style={{
						height: "100%",
						width: `${Math.max(progressPct, status === "queued" ? 4 : 0)}%`,
						background: statusTone,
						borderRadius: 999,
						transition: "width 280ms ease",
					}}
				/>
			</div>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					gap: 12,
					fontSize: 12,
					color: "var(--muted)",
				}}
			>
				<span>{job?.phase ? (RENDER_PHASE_LABELS[job.phase] ?? job.phase) : "Queue"}</span>
				<span>{progressPct}%</span>
			</div>
			{pollError && (
				<div style={{ fontSize: 12, color: "#ffb86b" }}>
					Could not refresh queue status: {pollError}
				</div>
			)}
		</div>
	);
}

export function DoneView({
	type,
	onAnother,
	onViewQueue,
	renderJobId,
}: DoneViewProps): JSX.Element {
	return (
		<div className="cv-generating">
			<div className="cv-gen-orb ok">{Ic.check(ICON.xl)}</div>
			<div className="cv-gen-title">{type === "video" ? "Render queued" : "Sent to review"}</div>
			<p style={{ fontSize: 13.5, color: "var(--muted)", textAlign: "center", maxWidth: 340 }}>
				{type === "video"
					? "Storyboard saved and render job sent to video queue."
					: `Your ${type === "image" ? "carousel" : "draft"} has entered the approval queue.`}
			</p>
			{type === "video" && renderJobId && <QueueStatusPanel renderJobId={renderJobId} />}
			<div style={{ display: "flex", gap: 10, marginTop: 6 }}>
				<Button variant="primary" onClick={onAnother}>
					{Ic.plus(ICON.sm)} Create another
				</Button>
				<Button variant="ghost" onClick={onViewQueue}>
					View in queue
				</Button>
			</div>
		</div>
	);
}
