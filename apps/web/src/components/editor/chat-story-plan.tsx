/* A story plan as the chat shows it: a record, never an editor.
 *
 * The plan is edited in the Storyboard view. Chat shows what the plan holds and
 * how far it got, and keeps the review material the Storyboard view does not
 * show — the arc and its advisory warnings, the explainer and POV contracts,
 * planned references, each section's job and sources — behind one closed
 * `Plan details` disclosure, as flat read-only rows.
 *
 * The newest plan may also offer `Open in Storyboard`; every other plan offers
 * nothing. Persisted plans replay from storage, so a shape older than this build
 * can arrive: everything is read defensively, because a plan that throws
 * unmounts the editor around it. */
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { SourceLinks } from "@components/research/source-links.tsx";
import { fmtMMSS } from "@models/core/measures.ts";
import { storyArcCoverageViolations } from "@maleo/shared";
import type { StorySectionMsg } from "@models/chat/chat-log.ts";
import type { StoryPlanPayload } from "@maleo/shared/agent-wire";

type StoryPlanArtifact = StoryPlanPayload;
const IN_FLIGHT = new Set(["pending", "voicing", "imaging"]);

function SectionRow({ index, section }: { index: number; section: StorySectionMsg }): JSX.Element {
	const status = section.status ?? "draft";
	const dur = section.audioDurationSec ?? section.estimatedDurationSec;
	const role = section.chapterFunction?.replace(/_/g, " ");
	const povRoles = Array.from(
		new Set(
			section.povShots
				?.map((shot) => shot.cameraRole)
				.filter((r): r is NonNullable<typeof r> => Boolean(r)) ?? [],
		),
	);
	return (
		<li className="fc-plan-row">
			<div className="fc-plan-row-h">
				<b>
					{index + 1}. {section.title}
				</b>
				<span className="fc-plan-row-meta">
					{status} · {section.audioDurationSec != null ? "" : "~"}
					{fmtMMSS(dur)}
				</span>
			</div>
			{role && (
				<div className="fc-output-muted">
					{role}
					{section.chapterObligation ? ` — ${section.chapterObligation}` : ""}
				</div>
			)}
			{section.teachingMove && (
				<div className="fc-output-muted">Teaching move: {section.teachingMove}</div>
			)}
			{section.povStage && (
				<div className="fc-output-muted">
					POV stage:{" "}
					{[
						section.povStage.stage,
						section.povStage.chapterFunction,
						section.povStage.survivalProblem,
					]
						.filter(Boolean)
						.join(" · ")}
				</div>
			)}
			{povRoles.length > 0 && (
				<div className="fc-output-muted">
					Shot roles: {povRoles.map((r) => r.replace(/_/g, " ")).join(", ")}
				</div>
			)}
			{section.needsDrafting && (
				<div className="fc-output-finding warn">
					Needs drafting — kept empty rather than filled with substitute text.
				</div>
			)}
			{section.sourceUrls && section.sourceUrls.length > 0 ? (
				<SourceLinks urls={section.sourceUrls} evidence={section.sourceEvidence} />
			) : section.factual && section.citationStatus === "unsupported" ? (
				<div className="fc-output-finding warn">Unsupported factual section</div>
			) : null}
			{section.error && <div className="fc-output-finding err">{section.error}</div>}
		</li>
	);
}

