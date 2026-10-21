/* The workspace registry — what the switcher lists, and how a new workspace is
 * added. The tenant an operator is working IN is client state (see the active
 * workspace store); this module only reads and writes the registry itself. */
import type { WorkspaceSummary } from "@maleo/shared";
import { get, post } from "./client.ts";

export type { WorkspaceSummary };

export function fetchWorkspaces(): Promise<{ items: WorkspaceSummary[] }> {
	return get<{ items: WorkspaceSummary[] }>("/api/workspaces");
}

export function createWorkspace(name: string): Promise<{ item: WorkspaceSummary }> {
	return post<{ item: WorkspaceSummary }>("/api/workspaces", { name });
}
