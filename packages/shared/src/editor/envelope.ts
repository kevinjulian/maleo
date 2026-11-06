/* The portable project envelope (`p1-envelope-inspector`): the type every client
 * exchanges, and admission through the shared engine. The engine owns the rules
 * (`crates/editor-core/src/envelope.rs`); this module only types its boundary. A
 * caller admits an envelope before it replaces stored state with it. */
import type { Engine } from "./engine.ts";
import { z } from "zod";
import type { EditScope } from "./scope.ts";
import type { StoryboardHead } from "./storyboard-scope.ts";

export const ENVELOPE_FORMAT = "maleo.project";
export const ENVELOPE_FORMAT_VERSION = 1;

export type EnvelopeRefusalReason =
	| "wrong-format"
	| "unsupported-format-version"
	| "unsupported-schema"
	| "invalid-field"
	| "missing-manifest-entry"
	| "device-url"
	| "unpreservable-field";

export interface EnvelopeRefusal {
	reason: EnvelopeRefusalReason;
	/** The field that caused the refusal, as `scope.doc.clips[0].video.url`. */
	path: string;
	message: string;
}

/** One asset-manifest entry, as `GET /projects/:id/asset-manifest` lists it. */
export interface EnvelopeManifestEntry {
	id: string;
	url: string;
	state: "ready" | "pending" | "failed" | "external";
	origin?: "import" | "managed" | "external";
	kind?: string;
	contentType?: string;
	size?: number;
	sha256?: string;
	label?: string;
	used?: boolean;
}

export interface ProjectEnvelope {
	format: typeof ENVELOPE_FORMAT;
	formatVersion: number;
	compatibility: { schemaVersion: 2; minReaderVersion: number };
	project: { id: string; type: "video" | "image" | "text"; title: string };
	scope: EditScope;
	/** Stored-document fields outside the scope, carried unchanged. */
	head: StoryboardHead;
	manifest: EnvelopeManifestEntry[];
}

export type EnvelopeAdmission =
	| { ok: true; envelope: ProjectEnvelope }
	| { ok: false; refusal: EnvelopeRefusal };

const RefusalSchema = z.object({
	reason: z.enum([
		"wrong-format",
		"unsupported-format-version",
		"unsupported-schema",
		"invalid-field",
		"missing-manifest-entry",
		"device-url",
		"unpreservable-field",
	]),
	path: z.string(),
	message: z.string(),
});

/** The engine's refusal; text that is not one reads as an invalid field. */
function refusalOf(text: string): EnvelopeRefusal {
	try {
		const parsed = RefusalSchema.safeParse(JSON.parse(text));
		if (parsed.success) return parsed.data;
	} catch {
		/* Not JSON: reported as an invalid field below. */
	}
	return { reason: "invalid-field", path: "", message: text };
}

/** Admit `json` (envelope text). The admitted envelope is the engine's serialization of it. */
export function admitEnvelope(engine: Engine, json: string): EnvelopeAdmission {
	const result = engine.envelopeAdmit(json);
	if (!result.ok) return { ok: false, refusal: refusalOf(result.error.message) };
	// SAFETY: the engine admitted it, which checks every field this type names.
	return { ok: true, envelope: JSON.parse(result.value) as ProjectEnvelope };
}
