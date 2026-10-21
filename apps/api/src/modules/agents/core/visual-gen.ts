/* Visual-generation leaf — the stateless image/video primitives: build a scene
 * or raw prompt into an image via the image service, animate a frame to video,
 * resolve SSRF-safe reference images from the project DB, and the shared async
 * retry. No job/plan mutation lives here (that stays engine-side in the
 * orchestrator: style-bible lock, style board, transition plates). Domain types
 * are imported type-only from the orchestrator, so this is a one-way leaf both
 * the orchestrator and the flow services import directly. */
import type { AgentScene, AgentJob } from "./model.ts";
import { runImageJob } from "../../../lib/generation/image-generator.ts";
import { resolveUploadFilePath } from "../../../lib/upload-files.ts";
import { absoluteDashboardUrl } from "../../../lib/dashboard-origin.ts";
import { meter } from "../../../lib/metering/meter.ts";
import { getMediaObject } from "@maleo/db/media-objects";
import { generateVideo } from "../../../lib/generation/video-generator.ts";

/* Whose budget a generation spends, and what the result belongs to. Carried from
 * the run's project rather than defaulted, so a workspace's spend is its own and
 * its generation quota gates the agent path as well as the route.
 *
 * `projectId` rides the same channel because metering context and ledger
 * attribution are the same question asked twice: a path that knows enough to be
 * billed knows enough to record what it produced. Keeping them apart is how three
 * producers ended up simultaneously unmetered and unrecorded. */
export interface BillingContext {
	workspace?: string;
	projectId?: string | null;
}

/* The agent path always has a workspace — AgentJob.workspace is absent only when
 * the project is gone, at which point there is no budget to spend and nothing to
 * attribute. Refusing here is the spec's "treated as a defect" rather than
 * generating something nobody can account for. */
function requireWorkspace(billing: BillingContext | undefined, what: string): string {
	const workspace = billing?.workspace?.trim();
	if (!workspace)
		throw new Error(`${what}: no workspace — generation cannot be metered or attributed`);
	return workspace;
}
import { listProjectReferences } from "@maleo/db/references";
import { UnresolvedReferenceError } from "./reference-preflight.ts";
import type { LockedVisualConstraints } from "../../../lib/content-generator.ts";
import {
	castableSubjects,
	resolutionSet,
	type CastableSubject,
} from "../../../lib/wire/reference-entity.ts";
import {
	DEFAULT_CAST_SUBJECT_CAP,
	beatVisualIntentSchema,
	buildStoryBeatIntent,
	type CreativeDirection,
	type MentionableReference,
} from "@maleo/shared";
import {
	MIN_SHORTFORM_SCENE_SEC,
	MAX_SHORTFORM_SCENE_SEC,
	MAX_SHORTFORM_BEAT_SEC,
	orderRefsForBinding,
	referenceMapForRefs,
	referenceUseForVisualMaterial,
	resolveSceneRoster,
	roleOf,
	EMPTY_PROJECT_SELECTION,
	MAX_REFERENCE_IMAGES,
	type ImagePromptIntent,
	type ImagePromptReference,
	type ProjectSelection,
	type ResolvedReferenceImage,
	type RosterScene,
	type SelectionHintMatch,
} from "@maleo/shared";

// Resolved reference image. `entityId`/`label` carry the cast identity so the
// scene prompt can bind each attached image to its subject by index.
type RefImage = ResolvedReferenceImage;

// Re-exported for tests; the binding logic lives in @maleo/shared so the agent
// path and the /api/image-gen route share one implementation.
export { orderRefsForBinding };
export const referenceMapFor = referenceMapForRefs;

/** Layer the project's Visual material and Rules onto a scene's own description.
 *
 *  Applied where the scene prompt is built rather than where the scene is planned:
 *  a planned scene describes what the frame IS, and the project's look and
 *  constraints are the same for every frame, so folding them into the plan would
 *  repeat them across every scene and make a re-plan overwrite them. */
/* What a generated style bible or planned scene must not contradict.
 *
 * Read at the point of generation rather than threaded through the job, because
 * the roster is a live read and every consumer wants the same snapshot of it.
 *
 * Without this the upstream generators saw the brief alone. A project locked to
 * "only sketch stickman, no human presence" got back cinematic paleo-realism
 * with prehistoric people in it, and the contradiction surfaced only in the
 * compiled image prompt — by which point the remedies were to ignore the
 * generated text or delete parts of it on a keyword guess. Both are worse than
 * saying so up front. */
