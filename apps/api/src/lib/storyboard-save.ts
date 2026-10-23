/* The rules a client-written storyboard document passes before it is saved:
 * validation, and the fields kept from the prior version because the client does
 * not own them. One function, so the save route and the command route
 * (`p1-command-log`) cannot drift on what a valid saved document is. */
import {
	clipControlBlockers,
	CaptionClipSchema,
	CaptionSetSchema,
	captionStateFingerprint,
	localMediaUrlIssues,
	readStoryboardDocument,
	readStoryboardPosts,
	readStoryboardSlides,
	writeStoryboardDocument,
	writeStoryboardPosts,
	writeStoryboardSlides,
	type StoredStoryboardDocument,
} from "@maleo/shared";

export type StoryboardSaveCheck =
	| { readonly ok: true; readonly storyboard_json: StoredStoryboardDocument }
	| {
			readonly ok: false;
			readonly status: 400 | 409;
			readonly error: string;
			readonly issues?: readonly string[];
			readonly message?: string;
	  };

/** `incoming` checked and merged over `prior` (the head's stored document).
 *  `expectedCaptionState` is the save route's caption fence; a caller that
 *  executes caption edits against the head itself passes `undefined` to skip it. */
export function prepareStoryboardSave(
	incoming: unknown,
	prior: unknown,
	expectedCaptionState?: string | null,
): StoryboardSaveCheck {
	const localUrls = localMediaUrlIssues(incoming);
	if (localUrls.length)
		return { ok: false, status: 400, error: "local_media_url", issues: localUrls };
	const keyIssues = clipControlBlockers(incoming);
	if (keyIssues.length)
		return { ok: false, status: 400, error: "invalid_clip_animation", issues: keyIssues };
	/* Artifacts and the unit lifecycle are agent-owned and never authored by the
	 * client: the editor's autosave serializes clips and markers and does not carry
	 * them. So a client save is a writer that lacks a field, and it does what every
	 * such writer does under the document contract — reads them from the prior
	 * document and supplies them explicitly.
	 *
	 * It used to do that as a special case: an `if` over an untyped blob that
	 * re-attached one hand-named key when the incoming array was empty. The
	 * behaviour is the same; what changed is that it goes through the typed
	 * document, so a field added to the contract flows through here without anyone
	 * remembering to extend a list.
	 *
	 * Deleting this outright — as this change first proposed — would drop a longform
	 * plan on any autosave between planning and approval. That was checked rather
	 * than assumed: the editor's payload still carries no `artifacts` key, because
	 * the editor genuinely does not own one. */
	const field = (key: string): unknown =>
		incoming && typeof incoming === "object"
			? Object.getOwnPropertyDescriptor(incoming, key)?.value
			: undefined;
	const ownsCaptions =
		!!incoming && typeof incoming === "object" && Object.hasOwn(incoming, "captionSet");
	if (ownsCaptions && !CaptionSetSchema.safeParse(field("captionSet")).success)
		return { ok: false, status: 400, error: "invalid_caption_set" };
	const rawClips = field("clips");
	if (
		Array.isArray(rawClips) &&
		rawClips.some(
			(clip) =>
				clip?.type === "caption" && (!ownsCaptions || !CaptionClipSchema.safeParse(clip).success),
		)
	)
		return { ok: false, status: 400, error: "invalid_caption_clip" };
	const doc = readStoryboardDocument(incoming).doc;
	const priorDoc = readStoryboardDocument(prior).doc;
	if (
		ownsCaptions &&
		expectedCaptionState !== undefined &&
		expectedCaptionState !== captionStateFingerprint(priorDoc) &&
		captionStateFingerprint(doc) !== captionStateFingerprint(priorDoc)
	)
		return {
			ok: false,
			status: 409,
			error: "caption_conflict",
			message: "Captions changed; reload and retry.",
		};
	/* A carousel or a thread is saved as its slides or posts, which the timeline
	 * document does not carry; they are decoded and written through the same
	 * writers the agent uses, so an autosave keeps them. */
	const slides = readStoryboardSlides(incoming);
	const posts = readStoryboardPosts(incoming);
	return {
		ok: true,
		storyboard_json: {
			...writeStoryboardDocument({
				...doc,
				...(!ownsCaptions && priorDoc.captionSet
					? {
							captionSet: priorDoc.captionSet,
							captions: priorDoc.captions,
							clips: [
								...doc.clips.filter((clip) => clip.type !== "caption"),
								...priorDoc.clips.filter((clip) => clip.type === "caption"),
							],
						}
					: {}),
				artifacts: doc.artifacts.length ? doc.artifacts : priorDoc.artifacts,
				unitLifecycle: doc.unitLifecycle ?? priorDoc.unitLifecycle,
			}),
			...(slides.length ? { slides: writeStoryboardSlides(slides) } : {}),
			...(posts.length ? { posts: writeStoryboardPosts(posts) } : {}),
		},
	};
}
