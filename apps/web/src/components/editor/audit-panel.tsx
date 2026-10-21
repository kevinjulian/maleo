/* Maleo — Content-First Create · Audit panel.
 *
 * Replaces the old "why + fix" handles and the raw tool Trace with the two views
 * a creator actually audits: WHAT changed (per run) and WHAT it produced (asset
 * ledger with one-click regenerate). Both read the same durable trace endpoint
 * (GET /api/operations/projects/:id/trace), so nothing new is persisted — the
 * data was already recorded, we just surface it usefully. */
import { entriesOfUnknown } from "@maleo/shared";
import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { get, post } from "@api/client.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { TabsRoot, TabsList, TabsTab, TabsPanel } from "@design-system/components/tabs.tsx";
import { Button } from "@design-system/components/button.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import "./audit-panel.css";

interface TraceAsset {
	assetType: string;
	url: string;
	ref: string | null;
	prompt: string | null;
	model: string | null;
}
interface TraceToolCall {
	id: string;
	tool: string;
	ok: boolean;
	durationMs: number | null;
	args: unknown;
	result: string;
	at: number;
	assets: TraceAsset[];
}
interface TraceApproval {
	target: string;
	at: number;
}
interface TraceSession {
	jobId: string;
	contentType: string | null;
	instruction: string;
	status: string | null;
	startedAt: number;
	endedAt: number | null;
	toolCalls: TraceToolCall[];
	approvals: TraceApproval[];
	outcomeContract?: { objective: string; targetDurationSec?: number } | null;
	outcomeEvaluation?: {
		status: "passed" | "needs_attention" | "failed";
		score: number;
		findings: Array<{
			id: string;
			severity: "pass" | "info" | "warning" | "blocker";
			message: string;
			fix?: { command: string };
		}>;
	} | null;
}
interface DurableArtifact {
	id: string;
	logical_ref: string | null;
	parent_artifact_id: string | null;
	public_url: string | null;
	version: number;
	active: number;
	created_at: number;
}
interface QualityReport {
	runCount: number;
	outcomePassPct: number | null;
	briefCoveragePct: number | null;
	visualContinuityPct: number | null;
	beatsPerPlannedShot: number | null;
	visualBeatReusePct: number | null;
	firstUsableOutputMs: number | null;
	targetedFixSuccessPct: number | null;
	renderPassPct: number | null;
	durationErrorPct: number | null;
	unsupportedClaimCount: number;
	totalToolCost: number;
	totalGenerationTimeMs: number;
	feedback: { accept: number; regenerate: number; rollback: number };
}

// A single current asset (latest generation for a given ref), enriched with the
// run + tool that produced it so the ledger can show provenance and regenerate.
interface LedgerEntry {
	key: string;
	ref: string;
	assetType: string;
	url: string;
	prompt: string | null;
	model: string | null;
	at: number;
	tool: string;
	version?: number;
	active?: boolean;
}

