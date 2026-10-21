/* Registered formatting the template vocabulary cannot express. Each reads the
 * arguments its template node binds, by name, and returns text. */
import {
	ownValue,
	type StoryPlannedReference,
	type StoryVisualDirectionRosterEntry,
	type TemplateFormatter,
	textOf,
} from "@maleo/shared";
import type { StoryPlanSection } from "../content-generator.ts";

/* Arguments arrive from template paths over typed builder inputs; a missing or
 * non-list argument reads as an empty list, as the replaced builders' `?? []` did. */
function list<T>(value: unknown): readonly T[] {
	// SAFETY: every binding of these formatters is a path to a list of T in its template's builder input.
	return Array.isArray(value) ? (value as readonly T[]) : [];
}
const fieldsOf = (item: unknown, fields: readonly string[]) =>
	Object.fromEntries(
		fields.map((field) => [
			field,
			item === null || typeof item !== "object" ? undefined : ownValue(item, field),
		]),
	);

export const PROMPT_FORMATTERS: ReadonlyMap<string, TemplateFormatter> = new Map<
	string,
	TemplateFormatter
>([
	/** How many items a list holds. */
	["count", (argument) => String(list(argument("list")).length)],
	/** A snake_case enum value read as words ("first_person" -> "first person"). */
	["underscoresAsSpaces", (argument) => textOf(argument("value")).replace(/_/g, " ")],
	/** The value as JSON, exactly as `JSON.stringify` writes it. */
	["json", (argument) => JSON.stringify(argument("value"))],
	/** An object as JSON, `{}` when absent. */
	["jsonObject", (argument) => JSON.stringify(argument("value") ?? {})],
	/** Each item reduced to the named fields, in that order, as JSON. */
	[
		"jsonPick",
		(argument) =>
			JSON.stringify(
				list(argument("value")).map((item) => fieldsOf(item, list<string>(argument("fields")))),
			),
	],
	/** One field of each item, as a JSON list. */
	[
		"jsonPluck",
		(argument) =>
			JSON.stringify(
				list(argument("value")).map((item) =>
					item === null || typeof item !== "object"
						? undefined
						: ownValue(item, String(argument("field"))),
				),
			),
	],
	/** Distinct items in first-seen order, joined. */
	[
		"joinUnique",
		(argument) => [...new Set(list<string>(argument("list")))].join(textOf(argument("sep"))),
	],
	/** The drafted beats as the sequence director reads them: narration, planned visuals and evidence. */
	[
		"sequenceBeats",
		(argument) =>
			JSON.stringify(
				list<StoryPlanSection>(argument("sections")).map((section) => ({
					beatId: section.semanticBeatId,
					title: section.title,
					narration: section.narration,
					plannedVisuals: (section.shots ?? [section.visualPrompt]).map((shot, index) => ({
						index,
						visualPrompt: typeof shot === "string" ? shot : shot.visualPrompt,
						proposedReferenceKeys: typeof shot === "string" ? [] : (shot.refKeys ?? []),
					})),
					operatorRequiredReferences: section.requiredReferences ?? [],
					sourceEvidence: section.sourceEvidence,
				})),
			),
	],
	/** The project roster, asset-free. */
	[
		"sequenceRoster",
		(argument) =>
			JSON.stringify(
				list<StoryVisualDirectionRosterEntry>(argument("roster")).map(
					({ id, role, label, description }) => ({ id, role, label, description }),
				),
			),
	],
	/** Provisional planned-reference candidates. */
	[
		"sequenceCandidates",
		(argument) =>
			JSON.stringify(
				list<StoryPlannedReference>(argument("plannedReferences")).map(
					({ key, role, label, description, visibilityMode, sectionIds }) => ({
						key,
						role,
						label,
						description,
						visibilityMode,
						sectionIds,
					}),
				),
			),
	],
]);