export async function lockedConstraintsFor(job: AgentJob): Promise<LockedVisualConstraints> {
	return {
		visual: job.direction?.visual,
		rules: job.direction?.rules,
		references: job.projectId
			? (await listProjectReferences(job.projectId, { sceneKey: null })).map((row) => ({
					label: row.label || row.id,
					description: row.description,
				}))
			: [],
	};
}

export { MAX_SHORTFORM_SCENE_SEC };
// Per-clip cap (one generated frame). Manual scenes stay single-frame.
export const clampShortformSceneDuration = (value: number): number =>
	Math.max(MIN_SHORTFORM_SCENE_SEC, Math.min(MAX_SHORTFORM_SCENE_SEC, value));
// Beat-intent cap. A beat may run longer than one clip; the builder splits it
// into ≤MAX_SHORTFORM_SCENE_SEC frames instead of truncating to the clip cap.
export const clampShortformBeatDuration = (value: number): number =>
	Math.max(MIN_SHORTFORM_SCENE_SEC, Math.min(MAX_SHORTFORM_BEAT_SEC, value));

// ── Async retry ─────────────────────────────────────────────────────────────

// Retry a transient async op with linear backoff. The image/TTS backends are flaky
// under load (browser-automation timeouts, rate limits), and a single miss should
// not fail a whole section — retrying recovers most. Throws the last error if all
// attempts fail.
const ASSET_RETRY_ATTEMPTS = 3;
let assetRetryBaseMs = 1000;
/** Test hook: shrink (or zero) the retry backoff so failing-asset paths don't sleep. */
export function setAssetRetryDelayForTests(ms: number | null): void {
	assetRetryBaseMs = ms == null ? 1000 : Math.max(0, ms);
}
export async function withRetry<T>(
	fn: () => Promise<T>,
	attempts = ASSET_RETRY_ATTEMPTS,
	baseMs = assetRetryBaseMs,
): Promise<T> {
	let lastErr: unknown;
	for (let i = 0; i < attempts; i++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseMs * (i + 1)));
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ── Image / video generation ────────────────────────────────────────────────

/* Test seam — replace scene-frame generation (avoids the real image service).
 *
 * The prepared intent is handed to the override as well as the scene. It has to
 * be: on the story path the provider receives the INTENT, and the scene's
 * `visual` is a reviewer-facing mirror. A seam that showed only the scene let a
 * test assert on text the provider never sees — which is exactly what two tests
 * here were doing, checking for the style bible inside a prompt string after the
 * style had moved into its own field. */
type SceneFrameOverride = (
	s: AgentScene,
	aspect: string,
	styleImageUrl?: string,
	visualStyle?: string,
	referenceImageUrls?: RefImage[],
	prepared?: PreparedSceneIntent,
) => Promise<string>;
let sceneFrameOverride: SceneFrameOverride | null = null;
export function setSceneFrameGeneratorForTests(fn: SceneFrameOverride | null): void {
	sceneFrameOverride = fn;
}
let promptImageOverride:
	| ((prompt: string, aspect: string, referenceImageUrls?: RefImage[]) => Promise<string>)
	| null = null;
export function setPromptImageGeneratorForTests(
	fn: ((prompt: string, aspect: string, referenceImageUrls?: RefImage[]) => Promise<string>) | null,
): void {
	promptImageOverride = fn;
}

// Absolute urls: the image service fetches references by URL.
function providerRefs(orderedRefs: ResolvedReferenceImage[]): ImagePromptReference[] {
	return orderedRefs.map((r) => ({
		url: absoluteDashboardUrl(r.url),
		role: roleOf(r.role) ?? "character",
		...(r.referenceUse ? { referenceUse: r.referenceUse } : {}),
		...(r.entityId ? { entityId: r.entityId } : {}),
		...(r.label ? { label: r.label } : {}),
		...(r.description ? { description: r.description } : {}),
		...(r.primary === undefined ? {} : { primary: r.primary }),
	}));
}

function subjectLocksFor(refs: ImagePromptReference[]): ImagePromptIntent["subjectLocks"] {
	return refs
		.filter((ref) => ref.role !== "style")
		.map((ref) => ({
			source: "reference",
			role: ref.role,
			label: ref.label ?? ref.entityId ?? ref.role,
			descriptors: ref.description ? [ref.description] : [],
			mustAvoid: [],
			referenceId: ref.entityId,
		}));
}

