import type { Page } from "@playwright/test";
import templates from "./fixtures/agent-templates.json" with { type: "json" };

const user = {
	id: "fixture-user",
	email: "fixture@example.com",
	name: "Fixture",
	role: "instance_owner",
	suspended: false,
	created_at: "2026-08-01T00:00:00Z",
	workspaces: [{ name: "alpha", role: "owner", sole_owner: true }],
};
const member = {
	id: "user-2",
	email: "member@example.com",
	name: "Member",
	role: "member",
	suspended: false,
	created_at: "2026-08-02T00:00:00Z",
	workspaces: [{ name: "alpha", role: "member", sole_owner: false }],
};
const workspace = {
	name: "alpha",
	display_name: "Alpha Studio",
	status: "active",
	description: "Editorial workspace",
	project_count: 1,
	created_at: 1785690000000,
	last_activity: 1785776400000,
	members: [
		{ user_id: "fixture-user", email: "fixture@example.com", name: "Fixture", role: "owner" },
		{ user_id: "user-2", email: "member@example.com", name: "Member", role: "member" },
	],
	invitations: [],
};
const project = {
	id: "project-1",
	workspace: "alpha",
	title: "Brand story",
	type: "video",
	status: "draft",
	created_at: 1,
	updated_at: 2,
};

export async function mockAdmin(page: Page): Promise<void> {
	await page.route("**/api/admin/**", async (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname.slice("/api/admin".length);
		const q = (url.searchParams.get("q") ?? "").toLowerCase();
		const filter = <
			T extends {
				id?: string;
				email?: string;
				name?: string;
				title?: string;
				display_name?: string;
			},
		>(
			items: T[],
		) => items.filter((item) => JSON.stringify(item).toLowerCase().includes(q));
		const response =
			path === "/agent-templates"
				? templates
				: path === "/users"
					? { items: filter([user, member]), total: filter([user, member]).length }
					: path === "/users/fixture-user"
						? { item: user }
						: path === "/users/user-2"
							? { item: member }
							: path === "/workspaces"
								? { items: filter([workspace]), total: filter([workspace]).length }
								: path === "/workspaces/alpha"
									? { item: workspace }
									: path === "/workspaces/alpha/delete-impact"
										? {
												item: {
													workspace: "alpha",
													affected_accounts: 2,
													losing_access: [{ id: "user-2", email: "member@example.com" }],
													project_count: 1,
													in_flight_runs: 0,
													final_workspace: false,
												},
											}
										: path === "/projects"
											? { items: filter([project]), total: filter([project]).length }
											: path === "/projects/project-1"
												? { item: project }
												: path === "/authentication"
													? {
															policy: {
																stored: "invitation_only",
																effective: "invitation_only",
																source: "stored",
															},
														}
													: path === "/audit"
														? {
																items: [
																	{
																		id: "audit-1",
																		actor_id: user.id,
																		action: "membership.grant",
																		target_type: "user",
																		target_id: member.id,
																		outcome: "success",
																		reason: "alpha",
																		created_at: 1785776400000,
																	},
																],
																total: 1,
															}
														: null;
		if (!response) return route.fulfill({ status: 404, json: { error: "not_found" } });
		return route.fulfill({ json: response });
	});
}
