/* The editor's image-provider picker.
 *
 * Reads a status projection of its own — the picker needs each provider's
 * reference support and model, which the capability list deliberately does not
 * carry. WRITES go through the one capability endpoint, so the editor's picker
 * and the settings surface cannot disagree about where the choice lives.
 */
import { get, put } from "./client.ts";
import type { ImageProviderStatus } from "@models/settings/image-provider.ts";

export function fetchImageProviderStatus(): Promise<ImageProviderStatus> {
	return get<ImageProviderStatus>("/api/settings/image-provider");
}

export async function saveImageProvider(providerId: string): Promise<ImageProviderStatus> {
	await put("/api/capabilities/image/provider", { provider_id: providerId || null });
	// Re-read: the selection endpoint answers what was selected, not the richer
	// status this picker renders.
	return fetchImageProviderStatus();
}
