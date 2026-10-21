/* Applying an agent result without trampling what the user did meanwhile.
 *
 * A run takes minutes and the user keeps working. When the result lands it is
 * shaped like the whole document — the agent read a project and hands one back —
 * so writing it wholesale replaces every entity, including the three the user
 * edited while waiting. That is the bug this module exists to prevent, and it is
 * silent: nothing errors, the user's work is simply gone on the next save.
 *
 * Three steps, in order:
 *
 *   1. TOUCHED SCOPE — which entities did the run actually change?
 *   2. FENCING       — did the user change any of those same entities?
 *   3. SCOPED APPLY  — write only the touched ones, keep everything else current.
 *
 * Step 1 is observed, not declared. An entity is touched when what the run
 * returns differs from what the run READ, which the envelope recorded as a
 * fingerprint. That is a fact about the result rather than a claim by the model,
 * so a model that quietly rewrites something it was not asked to touch cannot
 * hide it, and one that reports edits it did not make cannot invent them.
 *
 * The consequence that matters: an entity the user edited during the run comes
 * back from the agent holding the OLD value — the one the run read — so it
 * fingerprints equal, is not touched, and is left at the user's version. The
 * common case resolves correctly with no conflict at all. */
import {
	clipFingerprint,
	entityKey,
	fingerprintIndex,
	fingerprintValue,
	type ChatEntityRef,
	type EntityFingerprint,
} from "@maleo/shared";
import type { EditScope } from "@maleo/shared/editor";

/* The canonical record an entity is fingerprinted by.
 *
 * Only content, never presentation. `Slide.id` is a render ordinal that changes
 * on reorder, so including it would make every reorder look like an edit to
 * every slide. `key` is identity, not content, so it is excluded too — identity
 * is the map key here, not part of the value. */
function slideValue(slide: EditScope["slides"][number]): unknown {
	return {
		name: slide.name,
		cap: slide.cap,
		vis: slide.vis,
		src: slide.src,
		img: slide.img,
		refIds: slide.refIds ?? [],
		noteIds: slide.noteIds ?? [],
	};
}

function postValue(post: EditScope["posts"][number]): unknown {
	return { body: post.body, src: post.src, img: post.img };
}

/** Every entity in a scope, as `ref -> content hash`. */
export function scopeFingerprints(scope: EditScope): EntityFingerprint[] {
	return [
		...scope.doc.clips.map(clipFingerprint),
		...scope.slides.map((slide) => ({
			kind: "slide" as const,
			id: slide.key,
			hash: fingerprintValue(slideValue(slide)),
		})),
		...scope.posts.map((post) => ({
			kind: "post" as const,
			id: post.key,
			hash: fingerprintValue(postValue(post)),
		})),
	];
}

/* What the run changed.
 *
 * Present in the result and different from what was captured, or present and not
 * captured at all (something the run created). An entity that was captured and
 * is now absent from the result was deleted by the run, which is also a change. */
export function touchedScopeOf(captured: EntityFingerprint[], result: EditScope): ChatEntityRef[] {
	const before = fingerprintIndex(captured);
	const after = scopeFingerprints(result);
	const afterKeys = new Set(after.map((fp) => entityKey(fp)));

	const touched: ChatEntityRef[] = after
		.filter((fp) => before.get(entityKey(fp)) !== fp.hash)
		.map((fp) => ({ kind: fp.kind, id: fp.id }));

	// Deletions: captured, and no longer there.
	for (const fp of captured) {
		if (!afterKeys.has(entityKey(fp))) touched.push({ kind: fp.kind, id: fp.id });
	}
	return touched;
}

export type FenceDecision =
	| { status: "apply"; touched: ChatEntityRef[] }
	| { status: "hold"; reason: "changed" | "deleted"; conflicts: ChatEntityRef[] };

/* Did the user change anything the run is about to write?
 *
 * Only touched entities are compared. An unrelated edit is not a conflict and
 * must not block the result — that was the flaw in a project-wide revision
 * counter, which reported a collision for an edit three scenes away.
 *
 * An entity the user deleted is held rather than recreated: bringing back
 * something they removed is more surprising than doing nothing. */
