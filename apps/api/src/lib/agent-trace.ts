/* Durable traceability for the chat agent.
 *
 * The orchestrator's per-step events (tool_call_started/completed, thinking
 * notes) live only in the in-memory AgentJob and are dropped ~30 min after the
 * run finishes. That makes it impossible to reconstruct "what the agent did and
 * why" after the fact — only the built storyboard survives.
 *
 * This module persists the AGENT'S ACTIONS (not just its output) to the durable
 * content_project_events table, and records researched sources as project
 * citations so they stay queryable after the research artifact churns. Citations
 * are kept out of content_references on purpose — see saveResearchSources.
 * Everything here is best-effort: a tracing failure must never abort or alter a
 * run. */
import { slidesOf, postsOf } from "../modules/agents/core/content-state.ts";
import { researchOf } from "../modules/agents/core/research-state.ts";
import { entriesOfUnknown } from "@maleo/shared";
import { recordContentProjectEvent, type ContentProjectEventRow } from "@maleo/db/events";
import {
	addProjectCitation,
	getProjectStyleLock,
	listProjectCitations,
	upsertProjectStyleLock,
} from "@maleo/db/project-children";
import { getContentProject } from "@maleo/db/project-detail";
import { readStoryboardDocument } from "@maleo/shared";
import type { AgentJob } from "../modules/agents/core/model.ts";

// Cap any value we persist as JSON so a long narration arg / page excerpt can't
// bloat an event row. Returns a structurally-trimmed copy, never throws.
const MAX_FIELD_CHARS = 4000;
function capValue(value: unknown, max = MAX_FIELD_CHARS): unknown {
	if (typeof value === "string")
		return value.length > max ? `${value.slice(0, max)}…[+${value.length - max}]` : value;
	if (Array.isArray(value)) return value.slice(0, 50).map((v) => capValue(v, max));
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of entriesOfUnknown(value)) out[k] = capValue(v, max);
		return out;
	}
	return value;
}

// One durable row per agent tool call: tool name, exact (capped) args, the
// result note, ok/error, and wall-clock duration. Actor = the chat agent, so the
// audit view can separate agent actions from operator actions.
export async function recordAgentToolEvent(
	job: AgentJob,
	input: {
		toolCallId: string;
		tool: string;
		args: Record<string, unknown>;
		note: string;
		ok: boolean;
		startedAt: number;
	},
): Promise<void> {
	try {
		await recordContentProjectEvent({
			project_id: job.projectId,
			actor_type: job.mcpActor ? "operator" : "agent",
			actor_id: job.mcpActor ? `mcp:${job.mcpActor}` : "chat-agent",
			kind: "agent.tool_call",
			summary: `${input.tool} — ${input.ok ? "ok" : "error"}`,
			payload_json: {
				// Stable id for the call; assets it produced reference it, so the trace can
				// nest "call → produced these". job_id is the run/message id so events group
				// into the user message that triggered them.
				tool_call_id: input.toolCallId,
				job_id: job.id,
				content_type: job.contentType,
				tool: input.tool,
				ok: input.ok,
				duration_ms: Math.max(0, Date.now() - input.startedAt),
				args: capValue(input.args),
				result: capValue(input.note),
			},
		});
	} catch {
		/* tracing is best-effort — never break a run */
	}
}

// Provenance for one generated asset: what produced it (tool_call_id), what it
// is, and the inputs that determined it (semantic prompt + model + clip ref). Lets
// the trace answer "why does this frame look like this / what made this audio".
export async function recordAssetProvenance(
	job: AgentJob,
	toolCallId: string,
	asset: {
		assetType: "image" | "audio" | "video";
		url: string;
		ref?: string;
		prompt?: string;
		model?: string;
		providerId?: string;
		durationSec?: number;
	},
): Promise<void> {
	try {
		await recordContentProjectEvent({
			project_id: job.projectId,
			actor_type: "agent",
			actor_id: "chat-agent",
			kind: "agent.asset",
			summary: `${asset.assetType} produced${asset.ref ? ` for ${asset.ref}` : ""}.`,
			payload_json: {
				tool_call_id: toolCallId,
				job_id: job.id,
				asset_type: asset.assetType,
				url: asset.url,
				ref: asset.ref ?? null,
				prompt: capValue(asset.prompt ?? null),
				model: asset.model ?? null,
				...(asset.providerId ? { provider_id: asset.providerId } : {}),
				...(asset.durationSec == null ? {} : { source_duration_sec: asset.durationSec }),
			},
		});
	} catch {
		/* best-effort */
	}
}

