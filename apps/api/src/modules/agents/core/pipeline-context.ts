/* What a stage is allowed to read.
 *
 * A stage declares its context keys at registration, so the question "what does
 * this stage consume?" is answered by reading one line rather than the whole body.
 * Today the answer is spread across three places that each own part of the rule:
 * `material-layers.ts` fixes the prompt layer order, `style-engine.ts` fixes style
 * precedence, and creative direction is split into channels so a directive for one
 * dimension cannot leak into another. None of them is stated where a stage is
 * defined, which is why the rule is currently enforced by reviewer memory.
 *
 * The keys are a closed set on purpose. A stage that could declare any string would
 * document nothing — a typo would read as a new dimension. Declaring a key outside
 * this set is a compile error.
 *
 * Declaration is not yet enforcement. In this change `consumes` is validated and
 * traced; a stage reading a channel it did not declare is still possible because
 * stages read `AgentJob` directly in dozens of places. Cutting that access is the
 * same work as demoting the job as a stage-data bus, which belongs to
 * `standardize-pipeline-artifact-contracts`. */

/* The material channels a stage may read, named for the routed wire model rather
 * than the authoring model: materials reach stages as `CreativeDirection` channels
 * through `directionFromMaterials`, and that conversion is the only one. A key per
 * channel rather than a single `materials` key is what makes a leak visible — a
 * stage that consumes voice guidance while claiming only visual guidance is a
 * one-line diff to spot. */
/* There is deliberately no `materials.styleBible` key. The style bible is a derived
 * Visual material, folded into the visual channel by `directionFromMaterials`
 * (`packages/shared/src/project-materials.ts:355`) and documented as such by
 * `material-layers.ts:57-58`. No stage can receive it separately, so a key for it
 * would let a stage declare something it cannot read. A stage that reads the bible
 * declares `materials.visual`; the resolved project-wide lock is `styleLock`. */
import { stableInputHash, stableStringify, type ArtifactContextSnapshot } from "@maleo/shared";

export const MATERIAL_CONTEXT_KEYS = [
	"materials.story",
	"materials.visual",
	"materials.voice",
	"materials.rules",
	/* The scene's resolved cast, passed alongside the visual channel so editor
	 * mention syntax can be stripped before a prompt reaches a provider. */
	"materials.references",
] as const;

export const PIPELINE_CONTEXT_KEYS = [
	/* The operator's request for this run. */
	"brief",
	...MATERIAL_CONTEXT_KEYS,
	/* The resolved project-wide visual lock — a chosen reference image or a style
	 * bible. Resolution order lives in `style-engine.ts`; this key only records that
	 * a stage reads the outcome. */
	"styleLock",
	/* Timing, pacing, transitions, titles, music and render policy. Read at the
	 * generation boundary and held stable for the asset pass. */
	"timelineTemplate",
	/* The exact approved plan revision. Generation refuses to run without one, so a
	 * stage consuming this is consuming frozen content, not the live draft. */
	"approvedPlan",
	/* Assets produced by an earlier stage of this run. */
	"generatedAssets",
] as const;

export type PipelineContextKey = (typeof PIPELINE_CONTEXT_KEYS)[number];

const CONTEXT_KEY_SET: ReadonlySet<string> = new Set(PIPELINE_CONTEXT_KEYS);

/** Runtime guard for the trace surface, which receives keys as plain strings. */
export function isPipelineContextKey(value: string): value is PipelineContextKey {
	return CONTEXT_KEY_SET.has(value);
}

/* ── Snapshotting declared context ─────────────────────────────────────────── */

/* What each key reads off a run, so a stage's declared context can be
 * fingerprinted when it begins. Hashing the value rather than storing it keeps an
 * artifact small and still answers the only question asked of it later: was this
 * made against the context the project has now? */
interface SnapshotSource {
	brief?: string;
	direction?: { story?: string; visual?: string; voice?: string; rules?: string };
	projectRefIds?: string[];
	styleImageUrl?: string;
	visualStyle?: string;
	timelineTemplate?: unknown;
}

/* Only context from outside the pipeline is fingerprinted. `approvedPlan` and
 * `generatedAssets` are other stages' artifacts, and their lineage is already
 * exact: an artifact's input references name them by content hash. Fingerprinting
 * them again would record the same fact twice at the same granularity — and the
 * approval in particular is made inside the stage that declares it, so a snapshot
 * taken as that stage begins would call it superseded the moment the stage ends. */
const EXTERNAL_CONTEXT: Readonly<
	Partial<Record<PipelineContextKey, (source: SnapshotSource) => unknown>>
> = {
	brief: (source) => source.brief ?? "",
	"materials.story": (source) => source.direction?.story ?? "",
	"materials.visual": (source) => source.direction?.visual ?? "",
	"materials.voice": (source) => source.direction?.voice ?? "",
	"materials.rules": (source) => source.direction?.rules ?? "",
	"materials.references": (source) => [...(source.projectRefIds ?? [])].sort(),
	styleLock: (source) => [source.styleImageUrl ?? "", source.visualStyle ?? ""],
	timelineTemplate: (source) => source.timelineTemplate ?? null,
};

/** Fingerprint a stage's declared external context, key by key. */
export function snapshotDeclaredContext(
	source: SnapshotSource,
	keys: readonly PipelineContextKey[],
): ArtifactContextSnapshot {
	return keys.flatMap((key) => {
		const read = EXTERNAL_CONTEXT[key];
		return read
			? [
					{
						key,
						hash: stableInputHash(["pipeline-context-v1", key, stableStringify(read(source))]),
					},
				]
			: [];
	});
}

/** The declared context keys whose value has changed since an artifact was made
 *  — empty when it was made against the context the project has now. */
export function supersededContext(
	snapshot: ArtifactContextSnapshot | undefined,
	source: SnapshotSource,
): string[] {
	if (!snapshot?.length) return [];
	const current = new Map(
		snapshotDeclaredContext(
			source,
			snapshot.map((entry) => entry.key).filter(isPipelineContextKey),
		).map((entry) => [entry.key, entry.hash]),
	);
	return snapshot
		.filter((entry) => current.get(entry.key) !== entry.hash)
		.map((entry) => entry.key);
}
