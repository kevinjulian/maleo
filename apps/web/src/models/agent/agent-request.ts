/* What the chat agent is told about a project.
 *
 * Pure derivations of the editor's own state: the default narrator, the brief,
 * the creative direction, and the typed context. They live here rather than
 * inside the container because what the agent receives is a contract, and a
 * contract that is only expressible as a closure is one nobody can test.
 */
import {
	EMPTY_CREATIVE_DIRECTION,
	directionFromMaterials,
	hasRoutableMaterials,
	isEmptyDirection,
	styleDirective,
	type CreativeDirection,
	type ProjectMaterials,
} from "@maleo/shared";
import type { ChatAgentContext } from "./agent-context.ts";
import type { Config, ContentType, ProjectSelection, RefImage, RefsState } from "@maleo/shared";
import type { GlobalSettings } from "@models/presets/creative-settings.ts";

export function defaultCastId(refs: RefsState): string | undefined {
	return refs.speakers.find((cast) => cast.default)?.id ?? refs.speakers[0]?.id;
}

/** Content-only brief: the project-reference prompt (visual directives) no longer
 *  merges in — it travels via the VISUAL direction channel so it cannot pollute the
 *  research/planning topic. The style-reference label stays, because it names an image. */
export function agentBrief(config: Config, settings: GlobalSettings, pool: RefImage[]): string {
	const styleRef = settings.globalStyleRefId
		? pool.find((r) => r.id === settings.globalStyleRefId)
		: undefined;
	const style = styleRef
		? `Global style reference: ${styleRef.label}${styleRef.description ? ` — ${styleRef.description}` : ""}`
		: "";
	return [config.brief, style].filter((x): x is string => Boolean(x?.trim())).join("\n\n");
}

/* What the generation stages are told to steer by, in precedence order.
 *
 * 1. PROJECT MATERIALS, when the project has any. Materials are the authoring
 *    model an operator now edits; direction is the wire model the stages read, and
 *    `directionFromMaterials` is the one conversion between them.
 * 2. The operator's authored direction, for projects that predate materials.
 * 3. The legacy project-reference prompt, migrated into the VISUAL channel so
 *    existing projects keep their look while research stays on-subject.
 *
 * Materials win over direction rather than merging with it: a project that has
 * both would otherwise send the same guidance twice, and the two copies would
 * disagree the moment someone edited one of them. */
export function effectiveDirection(
	direction: CreativeDirection,
	projectReferences: ProjectSelection,
	materials?: ProjectMaterials,
): CreativeDirection {
	if (materials && hasRoutableMaterials(materials)) return directionFromMaterials(materials);
	if (!isEmptyDirection(direction)) return direction;
	const prompt = projectReferences.prompt?.trim();
	return prompt
		? { raw: prompt, story: "", visual: prompt, voice: "", rules: "" }
		: EMPTY_CREATIVE_DIRECTION;
}

/** The preset identity snapshotted alongside the knobs. Undefined when a project
 *  predates the snapshot, in which case the directive simply omits the name. */
function styleMeta(config: Config): { name: string; description: string } | undefined {
	return config.styleName?.trim()
		? { name: config.styleName.trim(), description: config.styleDescription?.trim() ?? "" }
		: undefined;
}

export function agentContext(
	type: ContentType | null,
	config: Config,
	settings: GlobalSettings,
): ChatAgentContext {
	return {
		audience: config.audience?.trim() || undefined,
		targetDurationSec: type === "video" ? Number(config.length) || undefined : undefined,
		// Video Director: the chosen style, so the agent plans beats and emotions to
		// match the cinematic style rather than remapping after the fact. The knobs
		// travel too, because the server resolves camera/transition from them.
		style:
			type === "video" ? styleDirective(config.style ?? undefined, styleMeta(config)) : undefined,
		styleKnobs: type === "video" ? (config.style ?? undefined) : undefined,
		styleName: type === "video" ? config.styleName?.trim() || undefined : undefined,
		timelineTemplateId: type === "video" ? settings.timelineTemplateId || undefined : undefined,
		// Narration voice context (video) — drives longform TTS provider/voice/language.
		voiceProvider: type === "video" ? settings.voiceProvider || undefined : undefined,
		voice: type === "video" ? settings.voice || undefined : undefined,
		language: type === "video" ? settings.language || undefined : undefined,
	};
}