// A user-approval checkpoint (actor = operator, not agent). Separates "what the
// user signed off on" (plan v2, style, sources, render) from what the agent then
// changed — the core question codex flagged.
export async function recordApproval(
	job: AgentJob,
	target: string,
	detail?: Record<string, unknown>,
): Promise<void> {
	try {
		await recordContentProjectEvent({
			project_id: job.projectId,
			actor_type: "operator",
			actor_id: "dashboard",
			kind: "agent.approval",
			summary: `Approved ${target}.`,
			payload_json: { job_id: job.id, target, ...(detail ? { detail: capValue(detail) } : {}) },
		});
	} catch {
		/* best-effort */
	}
}

export async function recordPipelineCheckpoint(
	job: AgentJob,
	input: { label: string; status: "awaiting_input" | "done" | "rejected" | "needs_attention" },
): Promise<void> {
	try {
		await recordContentProjectEvent({
			project_id: job.projectId,
			actor_type: "agent",
			actor_id: "chat-agent",
			kind: "agent.pipeline_checkpoint",
			summary:
				input.status === "awaiting_input"
					? `Pipeline awaiting approval for ${input.label}.`
					: `Pipeline ${input.status} for ${input.label}.`,
			payload_json: {
				job_id: job.id,
				content_type: job.contentType,
				label: input.label,
				status: input.status,
				job: {
					id: job.id,
					projectId: job.projectId,
					contentType: job.contentType,
					status: job.status,
					run: job.run ?? null,
					pendingQuestion: job.pendingQuestion ?? null,
					scenes: job.scenes,
					slides: slidesOf(job),
					posts: postsOf(job),
					textOverlays: job.textOverlays,
					infographicOverlays: job.infographicOverlays,
					videoOverlays: job.videoOverlays,
					audioOverlays: job.audioOverlays,
					characters: job.characters,
					artifacts: job.artifacts,
					error: job.error ?? null,
					aspect: job.aspect,
					brief: job.brief,
					styleImageUrl: job.styleImageUrl ?? null,
					projectRefIds: job.projectRefIds ?? null,
					visualStyle: job.visualStyle ?? null,
					research: researchOf(job) ?? null,
					startedAt: job.startedAt,
					audience: job.audience ?? null,
					targetDurationSec: job.targetDurationSec ?? null,
					slideCount: job.slideCount ?? null,
					platform: job.platform ?? null,
					thread: job.thread ?? null,
					voiceProvider: job.voiceProvider ?? null,
					voice: job.voice ?? null,
					language: job.language ?? null,
					style: job.style ?? null,
					styleName: job.styleName ?? null,
					timelineTemplate: job.timelineTemplate ?? null,
					clientClips: job.clientClips ?? null,
					clientCaptionSet: job.clientCaptionSet ?? null,
					generatedCaptionSources: job.generatedCaptionSources ?? null,
				},
			},
		});
	} catch {
		/* best-effort */
	}
}

// Session boundary markers — let the audit trail show when a chat run started
// (with the instruction) and how it ended (status + how many tools it ran),
// surviving the in-memory job's 30-min expiry.
export async function recordAgentSessionEvent(
	job: AgentJob,
	phase: "started" | "ended",
	instruction?: string,
): Promise<void> {
	try {
		const toolCalls = job.events.filter((e) => e.kind === "tool_call_completed").length;
		await recordContentProjectEvent({
			project_id: job.projectId,
			actor_type: "agent",
			actor_id: "chat-agent",
			kind: `agent.session_${phase}`,
			summary:
				phase === "started"
					? "Chat run started."
					: `Chat run ${job.status} after ${toolCalls} tool call(s).`,
			payload_json: {
				job_id: job.id,
				content_type: job.contentType,
				status: job.status,
				...(phase === "started"
					? { instruction: capValue(instruction ?? "") }
					: { tool_calls: toolCalls, error: job.error ?? null }),
			},
		});
	} catch {
		/* best-effort */
	}
}

