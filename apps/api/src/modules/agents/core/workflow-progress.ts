import type {
	AgentJob,
	WorkflowPlan,
	WorkflowPlanItem,
	WorkflowRoute,
	WorkflowStatus,
} from "./model.ts";

type ItemSeed = Omit<WorkflowPlanItem, "status"> & { status?: WorkflowStatus };

const ROUTE_TITLES = {
	plan_story: "Build story",
	edit_scene: "Edit timeline",
	react: "Agent workflow",
} satisfies Record<WorkflowRoute, string>;

export function emitWorkflowProgress(job: AgentJob, plan: WorkflowPlan): void {
	job.events.push({ kind: "workflow_progress", plan });
}

export function makeWorkflowPlan(input: {
	id?: string;
	route: WorkflowRoute;
	title?: string;
	reason?: string;
	items: ItemSeed[];
}): WorkflowPlan {
	return {
		id: input.id ?? "active",
		route: input.route,
		title: input.title ?? ROUTE_TITLES[input.route],
		readonly: true,
		reason: input.reason,
		items: input.items.map((item) => ({ ...item, status: item.status ?? "pending" })),
	};
}

export function setWorkflowItem(
	plan: WorkflowPlan,
	id: string,
	status: WorkflowStatus,
	patch: Partial<WorkflowPlanItem> = {},
): WorkflowPlan {
	return {
		...plan,
		items: plan.items.map((item) => (item.id === id ? { ...item, ...patch, status } : item)),
	};
}
