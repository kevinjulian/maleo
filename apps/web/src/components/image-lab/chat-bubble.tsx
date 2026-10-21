/* One generation in the feed: its image, or what is happening instead.
 *
 * This module also OWNS image-lab.css, which is why the import is here rather
 * than on the page. The sheet describes the lab surface — feed, composer, tool
 * row — and that surface now has two pages on it: the image lab and the speech
 * lab, which reuses the same chrome so the two read as one product. A sheet
 * imported by both pages has no owner, and `bun run check:layers` refuses it for
 * a good reason: nothing fails when the last importer is deleted, so the styles
 * simply vanish. Both labs import this module (for `Spinner`, and for
 * `ChatBubble`), so one import here reaches both.
 */
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import type { ChatMessage } from "@models/image-lab/image-job.ts";
import "./image-lab.css";

export function Spinner({ size = 18 }: { size?: number }): JSX.Element {
	return <span className="imagelab-spinner">{Ic.loader(size)}</span>;
}

export function ChatBubble({
	msg,
	onReuse,
}: {
	msg: ChatMessage;
	onReuse: (p: string) => void;
}): JSX.Element {
	const isGenerating = msg.status === "generating";
	const isFailed = msg.status === "failed";

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				maxWidth: 520,
				margin: "0 auto",
				width: "100%",
			}}
		>
			{/* Image area */}
			<div
				style={{
					width: "100%",
					borderRadius: 12,
					overflow: "hidden",
					background: "var(--bg)",
					border: "1px solid var(--border)",
					aspectRatio: msg.aspect === "16:9" ? "16/9" : msg.aspect === "9:16" ? "9/16" : "1/1",
					maxHeight: 480,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					position: "relative",
				}}
			>
				{msg.image_url ? (
					<a href={msg.image_url} target="_blank" rel="noreferrer" style={{ display: "contents" }}>
						<img
							src={msg.image_url}
							alt=""
							style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
						/>
					</a>
				) : isGenerating ? (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							gap: 12,
							color: "var(--muted)",
						}}
					>
						<Spinner size={28} />
						<span className="mono" style={{ fontSize: 12 }}>
							{msg.elapsed != null ? `${msg.elapsed}s` : "starting..."}
						</span>
					</div>
				) : isFailed ? (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							gap: 8,
							color: "var(--err)",
							padding: 20,
						}}
					>
						{Ic.alertCircle(ICON.xl)}
						<span style={{ fontSize: 12, textAlign: "center" }}>{msg.error ?? "Failed"}</span>
					</div>
				) : null}
			</div>

			{/* Prompt text + meta */}
			<div
				style={{
					width: "100%",
					marginTop: 8,
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
					gap: 8,
				}}
			>
				<div style={{ flex: 1, minWidth: 0 }}>
					<div
						style={{
							fontSize: 13,
							lineHeight: 1.5,
							color: "var(--fg)",
							display: "-webkit-box",
							WebkitLineClamp: 3,
							WebkitBoxOrient: "vertical",
							overflow: "hidden",
						}}
					>
						{msg.prompt}
					</div>
					<div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
						{new Date(msg.created_at).toLocaleTimeString()} · {msg.aspect}
						{msg.workspace && msg.workspace !== "default" ? ` · ${msg.workspace}` : ""}
					</div>
				</div>
				{msg.status === "done" && (
					<button
						onClick={() => onReuse(msg.prompt)}
						title="Reuse prompt"
						style={{
							all: "unset",
							cursor: "pointer",
							padding: 4,
							borderRadius: 4,
							color: "var(--muted)",
							flexShrink: 0,
							opacity: 0.6,
							transition: "opacity 120ms",
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.opacity = "1";
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.opacity = "0.6";
						}}
					>
						{Ic.repeat(ICON.sm)}
					</button>
				)}
			</div>
		</div>
	);
}
