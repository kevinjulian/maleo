import { PROMPT_FRAGMENTS, IMAGE_PROMPT_BLOCK_ORDER } from "./image-prompt-prompt-definitions.ts";
import { renderPromptParts } from "@maleo/shared";
import {
	defaultReferenceUseForRole,
	roleOf,
	type ImagePromptIntent,
	type ImagePromptReference,
	type ImageSubjectLock,
} from "@maleo/shared";
import type { ImageReferenceSupport } from "../providers/types.ts";

export interface CompiledImagePrompt {
	prompt: string;
	referenceUrls?: string[];
	warnings?: string[];
}

const BASE_NEGATIVE = [
	PROMPT_FRAGMENTS.BASE_NEGATIVEFragment0.parts[0],
	PROMPT_FRAGMENTS.BASE_NEGATIVEFragment1.parts[0],
	PROMPT_FRAGMENTS.BASE_NEGATIVEFragment2.parts[0],
	PROMPT_FRAGMENTS.BASE_NEGATIVEFragment3.parts[0],
	PROMPT_FRAGMENTS.BASE_NEGATIVEFragment4.parts[0],
	PROMPT_FRAGMENTS.BASE_NEGATIVEFragment5.parts[0],
	PROMPT_FRAGMENTS.BASE_NEGATIVEFragment6.parts[0],
];