// Per-job memo of source urls already written as references, so the frequent
// research-artifact refresh (fired on every read_web_page) doesn't re-insert
// duplicates. Seeded once from the project's existing agent-origin references so
// re-runs of the same project don't duplicate across jobs either.
const savedSourceUrls = new Map<string, Set<string>>();

async function seenUrlsFor(job: AgentJob): Promise<Set<string>> {
	let set = savedSourceUrls.get(job.id);
	if (set) return set;
	set = new Set<string>();
	try {
		// Cited sources live in project_citation. They were briefly readable as
		// content_references rows with origin='research'; that table is gone.
		for (const c of await listProjectCitations(job.projectId)) if (c.url) set.add(c.url);
	} catch {
		/* best-effort seed */
	}
	savedSourceUrls.set(job.id, set);
	return set;
}

// Persist the agent's researched sources as project citations. Makes every cited
// source durable and queryable instead of a value buried in the research_bundle
// artifact — so a "Sources" panel can list them and they survive artifact churn.
//
// Citations deliberately do NOT live in content_references. Stored there (as
// kind="research") they entered the castable reference library: projectRoster
// picked them up and a cited webpage could bind as a subject reference at
// generation time.
export async function saveResearchSources(job: AgentJob): Promise<void> {
	// An MCP read changes no project state: its sources go back to the client only.
	if (job.mcpActor) return;
	const research = researchOf(job);
	const sources = research?.sources;
	if (!sources?.length) return;
	const seen = await seenUrlsFor(job);
	for (const s of sources) {
		if (!s.url || seen.has(s.url)) continue;
		seen.add(s.url);
		try {
			await addProjectCitation({
				project_id: job.projectId,
				url: s.url,
				title: s.title || s.url,
				excerpt:
					typeof s.excerpt === "string"
						? s.excerpt.length > MAX_FIELD_CHARS
							? s.excerpt.slice(0, MAX_FIELD_CHARS)
							: s.excerpt
						: null,
				topic: research?.topic ?? job.brief ?? null,
				job_id: job.id,
			});
		} catch {
			/* best-effort — a failed citation insert must not abort research */
		}
	}
}

// Drop a job's memo once it's no longer needed (mirrors the orchestrator's job
// eviction) — prevents unbounded growth of the dedup map.
export function forgetAgentTrace(jobId: string): void {
	savedSourceUrls.delete(jobId);
}

// The generated style bible lives only in the in-memory job artifacts and dies
// with the job, so it is persisted per project: the bible text plus, once a
// style-board image is generated, its url. Survives restarts and lets a later job
// reuse the look instead of regenerating a divergent one.
//
// This used to be a content_references row with kind='style' and logical id
// "style-bible" — one per project, 6,270 of them, all sharing that id. A
// per-project generated plate is project state, not a reusable library entry, and
// living in the reference table made it look castable. It now has its own table.
export async function saveStyleBibleReference(
	job: AgentJob,
	visualStyle: string,
	imageUrl?: string,
): Promise<void> {
	const clean = visualStyle.trim();
	if (!clean) return;
	try {
		// Pass the url through as-is: upsertProjectStyleLock preserves an existing
		// image when given none, so text-only saves cannot clear the board image.
		await upsertProjectStyleLock({
			project_id: job.projectId,
			visual_style: clean,
			board_image_url: imageUrl?.trim() || null,
		});
	} catch {
		/* best-effort — a failed style-lock write must not abort the run */
	}
}

export async function loadStyleBibleReference(projectId: string): Promise<string | undefined> {
	try {
		return (await getProjectStyleLock(projectId))?.visual_style?.trim() || undefined;
	} catch {
		return undefined;
	}
}