function fmtTime(ms: number): string {
	if (!ms) return "—";
	try {
		return new Date(ms).toLocaleString();
	} catch {
		return "—";
	}
}
function fmtDur(ms: number | null): string {
	if (ms == null) return "";
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
function argSummary(args: unknown): string {
	if (args == null || typeof args !== "object") return "";
	return entriesOfUnknown(args)
		.slice(0, 4)
		.map(
			([k, v]) =>
				`${k}: ${typeof v === "string" ? (v.length > 40 ? `${v.slice(0, 40)}…` : v) : JSON.stringify(v)}`,
		)
		.join(", ");
}

// Turn an asset ref into a natural-language regenerate command the chat agent
// understands. "scene:3" → regenerate that scene; anything else regenerates by
// its label so the same tool re-runs.
function regenCommand(ref: string): string {
	const scene = ref.match(/^scene:(\d+)$/);
	if (scene) return `Regenerate the visual for scene ${scene[1]}.`;
	const plate = ref.match(/^transition-plate:(.+)$/);
	if (plate) return `Regenerate the transition plate ${plate[1]}.`;
	return `Regenerate ${ref}.`;
}

// Collapse all trace assets to the latest per ref — the ledger shows the current
// state of each output, not every historical attempt.
function buildLedger(sessions: TraceSession[], artifacts: DurableArtifact[]): LedgerEntry[] {
	const durableByUrl = new Map(
		artifacts
			.filter((artifact) => artifact.public_url)
			.map((artifact) => [artifact.public_url!, artifact]),
	);
	const byRef = new Map<string, LedgerEntry>();
	for (const s of sessions) {
		for (const call of s.toolCalls) {
			for (const a of call.assets) {
				const ref = a.ref ?? `${a.assetType}:${a.url.slice(-8)}`;
				const prev = byRef.get(ref);
				if (!prev || call.at >= prev.at) {
					const durable = durableByUrl.get(a.url);
					byRef.set(ref, {
						key: ref,
						ref: durable?.logical_ref ?? ref,
						assetType: a.assetType,
						url: a.url,
						prompt: a.prompt,
						model: a.model,
						at: call.at,
						tool: call.tool,
						version: durable?.version,
						active: durable ? durable.active === 1 : undefined,
					});
				}
			}
		}
	}
	for (const artifact of artifacts) {
		if (!artifact.public_url || artifact.active !== 1) continue;
		const ref = artifact.logical_ref ?? `artifact:${artifact.id}`;
		if ([...byRef.values()].some((entry) => entry.url === artifact.public_url)) continue;
		byRef.set(ref, {
			key: ref,
			ref,
			assetType: "image",
			url: artifact.public_url,
			prompt: null,
			model: null,
			at: artifact.created_at,
			tool: "generation",
			version: artifact.version,
			active: true,
		});
	}
	return [...byRef.values()].sort((x, y) => y.at - x.at);
}

function LedgerCard({
	entry,
	onRun,
	onFeedback,
	busy,
}: {
	entry: LedgerEntry;
	onRun: (t: string) => void;
	onFeedback: (action: "regenerate", id?: string) => void;
	busy?: boolean;
}): JSX.Element {
	return (
		<div className="fc-sbtable fc-audit-asset">
			<div className="fc-audit-asset-row">
				{entry.assetType === "image" ? (
					<img
						src={entry.url}
						alt={entry.ref}
						width={48}
						height={48}
						className="fc-audit-asset-thumb"
					/>
				) : (
					<span className="fc-audit-asset-ic">
						{entry.assetType === "audio" ? Ic.mic(ICON.md) : Ic.film(ICON.md)}
					</span>
				)}
				<div className="fc-audit-asset-meta">
					<div className="fc-audit-asset-h">
						<b className="fc-audit-strong">{entry.ref}</b>
						<a href={entry.url} target="_blank" rel="noopener noreferrer" className="fc-audit-link">
							open ↗
						</a>
					</div>
					{entry.prompt && (
						<span className="fc-audit-prompt" title={entry.prompt}>
							{entry.prompt}
						</span>
					)}
					<span className="fc-audit-sub">
						{entry.model ?? entry.tool}
						{entry.version ? ` · v${entry.version}${entry.active ? " current" : ""}` : ""} ·{" "}
						{fmtTime(entry.at)}
					</span>
				</div>
			</div>
			<Button
				variant="secondary"
				size="sm"
				className="fc-audit-fit"
				disabled={busy}
				onClick={() => {
					onFeedback("regenerate", entry.key);
					onRun(regenCommand(entry.ref));
				}}
			>
				{Ic.regen(ICON.xs)} Regenerate
			</Button>
		</div>
	);
}

function ToolRow({ call }: { call: TraceToolCall }): JSX.Element {
	const [open, setOpen] = useState(false);
	const args = argSummary(call.args);
	return (
		<div className="fc-audit-tool">
			<Button
				variant="secondary"
				size="sm"
				className="fc-audit-tool-h"
				onClick={() => setOpen(!open)}
				title="Show args + result"
			>
				<span className={call.ok ? "fc-audit-ok" : "fc-audit-err"}>
					{call.ok ? Ic.check(ICON.xs) : Ic.x(ICON.xs)}
				</span>
				<b className="fc-audit-strong">{call.tool.replace(/_/g, " ")}</b>
				{args && <span className="fc-audit-args">{args}</span>}
				{call.assets.length > 0 && (
					<span className="fc-audit-count">
						{call.assets.length} asset{call.assets.length === 1 ? "" : "s"}
					</span>
				)}
				<span className="fc-audit-dur">{fmtDur(call.durationMs)}</span>
			</Button>
			{open && (
				<div className="fc-audit-tool-body">
					{call.result && (
						<div>
							<b>result:</b> {call.result}
						</div>
					)}
					<div className="fc-audit-faint">{fmtTime(call.at)}</div>
				</div>
			)}
		</div>
	);
}

// One run = one entry in the Changes view: the instruction, its outcome, and the
// tool calls it triggered folded underneath.
function ChangeCard({
	session,
	onRun,
	onAccept,
	busy,
}: {
	session: TraceSession;
	onRun: (text: string) => void;
	onAccept: (runId: string) => void;
	busy?: boolean;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const failed = session.toolCalls.filter((t) => !t.ok).length;
	const assetCount = session.toolCalls.reduce((n, t) => n + t.assets.length, 0);
	return (
		<div className="fc-sbtable fc-audit-change">
			<button className="fc-sbtable-h fc-audit-change-h" onClick={() => setOpen(!open)}>
				{Ic.layers(ICON.xs)}
				<span className="fc-audit-change-msg">{session.instruction || "(no message)"}</span>
				<span className="fc-audit-meta">
					{assetCount > 0 && (
						<span className="fc-audit-info">
							{assetCount} asset{assetCount === 1 ? "" : "s"} ·{" "}
						</span>
					)}
					{session.toolCalls.length} call{session.toolCalls.length === 1 ? "" : "s"}
					{failed > 0 && <span className="fc-audit-err"> · {failed} failed</span>}
				</span>
			</button>
			{session.outcomeEvaluation && (
				<div className="fc-audit-outcome">
					<div
						className={`fc-audit-outcome-h ${session.outcomeEvaluation.status === "passed" ? "fc-audit-ok" : "fc-audit-err"}`}
					>
						<b>Outcome {session.outcomeEvaluation.score}/100</b>
						<span>{session.outcomeContract?.objective}</span>
					</div>
					{session.outcomeEvaluation.findings
						.filter((finding) => finding.severity === "blocker" || finding.severity === "warning")
						.map((finding) => (
							<div key={finding.id} className="fc-audit-finding">
								<span
									className={`fc-audit-finding-msg ${finding.severity === "blocker" ? "fc-audit-err" : "fc-audit-muted"}`}
								>
									{finding.message}
								</span>
								{finding.fix && (
									<Button
										variant="secondary"
										size="sm"
										disabled={busy}
										onClick={() => onRun(finding.fix!.command)}
									>
										{Ic.regen(ICON.xs)} Fix
									</Button>
								)}
							</div>
						))}
					{session.outcomeEvaluation.status === "passed" && (
						<Button
							variant="secondary"
							size="sm"
							className="fc-audit-fit"
							disabled={busy}
							onClick={() => onAccept(session.jobId)}
						>
							{Ic.check(ICON.xs)} Accept outcome
						</Button>
					)}
				</div>
			)}
			{open && (
				<>
					<div className="fc-audit-status">
						{session.status ?? "?"} · {fmtTime(session.startedAt)}
					</div>
					{session.approvals.length > 0 && (
						<div className="fc-audit-approvals">
							{session.approvals.map((a, idx) => (
								<span
									key={a.target + idx}
									className="fc-audit-approval"
									title={`Approved ${fmtTime(a.at)}`}
								>
									{Ic.check(ICON.xs)} approved {a.target}
								</span>
							))}
						</div>
					)}
					{session.toolCalls.length === 0 ? (
						<div className="fc-audit-none">No tool calls.</div>
					) : (
						session.toolCalls.map((c) => <ToolRow key={c.id} call={c} />)
					)}
				</>
			)}
		</div>
	);
}

type Tab = "changes" | "assets";

export function AuditPanel({
	projectId,
	onRun,
	busy,
	onClose,
}: {
	projectId: string;
	onRun: (text: string) => void;
	busy?: boolean;
	onClose: () => void;
}): JSX.Element {
	const [sessions, setSessions] = useState<TraceSession[] | null>(null);
	const [artifacts, setArtifacts] = useState<DurableArtifact[]>([]);
	const [quality, setQuality] = useState<QualityReport | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<Tab>("changes");

	const load = (): void => {
		setError(null);
		setSessions(null);
		get<{ sessions: TraceSession[]; artifacts: DurableArtifact[]; quality: QualityReport }>(
			`/api/operations/projects/${projectId}/trace`,
		)
			.then((r) => {
				setSessions(r.sessions);
				setArtifacts(r.artifacts ?? []);
				setQuality(r.quality);
			})
			.catch((e) => setError(e instanceof Error ? e.message : "failed to load audit"));
	};
	useEffect(load, [projectId]);

	const ledger = useMemo(
		() => (sessions ? buildLedger(sessions, artifacts) : []),
		[sessions, artifacts],
	);
	const feedback = (action: "accept" | "regenerate" | "rollback", id?: string): void => {
		void post(`/api/operations/projects/${projectId}/feedback`, {
			action,
			...(action === "accept" ? { run_id: id } : { target_ref: id }),
		})
			.then(load)
			.catch((e) => setError(e instanceof Error ? e.message : "failed to record feedback"));
	};

	return (
		<>
			<PanelHeader
				title="Audit"
				actions={
					<IconButton size="xs" onClick={load} title="Refresh">
						{Ic.regen(ICON.md)}
					</IconButton>
				}
				onClose={onClose}
				closeLabel="Close audit"
			/>
			<div className="fc-chat">
				{quality && (
					<div className="fc-audit-quality">
						{[
							["Outcome", quality.outcomePassPct == null ? "—" : `${quality.outcomePassPct}%`],
							// One authored visual per measured narration beat is the contract: 1.00 beats
							// per planned shot, 0% adjacent reuse. Absent (—) when this project has no
							// generated story sections, which is not the same as passing.
							[
								"Beats / shot",
								quality.beatsPerPlannedShot == null ? "—" : quality.beatsPerPlannedShot.toFixed(2),
							],
							[
								"Beat reuse",
								quality.visualBeatReusePct == null ? "—" : `${quality.visualBeatReusePct}%`,
							],
							[
								"Continuity",
								quality.visualContinuityPct == null ? "—" : `${quality.visualContinuityPct}%`,
							],
							["Render pass", quality.renderPassPct == null ? "—" : `${quality.renderPassPct}%`],
							[
								"Duration error",
								quality.durationErrorPct == null ? "—" : `${quality.durationErrorPct}%`,
							],
							[
								"First output",
								quality.firstUsableOutputMs == null ? "—" : fmtDur(quality.firstUsableOutputMs),
							],
						].map(([label, value]) => (
							<div key={label} className="fc-audit-tile">
								<span className="fc-audit-tile-label">{label}</span>
								<b className="fc-audit-tile-value">{value}</b>
							</div>
						))}
					</div>
				)}
				<TabsRoot
					value={tab}
					onValueChange={(value) => setTab(value === "assets" ? "assets" : "changes")}
				>
					<TabsList className="fc-audit-tabs" aria-label="Audit view">
						<TabsTab value="changes">{Ic.layers(ICON.xs)} Changes</TabsTab>
						<TabsTab value="assets">
							{Ic.image(ICON.xs)} Assets{ledger.length ? ` · ${ledger.length}` : ""}
						</TabsTab>
					</TabsList>
					<div className="fc-chat-log fc-audit-log">
						{error && <div className="fc-audit-msg-err">{error}</div>}
						{!error && sessions == null && <div className="fc-audit-msg">Loading audit…</div>}
						{sessions != null && sessions.length === 0 && (
							<div className="fc-audit-msg">
								No agent activity yet. Run a command to populate the audit.
							</div>
						)}
						<TabsPanel value="changes">
							{sessions?.map((s) => (
								<ChangeCard
									key={s.jobId}
									session={s}
									onRun={onRun}
									onAccept={(runId) => feedback("accept", runId)}
									busy={busy}
								/>
							))}
						</TabsPanel>
						<TabsPanel value="assets">
							{ledger.length === 0
								? sessions != null && <div className="fc-audit-msg">No generated assets yet.</div>
								: ledger.map((e) => (
										<LedgerCard
											key={e.key}
											entry={e}
											onRun={onRun}
											onFeedback={(action, id) => feedback(action, id)}
											busy={busy}
										/>
									))}
						</TabsPanel>
					</div>
				</TabsRoot>
			</div>
		</>
	);
}

export default AuditPanel;