export function sceneIntent(
	scene: AgentScene,
	aspect: string,
	refs: ImagePromptReference[],
	visualStyle?: string,
	direction?: CreativeDirection,
	roster: readonly MentionableReference[] = [],
): ImagePromptIntent {
	const base = buildStoryBeatIntent({
		beat: beatVisualIntentSchema.parse({
			beatIndex: 0,
			visualMoment: scene.visual || scene.name,
			action: scene.action,
			shotType: scene.shot,
			mood: scene.emotion,
		}),
		aspect,
		visual: direction?.visual,
		rules: direction?.rules,
		roster,
		references: refs,
	});
	return {
		...base,
		subjectLocks: subjectLocksFor(refs),
		composition: {
			...base.composition,
			movement: scene.move || "Static",
		},
		style: {
			...base.style,
			visualTreatment: visualStyle,
		},
	};
}

/* Story beats arrive with prepared intent. Direct scenes use `sceneIntent`,
 * which compiles scene fields and project materials through the same shared
 * image intent contract. */
export interface PreparedSceneIntent {
	intent: ImagePromptIntent;
}

// Generate a scene frame server-side: build the prompt, submit to the image
// service, poll the job, and return a dashboard-proxied image url.
export async function generateSceneFrame(
	s: AgentScene,
	aspect: string,
	styleImageUrl?: string,
	visualStyle?: string,
	refImageUrls?: RefImage[],
	billing?: BillingContext,
	prepared?: PreparedSceneIntent,
	materials?: { direction?: CreativeDirection; roster?: readonly MentionableReference[] },
): Promise<string> {
	const scene = s;
	if (sceneFrameOverride)
		return sceneFrameOverride(scene, aspect, styleImageUrl, visualStyle, refImageUrls, prepared);
	const orderedRefs = orderRefsForBinding(
		refImageUrls ?? (styleImageUrl ? [{ url: styleImageUrl, role: "style" }] : []),
	);
	const referenceImageUrls = providerRefs(orderedRefs);
	const intent = prepared
		? {
				...prepared.intent,
				output: { ...prepared.intent.output, aspect },
				references: referenceImageUrls,
			}
		: sceneIntent(
				scene,
				aspect,
				referenceImageUrls,
				styleImageUrl ? undefined : visualStyle,
				materials?.direction,
				materials?.roster,
			);
	const prompt = intent.scene.visualMoment;
	const model = referenceImageUrls.length ? "image-service+refs" : "image-service";
	return meter({
		operation: "image",
		quantity: 1,
		provider: "image-service",
		model,
		reference: "image:scene",
		workspace: billing?.workspace,
		metadata: { aspect, scene: scene.name },
		identity: intent,
		run: (generationKey) =>
			runImageJob(
				{ prompt, aspect, referenceImageUrls, intent },
				{
					workspace: requireWorkspace(billing, "generateSceneFrame"),
					projectId: billing?.projectId ?? null,
					source: "agent",
					generationKey,
				},
			),
	});
}

/** Shared video generation keeps selected provider, duration and provenance together. */
export async function animateFrame(
	imageUrl: string,
	prompt: string,
	durationSec: number,
	billing?: BillingContext,
) {
	return generateVideo(
		{ imageUrl, prompt, durationSec },
		{ workspace: requireWorkspace(billing, "animateFrame"), projectId: billing?.projectId },
	);
}

// Generate a standalone image from a raw prompt (no scene framing). Used for
// carousel slides — submits to the image service, polls, returns a proxied url.
export async function generatePromptImage(
	prompt: string,
	aspect: string,
	refImageUrls?: RefImage[],
	billing?: BillingContext,
): Promise<string> {
	const orderedRefs = orderRefsForBinding(refImageUrls ?? []);
	const referenceImageUrls = providerRefs(orderedRefs);
	const intent = sceneIntent(
		{
			name: "Generated image",
			durationSec: 4,
			shot: "Medium Shot",
			move: "Static",
			transition: "fade",
			visual: prompt,
			voiceover: "",
		},
		aspect,
		referenceImageUrls,
	);
	if (promptImageOverride) return promptImageOverride(prompt, aspect, referenceImageUrls);
	const model = referenceImageUrls.length ? "image-service+refs" : "image-service";
	return meter({
		operation: "image",
		quantity: 1,
		provider: "image-service",
		model,
		reference: "image:prompt",
		workspace: billing?.workspace,
		metadata: { aspect },
		identity: intent,
		run: (generationKey) =>
			runImageJob(
				{ prompt, aspect, referenceImageUrls, intent },
				{
					workspace: requireWorkspace(billing, "generatePromptImage"),
					projectId: billing?.projectId ?? null,
					source: "agent",
					generationKey,
				},
			),
	});
}

