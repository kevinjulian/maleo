/* The things a run produces, rendered: delivery checks, artifacts, research,
 * media, errors and credit state.
 *
 * Every output takes an optional `actions`. The frontier run passes them; history
 * passes nothing, and the same output renders as a record with no control that
 * could act on a project it no longer describes. Presentational only — every
 * action is a callback the chat panel owns. */
import { useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { AudioPreview } from "@design-system/components/audio-preview.tsx";
import { Button } from "@design-system/components/button.tsx";
import { StoryPlanSummary } from "./chat-story-plan.tsx";
import { fmtMMSS } from "@models/core/measures.ts";
import { domainOf } from "@models/core/source-url.ts";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import type { AgentErrorInfo } from "@maleo/shared/agent-errors";
import {
	knowledgeArtifact,
	mediaArtifact,
	payloadOfKind,
	researchBundleArtifact,
	storyboardTableArtifact,
	storyPlanArtifact,
	styleBibleArtifact,
} from "@maleo/shared";
import type { MediaPayload, ResearchBundlePayload } from "@maleo/shared/agent-wire";
import { GenerationError } from "@design-system/patterns/generation.tsx";
import { ChatMessage } from "@design-system/patterns/chat.tsx";
import {
	formatCreditClock,
	formatCreditPair,
	formatCredits,
	type CreditSummary,
} from "@api/credits.ts";

const fmtRange = (a: number, b: number): string => `${fmtMMSS(a)}–${fmtMMSS(b)}`;

/* Cited sources, one row each. Title and domain always shown; the excerpt opens
 * on request — a disclosure, not an action, so history keeps it. */
function ResearchCard({ bundle }: { bundle: ResearchBundlePayload }): JSX.Element {
	const [open, setOpen] = useState<number | null>(null);
	return (
		<div className="fc-output">
			<div className="fc-output-h">
				{Ic.layers(ICON.xs)} Research · {bundle.sources.length} source(s) · {bundle.topic}
			</div>
			{bundle.sources.length === 0 && <div className="fc-output-muted">No sources retrieved.</div>}
			{bundle.sources.map((s, i) => (
				<div key={s.url + i} className="fc-output-row">
					<button
						type="button"
						className="fc-output-disclose"
						aria-expanded={open === i}
						onClick={() => setOpen(open === i ? null : i)}
					>
						{i + 1}. {s.title}
					</button>
					<a
						href={s.url}
						target="_blank"
						rel="noopener noreferrer"
						className="fc-output-link"
						title={s.url}
					>
						{domainOf(s.url)} ↗
					</a>
					{open === i && s.excerpt && (
						<div className="fc-output-muted fc-output-full">{s.excerpt}</div>
					)}
				</div>
			))}
		</div>
	);
}

/* A run's error. The retry belongs to the run's status line, and only while the
 * run is the frontier, so this carries none. */
export function AgentErrorCard({ error }: { error: AgentErrorInfo }): JSX.Element {
	return (
		<GenerationError
			title={error.title}
			code={error.code}
			message={error.message}
			detail={error.technicalDetail ?? error.message}
		/>
	);
}

/* The delivery check as a record.
 *
 * Its blockers are no longer acted on here. A `Fix this` per finding belonged to
 * the run that reported it, so answering one started a run, turned this card into
 * history and left its siblings as dead text — and a run that failed rendered
 * every finding with no control at all. Blockers are now read from project state
 * and answered together in the pinned batch, which outlives any run. Warnings
 * stay here, where they always were: they are a record, not a decision. */
function OutcomeCard({
	outcome,
}: {
	outcome: NonNullable<ChatLogMessage["outcome"]>;
}): JSX.Element {
	const issues = outcome.findings.filter((finding) => finding.severity !== "pass");
	const blocked = outcome.metrics.blockerCount > 0;
	const verdict = blocked
		? `${outcome.metrics.blockerCount} blocker${outcome.metrics.blockerCount === 1 ? "" : "s"}`
		: outcome.metrics.warningCount
			? `${outcome.metrics.warningCount} warning${outcome.metrics.warningCount === 1 ? "" : "s"}`
			: "Ready";
	return (
		<div className="fc-output" role="status">
			<div className="fc-output-h">
				{Ic.info(ICON.xs)} Delivery check · {outcome.score}/100
				<span
					className={`fc-output-verdict${blocked ? " err" : outcome.metrics.warningCount ? " warn" : ""}`}
				>
					{verdict}
				</span>
			</div>
			{issues.map((finding) => (
				<div key={finding.id} className="fc-output-row">
					<div className={`fc-output-finding ${finding.severity === "blocker" ? "err" : "warn"}`}>
						{finding.message}
					</div>
				</div>
			))}
		</div>
	);
}

export function creditBlocked(summary: CreditSummary | null): "daily" | "rolling" | null {
	if (!summary?.enforcementEnabled) return null;
	if (summary.dailyRemainingCredits != null && summary.dailyRemainingCredits <= 0) return "daily";
	if (summary.rolling5hRemainingCredits != null && summary.rolling5hRemainingCredits <= 0)
		return "rolling";
	return null;
}

export function CreditMeter({ summary }: { summary: CreditSummary | null }): JSX.Element | null {
	if (!summary) return null;
	const dailyLimit = summary.policy.dailyLimitCredits ?? null;
	const rollingLimit = summary.policy.rolling5hLimitCredits ?? null;
	const dailyPct = dailyLimit ? summary.dailyUsedCredits / dailyLimit : 0;
	const rollingPct = rollingLimit ? summary.rolling5hUsedCredits / rollingLimit : 0;
	const state = creditBlocked(summary)
		? "blocked"
		: dailyPct >= 0.8 || rollingPct >= 0.8
			? "low"
			: "ok";
	// A healthy balance is not news; credits show only once they constrain work.
	if (state === "ok") return null;
	return (
		<div className={`fc-creditmeter ${state}`} title="Credit limits">
			<span>{Ic.spark(ICON.xs)} Credits</span>
			<b>Daily {formatCreditPair(summary.dailyRemainingCredits, dailyLimit)}</b>
			<b>5h {formatCreditPair(summary.rolling5hRemainingCredits, rollingLimit)}</b>
			<em>5h refresh {formatCreditClock(summary.rolling5hRefreshAt)}</em>
		</div>
	);
}

export function CreditLimitCard({
	summary,
	onCommand,
}: {
	summary: CreditSummary;
	onCommand: (text: string) => void;
}): JSX.Element {
	const blocker = creditBlocked(summary);
	const dailyBlocked = blocker === "daily";
	const refreshAt = dailyBlocked ? summary.dailyRefreshAt : summary.rolling5hRefreshAt;
	return (
		<div className="fc-creditblock" role="status">
			<div className="fc-creditblock-h">{Ic.info(ICON.sm)} Generation paused</div>
			<div className="fc-creditblock-body">
				{dailyBlocked ? "Daily limit reached." : "5-hour limit reached."}
			</div>
			<div className="fc-creditblock-grid">
				<span>Daily left</span>
				<b>{formatCredits(summary.dailyRemainingCredits)}</b>
				<span>5h left</span>
				<b>{formatCredits(summary.rolling5hRemainingCredits)}</b>
				<span>Refresh at</span>
				<b>{formatCreditClock(refreshAt)}</b>
			</div>
			<div className="fc-creditblock-actions">
				<button
					type="button"
					className="fc-approval-reject"
					onClick={() =>
						onCommand("Storyboard only. Do not generate images, voiceover, or render assets.")
					}
				>
					Storyboard only
				</button>
				<button
					type="button"
					className="fc-approval-reject"
					onClick={() =>
						onCommand("Use existing assets only. Do not generate new images or voiceover.")
					}
				>
					Use existing assets
				</button>
				<button
					type="button"
					className="fc-approval-approve"
					onClick={() => {
						window.location.href = "/settings/credits";
					}}
				>
					Open credits
				</button>
			</div>
		</div>
	);
}

export function approvalLabel(label: string, value: string): string {
	const v = value.toLowerCase().trim();
	if (v === "approve") return "Approve & generate";
	if (v === "approve all") return "Approve & auto-continue";
	if (v === "reject") return "Revise plan";
	if (v === "research again") return "Find more sources";
	return label;
}

/** What a frontier output may do. History passes none of it. */
export interface OutputActions {
	busy: boolean;
	onSend: (text: string) => void;
	onSeek?: (sec: number) => void;
	onJump?: (ref: NonNullable<ChatLogMessage["ref"]>) => void;
	onAddArtifact?: (media: MediaPayload) => void;
	/** Switch the editor to the Storyboard view, where the plan is edited. */
	onOpenStoryboard?: () => void;
}

/** One output a run produced. Null for a message that renders nothing. */
export function ChatOutput({
	message: m,
	actions,
}: {
	message: ChatLogMessage;
	actions?: OutputActions;
}): JSX.Element | null {
	const seek = actions?.onSeek;
	if (m.outcome) return <OutcomeCard outcome={m.outcome} />;
	if (m.error) return <AgentErrorCard error={m.error} />;
	const a = m.artifact;
	const plan = payloadOfKind(a, storyPlanArtifact);
	if (plan) return <StoryPlanSummary plan={plan} onOpenStoryboard={actions?.onOpenStoryboard} />;
	const table = payloadOfKind(a, storyboardTableArtifact);
	if (table) {
		return (
			<div className="fc-output fc-sbtable">
				<div className="fc-output-h">
					{Ic.layers(ICON.xs)} {table.title}
				</div>
				<table>
					<thead>
						<tr>
							<th>Timestamp</th>
							<th>Content</th>
						</tr>
					</thead>
					<tbody>
						{table.rows.map((r, i) => (
							<tr
								key={i}
								className={`fc-sbrow ${r.kind}${seek ? " seekable" : ""}`}
								onClick={seek ? () => seek(r.startSec) : undefined}
								title={seek ? "Seek to this point" : undefined}
							>
								<td className="fc-sbrow-t">{fmtRange(r.startSec, r.endSec)}</td>
								<td className="fc-sbrow-c">{r.content}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}
	const research = payloadOfKind(a, researchBundleArtifact);
	if (research) return <ResearchCard bundle={research} />;
	const style = payloadOfKind(a, styleBibleArtifact);
	if (style) {
		return (
			<div className="fc-output">
				<div className="fc-output-h">
					{Ic.image(ICON.xs)} Style bible · {style.source}
				</div>
				<div className="fc-output-muted">{style.visualStyle}</div>
				{style.refUrl && (
					<a
						href={style.refUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="fc-output-link"
					>
						style ref ↗
					</a>
				)}
			</div>
		);
	}
	const knowledge = payloadOfKind(a, knowledgeArtifact);
	if (knowledge) {
		return (
			<div className="fc-output fc-knowledge">
				<div className="fc-output-h">{Ic.layers(ICON.xs)} Knowledge Base</div>
				<div className="fc-knowledge-title">{knowledge.title}</div>
				<div className="fc-knowledge-body">{knowledge.body}</div>
			</div>
		);
	}
	const media = payloadOfKind(a, mediaArtifact);
	if (media) {
		const onAdd = actions?.onAddArtifact;
		return (
			<div className="fc-output fc-artifact">
				<div className="fc-output-h">
					{media.mediaType === "audio"
						? Ic.mic(ICON.xs)
						: media.mediaType === "video"
							? Ic.film(ICON.xs)
							: Ic.image(ICON.xs)}{" "}
					{media.label ?? media.mediaType}
				</div>
				{media.mediaType === "audio" && (
					<AudioPreview className="fc-music-audio" src={media.url} label={media.label ?? "audio"} />
				)}
				{media.mediaType === "video" && (
					<video className="fc-artifact-media" src={media.url} muted loop controls playsInline />
				)}
				{media.mediaType === "image" && (
					<img className="fc-artifact-media" src={media.url} alt={media.label ?? "image"} />
				)}
				{onAdd && (
					<Button variant="secondary" size="sm" onClick={() => onAdd(media)}>
						{Ic.plus(ICON.xs)} Add to timeline
					</Button>
				)}
			</div>
		);
	}
	if (!m.text) return null;
	const speaker = m.role === "user" ? "user" : "assistant";
	const onJump = m.ref ? actions?.onJump : undefined;
	return (
		<ChatMessage
			speaker={speaker}
			action={onJump ? { label: "Jump to clip", onPress: () => onJump(m.ref!) } : undefined}
		>
			{m.text}
		</ChatMessage>
	);
}
