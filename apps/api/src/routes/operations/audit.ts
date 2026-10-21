import { textOf } from "@maleo/shared";
/* Audit / activity-feed summarization for the dashboard /audit route.
 *
 * Extracted from operations.ts: maps a raw workspace activity event into a typed
 * AuditEntry (category, severity, actor role, source, human title/summary). Pure
 * functions over event records — no I/O. */

type AuditCategory =
	| "thinking"
	| "pipeline"
	| "review"
	| "publish"
	| "metrics"
	| "operator"
	| "runtime";

type AuditSeverity = "info" | "ok" | "warn" | "critical";

export interface AuditEntry {
	id: string;
	workspace: string;
	ts: number;
	kind: string;
	cycle_id?: string;
	actor: string;
	category: AuditCategory;
	severity: AuditSeverity;
	actor_role: "workspace" | "operator" | "system";
	title: string;
	summary: string;
	target?: string | null;
	source: "web" | "api" | "cron";
	note?: string | null;
	payload: Record<string, unknown>;
}

function categoryOf(kind: string): AuditCategory {
	switch (kind) {
		case "thought":
			return "thinking";
		case "validate":
		case "approve_request":
		case "approve_result":
			return "review";
		case "post":
			return "publish";
		case "metric":
			return "metrics";
		case "directive_consumed":
			return "operator";
		case "pipeline_stage":
		case "stage_complete":
			return "pipeline";
		default:
			return "runtime";
	}
}

function actorOf(workspace: string, event: Record<string, unknown>): string {
	const kind = typeof event.kind === "string" ? event.kind : "unknown";
	if (kind === "directive_consumed") return "operator";
	if (kind === "cycle_error") return "system";
	if (kind === "approve_result" || kind === "approve_request") return "operator";
	if (kind === "mood_shift") {
		const source = typeof event.source === "string" ? event.source : "";
		if (source === "dashboard" || source === "cli") return "operator";
	}
	return workspace;
}

function actorRoleOf(actor: string): "workspace" | "operator" | "system" {
	if (actor === "operator") return "operator";
	if (actor === "system") return "system";
	return "workspace";
}

function sourceOf(actor: string, kind: string): "web" | "api" | "cron" {
	if (actor === "operator") return "web";
	if (actor === "system") return "cron";
	if (kind === "post" || kind === "metric") return "api";
	return "cron";
}

function severityOf(event: Record<string, unknown>): AuditSeverity {
	const kind = typeof event.kind === "string" ? event.kind : "unknown";
	if (kind === "cycle_error") return "critical";
	if (kind === "validate") return event.pass === false ? "warn" : "ok";
	if (kind === "approve_result") return event.approved === false ? "warn" : "ok";
	if (kind === "post") return event.ok === false ? "critical" : "ok";
	return "info";
}

export function summarizeActivity(
	workspace: string,
	event: Record<string, unknown>,
): Omit<AuditEntry, "id" | "workspace" | "ts" | "payload"> {
	const kind = typeof event.kind === "string" ? event.kind : "unknown";
	const actor = actorOf(workspace, event);
	const actor_role = actorRoleOf(actor);
	const category = categoryOf(kind);
	const severity = severityOf(event);
	const source = sourceOf(actor, kind);
	switch (kind) {
		case "thought":
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title: `Planned ${textOf(event.action, "action")}`,
				summary:
					typeof event.reasoning === "string" ? event.reasoning : "Workspace generated a new plan.",
				target: typeof event.draft === "string" ? event.draft : null,
				note: null,
			};
		case "validate":
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title: event.pass === false ? "Validation flagged" : "Validation passed",
				summary:
					Array.isArray(event.violations) && event.violations.length > 0
						? event.violations.map((value) => String(value)).join(" | ")
						: event.pass === false
							? "One or more guardrails failed."
							: "No violations reported.",
				target: null,
				note: null,
			};
		case "approve_request":
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title: "Approval requested",
				summary: "Draft is waiting for operator review.",
				target: typeof event.draft_id === "string" ? event.draft_id : null,
				note: null,
			};
		case "approve_result":
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title: event.approved === false ? "Draft rejected" : "Draft approved",
				summary:
					[
						typeof event.reason === "string" ? event.reason : null,
						typeof event.reject_notes === "string" ? event.reject_notes : null,
						event.edited ? "Edited before approval." : null,
					]
						.filter(Boolean)
						.join(" ") || "Operator decision recorded.",
				target: null,
				note: typeof event.reject_notes === "string" ? event.reject_notes : null,
			};
		case "post":
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title:
					event.ok === false
						? `Publish failed on ${textOf(event.platform, "platform")}`
						: `Published to ${textOf(event.platform, "platform")}`,
				summary:
					event.ok === false
						? textOf(event.error, "Unknown publish error")
						: typeof event.content === "string"
							? event.content
							: "Post completed.",
				target:
					typeof event.platform_post_id === "string"
						? event.platform_post_id
						: typeof event.video_job_id === "string"
							? event.video_job_id
							: null,
				note: typeof event.error === "string" ? event.error : null,
			};
		case "metric":
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title: "Metrics refreshed",
				summary: `${textOf(event.likes, "0")} likes · ${textOf(event.replies, "0")} replies · ${textOf(event.views, "0")} views`,
				target: typeof event.post_id === "string" ? event.post_id : null,
				note: null,
			};
		case "directive_consumed":
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title: "Directive consumed",
				summary: typeof event.content === "string" ? event.content : "Operator directive applied.",
				target: null,
				note: null,
			};
		case "mood_shift":
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title: "Mood shifted",
				summary: `${textOf(event.prev_mood, "unset")} -> ${textOf(event.mood, "unknown")} (${textOf(event.source, "unknown source")})`,
				target: null,
				note: null,
			};
		case "pipeline_stage":
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title: `Entered ${textOf(event.stage, "stage")}`,
				summary: typeof event.detail === "string" ? event.detail : "Pipeline stage started.",
				target: null,
				note: null,
			};
		case "stage_complete":
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title: `Completed ${textOf(event.stage, "stage")}`,
				summary: `${Math.round(Number(event.duration_ms ?? 0))} ms`,
				target: null,
				note: null,
			};
		case "cycle_start":
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title: "Cycle started",
				summary: "Workspace loop started a new run.",
				target: null,
				note: null,
			};
		case "cycle_end":
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title: "Cycle finished",
				summary: typeof event.outcome === "string" ? event.outcome : "Cycle completed.",
				target: null,
				note: null,
			};
		case "cycle_error":
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title: "Cycle error",
				summary: typeof event.error === "string" ? event.error : "Unhandled cycle error.",
				target: null,
				note: typeof event.error === "string" ? event.error : null,
			};
		default:
			return {
				kind,
				cycle_id: typeof event.cycle_id === "string" ? event.cycle_id : undefined,
				actor,
				actor_role,
				category,
				severity,
				source,
				title: kind.replace(/_/g, " "),
				summary: "Activity recorded.",
				target: null,
				note: null,
			};
	}
}