export function fenceTouchedResult(
	captured: EntityFingerprint[],
	current: EditScope,
	touched: ChatEntityRef[],
): FenceDecision {
	const before = fingerprintIndex(captured);
	const now = fingerprintIndex(scopeFingerprints(current));

	const deleted: ChatEntityRef[] = [];
	const changed: ChatEntityRef[] = [];

	for (const ref of touched) {
		const key = entityKey(ref);
		const capturedHash = before.get(key);
		// Not captured means the run created it — there is no earlier user value to
		// conflict with, so it applies.
		if (capturedHash === undefined) continue;
		const currentHash = now.get(key);
		if (currentHash === undefined) {
			deleted.push(ref);
			continue;
		}
		if (currentHash !== capturedHash) changed.push(ref);
	}

	if (deleted.length) return { status: "hold", reason: "deleted", conflicts: deleted };
	if (changed.length) return { status: "hold", reason: "changed", conflicts: changed };
	return { status: "apply", touched };
}

export type PreviewDecision =
	| { status: "apply"; current: EditScope; expected: EditScope }
	| { status: "hold"; reason: "changed" | "deleted"; conflicts: ChatEntityRef[] };

/** Apply one live agent preview without confusing its previous preview with a
 * user edit. `expected` is editor state after the last agent preview; any
 * difference between it and `current` came from the user and is fenced. */
export function applyAgentPreview(
	expected: EditScope,
	current: EditScope,
	result: EditScope,
): PreviewDecision {
	const fingerprints = scopeFingerprints(expected);
	const touched = touchedScopeOf(fingerprints, result);
	if (!touched.length) return { status: "apply", current, expected };
	const fence = fenceTouchedResult(fingerprints, current, touched);
	if (fence.status === "hold") return fence;
	return {
		status: "apply",
		current: applyTouchedResult(current, result, touched),
		expected: applyTouchedResult(expected, result, touched),
	};
}

/* Write only what the run touched.
 *
 * `next` starts from `current`, never from the captured state and never from the
 * result. Anything outside `touched` keeps the value it has right now, which is
 * what makes "unrelated edits are preserved" true rather than merely intended:
 * fingerprint comparison detects a conflict, but it is this function that
 * prevents the overwrite.
 *
 * Order is taken from current state. Ordering is not fingerprinted as entity
 * content, so a result cannot claim it touched the collection order; keeping
 * current order is what preserves a user reorder made while the run worked. */
export function applyTouchedResult(
	current: EditScope,
	result: EditScope,
	touched: ChatEntityRef[],
): EditScope {
	const touchedKeys = new Set(touched.map((ref) => entityKey(ref)));
	if (!touchedKeys.size) return current;

	const currentClips = new Map(current.doc.clips.map((clip) => [clip.id, clip]));
	const currentSlides = new Map(current.slides.map((slide) => [slide.key, slide]));
	const currentPosts = new Map(current.posts.map((post) => [post.key, post]));

	/* One collection, merged in current order. Touched entities take result
	 * content, touched omissions are deletions, and touched creations append in
	 * result order. */
	const merge = <T>(
		kind: ChatEntityRef["kind"],
		resultItems: T[],
		currentItems: T[],
		idOf: (item: T) => string,
		currentById: Map<string, T>,
	): T[] => {
		const isTouched = (id: string): boolean => touchedKeys.has(entityKey({ kind, id }));
		const resultById = new Map(resultItems.map((item) => [idOf(item), item]));
		const currentIds = new Set(currentItems.map(idOf));
		const merged: T[] = [];

		for (const item of currentItems) {
			const id = idOf(item);
			if (!isTouched(id)) {
				merged.push(currentById.get(id) ?? item);
				continue;
			}
			const replacement = resultById.get(id);
			if (replacement) merged.push(replacement);
		}
		for (const item of resultItems) {
			const id = idOf(item);
			if (!currentIds.has(id) && isTouched(id)) merged.push(item);
		}
		return merged;
	};

	return {
		mediaAssets: current.mediaAssets,
		doc: {
			...current.doc,
			clips: merge("clip", result.doc.clips, current.doc.clips, (clip) => clip.id, currentClips),
		},
		slides: merge("slide", result.slides, current.slides, (slide) => slide.key, currentSlides),
		posts: merge("post", result.posts, current.posts, (post) => post.key, currentPosts),
	};
}
