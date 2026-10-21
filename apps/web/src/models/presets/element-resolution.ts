/* Resolving an element to a value AND the layer that supplied it.
 *
 * Two shapes, because the two scopes store differently. A project-scope element
 * already holds its value on the project, so resolution only has to look up who
 * supplied it. A render-scope element does not: the project points at a shared
 * timeline template and reads the field from there, so the value itself has to be
 * resolved through the cascade before anyone can say where it came from.
 *
 * Render order is override, then template, then shipped default. That middle step is
 * what makes a shared row shareable — one project diverging must not touch it.
 */
import {
	DEFAULT_TIMELINE_TEMPLATE,
	isOverridden,
	operatorSource,
	timelineTemplateInputSchema,
	type ElementSource,
	type TimelineTemplate,
	type TimelineTemplateInput,
} from "@maleo/shared";
import type { ElementSourceMap, RenderOverrides } from "./element-sources.ts";

export interface ResolvedElement<T> {
	value: T;
	source: ElementSource;
	/** Derived from `source.layer`, never stored beside it. */
	overridden: boolean;
}

/** Fields a render-scope element can address: the timeline template's own config. */
export type RenderElementField = keyof TimelineTemplateInput;

/** Resolve one render-scope element: the project's override if it has one, else the
 *  selected template's value, else the shipped default.
 *
 *  Presence is tested with `in`, not truthiness — `useData: false` and
 *  `musicVolume: 0` are legitimate overrides that a falsy check would discard, and
 *  discarding them would silently hand the value back to the template. */
export function resolveRenderElement<K extends RenderElementField>(
	field: K,
	overrides: RenderOverrides,
	template: TimelineTemplate | null,
): ResolvedElement<TimelineTemplateInput[K]> {
	/* An override is a persisted, untyped template parameter. It is read through
	 * the template's own schema, so one that does not fit the field is ignored
	 * and the element inherits instead of rendering a value of the wrong type. */
	const override =
		field in overrides
			? timelineTemplateInputSchema.safeParse({
					...DEFAULT_TIMELINE_TEMPLATE,
					[field]: overrides[field],
				})
			: null;
	if (override?.success) {
		return {
			value: override.data[field],
			source: operatorSource(),
			overridden: true,
		};
	}
	if (template) {
		return {
			value: template[field],
			// The template names itself, so a surface can say WHICH one supplied this
			// and open it. That is the whole point of recording a defaulterId.
			source: { layer: "render-template", defaulterId: template.id },
			overridden: false,
		};
	}
	// No template selected is a real state: `settings.timelineTemplateId` defaults to
	// "" and the render falls back to the shipped default. Saying `code-default` is
	// honest; naming a template that is not there would not be.
	return {
		value: DEFAULT_TIMELINE_TEMPLATE[field],
		source: { layer: "code-default", defaulterId: null },
		overridden: false,
	};
}

/** Resolve one project-scope element: the value is already held, so this reports who
 *  supplied it.
 *
 *  An element with no recorded source resolves to the operator layer. That is the
 *  safety property, not a convenience: a project persisted before provenance existed
 *  carries no sources, and treating those as inherited would let the first preset
 *  applied after the upgrade overwrite work somebody had already done. */
export function resolveProjectElement<T>(
	path: string,
	sources: ElementSourceMap,
	value: T,
): ResolvedElement<T> {
	const recorded = sources[path];
	const source = recorded ?? operatorSource();
	return { value, source, overridden: isOverridden(recorded) };
}
