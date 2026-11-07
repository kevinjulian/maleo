/* Render-progress detail body for the CreateContent render modal. */
import type { JSX } from "react";
import { useShellChrome, type ShellChromeStore } from "@stores/shell-chrome-store.ts";
import { Button } from "@design-system/components/button.tsx";
import { exportOutputAvailable } from "@models/video/render-job.ts";
import { Chip } from "@design-system/components/chip.tsx";
import { describeRenderState, type RenderQueueStatus } from "./launcher.tsx";

export function RenderStatusBody({
	status: job,
	jobId,
	chrome,
	onCancelBrowserExport,
}: {
	status: RenderQueueStatus | null;
	jobId: string | null;
	chrome: ShellChromeStore;
	onCancelBrowserExport?: () => void;
}): JSX.Element {
	const connection = useShellChrome(chrome, "exportConnection");
	const error = useShellChrome(chrome, "exportError");
	const origin = useShellChrome(chrome, "exportOrigin");
	const rendering = useShellChrome(chrome, "rendering");
	if (!job)
		return (
			<div role="status">
				{connection === "checking"
					? "Checking export status…"
					: (error ?? "No server export yet. Browser exports are available only in this session.")}
				{error && (
					<Button onClick={() => window.dispatchEvent(new Event("maleo:refresh-export"))}>
						Reconnect
					</Button>
				)}
			</div>
		);
	const status = job?.status ?? "queued";
	const pct = Math.max(0, Math.min(100, Math.round((job?.progress ?? 0) * 100)));
	const tone =
		status === "done" || status === "done_with_fallback"
			? "ok"
			: status === "error" || status === "cancelled"
				? "err"
				: status === "running"
					? "warn"
					: "";
	const barColor = tone === "ok" ? "var(--ok)" : tone === "err" ? "var(--err)" : "var(--info)";
	const done = exportOutputAvailable(job);
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			{error && (
				<div role="alert">
					{error}
					<Button onClick={() => window.dispatchEvent(new Event("maleo:refresh-export"))}>
						Reconnect
					</Button>
				</div>
			)}
			<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
				<Chip tone={tone || "plain"} style={{ textTransform: "capitalize" }}>
					{status.replace(/_/g, " ")}
				</Chip>
				{jobId && (
					<span style={{ fontSize: 11, color: "var(--muted)" }}>job {jobId.slice(0, 8)}</span>
				)}
				{done && jobId && (
					<a
						href={`/api/video/render/${jobId}/file`}
						target="_blank"
						rel="noreferrer"
						style={{ marginLeft: "auto", color: "var(--fg)", fontSize: 12.5, fontWeight: 600 }}
					>
						Open MP4
					</a>
				)}
			</div>
			<div style={{ fontSize: 14, fontWeight: 600 }}>{describeRenderState(job)}</div>
			<div
				style={{
					height: 6,
					borderRadius: "var(--r-pill)",
					background: "var(--surface-tint)",
					overflow: "hidden",
				}}
			>
				<div
					style={{
						height: "100%",
						width: `${Math.max(pct, status === "queued" ? 4 : 0)}%`,
						background: barColor,
						transition: "width 280ms ease",
					}}
				/>
			</div>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					fontSize: 12,
					color: "var(--muted)",
				}}
			>
				<span style={{ textTransform: "capitalize" }}>{job?.phase ?? "queue"}</span>
				<span style={{ fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
			</div>
			{status === "done_with_fallback" && (
				<div
					style={{
						fontSize: 12,
						color: "var(--fg-dim)",
						lineHeight: 1.5,
						padding: "10px 12px",
						background: "var(--surface-tint)",
						borderRadius: "var(--r-1)",
					}}
				>
					Video rendered, but degraded:{" "}
					<b>{job?.phase_detail?.trim() || "some assets fell back"}</b>.
					{(job?.phase_detail ?? "").includes("silent") && (
						<>
							{" "}
							No text-to-speech provider is configured. Set <code>MALEO_KOKORO_URL</code> on the
							server and re-render to get audio.
						</>
					)}
					{(job?.phase_detail ?? "").includes("placeholder") && (
						<>
							{" "}
							Placeholder art means the image service was unreachable. Check{" "}
							<code>MALEO_IMAGE_URL</code> and re-render.
						</>
					)}
				</div>
			)}
			{origin === "browser" && rendering && onCancelBrowserExport && (
				<Button variant="secondary" onClick={onCancelBrowserExport}>
					Cancel export
				</Button>
			)}
			{status === "error" && job?.error && (
				<div style={{ fontSize: 12, color: "var(--err)", lineHeight: 1.5 }}>{job.error}</div>
			)}
		</div>
	);
}