// ── Reference-image resolution (SSRF-safe) ──────────────────────────────────

// SSRF defense: a reference image url is only safe if it points at our own
// MANAGED media — the generated-image proxy (/api/image-gen/files/...) or a
// user-uploaded file (/uploads/<single-safe-name>, validated against traversal
// by resolveUploadFilePath). Every external url is rejected — the server never
// fetches an arbitrary host, so there is no SSRF / DNS-rebinding surface.
export async function isSafeRefUrl(url: string): Promise<boolean> {
	if (typeof url !== "string") return false;
	if (url.startsWith("/api/media/")) {
		const row = await getMediaObject(url.slice("/api/media/".length));
		return row?.kind === "image";
	}
	if (url.startsWith("/api/image-gen/files/")) return true;
	if (url.startsWith("/uploads/")) return resolveUploadFilePath(url) !== null;
	return false;
}

// Resolve reference ids to image urls FROM THE PROJECT DB — never trust
// client-supplied urls. Style ref first, then the requested refs, all
// SSRF-validated, then the shared subject cap.
/* The project's selectable cast, read from its `project_reference` selections.
 *
 * The decode and the two projections live in `lib/wire/reference-entity.ts`; this
 * reads the rows and hands them over. It used to decode them here as well, with a
 * style rule that disagreed with the one next to it — see that module for why the
 * two views differ and what each is for. */
export type RosterEntry = CastableSubject;

export async function projectRoster(projectId: string): Promise<RosterEntry[]> {
	return castableSubjects(await listProjectReferences(projectId));
}

/* Resolve a scene's cast from the entity model.
 *
 * Applies roster-size defaulting via `selectCast` — roster 0 attaches nothing,
 * roster 1 auto-casts its single entity into every scene, roster >= 2 uses the
 * declared cast with the project's primary backfilling an empty one. That
 * defaulting is a normative requirement that the previous path did not implement
 * at all: a project with exactly one character got no reference on any scene the
 * planner left untagged.
 *
 * Returns null when the project has no migrated entities, so the caller can fall
 * back to the legacy content_references path. */
async function resolveEntityRefImages(
	projectId: string,
	selection: ProjectSelection,
	scene: RosterScene,
	styleUrl?: string,
	materials?: AgentJob["materials"],
	sceneText = "",
): Promise<{
	refs: RefImage[];
	dropped: string[];
	missing: string[];
	unusable: string[];
	ambiguous: SelectionHintMatch[];
} | null> {
	// Filter unsafe urls BEFORE resolution, so an unreachable entity neither
	// occupies a subject-cap slot nor auto-casts as a one-entity roster.
	const attached = resolutionSet(await listProjectReferences(projectId));
	const safe = await Promise.all(attached.map((e) => isSafeRefUrl(e.imageUrl)));
	const roster = attached.filter((_, i) => safe[i]);
	if (roster.length === 0) return null;

	const { refs, dropped, missing, ambiguous } = resolveSceneRoster({
		roster,
		selection,
		scene,
		referenceSettings: materials?.visual.referenceSettings,
		sceneText,
	});

	/* `missing` conflates two failures, because the unsafe-url filter above runs
	 * before resolution and so an attached entity with a bad image looks exactly
	 * like an id that was never attached.
	 *
	 * They are not the same and must not be treated the same. An id absent from
	 * the roster is a selection that can never render — the run stops. An
	 * attached entity whose image failed the SSRF check is the security boundary
	 * doing its job on a reference the project genuinely has — that is reported,
	 * and the run continues, exactly as it did before blocking existed. Escalating
	 * it would turn one bad url into a project that cannot generate at all. */
	const attachedIds = new Set(attached.map((e) => e.id));
	const unusable = missing.filter((id) => attachedIds.has(id));
	const notAttached = missing.filter((id) => !attachedIds.has(id));

	const out: RefImage[] = [];
	if (styleUrl && (await isSafeRefUrl(styleUrl))) out.push({ url: styleUrl, role: "style" });
	for (const entity of refs) {
		if (out.some((o) => o.url === entity.imageUrl)) continue;
		out.push({
			url: entity.imageUrl,
			role: entity.role,
			entityId: entity.id,
			// The entity's own label, not its description: the map falls back
			// description -> label -> id, and naming a subject by raw id in the
			// prompt is the weakest of the three.
			label: entity.label || entity.id,
			description: entity.description,
			primary: entity.primary,
			referenceUse: materials
				? referenceUseForVisualMaterial(materials, entity.id, entity.role)
				: undefined,
		});
	}
	// The subject cap's report travels with the refs. It used to be discarded
	// here, so the agent path could never say a subject had been skipped while the
	// editor marked the same entity "won't render".
	//
	// Roster misses travel alongside it, by id: there is no entity to read a label
	// from, which is the whole point — the project never had one.
	return {
		refs: out.slice(0, MAX_REFERENCE_IMAGES),
		dropped: dropped.map((e) => e.label || e.id),
		missing: notAttached,
		unusable,
		ambiguous,
	};
}

