/* Pushing an operator's value back into the defaulter that would otherwise supply it.
 *
 * The inverse of seeding, and the reason provenance is worth recording at all: without
 * it, an operator who liked their tweak had to retype it in the library. With it, the
 * tweak can be promoted to the thing that supplies it.
 *
 * Two rules make this safe, and both are here rather than at the call site:
 *
 *   FORK A FIXTURE. A shipped preset is read-only — the same rule the API enforces with
 *   a 409 that names the fork route. Pushing into one clones it into an operator-owned
 *   record first, and the project is repointed at the clone. The shipped preset is never
 *   edited, so a product update can still retune it.
 *
 *   THE CLAIM MOVES, IT DOES NOT DISAPPEAR. After a push the element is supplied by the
 *   target, so its source records the target — not the operator, and not nothing.
 *   Leaving it operator-owned would report the project as diverged from a preset it now
 *   agrees with, and dropping it would read as operator-owned anyway.
 *
 * What is NOT here: choosing which preset to push into, and counting how many other
 * projects the write affects. The first is a UI decision; the second needs a server
 * query, because a client cannot scan every project to find the ones drawing from a
 * given defaulter.
 */
import {
	entriesOf,
	defaulterSource,
	type ContentPresetBundle,
	type ProjectSelection,
	type StyleKnobs,
} from "@maleo/shared";
import type { InfographicStyle, PacingDevices } from "@maleo/shared";
import type { GlobalSettings } from "./creative-settings.ts";
import { withSources, type ElementSourceMap } from "./element-sources.ts";

export interface PushUpPlan {
	/** The target's bundle with the pushed values written into it. */
	bundle: ContentPresetBundle;
	/** True when the target ships in code, so it must be cloned before being written. */
	fork: boolean;
	/** Paths this plan actually wrote. A path the plan does not understand is skipped
	 *  rather than silently reported as pushed. */
	pushed: string[];
}

export function planPushUp(input: {
	paths: readonly string[];
	/** The preset being pushed into. */
	targetId: string;
	/* Whether that preset is a shipped fixture, which is what sets `fork`.
	 *
	 * Passed in rather than derived from the id: a fixture used to be recognisable by a
	 * `builtin:` prefix, but fixtures are ordinary rows now with ordinary ids, and only
	 * the row itself says what it is. */
	targetIsFixture: boolean;
	targetBundle: ContentPresetBundle;
	/** The project's current values, which are what gets promoted. */
	style: StyleKnobs | null;
	projectReferences: ProjectSelection;
	settings: GlobalSettings;
	pacingDevices: PacingDevices;
	infographicStyle: InfographicStyle;
	settingsPaths: Readonly<Record<keyof GlobalSettings, string>>;
	axisPaths: {
		config: string;
		projectReferences: string;
		pacingDevices: string;
		infographicStyle: string;
	};
}): PushUpPlan {
	// The bundle's `settings` is already `Record<string, unknown>` — the schema
	// leaves it open because `GlobalSettings` lives here, not in `@maleo/shared`.
	// Inference carries that; annotating it again only discards the evidence.
	const bundleSettings = { ...input.targetBundle.settings };
	let bundle: ContentPresetBundle = { ...input.targetBundle };
	const pushed: string[] = [];

	const fieldForPath = new Map<string, keyof GlobalSettings>(
		entriesOf(input.settingsPaths).map(([field, path]) => [path, field]),
	);

	for (const path of input.paths) {
		const field = fieldForPath.get(path);
		if (field) {
			bundleSettings[field] = input.settings[field];
		} else if (path === input.axisPaths.config) {
			bundle = { ...bundle, style: input.style };
		} else if (path === input.axisPaths.projectReferences) {
			bundle = { ...bundle, projectRefs: { ...input.projectReferences } };
		} else if (path === input.axisPaths.pacingDevices) {
			bundle = { ...bundle, pacingDevices: { ...input.pacingDevices } };
		} else if (path === input.axisPaths.infographicStyle) {
			bundle = { ...bundle, infographicStyle: { ...input.infographicStyle } };
		} else {
			// Not an element this plan knows how to promote. Skipping it keeps `pushed`
			// truthful, which matters because the caller records sources from it.
			continue;
		}
		pushed.push(path);
	}

	return {
		bundle: { ...bundle, settings: bundleSettings },
		fork: input.targetIsFixture,
		pushed,
	};
}

/** Attribute the pushed elements to the defaulter that now supplies them.
 *
 *  Called with the id the write LANDED on, which is the clone's id when a builtin was
 *  forked — recording the builtin's id would name a record the project no longer points
 *  at. */
export function recordPushedSources(
	pushed: readonly string[],
	landedDefaulterId: string,
	sources: ElementSourceMap,
): ElementSourceMap {
	return withSources(
		sources,
		pushed.map((path) => [path, defaulterSource("project-preset", landedDefaulterId)] as const),
	);
}

/** When a builtin is forked, move every element that still named the builtin onto the
 *  clone. Otherwise the group header reports two suppliers even though the project has
 *  one active preset after the push. Operator-owned elements stay operator-owned. */
export function repointForkedPresetSources(input: {
	sources: ElementSourceMap;
	fromDefaulterId: string;
	toDefaulterId: string;
}): ElementSourceMap {
	const moved: Array<readonly [string, ReturnType<typeof defaulterSource>]> = [];
	for (const [path, source] of Object.entries(input.sources)) {
		if (source.layer === "project-preset" && source.defaulterId === input.fromDefaulterId) {
			moved.push([path, defaulterSource("project-preset", input.toDefaulterId)]);
		}
	}
	return moved.length ? withSources(input.sources, moved) : input.sources;
}
