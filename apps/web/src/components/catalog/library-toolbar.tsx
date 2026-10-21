/* The one toolbar every library surface searches and filters from.
 *
 * Before this, search was in six places and behaved six ways: References put a
 * tab strip above it and dropped it entirely on Products, Voices and Materials
 * had a bare input, Elements had a different bare input, Project Presets had no
 * search at all. Nothing about a library surface justified any of that — the
 * differences were the order the surfaces were written in.
 *
 * Group filters live here too rather than in each surface's body, because a
 * group chip and a query are one question ("show me these") and answering it in
 * two different regions of the page is what made the filters easy to miss.
 * Groups stay optional: a surface with no meaningful taxonomy renders search
 * alone, which is not the same thing as inventing chips it cannot fill.
 *
 * `null` is the unfiltered state and is a real value, not the absence of one —
 * Materials renders all four group sections when no chip is active and one when
 * a chip is, so the toolbar has to be able to say "no chip" out loud.
 */
import type { JSX } from "react";
import { ChipButton } from "@design-system/components/chip.tsx";
import { Toolbar } from "@design-system/patterns/toolbar.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";

export interface LibraryGroup<T extends string> {
	id: T;
	label: string;
}

export interface LibraryToolbarProps<T extends string> {
	query: string;
	onQuery: (value: string) => void;
	/** Names what is being searched, e.g. "Search materials". */
	placeholder: string;
	/** Omit for a surface with no meaningful groups; the toolbar then renders search alone. */
	groups?: ReadonlyArray<LibraryGroup<T>>;
	/** `null` means no group filter is active — every group shows. */
	group?: T | null;
	onGroup?: (group: T | null) => void;
	/** Label for the group row, read by screen readers. Defaults to "Filter by group". */
	groupLabel?: string;
	/** Whether the unfiltered state is offered. False for a surface whose groups
	 *  render through different components and so have no combined view —
	 *  References is Images, Products or Notes, never all three at once. An All
	 *  chip there would be a control that can never read as active. */
	allowAll?: boolean;
	secondaryGroups?: ReadonlyArray<LibraryGroup<string>>;
	secondaryGroup?: string | null;
	onSecondaryGroup?: (group: string | null) => void;
	secondaryGroupLabel?: string;
}

export function LibraryToolbar<T extends string>(props: LibraryToolbarProps<T>): JSX.Element {
	const {
		query,
		onQuery,
		placeholder,
		groups,
		group = null,
		onGroup,
		groupLabel = "Filter by group",
		allowAll = true,
		secondaryGroups,
		secondaryGroup = null,
		onSecondaryGroup,
		secondaryGroupLabel = "Filter by type",
	} = props;
	/* More than one group means the chips are earning their place — the same rule
	 * `voices-library.tsx` already states for its section headings, and for the
	 * same reason. A filter row offering exactly one option filters nothing: it
	 * renders "All" beside the only value, and choosing either shows the same
	 * list. That is chrome describing the data rather than acting on it.
	 *
	 * `> 0` was invisible for as long as every surface that passed `groups` had
	 * several. Voices is the surface that exposed it, because it derives its
	 * chips from the providers the payload happens to carry, and a deployment
	 * with one configured provider is the ordinary case rather than the edge. */
	const showGroups = groups != null && groups.length > 1 && onGroup != null;
	const showSecondaryGroups =
		secondaryGroups != null && secondaryGroups.length > 1 && onSecondaryGroup != null;

	const renderGroups = <U extends string>(
		items: ReadonlyArray<LibraryGroup<U>>,
		active: U | null,
		onChange: (group: U | null) => void,
		label: string,
		withAll: boolean,
	): JSX.Element => (
		<div className="catalog-groups" role="group" aria-label={label}>
			{withAll && (
				<ChipButton variant="inline" on={active === null} onClick={() => onChange(null)}>
					All
				</ChipButton>
			)}
			{items.map((g) => (
				<ChipButton
					key={g.id}
					variant="inline"
					on={active === g.id}
					onClick={() => onChange(withAll && active === g.id ? null : g.id)}
				>
					{g.label}
				</ChipButton>
			))}
		</div>
	);

	return (
		<Toolbar label={placeholder} className="collection-toolbar collection-toolbar-stack">
			<SearchField
				className="catalog-search"
				label={placeholder}
				value={query}
				onValueChange={onQuery}
			/>

			{showGroups && renderGroups(groups, group, onGroup, groupLabel, allowAll)}

			{showSecondaryGroups &&
				renderGroups(secondaryGroups, secondaryGroup, onSecondaryGroup, secondaryGroupLabel, true)}
		</Toolbar>
	);
}
