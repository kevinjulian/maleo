/* Reusable materials: named generation context (Story, Visual, Voice, Rules) a
 * project selects and a Project Preset names per group.
 *
 * Library-scoped rows, not project content — a project reads a material to seed a
 * group and never writes it back implicitly. Saving a project-local edit as a
 * reusable material is an explicit create/update from the editor.
 *
 * Materials are WORKSPACE-SCOPED, and the active workspace reaches them without
 * any of these functions naming it: `api/client.ts` carries it on every
 * `/api/operations` request. That is why the `workspace` argument each of these
 * used to take is gone — it was optional at every call site and passed by none,
 * which is precisely how a scoped surface silently widens to one tenant. */
import { del, get, patch, post } from "./client.ts";
import type { MaterialGroup, MaterialRecord, MaterialRecordInput } from "@maleo/shared";
import { BASE } from "./base.ts";

/** Every material, or just one group's. The group filter is server-side so the
 *  library's tabs do not each pull the whole list. */
function query(params: Record<string, string | undefined>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
	const encoded = search.toString();
	return encoded ? `?${encoded}` : "";
}

export async function listContentMaterials(group?: MaterialGroup): Promise<MaterialRecord[]> {
	return (await get<{ items: MaterialRecord[] }>(`${BASE}/content-materials${query({ group })}`))
		.items;
}

export async function createContentMaterial(input: MaterialRecordInput): Promise<MaterialRecord> {
	return (await post<{ item: MaterialRecord }>(`${BASE}/content-materials`, input)).item;
}

export async function updateContentMaterial(
	id: string,
	input: MaterialRecordInput,
): Promise<MaterialRecord> {
	return (
		await patch<{ item: MaterialRecord }>(
			`${BASE}/content-materials/${encodeURIComponent(id)}`,
			input,
		)
	).item;
}

export async function deleteContentMaterial(id: string): Promise<void> {
	await del(`${BASE}/content-materials/${encodeURIComponent(id)}`);
}
