/* The settings screen's requests. The view shapes stay with the screen that
 * renders them; this module owns the URLs and the client calls. */
import type { WriterStyle } from "@maleo/shared";
import { get, post, put } from "./client.ts";

export function fetchTtsStatus<T>(): Promise<T> {
	return get<T>("/api/tts/status");
}

export function fetchResearchStatus<T>(): Promise<{ status: T }> {
	return get<{ status: T }>("/api/settings/research-status");
}

export function fetchCaptionStatus<T>(): Promise<{ status: T }> {
	return get<{ status: T }>("/api/settings/captions-status");
}

export function setupLocalCaptions<T>(): Promise<{ status: T }> {
	return post<{ status: T }>("/api/settings/captions-setup", {});
}

export function fetchGlobalKeys<T>(): Promise<{ items: T[] }> {
	return get<{ items: T[] }>("/api/settings/global");
}

export function saveGlobalKeys(updates: Record<string, string>): Promise<void> {
	return put("/api/settings/global", { updates });
}

/** One writer style profile as the picker needs it: enough to choose between two
 *  of them without the client restating the library. */
export interface WriterStyleOption {
	key: WriterStyle;
	label: string;
	person: string;
	tense: string;
	sentenceRhythm: string;
}

export interface WriterStyleView {
	/** Null when the workspace has never chosen one, or stored a retired key. */
	selected: WriterStyle | null;
	options: WriterStyleOption[];
}

export function fetchWriterStyle(workspace: string): Promise<WriterStyleView> {
	return get<WriterStyleView>(
		`/api/settings/workspaces/${encodeURIComponent(workspace)}/writer-style`,
	);
}

/** `null` clears the selection — a real state meaning "narrate as before". */
export function saveWriterStyle(
	workspace: string,
	writerStyle: WriterStyle | null,
): Promise<{ ok: boolean; selected: WriterStyle | null }> {
	return put<{ ok: boolean; selected: WriterStyle | null }>(
		`/api/settings/workspaces/${encodeURIComponent(workspace)}/writer-style`,
		{ writerStyle },
	);
}
