/* Library > Elements: Text, Shapes and user-authored Motion. */
import { useCallback, useMemo, useState } from "react";
import type { JSX, ReactNode } from "react";
import type { ClipTemplateKind } from "@maleo/shared";
import { CustomTemplatesBlock } from "@components/clip-templates/custom-clip-templates.tsx";
import { BuiltInShapeTiles, BuiltInTextTiles, builtInCounts } from "./built-in-elements.tsx";
import { LibraryHeader } from "./library-chrome.tsx";
import { LibraryToolbar } from "./library-toolbar.tsx";
import { Chip } from "@design-system/components/chip.tsx";

/* Hoisted, not inline. The block memoises its loader on `kinds`, so an array literal in
 * the JSX gives it a new identity every render — which re-ran the fetch, set state, and
 * re-rendered, until the browser ran out of sockets. A module constant is stable. */
const CUSTOM_KINDS: ClipTemplateKind[] = ["text", "composition"];

type ElementGroup = "shapes" | "text" | "motion";

const GROUPS = [
	{ id: "text", label: "Text" },
	{ id: "shapes", label: "Shapes" },
	{ id: "motion", label: "Motion" },
] as const satisfies ReadonlyArray<{ id: ElementGroup; label: string }>;

function Group({
	title,
	hint,
	count,
	children,
}: {
	title: string;
	hint: string;
	count: number;
	children: ReactNode;
}): JSX.Element {
	return (
		<section className="catalog-el-group">
			<h2>
				{title}
				<Chip>{count}</Chip>
			</h2>
			<p>{hint}</p>
			{children}
		</section>
	);
}

export function ElementsLibrary(): JSX.Element {
	const [query, setQuery] = useState("");
	const [group, setGroup] = useState<ElementGroup | null>(null);
	/* The user-template block owns its fetch, so its count
	 * arrive from them rather than being known up front. */
	const [counts, setCounts] = useState<Record<string, number>>({});
	const setCount = useCallback((key: string, n: number): void => {
		setCounts((prev) => (prev[key] === n ? prev : { ...prev, [key]: n }));
	}, []);

	const builtIn = useMemo(() => builtInCounts(query), [query]);
	const total =
		builtIn.shapes +
		builtIn.text +
		(counts.text ?? 0) +
		(counts.shapes ?? 0) +
		(counts.motion ?? 0);

	const shows = (id: ElementGroup): boolean => group === null || group === id;

	return (
		<div className="pg">
			<LibraryHeader type="elements" count={total} />
			<LibraryToolbar
				query={query}
				onQuery={setQuery}
				placeholder="Search elements"
				groups={GROUPS}
				group={group}
				onGroup={setGroup}
				groupLabel="Filter by element family"
			/>

			<div className="catalog-el-groups">
				{shows("text") && (
					<Group
						title="Text"
						hint="Plain text. Style and animate each clip."
						count={builtIn.text + (counts.text ?? 0)}
					>
						<BuiltInTextTiles query={query} />
						<CustomTemplatesBlock
							group="text"
							kind="text"
							kinds={CUSTOM_KINDS}
							query={query}
							placeable={false}
							onPlace={() => undefined}
							onCount={(n) => setCount("text", n)}
						/>
					</Group>
				)}
				{shows("shapes") && (
					<Group
						title="Shapes"
						hint="Five shape primitives."
						count={builtIn.shapes + (counts.shapes ?? 0)}
					>
						<BuiltInShapeTiles query={query} />
						<CustomTemplatesBlock
							group="shapes"
							kind="text"
							kinds={CUSTOM_KINDS}
							query={query}
							placeable={false}
							onPlace={() => undefined}
							onCount={(n) => setCount("shapes", n)}
						/>
					</Group>
				)}
				{shows("motion") && (
					<Group
						title="Motion"
						hint="Compositions saved in this workspace."
						count={counts.motion ?? 0}
					>
						<CustomTemplatesBlock
							kind="text"
							group="motion"
							kinds={CUSTOM_KINDS}
							query={query}
							studio={{ aspect: 16 / 9 }}
							placeable={false}
							onPlace={() => undefined}
							onCount={(n) => setCount("motion", n)}
						/>
					</Group>
				)}
			</div>
		</div>
	);
}
