/* Building one source manifest from what is published and what was just
 * captured.
 *
 *   published.json        what B2 already serves      (fetch:manifest)
 *   <track>.json × N      one per newly captured bed  (the extension)
 *   → manifest.json       what bake and publish read  (compile:manifest)
 *
 * The whole point is that adding a bed does not disturb the beds already there.
 * Two ways that could go wrong, and both are the reason this is a module with
 * tests rather than a few lines in a script:
 *
 * A published bed whose audio is no longer on disk must survive. Nobody keeps
 * every mp3 they ever published; if such a bed fell out of the manifest here,
 * bake would not see it, publish would call it orphaned, and the library would
 * quietly shrink. So published entries are carried through with their url and
 * hash intact, marked as already published, and bake passes them straight on.
 *
 * A published bed's labels must survive too. If an operator recaptures a track
 * to fix a tag, the sidecar carries a blank description — because descriptions
 * are written later by enrich, not by the extension. Overwriting with blank
 * would throw away work and cost another labelling pass. */

import { fieldOf } from "@maleo/shared";

export interface SidecarTrack {
	file: string;
	title: string;
	author?: string;
	description?: string;
	tags?: string[];
	emotion?: string;
	durationSec?: number;
	source: string;
	license: string;
	[key: string]: unknown;
}

export interface PublishedTrack {
	id?: string;
	url?: string;
	title: string;
	author?: string;
	description?: string;
	tags?: string[];
	emotion?: string;
	sha256?: string;
	durationSec?: number;
	source: string;
	license: string;
	[key: string]: unknown;
}

export interface CompiledTrack extends SidecarTrack {
	/** Set for a bed that is already live. Bake passes these through without
	 *  touching audio, and publish reuses the url rather than uploading. */
	url?: string;
	sha256?: string;
}

export interface CompileResult {
	tracks: CompiledTrack[];
	/** Beds already published and left alone. */
	carried: number;
	/** Newly captured beds not previously published. */
	added: number;
	/** Captured beds that were already published — labels merged, not duplicated. */
	updated: number;
	problems: string[];
}

/* The fields compile reads with a type. Read off a JSON row with `trackFields`,
 * which keeps every other key as the row has it. */
const TEXT_FIELDS = ["id", "url", "author", "description", "emotion", "sha256"] as const;
const REQUIRED_TEXT = ["title", "source", "license"] as const;

/** A track row read from JSON on disk — the published manifest or a sidecar the
 *  capture extension wrote. A field of the wrong type is dropped, and a missing
 *  title, source or licence reads as empty, which `compileManifest` reports. */
function trackFields(raw: unknown) {
	const typed = new Set<string>([...TEXT_FIELDS, ...REQUIRED_TEXT, "tags", "durationSec", "file"]);
	const rest =
		raw !== null && typeof raw === "object"
			? Object.fromEntries(Object.entries(raw).filter(([field]) => !typed.has(field)))
			: {};
	const text = (field: string): string | undefined => {
		const value = fieldOf(raw, field);
		return typeof value === "string" ? value : undefined;
	};
	const tags = fieldOf(raw, "tags");
	const durationSec = fieldOf(raw, "durationSec");
	return {
		...rest,
		title: text("title") ?? "",
		source: text("source") ?? "",
		license: text("license") ?? "",
		...Object.fromEntries(
			TEXT_FIELDS.flatMap((field) => {
				const value = text(field);
				return value === undefined ? [] : [[field, value]];
			}),
		),
		...(Array.isArray(tags)
			? { tags: tags.filter((tag): tag is string => typeof tag === "string") }
			: {}),
		...(typeof durationSec === "number" ? { durationSec } : {}),
	};
}

export function readPublishedTrack(raw: unknown): PublishedTrack {
	return trackFields(raw);
}

export function readSidecar(raw: unknown): SidecarTrack {
	const file = fieldOf(raw, "file");
	return { ...trackFields(raw), file: typeof file === "string" ? file : "" };
}

const key = (source: string): string => source.trim().replace(/\/$/, "").toLowerCase();

const isBlank = (value: unknown): boolean => typeof value !== "string" || !value.trim();

export function compileManifest(
	published: readonly PublishedTrack[],
	sidecars: readonly SidecarTrack[],
): CompileResult {
	const problems: string[] = [];
	const bySource = new Map<string, PublishedTrack>();
	for (const bed of published) {
		if (!bed.source?.trim()) {
			problems.push(
				`A published bed has no source and cannot be matched: ${bed.title ?? "untitled"}`,
			);
			continue;
		}
		bySource.set(key(bed.source), bed);
	}

	const tracks: CompiledTrack[] = [];
	const seen = new Set<string>();
	let added = 0;
	let updated = 0;

	for (const sidecar of sidecars) {
		if (!sidecar.source?.trim() || !sidecar.license?.trim()) {
			problems.push(`${sidecar.file || "a sidecar"} has no source or licence and was skipped`);
			continue;
		}
		const id = key(sidecar.source);
		if (seen.has(id)) {
			// The same track captured twice in one folder. Harmless, but the second
			// would otherwise silently win.
			problems.push(`${sidecar.file} repeats a source already captured; keeping the first`);
			continue;
		}
		seen.add(id);

		const existing = bySource.get(id);
		if (!existing) {
			tracks.push({ ...sidecar });
			added++;
			continue;
		}

		// Already published. Keep the live url and hash so publish can recognise
		// it, and prefer whichever side actually says something for each label.
		tracks.push({
			...sidecar,
			author: sidecar.author?.trim() ? sidecar.author : existing.author,
			description: isBlank(sidecar.description)
				? (existing.description ?? "")
				: sidecar.description,
			emotion: sidecar.emotion ?? existing.emotion,
			tags: sidecar.tags?.length ? sidecar.tags : (existing.tags ?? []),
			...(existing.url ? { url: existing.url } : {}),
			...(existing.sha256 ? { sha256: existing.sha256 } : {}),
		});
		updated++;
	}

	// Everything published that was not recaptured. These have no local audio and
	// must not be re-baked, only carried.
	let carried = 0;
	for (const bed of published) {
		if (!bed.source?.trim() || seen.has(key(bed.source))) continue;
		tracks.push({
			file: "",
			title: bed.title,
			...(bed.author ? { author: bed.author } : {}),
			description: bed.description ?? "",
			tags: bed.tags ?? [],
			...(bed.emotion ? { emotion: bed.emotion } : {}),
			...(bed.durationSec ? { durationSec: bed.durationSec } : {}),
			source: bed.source,
			license: bed.license,
			...(bed.url ? { url: bed.url } : {}),
			...(bed.sha256 ? { sha256: bed.sha256 } : {}),
		});
		carried++;
	}

	return { tracks, carried, added, updated, problems };
}

/** A bed that is already live and needs no local audio. */
/* Takes the two fields it reads rather than a whole `CompiledTrack`: "carried"
 * means the bed lives at a remote url and has no local file, and asking for the
 * full type is what forced callers holding a prepared track to assert. */
export function isCarried(track: { url?: unknown; file?: unknown }): boolean {
	return Boolean(track.url && !track.file);
}

export function describeCompile(result: CompileResult): string {
	return `${result.added} new, ${result.updated} recaptured, ${result.carried} already published`;
}