function clean(value: string | undefined): string {
	return (value ?? "")
		.replace(/(^|[\s([{"'])@([^\s,).!?;:"'\]}][^,).!?;:"'\]}]*)/gu, "$1$2")
		.replace(/\s+/g, " ")
		.trim();
}

function unique(values: readonly (string | undefined)[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const item = clean(value);
		if (!item) continue;
		const key = item.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}

function sentence(label: string, values: readonly (string | undefined)[]): string {
	const parts = unique(values);
	return parts.length
		? renderPromptParts(PROMPT_FRAGMENTS.sentenceFragment0.parts, [
				label,
				parts.join(PROMPT_FRAGMENTS.sentenceFragment1.parts[0]),
			])
		: "";
}

function subjectLine(lock: ImageSubjectLock): string {
	const label = clean(lock.label);
	const descriptors = unique(lock.descriptors);
	if (!descriptors.length)
		return label ? renderPromptParts(PROMPT_FRAGMENTS.subjectLineFragment0.parts, [label]) : "";
	return renderPromptParts(PROMPT_FRAGMENTS.subjectLineFragment1.parts, [
		label,
		descriptors.join(PROMPT_FRAGMENTS.subjectLineFragment2.parts[0]),
	]);
}

function referenceName(ref: ImagePromptReference): string {
	return clean(ref.label) || clean(ref.entityId) || clean(ref.role);
}

function referenceDescription(ref: ImagePromptReference): string {
	return clean(ref.description) || referenceName(ref);
}

function referenceUseText(
	ref: ImagePromptReference,
	support: ImageReferenceSupport["mode"],
): string {
	const role = roleOf(ref.role);
	const use =
		ref.referenceUse ??
		(role ? defaultReferenceUseForRole(role) : PROMPT_FRAGMENTS.referenceUseTextFragment0.parts[0]);
	switch (use) {
		case PROMPT_FRAGMENTS.referenceUseTextFragment1.parts[0]:
			return PROMPT_FRAGMENTS.referenceUseTextFragment2.parts[0];
		case PROMPT_FRAGMENTS.referenceUseTextFragment3.parts[0]:
			return PROMPT_FRAGMENTS.referenceUseTextFragment4.parts[0];
		case PROMPT_FRAGMENTS.referenceUseTextFragment5.parts[0]:
			return PROMPT_FRAGMENTS.referenceUseTextFragment6.parts[0];
		case PROMPT_FRAGMENTS.referenceUseTextFragment7.parts[0]:
			if (support !== PROMPT_FRAGMENTS.referenceUseTextFragment8.parts[0])
				return PROMPT_FRAGMENTS.referenceUseTextFragment9.parts[0];
			return PROMPT_FRAGMENTS.referenceUseTextFragment10.parts[0];
	}
}

function referenceMap(
	refs: readonly ImagePromptReference[],
	support: ImageReferenceSupport["mode"],
): string {
	const subjects = refs.filter(
		(ref) => ref.role !== PROMPT_FRAGMENTS.referenceMapFragment0.parts[0],
	);
	if (!subjects.length) return "";
	const lines = subjects.map((ref, index) => {
		const name = referenceName(ref);
		return renderPromptParts(PROMPT_FRAGMENTS.referenceMapFragment1.parts, [
			index + 1,
			name,
			referenceDescription(ref),
			referenceUseText(ref, support),
			name,
		]);
	});
	const subjectCount = subjects.filter(
		(ref) =>
			ref.role === PROMPT_FRAGMENTS.referenceMapFragment2.parts[0] ||
			ref.role === PROMPT_FRAGMENTS.referenceMapFragment3.parts[0],
	).length;
	return renderPromptParts(PROMPT_FRAGMENTS.referenceMapFragment4.parts, [
		lines.join(PROMPT_FRAGMENTS.referenceMapFragment5.parts[0]),
		subjectCount >= 2 ? PROMPT_FRAGMENTS.referenceMapFragment6.parts[0] : "",
	]);
}

function referenceBrief(
	refs: readonly ImagePromptReference[],
	support: ImageReferenceSupport["mode"],
): string {
	const lines = refs.map((ref) => {
		const name = referenceName(ref);
		const role = clean(ref.role);
		return renderPromptParts(PROMPT_FRAGMENTS.referenceBriefFragment0.parts, [
			name,
			role,
			referenceDescription(ref),
			referenceUseText(ref, support),
		]);
	});
	return lines.length
		? renderPromptParts(PROMPT_FRAGMENTS.referenceBriefFragment1.parts, [
				lines.join(PROMPT_FRAGMENTS.referenceBriefFragment2.parts[0]),
			])
		: "";
}

export function compileImagePrompt(
	intent: ImagePromptIntent,
	support: ImageReferenceSupport,
): CompiledImagePrompt {
	const refs = intent.references;
	const nativeRefs =
		support.mode === PROMPT_FRAGMENTS.compileImagePromptFragment0.parts[0]
			? refs.slice(0, support.maxImages)
			: [];
	const referenceUrls = nativeRefs.map((ref) => clean(ref.url)).filter(Boolean);
	const subjectAvoid = intent.subjectLocks.flatMap((lock) => lock.mustAvoid);
	const fullFrame = intent.output.fullFrame
		? PROMPT_FRAGMENTS.compileImagePromptFragment1.parts[0]
		: "";
	const output = sentence(PROMPT_FRAGMENTS.compileImagePromptFragment2.parts[0], [
		intent.output.aspect,
		fullFrame,
	]);
	const subject = intent.subjectLocks
		.map(subjectLine)
		.filter(Boolean)
		.join(PROMPT_FRAGMENTS.compileImagePromptFragment3.parts[0]);
	const scene = sentence(PROMPT_FRAGMENTS.compileImagePromptFragment4.parts[0], [
		intent.scene.visualMoment,
		intent.scene.action,
		intent.scene.endState,
	]);
	const composition = sentence(PROMPT_FRAGMENTS.compileImagePromptFragment5.parts[0], [
		intent.composition?.shotType,
		intent.composition?.cameraAngle,
		intent.composition?.framing,
		intent.composition?.movement,
	]);
	const style = sentence(PROMPT_FRAGMENTS.compileImagePromptFragment6.parts[0], [
		intent.style?.medium,
		intent.style?.realism,
		intent.style?.visualTreatment,
	]);
	const lightingColor = sentence(PROMPT_FRAGMENTS.compileImagePromptFragment7.parts[0], [
		intent.lightingColor?.lighting,
		intent.lightingColor?.palette,
		intent.lightingColor?.mood,
	]);
	const include = sentence(
		PROMPT_FRAGMENTS.compileImagePromptFragment8.parts[0],
		intent.constraints.mustInclude,
	);
	const avoid = sentence(PROMPT_FRAGMENTS.compileImagePromptFragment9.parts[0], [
		...subjectAvoid,
		...intent.constraints.mustAvoid,
	]);
	const referenceText =
		support.mode === PROMPT_FRAGMENTS.compileImagePromptFragment10.parts[0]
			? referenceMap(nativeRefs, support.mode)
			: support.mode === PROMPT_FRAGMENTS.compileImagePromptFragment11.parts[0]
				? referenceBrief(refs, support.mode)
				: "";
	const weakDirectPlacement =
		support.mode === PROMPT_FRAGMENTS.compileImagePromptFragment12.parts[0]
			? []
			: refs
					.filter(
						(ref) => ref.referenceUse === PROMPT_FRAGMENTS.compileImagePromptFragment13.parts[0],
					)
					.map((ref) =>
						renderPromptParts(PROMPT_FRAGMENTS.compileImagePromptFragment14.parts, [
							referenceName(ref),
							support.mode,
						]),
					);
	const negative = sentence(PROMPT_FRAGMENTS.compileImagePromptFragment15.parts[0], [
		...BASE_NEGATIVE,
		...intent.negative,
	]);
	const blocks = {
		output,
		subject,
		referenceText,
		scene,
		composition,
		style,
		lightingColor,
		include,
		avoid,
		negative,
	};
	const prompt = IMAGE_PROMPT_BLOCK_ORDER.map((key) => blocks[key])
		.filter(Boolean)
		.join(PROMPT_FRAGMENTS.compileImagePromptFragment16.parts[0]);

	return {
		prompt,
		referenceUrls: referenceUrls.length ? referenceUrls : undefined,
		warnings: weakDirectPlacement.length ? weakDirectPlacement : undefined,
	};
}