/* A style bible the operator has EDITED, from the project's materials.
 *
 * The bible is generated from Visual materials but is editable, so it needs a
 * lock: without one the next regeneration silently discards a hand-written bible.
 * `locked` is stored rather than inferred from the text differing from the last
 * generated version, because that comparison cannot tell a deliberate re-type of
 * the generated text from an untouched one.
 *
 * Returns undefined when there is no bible or it is unlocked — an unlocked bible
 * is still the generator's to replace. */
export async function loadLockedStyleBible(projectId: string): Promise<string | undefined> {
	try {
		const latest = (await getContentProject(projectId))?.storyboards?.[0]?.storyboard_json;
		if (!latest || typeof latest !== "object") return undefined;
		const { styleBible } = readStoryboardDocument(latest).doc.materials;
		return styleBible.locked && styleBible.body.trim() ? styleBible.body.trim() : undefined;
	} catch {
		return undefined;
	}
}

export async function loadStyleBibleImage(projectId: string): Promise<string | undefined> {
	try {
		return (await getProjectStyleLock(projectId))?.board_image_url?.trim() || undefined;
	} catch {
		return undefined;
	}
}

export interface TraceAsset {
	assetType: string;
	url: string;
	ref: string | null;
	prompt: string | null;
	model: string | null;
}
export interface TraceToolCall {
	id: string;
	tool: string;
	ok: boolean;
	durationMs: number | null;
	args: unknown;
	result: string;
	at: number;
	assets: TraceAsset[];
}
export interface TraceApproval {
	target: string;
	at: number;
}

// One agent run = one user message + every tool call it triggered. This is the
// shape the Trace panel renders: "user said X → agent ran these tools → result".
export interface TraceSession {
	jobId: string;
	contentType: string | null;
	instruction: string;
	status: string | null;
	startedAt: number;
	endedAt: number | null;
	toolCalls: TraceToolCall[];
	approvals: TraceApproval[];
}

function payloadStr(payload: Record<string, unknown> | null, key: string): string | null {
	const v = payload?.[key];
	return typeof v === "string" ? v : null;
}

