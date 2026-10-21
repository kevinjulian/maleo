/* Content presets: named bundles of {style, refs, settings} with one default.
 *
 * The create flow seeds itself from the default, which is why the list carries
 * `defaultId` rather than making the caller ask twice. */
import { del, get, patch, post, put } from "./client.ts";
import type { ContentPreset, ContentPresetInput } from "@maleo/shared";
import { BASE } from "./base.ts";

/** Content presets: named bundles of {style, refs, settings} with one default.
 *  `defaultId` rides on the list so the create flow can seed without a second
 *  request. */
export interface ContentPresetList {
	items: ContentPreset[];
	defaultId: string | null;
}

export async function listContentPresets(): Promise<ContentPresetList> {
	return get<ContentPresetList>(`${BASE}/content-presets`);
}

/** Who draws from a preset, and who has drifted off it.
 *
 *  Derived server-side from stored provenance: counting the projects that record a
 *  preset as their supplier means reading every project's element sources, which a
 *  client cannot do. Read before a write that affects a shared record, and by the
 *  library's divergence view. */
export interface PresetUsage {
	using: number;
	diverged: number;
	/** The diverged projects, capped by the server. `diverged` is the true total. */
	projects: Array<{
		id: string;
		title: string;
		diverged: string[];
		divergedDetails?: Array<{ path: string; projectValue: unknown; defaulterValue: unknown }>;
	}>;
}

export async function getContentPresetUsage(id: string): Promise<PresetUsage> {
	return get<PresetUsage>(`${BASE}/content-presets/${encodeURIComponent(id)}/usage`);
}

export async function createContentPreset(input: ContentPresetInput): Promise<ContentPreset> {
	return (await post<{ item: ContentPreset }>(`${BASE}/content-presets`, input)).item;
}

export async function updateContentPreset(
	id: string,
	input: ContentPresetInput,
): Promise<ContentPreset> {
	return (
		await patch<{ item: ContentPreset }>(`${BASE}/content-presets/${encodeURIComponent(id)}`, input)
	).item;
}

export async function deleteContentPreset(id: string): Promise<void> {
	await del(`${BASE}/content-presets/${encodeURIComponent(id)}`);
}

export async function setDefaultContentPreset(id: string | null): Promise<string | null> {
	return (await put<{ defaultId: string | null }>(`${BASE}/content-presets/default`, { id }))
		.defaultId;
}

/** The default preset resolved for the create flow, or null when none set. */
export async function getDefaultContentPreset(): Promise<ContentPreset | null> {
	const { items, defaultId } = await listContentPresets();
	return defaultId ? (items.find((p) => p.id === defaultId) ?? null) : null;
}
