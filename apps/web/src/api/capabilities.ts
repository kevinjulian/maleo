/* The provider settings surface's requests.
 *
 * One list endpoint and one selection endpoint for every capability, which is
 * what lets the surface be generic. The three per-service endpoints this
 * replaces are why there were three cards, three hooks and three status shapes. */
import { del, get, post, put } from "./client.ts";
import type {
	CapabilityView,
	ProviderConfigView,
	ProviderTestResult,
} from "@models/settings/capability-views.ts";

export function fetchCapabilities(): Promise<{ capabilities: CapabilityView[] }> {
	return get<{ capabilities: CapabilityView[] }>("/api/capabilities");
}

export function activateProvider(
	capability: string,
	providerId: string | null,
): Promise<{ ok: boolean; active_provider_id: string | null }> {
	return put(`/api/capabilities/${encodeURIComponent(capability)}/provider`, {
		provider_id: providerId,
	});
}

export function fetchProviderConfig(providerId: string): Promise<ProviderConfigView> {
	return get<ProviderConfigView>(`/api/providers/${encodeURIComponent(providerId)}/config`);
}

/** Blank values are omitted by the caller: an empty field means "leave it alone". */
export function saveProviderConfig(
	providerId: string,
	values: Record<string, string>,
): Promise<{ ok: boolean; written: string[] }> {
	return put(`/api/providers/${encodeURIComponent(providerId)}/config`, { values });
}

export function clearProviderField(providerId: string, key: string): Promise<{ ok: boolean }> {
	return del(`/api/providers/${encodeURIComponent(providerId)}/config/${encodeURIComponent(key)}`);
}

/** Probe a candidate configuration. Persists nothing, whatever the result. */
export function testProviderConfig(
	providerId: string,
	values: Record<string, string>,
): Promise<ProviderTestResult> {
	return post<ProviderTestResult>(`/api/providers/${encodeURIComponent(providerId)}/test`, {
		values,
	});
}

export interface SecurityStatus {
	master_key: {
		state: "ready" | "absent" | "changed" | "uninitialized";
		rotationPending: boolean;
		fingerprint: string | null;
		/** Where the key in force came from. */
		source: "env" | "file" | "generated" | null;
		/** Where a generated key is kept. */
		path: string;
	};
	/** Stored keys an environment variable is currently overriding. */
	shadowed: string[];
	/** Present only when the key cannot open what is stored. */
	unreadable?: { secretCount: number };
}

export function fetchSecurityStatus(): Promise<SecurityStatus> {
	return get<SecurityStatus>("/api/security");
}

/** Abandon a rotation that cannot be completed, keeping the key in force. */
export function cancelKeyRotation(): Promise<{ ok: boolean }> {
	return post<{ ok: boolean }>("/api/security/master-key/cancel-rotation", {});
}

/** Discard storage no available key can open, so credentials can be entered again. */
export function resetSecretStorage(): Promise<{ ok: boolean; removed: number }> {
	return post<{ ok: boolean; removed: number }>("/api/security/master-key/reset", {});
}

export interface RotationResult {
	/* Returned ONCE, and only when the operator has to place the key themselves —
	 * i.e. when it lives in the environment, which this app cannot write. */
	key?: string;
	pending: boolean;
	source: "env" | "file" | "generated";
	status: SecurityStatus["master_key"];
}

export function rotateMasterKey(): Promise<RotationResult> {
	return post<RotationResult>("/api/security/master-key/rotate", {});
}

/** Run a provider's bespoke setup action (local captions installs whisper.cpp). */
export function runProviderInstall(providerId: string): Promise<{ ok: boolean; ready: boolean }> {
	return post<{ ok: boolean; ready: boolean }>(
		`/api/providers/${encodeURIComponent(providerId)}/install`,
		{},
	);
}
