/* Duplicate detection for the music library.
 *
 * Three ways a bed can be duplicated, only one of which the filename catches:
 *
 *   same bytes, different labels  — capturing one track twice under slightly
 *     different titles yields different slugs, so the content hash is the only
 *     thing that notices. This is the common case in practice.
 *   same source url twice         — a hand-edited manifest repeating an entry.
 *   colliding id                  — an id derived from the emotion means two
 *     "calm" beds both become `calm`, and the emotion lookup then silently picks
 *     one while the other is dead weight in the manifest.
 *
 * All of it is pure so it can be tested without touching ffmpeg or a network. */

export interface PreparedTrack {
	id: string;
	file: string;
	title: string;
	sha256?: string;
	source: string;
	[key: string]: unknown;
}

export interface DuplicateProblem {
	kind: "same-audio" | "same-source" | "duplicate-id";
	message: string;
	/** Entries involved, by file name, so a human can go and look. */
	files: string[];
}

/** Everything wrong with a prepared set, in one pass, so the operator sees the
 *  whole picture rather than fixing one problem per run. */
export function findDuplicates(tracks: readonly PreparedTrack[]): DuplicateProblem[] {
	const problems: DuplicateProblem[] = [];

	const byHash = new Map<string, PreparedTrack[]>();
	for (const track of tracks) {
		if (!track.sha256) continue;
		const group = byHash.get(track.sha256) ?? [];
		group.push(track);
		byHash.set(track.sha256, group);
	}
	for (const [hash, group] of byHash) {
		if (group.length < 2) continue;
		problems.push({
			kind: "same-audio",
			message: `${group.length} beds are byte-identical (sha256 ${hash.slice(0, 8)}). Keep one.`,
			files: group.map((t) => t.file),
		});
	}

	const bySource = new Map<string, PreparedTrack[]>();
	for (const track of tracks) {
		const key = track.source.trim().replace(/\/$/, "").toLowerCase();
		if (!key) continue;
		const group = bySource.get(key) ?? [];
		group.push(track);
		bySource.set(key, group);
	}
	for (const [source, group] of bySource) {
		if (group.length < 2) continue;
		problems.push({
			kind: "same-source",
			message: `${group.length} beds share the source ${source}.`,
			files: group.map((t) => t.file),
		});
	}

	const byId = new Map<string, PreparedTrack[]>();
	for (const track of tracks) {
		const group = byId.get(track.id) ?? [];
		group.push(track);
		byId.set(track.id, group);
	}
	for (const [id, group] of byId) {
		if (group.length < 2) continue;
		problems.push({
			kind: "duplicate-id",
			message: `${group.length} beds share the id "${id}". Ids must be unique — the emotion lookup would silently pick one.`,
			files: group.map((t) => t.file),
		});
	}

	return problems;
}

/** Make ids unique without changing the ones that are already fine.
 *
 * A colliding id gets its content hash appended rather than a counter: a counter
 * depends on ordering, so re-baking in a different order would rename beds and
 * invalidate anything that referenced them. */
export function assignUniqueIds<T extends PreparedTrack>(tracks: readonly T[]): T[] {
	const counts = new Map<string, number>();
	for (const track of tracks) counts.set(track.id, (counts.get(track.id) ?? 0) + 1);

	return tracks.map((track) => {
		if ((counts.get(track.id) ?? 0) < 2) return track;
		const suffix = track.sha256?.slice(0, 8) ?? track.file.replace(/\.[^.]+$/, "");
		return { ...track, id: `${track.id}-${suffix}` };
	});
}

/** Drop byte-identical beds, keeping the first. Returns what was kept and what
 *  was dropped, so the caller can say which file it ignored and why. */
/** The partition a dedup pass produces. `dropped` is retained rather than
 *  discarded so the caller can report what it removed and why. */
export interface AudioDedupResult<T> {
	kept: T[];
	dropped: T[];
}

export function dropDuplicateAudio<T extends PreparedTrack>(
	tracks: readonly T[],
): AudioDedupResult<T> {
	const seen = new Set<string>();
	const kept: T[] = [];
	const dropped: T[] = [];
	for (const track of tracks) {
		if (track.sha256 && seen.has(track.sha256)) {
			dropped.push(track);
			continue;
		}
		if (track.sha256) seen.add(track.sha256);
		kept.push(track);
	}
	return { kept, dropped };
}
