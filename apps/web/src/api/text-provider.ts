import { get } from "./client.ts";
import type { TextProviderStatus } from "@models/settings/text-provider.ts";

export function fetchTextProviderStatus(refresh = false): Promise<TextProviderStatus> {
	return get(`/api/settings/text-provider${refresh ? "?refresh=true" : ""}`);
}
