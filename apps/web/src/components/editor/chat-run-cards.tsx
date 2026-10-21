/* A run's activity: working notes, workflow progress, and the disclosure that
 * folds them. Presentational only. */
import { useEffect, useId, useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";

/* A working note: the step's title and the summary the agent wrote for it.
 * Summaries only — the model's hidden reasoning never reaches the client. */
export function ThinkingCard({ note }: { note: NonNullable<ChatLogMessage["note"]> }): JSX.Element {
	const [tick, setTick] = useState(0);
	useEffect(() => {
		if (!note.running) return;
		const t = setInterval(() => setTick((n) => n + 1), 1000);
		return () => clearInterval(t);
	}, [note.running]);
	void tick; // re-render trigger
	const elapsed =
		note.running && note.startedAt
			? Math.max(0, Math.round((Date.now() - note.startedAt) / 1000))
			: note.elapsedSec;
	const body = note.body ?? "";
	return (
		<div className={`fc-note ${note.running ? "running" : ""}`}>
			<div className="fc-note-h">
				{note.running ? <span className="cv-spin" aria-hidden="true" /> : Ic.spark(ICON.xs)}
				<span>
					{note.title || "Step"} · {elapsed}s
				</span>
			</div>
			{body && <div className="fc-note-body">{body}</div>}
		</div>
	);
}

export function WorkflowProgressCard({
	plan,
}: {
	plan: NonNullable<ChatLogMessage["workflow"]>;
}): JSX.Element {
	const done = plan.items.filter(
		(item) => item.status === "done" || item.status === "skipped",
	).length;
	return (
		<div className="fc-workflow">
			<div className="fc-workflow-h">
				<span>
					{Ic.layers(ICON.xs)} {plan.title}
				</span>
				<span>
					{done}/{plan.items.length}
				</span>
			</div>
			{plan.reason && <div className="fc-workflow-reason">{plan.reason}</div>}
			<div className="fc-workflow-list">
				{plan.items.map((item) => (
					<div key={item.id} className={`fc-workflow-row ${item.status}`} title={item.reason}>
						<span className="fc-workflow-check">
							<input
								type="checkbox"
								checked={item.status === "done" || item.status === "skipped"}
								readOnly
								disabled
								aria-label={`${item.label}: ${item.status}`}
							/>
							{item.status === "running" && <span className="cv-spin" />}
						</span>
						<span className="fc-workflow-label">{item.label}</span>
						{item.tool && <span className="fc-workflow-tool">{item.tool.replace(/_/g, " ")}</span>}
					</div>
				))}
			</div>
		</div>
	);
}

/* A run's activity — working notes, tool calls, workflow progress — folded
 * under one explicit control. Open while the run works and has nothing to show;
 * closed once useful output lands, and reopenable. A manual toggle wins after
 * that, so the card never fights the reader. */
export function RunActivity({
	messages,
	hasOutput,
	running,
	render,
}: {
	messages: ChatLogMessage[];
	hasOutput: boolean;
	running: boolean;
	render: (m: ChatLogMessage) => JSX.Element;
}): JSX.Element {
	const [open, setOpen] = useState(running && !hasOutput);
	const [pinned, setPinned] = useState(false);
	const bodyId = useId();
	useEffect(() => {
		if (!pinned) setOpen(running && !hasOutput);
	}, [running, hasOutput, pinned]);
	const steps = messages.length;
	return (
		<div className={`fc-run-think ${running ? "running" : ""} ${open ? "open" : ""}`}>
			<button
				type="button"
				className="fc-run-think-h"
				aria-expanded={open}
				aria-controls={bodyId}
				onClick={() => {
					setPinned(true);
					setOpen((o) => !o);
				}}
			>
				<span className="fc-run-think-row">
					{running ? <span className="cv-spin" aria-hidden="true" /> : Ic.layers(ICON.xs)}
					<span className="fc-run-think-label">Activity</span>
					<span className="fc-run-think-toggle">{open ? "Hide activity" : "Show activity"}</span>
				</span>
				<span className="fc-run-think-meta">
					{steps} step{steps === 1 ? "" : "s"}
				</span>
			</button>
			{open && (
				<div id={bodyId} className="fc-run-think-body">
					{messages.map(render)}
				</div>
			)}
		</div>
	);
}
