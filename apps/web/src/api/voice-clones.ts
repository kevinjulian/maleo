/* The voice library's writes: creating a clone from a recording, and removing
 * one. Reading them is not here — a clone reaches a surface as an ordinary
 * entry in the voice catalogue, which is the whole point of a clone being a
 * voice rather than a second kind of thing.
 *
 * The active workspace rides on these paths through `scopedPath`, so no caller
 * passes a tenant and none can forget to. */
import { del, postForm } from "./client.ts";

export interface VoiceClone {
	id: string;
	workspace: string;
	providerId: string;
	label: string;
	lang: string;
	gender: "male" | "female" | null;
	refUrl: string;
	createdAt: number;
	updatedAt: number;
}

export interface CreateVoiceCloneInput {
	provider: string;
	label: string;
	audio: File;
	gender?: "male" | "female";
}

export function createVoiceClone(input: CreateVoiceCloneInput): Promise<VoiceClone> {
	const form = new FormData();
	form.set("provider", input.provider);
	form.set("label", input.label);
	if (input.gender) form.set("gender", input.gender);
	form.set("audio", input.audio);
	return postForm<VoiceClone>("/api/voice-clones", form);
}

export function deleteVoiceClone(id: string): Promise<{ ok: boolean }> {
	return del<{ ok: boolean }>(`/api/voice-clones/${encodeURIComponent(id)}`);
}