export function StoryPlanSummary({
	plan,
	onOpenStoryboard,
}: {
	plan: StoryPlanArtifact;
	onOpenStoryboard?: () => void;
}): JSX.Element {
	const sections = Array.isArray(plan.sections) ? plan.sections : [];
	const total = sections.reduce(
		(a, s) => a + (s.audioDurationSec ?? s.estimatedDurationSec ?? 0),
		0,
	);
	const ready = sections.filter((s) => s.status === "ready").length;
	const failed = sections.filter((s) => s.status === "failed").length;
	const inFlight = sections.filter((s) => IN_FLIGHT.has(s.status ?? "")).length;
	const counts = [
		ready && `${ready} ready`,
		inFlight && `${inFlight} in progress`,
		failed && `${failed} failed`,
	]
		.filter(Boolean)
		.join(" · ");
	const verification = plan.verificationStatus ?? (plan.unverified ? "unverified" : undefined);
	const coverage = plan.citationCoverage;
	const planKind = plan.planKind ?? "story";
	const explainer = plan.explainerContract;
	const pov = plan.povLifecycle;
	const references = Array.isArray(plan.plannedReferences) ? plan.plannedReferences : [];
	/* Advisory only: approval is never gated on narrative structure. */
	const arcWarnings = storyArcCoverageViolations({
		arc: plan.arc,
		sections: sections.map((section) => ({
			chapterFunction: section.chapterFunction,
			emotion: section.emotion,
			estimatedDurationSec: section.audioDurationSec ?? section.estimatedDurationSec,
			narration: section.narration,
		})),
		engagement: plan.engagement,
	});
	return (
		<div className="fc-output fc-plan-summary">
			<div className="fc-output-h">
				{Ic.film(ICON.xs)} Story plan · {sections.length} section{sections.length === 1 ? "" : "s"}{" "}
				· {fmtMMSS(total)} / {fmtMMSS(plan.targetSec)}
			</div>
			{counts && <div className="fc-output-muted">{counts}</div>}
			{verification && (
				<div className="fc-output-muted">
					{verification === "verified"
						? "Evidence matched"
						: verification === "partial"
							? "Evidence partially matched"
							: "Unverified draft — factual claims lack validated source evidence"}
					{coverage ? ` · ${coverage.verified}/${coverage.total} factual sections` : ""}
				</div>
			)}
			{/* Named here, answered above the composer. This card said "Asset
			 * generation is blocked" and offered nothing that could unblock it,
			 * in any run state; the open-blocker batch carries the remedy. */}
			{plan.needsDirection && (
				<div className="fc-output-finding warn">
					Sequence direction needs review
					{plan.directionErrors?.[0] ? `: ${plan.directionErrors[0]}` : "."} Answer it in Open
					blockers, above the composer.
				</div>
			)}
			<details className="fc-plan-details">
				<summary>Plan details</summary>
				<div className="fc-output-muted">
					Plan kind {planKind}
					{plan.arc ? ` · Arc ${plan.arc.replace(/_/g, " ")}` : ""}
					{plan.visualStyle ? " · Style locked" : ""}
				</div>
				{plan.frameDegraded && (
					<div className="fc-output-finding warn">
						Framing was defaulted — the framing stage failed, so the arc and language came from
						defaults rather than from the brief.
					</div>
				)}
				{arcWarnings.length > 0 && (
					<div className="fc-output-muted">
						Structure warnings — advisory, approval is not blocked:
						{arcWarnings.map((warning) => (
							<div key={`${warning.invariant}:${warning.detail}`}>
								{warning.invariant.replace(/_/g, " ")}: {warning.detail}
							</div>
						))}
					</div>
				)}
				{explainer && (
					<div className="fc-output-muted">
						<div>Learning objective: {explainer.learningObjective}</div>
						<div>Core question: {explainer.coreQuestion}</div>
						{explainer.conceptLadder?.length > 0 && (
							<div>Concept ladder: {explainer.conceptLadder.join(" → ")}</div>
						)}
					</div>
				)}
				{pov && (
					<div className="fc-output-muted">
						<div>POV role: {pov.viewerRole ?? "embodied viewer"}</div>
						{pov.bodyConstraints && <div>Body constraints: {pov.bodyConstraints}</div>}
						{(pov.worldSystem || pov.socialOrder) && (
							<div>
								System pressure: {[pov.worldSystem, pov.socialOrder].filter(Boolean).join(" · ")}
							</div>
						)}
						{pov.survivalGoal && <div>Survival goal: {pov.survivalGoal}</div>}
						{pov.endingFate && <div>Ending fate: {pov.endingFate}</div>}
					</div>
				)}
				{references.length > 0 && (
					<ul className="fc-plan-list">
						{references.map((ref) => (
							<li key={ref.key} className="fc-output-muted">
								{ref.label} · {ref.role}
								{ref.visibilityMode ? ` · ${ref.visibilityMode.replace(/_/g, " ")}` : ""} ·{" "}
								{ref.status}
								{ref.error && <span className="fc-output-finding err"> · {ref.error}</span>}
							</li>
						))}
					</ul>
				)}
				<ol className="fc-plan-list">
					{sections.map((section, i) => (
						<SectionRow key={section.id} index={i} section={section} />
					))}
				</ol>
			</details>
			{onOpenStoryboard && (
				<Button variant="secondary" size="sm" onClick={onOpenStoryboard}>
					Open in Storyboard
				</Button>
			)}
		</div>
	);
}
