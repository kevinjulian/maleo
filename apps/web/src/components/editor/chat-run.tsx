/* One run, flat: a status line, an Activity disclosure, and what it made.
 *
 * A run has no container. Its status line names the pipeline's stage and count,
 * its activity folds behind one disclosure, and its outputs sit directly in the
 * conversation, so a turn holds at most one bordered surface — the output.
 *
 * Only the frontier (the newest run, see `chatFrontier`) is given actions, and
 * it offers exactly the one its state calls for. Every other run is history:
 * rendered with no callbacks, so it cannot offer a control that would act on a
 * project it no longer describes. */
import type { JSX } from "react";
import { Button } from "@design-system/components/button.tsx";
import { ChatMessage, ToolCall } from "@design-system/patterns/chat.tsx";
import { GenerationCard, GenerationProgress } from "@design-system/patterns/generation.tsx";
import { RunActivity, ThinkingCard, WorkflowProgressCard } from "./chat-run-cards.tsx";
import { ChatOutput, type OutputActions } from "./chat-output-cards.tsx";
import type { ChatEntityRef, ChatProjectIndex } from "@maleo/shared";
import type { ChatRun, FrontierAction, RunPhase, RunProgress } from "@models/chat/chat-feed.ts";
import type { ChatLogMessage, ChatRunResult, ChatScopeChip } from "@models/chat/chat-log.ts";
import { labelFor } from "@models/chat/chat-composer.ts";

const PHASE_LABEL: Record<Exclude<RunPhase, "running">, string> = {
	awaiting: "Waiting for your decision",
	done: "Done",
	partial: "Partly done",
	failed: "Failed",
	stopped: "Stopped",
	interrupted: "Interrupted by a restart",
	held: "Not applied — conflicts with your edits",
	credit: "Paused — credit limit reached",
};

export function phaseLabel(progress: RunProgress): string {
	if (progress.phase === "running") return progress.stage ?? "Working";
	// Waiting names the step it waits at when the pipeline says which.
	if (progress.phase === "awaiting" && progress.stage) return `Waiting for you · ${progress.stage}`;
	if (progress.phase === "failed" && progress.error) return progress.error.title;
	return PHASE_LABEL[progress.phase];
}

/** The scope an instruction was sent with, kept closed beneath it. */
export function SubmittedContext({
	chips,
}: {
	chips: readonly ChatScopeChip[];
}): JSX.Element | null {
	if (!chips.length) return null;
	return (
		<details className="fc-sent-context">
			<summary>Context</summary>
			<span>{chips.map((chip) => chip.label).join(", ")}</span>
		</details>
	);
}

function ActivityItem({ message: m }: { message: ChatLogMessage }): JSX.Element {
	if (m.note) return <ThinkingCard note={m.note} />;
	if (m.workflow) return <WorkflowProgressCard plan={m.workflow} />;
	const tool = m.tool!;
	const status = tool.status === "running" ? "running" : tool.status === "error" ? "error" : "done";
	const note = tool.errorInfo ? `${tool.errorInfo.title}: ${tool.errorInfo.message}` : tool.note;
	return (
		<ToolCall
			name={tool.name.replace(/_/g, " ")}
			status={status}
			note={note}
			thumbs={tool.thumbs}
		/>
	);
}

function names(refs: readonly ChatEntityRef[], index: ChatProjectIndex, max = 3): string {
	const labels = refs.map((ref) => labelFor(ref, index));
	return labels.length > max
		? `${labels.slice(0, max).join(", ")} and ${labels.length - max} more`
		: labels.join(", ");
}

/** What the frontier result may do. */
export interface ResultActions {
	reveal?: (refs: ChatEntityRef[]) => void;
	undo?: () => void;
	canUndo: boolean;
	replan?: () => void;
}

