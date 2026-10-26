import type { TextOverlay } from "@maleo/shared";

/** Persisted clips are authoritative. Loading scene metadata cannot recreate deleted clips. */
export function migrateSceneTextOverlays(
	_scenes: unknown,
	existing: TextOverlay[],
	_migrationVersion: number | null,
): TextOverlay[] {
	return existing;
}