/* A scene's references: the project's selection (unless the scene opted out) plus
 * the scene's own cast. The union used to ignore `useGlobalReferences`, so an
 * opted-out scene generated with the project's selection anyway — every editor
 * surface said otherwise. The rule itself lives in @maleo/shared. */
export async function resolveSceneRefImages(job: AgentJob, scene: AgentScene): Promise<RefImage[]> {
	const selection: ProjectSelection = { prompt: "", entityIds: job.projectRefIds ?? [] };
	const rosterScene: RosterScene = {
		refIds: scene.refIds,
		useGlobalReferences: scene.useGlobalReferences,
	};
	const sceneText = [scene.name, scene.visual, scene.voiceover].filter(Boolean).join("\n");
	const resolved = await resolveEntityRefImages(
		job.projectId,
		selection,
		rosterScene,
		job.styleImageUrl,
		job.materials,
		sceneText,
	);
	if (!resolved) return [];
	// Say when the cap skipped a subject. The editor marks these "won't render";
	// the agent path said nothing, so the run reported a cast it did not use.
	if (resolved.dropped.length) {
		job.events.push({
			kind: "assistant_text",
			text: `Skipped ${resolved.dropped.length === 1 ? "1 reference" : `${resolved.dropped.length} references`} on "${scene.name}" — over the ${DEFAULT_CAST_SUBJECT_CAP}-subject limit: ${resolved.dropped.join(", ")}.`,
		});
	}
	// Stop when a selected reference is not attached to this project. This is a
	// different failure from the cap — nothing was over a limit, the entity simply
	// is not on the roster — and it used to produce no output at all: the id was
	// filtered before it could become an entity, so the cap report could not see it.
	//
	// It then became an `assistant_text` event, which was true and useless: it
	// arrived after the image had been generated from a cast missing the
	// reference the operator chose, buried among the job's other events. It
	// throws instead, from the one function every image path calls immediately
	// before the provider, so nothing reaches a provider around the run-level
	// preflight by calling this resolver directly. Named by id, because an
	// unattached entity has no label here to name it by.
	if (resolved.missing.length) {
		throw new UnresolvedReferenceError(resolved.missing, scene.name || scene.sceneKey || "scene");
	}
	if (resolved.ambiguous.length) {
		const names = resolved.ambiguous.map((match) => match.entityId).join(", ");
		throw new Error(
			`Ambiguous reference selection for "${scene.name || scene.sceneKey || "scene"}": ${names}. Choose scene references before generating.`,
		);
	}
	// An attached reference the SSRF check refused. Reported, not blocking: the
	// project has the reference, one url is unusable, and refusing to generate
	// anything would be a worse answer than generating without it and saying so.
	if (resolved.unusable.length) {
		job.events.push({
			kind: "assistant_text",
			text: `Could not use ${resolved.unusable.length === 1 ? "1 reference" : `${resolved.unusable.length} references`} on "${scene.name}" — the image url is not reachable: ${resolved.unusable.join(", ")}. Re-upload the reference image to fix it.`,
		});
	}
	return resolved.refs;
}

// Slide analog of resolveSceneRefImages — resolve a carousel slide's ref ids
// against the project DB (style ref + slide refs, SSRF-validated).
export async function resolveSlideRefImages(
	job: AgentJob,
	refIds: string[] | undefined,
): Promise<RefImage[]> {
	// A slide carries no project-selection opt-out — its cast is exactly what it declares.
	return (
		(
			await resolveEntityRefImages(
				job.projectId,
				EMPTY_PROJECT_SELECTION,
				{ refIds },
				job.styleImageUrl,
			)
		)?.refs ?? []
	);
}