// Pure: fold the flat durable event rows into per-run sessions with nested tool
// calls, newest run first, tool calls chronological within a run. Events without
// a job_id (legacy / non-agent) are ignored. Safe to unit-test in isolation.
export function buildAgentTrace(events: ContentProjectEventRow[]): TraceSession[] {
	const byJob = new Map<string, TraceSession>();
	const order: string[] = [];
	// agent.asset events may be folded before their parent tool_call (DESC order),
	// so buffer them by tool_call_id and attach in a second pass.
	const assetsByCall = new Map<string, TraceAsset[]>();
	const ensure = (jobId: string, payload: Record<string, unknown> | null): TraceSession => {
		let s = byJob.get(jobId);
		if (!s) {
			s = {
				jobId,
				contentType: payloadStr(payload, "content_type"),
				instruction: "",
				status: null,
				startedAt: 0,
				endedAt: null,
				toolCalls: [],
				approvals: [],
			};
			byJob.set(jobId, s);
			order.push(jobId);
		}
		return s;
	};
	for (const ev of events) {
		const payload = ev.payload_json;
		const jobId = payloadStr(payload, "job_id");
		if (!jobId || !ev.kind.startsWith("agent.")) continue;
		const session = ensure(jobId, payload);
		if (session.contentType == null) session.contentType = payloadStr(payload, "content_type");
		if (ev.kind === "agent.session_started") {
			session.instruction = payloadStr(payload, "instruction") ?? session.instruction;
			session.startedAt = ev.created_at;
			// Don't clobber a terminal status from session_ended (events arrive DESC, so
			// the ended row is folded first) — the run's final status wins.
			session.status = session.status ?? payloadStr(payload, "status");
		} else if (ev.kind === "agent.session_ended") {
			session.endedAt = ev.created_at;
			session.status = payloadStr(payload, "status") ?? session.status;
		} else if (ev.kind === "agent.tool_call") {
			session.toolCalls.push({
				id: payloadStr(payload, "tool_call_id") ?? ev.id,
				tool: payloadStr(payload, "tool") ?? "unknown",
				ok: payload?.ok !== false,
				durationMs: typeof payload?.duration_ms === "number" ? payload.duration_ms : null,
				args: payload?.args ?? null,
				result: payloadStr(payload, "result") ?? "",
				at: ev.created_at,
				assets: [],
			});
		} else if (ev.kind === "agent.asset") {
			const tcid = payloadStr(payload, "tool_call_id");
			if (!tcid) continue;
			const asset: TraceAsset = {
				assetType: payloadStr(payload, "asset_type") ?? "image",
				url: payloadStr(payload, "url") ?? "",
				ref: payloadStr(payload, "ref"),
				prompt: payloadStr(payload, "prompt"),
				model: payloadStr(payload, "model"),
			};
			const arr = assetsByCall.get(tcid) ?? [];
			arr.push(asset);
			assetsByCall.set(tcid, arr);
		} else if (ev.kind === "agent.approval") {
			session.approvals.push({
				target: payloadStr(payload, "target") ?? "unknown",
				at: ev.created_at,
			});
		}
	}
	for (const s of byJob.values()) {
		for (const c of s.toolCalls) {
			const a = assetsByCall.get(c.id);
			if (a) c.assets = a.slice().reverse(); // events arrive DESC → restore creation order
		}
		s.toolCalls.sort((a, b) => a.at - b.at);
		s.approvals.sort((a, b) => a.at - b.at);
		if (!s.startedAt) s.startedAt = s.toolCalls[0]?.at ?? s.endedAt ?? 0;
	}
	// listContentProjectEvents returns created_at DESC, so first-seen job = newest.
	return order.map((j) => byJob.get(j)!).sort((a, b) => b.startedAt - a.startedAt);
}

/* Record what context a run was given.
 *
 * Provenance, not payload. The point is to be able to answer "why did the run
 * think that" months later without storing a second copy of the project: which
 * entities were in focus, how big each index was, how much memory came through,
 * and what was rejected on the way in.
 *
 * Deliberately counts and identifiers rather than content. Memory holds the
 * user's own words and the index holds their captions — replaying those into an
 * event log would spread user content into a table nobody thinks of as holding
 * it, for no diagnostic gain. Rejection reasons are fixed codes from the
 * compiler, never the offending value. */
export async function recordChatContextCapture(job: AgentJob, rejected: string[]): Promise<void> {
	const envelope = job.context;
	if (!envelope) return;
	try {
		await recordContentProjectEvent({
			project_id: job.projectId,
			actor_type: "agent",
			actor_id: "chat-agent",
			kind: "agent.context_captured",
			summary: `Context captured: ${envelope.focus.source} focus over ${envelope.focus.entities.length} entity(ies).`,
			payload_json: {
				job_id: job.id,
				content_type: job.contentType,
				captured_at: envelope.capturedAt,
				focus_source: envelope.focus.source,
				// Identities only — a stable id names an entity without quoting it.
				focus_entities: envelope.focus.entities.map((entity) => `${entity.kind}:${entity.id}`),
				index_sizes: {
					story: envelope.index.story.length,
					timeline: envelope.index.timeline.length,
					materials: envelope.index.materials.length,
					references: envelope.index.references.length,
					assets: envelope.index.assets.length,
				},
				fingerprinted_entities: envelope.fingerprints.length,
				memory_counts: {
					decisions: envelope.memory.decisions.length,
					unresolved: envelope.memory.unresolved.length,
					recent_turns: envelope.memory.recentTurns.length,
				},
				// Provenance of the memory that was used, so a surprising constraint
				// can be traced to the message that set it.
				memory_sources: envelope.memory.decisions.map((decision) => decision.provenance.messageId),
				pending_action: envelope.pendingAction?.actionId ?? null,
				rejected,
			},
		});
	} catch {
		/* tracing is best-effort; never fail a run for it */
	}
}