export function RunResult({
	result,
	index,
	actions,
}: {
	result: ChatRunResult;
	index: ChatProjectIndex;
	actions?: ResultActions;
}): JSX.Element {
	if (result.status === "held") {
		const conflicts = result.conflicts ?? [];
		return (
			<div className="fc-result held" role={actions ? "alert" : undefined}>
				<div className="fc-result-h">Nothing was changed</div>
				<div className="fc-result-body">
					{result.reason === "refused" ? (
						"The timeline changed while this ran, so these edits no longer apply. Your version is kept."
					) : (
						<>
							{result.reason === "deleted" ? "You deleted " : "You edited "}
							{conflicts.length ? <b>{names(conflicts, index)}</b> : "part of this"} while this ran.
							Your version is kept.
						</>
					)}
				</div>
				{actions && (
					<div className="fc-result-actions">
						{actions.reveal && conflicts.length > 0 && (
							<Button variant="secondary" size="sm" onClick={() => actions.reveal!(conflicts)}>
								Review conflict
							</Button>
						)}
						{actions.replan && (
							<Button variant="secondary" size="sm" onClick={actions.replan}>
								Re-plan with my edits
							</Button>
						)}
					</div>
				)}
			</div>
		);
	}
	const touched = result.touched;
	const showChanges = actions?.reveal && touched.length > 0;
	const undo = actions?.canUndo && actions.undo;
	return (
		<div className="fc-result">
			<div className="fc-result-h">
				{touched.length
					? `Changed ${touched.length} item${touched.length === 1 ? "" : "s"}`
					: "No editor changes"}
			</div>
			{touched.length > 0 && <div className="fc-result-body">{names(touched, index)}</div>}
			{(showChanges || undo) && (
				<div className="fc-result-actions">
					{showChanges && (
						<Button variant="secondary" size="sm" onClick={() => actions!.reveal!(touched)}>
							Show changes
						</Button>
					)}
					{undo && (
						<Button variant="secondary" size="sm" onClick={undo}>
							Undo
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

/** What the frontier run may do. History gets none of it. */
export interface RunActions {
	stop?: () => void;
	resume?: () => void;
	retry: (text: string) => void;
	result: ResultActions;
	/** Absent unless the frontier's state leaves its outputs free to act. */
	output?: OutputActions;
}

export interface RunViewProps {
	run: ChatRun;
	progress: RunProgress;
	index: ChatProjectIndex;
	/** Present only for the frontier run: its one action and the callbacks. */
	frontier?: { action: FrontierAction | null; actions: RunActions };
	/** The decision pinned above the composer, which is not repeated here. */
	pinnedId?: number;
}

const RETRY_FAILED_SECTIONS = "Generate any remaining/failed sections.";

function StatusAction({
	action,
	instruction,
	actions,
}: {
	action: FrontierAction | null;
	instruction: string;
	actions: RunActions;
}): JSX.Element | null {
	if (action === "stop" && actions.stop)
		return (
			<Button variant="secondary" size="sm" onClick={actions.stop}>
				Stop
			</Button>
		);
	if (action === "resume" && actions.resume)
		return (
			<Button variant="secondary" size="sm" onClick={actions.resume}>
				Resume
			</Button>
		);
	if (action === "credits")
		return (
			<Button
				variant="secondary"
				size="sm"
				onClick={() => {
					window.location.href = "/settings/credits";
				}}
			>
				Open credits
			</Button>
		);
	if (action === "retry_failed")
		return (
			<Button variant="secondary" size="sm" onClick={() => actions.retry(RETRY_FAILED_SECTIONS)}>
				Retry failed sections
			</Button>
		);
	if (action === "retry")
		return (
			<Button variant="secondary" size="sm" onClick={() => actions.retry(instruction)}>
				Retry
			</Button>
		);
	return null;
}

export function RunView({ run, progress, index, frontier, pinnedId }: RunViewProps): JSX.Element {
	const { phase } = progress;
	const instruction = run.user?.text?.trim() ?? "";
	const hasOutput = run.outputs.length > 0 || run.answers.length > 0 || Boolean(run.result);
	const pastDecisions = run.decisions.filter((m) => m.id !== pinnedId);
	const actions = frontier?.actions;
	const resultActions =
		actions && (frontier.action === "result" || frontier.action === "held")
			? { ...actions.result, replan: instruction ? () => actions.retry(instruction) : undefined }
			: undefined;

	/* Colour is the state, and only the newest run can be acted on: history
	 * keeps its words and loses its colour. */
	const tone =
		phase === "running"
			? "active"
			: !frontier
				? undefined
				: phase === "partial" || phase === "credit" || phase === "interrupted"
					? "warn"
					: phase === "failed" || phase === "held"
						? "error"
						: undefined;

	return (
		<GenerationCard
			className="fc-run"
			phase={phase}
			busy={phase === "running"}
			frontier={Boolean(frontier)}
			status={
				<GenerationProgress
					label={phaseLabel(progress)}
					running={phase === "running"}
					count={progress.count ?? undefined}
					tone={tone}
					announce={Boolean(frontier)}
					action={
						frontier && actions ? (
							<StatusAction action={frontier.action} instruction={instruction} actions={actions} />
						) : undefined
					}
				/>
			}
		>
			{run.activity.length > 0 && (
				<RunActivity
					messages={run.activity}
					hasOutput={hasOutput}
					running={phase === "running"}
					render={(m) => <ActivityItem key={m.id} message={m} />}
				/>
			)}
			{run.outputs.map((m) => (
				<ChatOutput key={m.id} message={m} actions={actions?.output} />
			))}
			{pastDecisions.map((m) => (
				<div key={m.id} className="fc-run-note">
					{m.question!.answered ? "Decided" : "Superseded"}:{" "}
					{m.question!.batch?.intro ?? m.question!.question}
				</div>
			))}
			{run.replies.map((m) => (
				<ChatMessage key={m.id} speaker="user">
					{m.text}
				</ChatMessage>
			))}
			{phase === "partial" && (
				<div className="fc-run-note" role="note">
					{progress.readySections} section{progress.readySections === 1 ? "" : "s"} completed and
					kept. {progress.failedSections} failed{frontier ? " — retry regenerates only those" : ""}.
				</div>
			)}
			{run.result && <RunResult result={run.result} index={index} actions={resultActions} />}
		</GenerationCard>
	);
}
