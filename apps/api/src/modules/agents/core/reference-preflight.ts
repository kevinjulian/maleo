/* Selected references must be attached before any image is generated.
 *
 * A generation lock names entity ids; the project roster (`project_reference`)
 * is what makes them renderable. When the two disagreed, the resolver dropped
 * the id and the run pushed an `assistant_text` event saying so — after the
 * images had already been generated from a cast that was missing the reference
 * the operator chose. The warning was true and useless: it arrived behind the
 * wrong pictures, buried in job events.
 *
 * So the check moves in front of the provider call, and it blocks. Two steps,
 * in this order:
 *
 *  1. Reconcile. Projects created before the lock and the roster were written
 *     together can hold drift that is nobody's mistake. Attach what is
 *     attachable rather than blocking a project the operator never broke.
 *  2. Block on what is left. An id naming a deleted entity, or one from another
 *     workspace, cannot be rendered by anything and never will be.
 *
 * A subject-cap drop is deliberately NOT blocking. It is a declared limit doing
 * its job, not a broken selection, and it stays a report. */
import { getContentProject } from "@maleo/db/project-detail";
import {
	getReferenceEntity,
	listProjectReferences,
	reconcileProjectReferenceLocks,
} from "@maleo/db/references";
import { readStoryboardDocument } from "@maleo/shared";
import type { AgentJob } from "./model.ts";

/** A scene-selected id that cannot be rendered, and why. */
export interface UnresolvedReference {
	entityId: string;
	reason: "not_attached" | "unknown_entity" | "cross_workspace";
	/** The scene that selected it. Null only for historical callers. */
	sceneKey: string | null;
}

export interface ReferencePreflight {
	ok: boolean;
	unresolved: UnresolvedReference[];
	/** Ids the reconciliation pass repaired. Reported so a silent auto-attach
	 *  does not look like the drift never happened. */
	reconciled: string[];
}

/** Thrown at the resolver, so no image path can reach a provider around the
 *  run-level preflight by calling the resolver directly. */
export class UnresolvedReferenceError extends Error {
	readonly unresolved: readonly string[];
	constructor(unresolved: readonly string[], sceneKey: string) {
		super(
			`Cannot generate "${sceneKey}": ${unresolved.length === 1 ? "1 reference is" : `${unresolved.length} references are`} selected but not attached to this project — ${unresolved.join(", ")}. Attach them in References, or remove them from the selection.`,
		);
		this.name = "UnresolvedReferenceError";
		this.unresolved = unresolved;
	}
}

async function lockIdsFromDocument(projectId: string): Promise<string[]> {
	const latest = (await getContentProject(projectId))?.storyboards?.[0]?.storyboard_json;
	if (!latest || typeof latest !== "object") return [];
	return [...readStoryboardDocument(latest).doc.projectReferences.entityIds];
}

/* Repair a project's drifted lock, then say what is still unrenderable.
 *
 * The reconciliation is scoped to one project rather than run as a boot
 * migration: it is idempotent and cheap, it repairs exactly the project about
 * to generate, and it cannot leave a deployment half-migrated. */
export async function preflightProjectReferences(job: AgentJob): Promise<ReferencePreflight> {
	const projectId = job.projectId;
	if (!projectId) return { ok: true, unresolved: [], reconciled: [] };

	const reconciled = (
		await reconcileProjectReferenceLocks({
			project_id: projectId,
			readLock: lockIdsFromDocument,
		})
	).flatMap((entry) => entry.attached);

	const project = await getContentProject(projectId);
	const workspace = project?.project.workspace ?? null;
	const roster = new Set(
		(await listProjectReferences(projectId, { sceneKey: null })).map((row) => row.id),
	);

	const unresolved: UnresolvedReference[] = [];
	const seen = new Set<string>();
	const check = async (entityId: string, sceneKey: string | null): Promise<void> => {
		const id = entityId?.trim();
		if (!id || roster.has(id)) return;
		const key = `${sceneKey ?? ""}:${id}`;
		if (seen.has(key)) return;
		seen.add(key);
		// Separate a lock that is merely unattached from one that names something
		// this workspace can never attach. The operator's next action differs:
		// attach it, versus remove it from the selection. Read the entity table
		// directly — the roster deliberately cannot see other workspaces, so it
		// cannot tell "gone" from "someone else's".
		const entity = await getReferenceEntity(id);
		const reason: UnresolvedReference["reason"] = !entity
			? "unknown_entity"
			: workspace && entity.workspace !== workspace
				? "cross_workspace"
				: "not_attached";
		unresolved.push({ entityId: id, reason, sceneKey });
	};

	for (const scene of job.scenes ?? []) {
		for (const id of scene.refIds ?? []) await check(id, scene.sceneKey ?? null);
	}

	return { ok: unresolved.length === 0, unresolved, reconciled };
}

/** One line per unresolved id, for the run's trace and the chat outcome. */
export function describeUnresolvedReferences(unresolved: readonly UnresolvedReference[]): string {
	// `satisfies` rather than an annotation: exhaustiveness is still checked
	// against the reason union, and the literal keys survive for the lookup below.
	const reason = {
		not_attached: "selected but not attached to this project",
		unknown_entity: "no longer exists in this workspace",
		cross_workspace: "belongs to another workspace",
	} satisfies Record<UnresolvedReference["reason"], string>;
	const lines = unresolved.map((entry) => {
		const where = entry.sceneKey ? ` (scene ${entry.sceneKey})` : "";
		return `- ${entry.entityId}${where} — ${reason[entry.reason]}`;
	});
	return [
		`Generation stopped before any image was made: ${unresolved.length === 1 ? "1 selected reference cannot" : `${unresolved.length} selected references cannot`} be rendered.`,
		...lines,
		"Attach them in References, or remove them from the selection, then run again.",
	].join("\n");
}

/** Record the block on the job and produce the message the caller reports. */
export function blockOnUnresolvedReferences(job: AgentJob, preflight: ReferencePreflight): string {
	const message = describeUnresolvedReferences(preflight.unresolved);
	job.events.push({ kind: "error", message });
	return message;
}
