/* Library > Elements — the placeable timeline building blocks, browsable.
 *
 * This surface used to be Custom Elements: four editor panels stacked in a
 * 420px column, listing only the blocks an operator had saved. The menu said
 * "Elements" and showed none of the elements that ship with the product, so the
 * page contradicted its own label and was empty in a fresh workspace.
 *
 * It now lists every placeable family — built-in Text, built-in Motion, built-in
 * Data, the operator's own Custom Elements, and Motion presets — with Custom
 * Elements as one group inside it rather than the name of the whole thing.
 *
 * Nothing here places anything. Placing needs a timeline and a playhead and the
 * library has neither, so the built-in tiles carry no action and the custom
 * block runs with `placeable={false}`. What the library is for is finding,
 * inspecting and managing the records themselves.
 */
import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import type { ClipTemplateKind } from "@maleo/shared";
import { CustomTemplatesBlock } from "@components/clip-templates/custom-clip-templates.tsx";
import { MotionPresetLibraryBlock } from "@components/timeline/motion/motion-editor.tsx";
import {
	BuiltInBasicTiles,
	BuiltInShapeTiles,
	BuiltInDataTiles,
	BuiltInMotionTiles,
	BuiltInTextTiles,
	builtInCounts,
} from "./built-in-elements.tsx";
import { LibraryHeader } from "./library-chrome.tsx";
import { LibraryToolbar } from "./library-toolbar.tsx";
import { Chip } from "@design-system/components/chip.tsx";

/* Hoisted, not inline. The block memoises its loader on `kinds`, so an array literal in
 * the JSX gives it a new identity every render — which re-ran the fetch, set state, and
 * re-rendered, until the browser ran out of sockets. A module constant is stable. */
const CUSTOM_KINDS: ClipTemplateKind[] = ["text", "data", "composition"];

type ElementGroup = "basic" | "shapes" | "text" | "motion" | "data" | "custom" | "motion-presets";

const GROUPS = [
	{ id: "basic", label: "Basic" },
	{ id: "shapes", label: "Shapes" },
	{ id: "text", label: "Text" },
	{ id: "motion", label: "Motion" },
	{ id: "data", label: "Data" },
	{ id: "custom", label: "Custom Elements" },
	{ id: "motion-presets", label: "Motion presets" },
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
	children: JSX.Element;
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
	/* The custom and motion-preset blocks own their own fetches, so their counts
	 * arrive from them rather than being known up front. */
	const [counts, setCounts] = useState<Record<string, number>>({});
	const setCount = useCallback((key: string, n: number): void => {
		setCounts((prev) => (prev[key] === n ? prev : { ...prev, [key]: n }));
	}, []);

	const builtIn = useMemo(() => builtInCounts(query), [query]);
	const total =
		builtIn.basic +
		builtIn.shapes +
		builtIn.text +
		builtIn.motion +
		builtIn.data +
		(counts.custom ?? 0) +
		(counts.motionPresets ?? 0);

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
				{shows("basic") && (
					<Group title="Basic" hint="Static text. Add motion with keyframes." count={builtIn.basic}>
						<BuiltInBasicTiles query={query} />
					</Group>
				)}
				{shows("shapes") && (
					<Group title="Shapes" hint="Rectangle and Circle primitives." count={builtIn.shapes}>
						<BuiltInShapeTiles query={query} />
					</Group>
				)}
				{shows("text") && (
					<Group
						title="Text"
						hint="Styled text presets — a title, a stat, a quote."
						count={builtIn.text}
					>
						<BuiltInTextTiles query={query} />
					</Group>
				)}
				{shows("motion") && (
					<Group
						title="Motion"
						hint="Animated compositions that ship with the product."
						count={builtIn.motion}
					>
						<BuiltInMotionTiles query={query} />
					</Group>
				)}
				{shows("data") && (
					<Group
						title="Data"
						hint="Charts and callouts that render a number or a series."
						count={builtIn.data}
					>
						<BuiltInDataTiles query={query} />
					</Group>
				)}
				{shows("custom") && (
					<Group
						title="Custom Elements"
						hint="Blocks saved in this workspace. Edit, copy or delete them here."
						count={counts.custom ?? 0}
					>
						<CustomTemplatesBlock
							kind="text"
							kinds={CUSTOM_KINDS}
							query={query}
							studio={{ aspect: 16 / 9 }}
							placeable={false}
							onPlace={() => undefined}
							onCount={(n) => setCount("custom", n)}
						/>
					</Group>
				)}
				{shows("motion-presets") && (
					<Group
						title="Motion presets"
						hint="Reusable keyframe motion applied to a clip."
						count={counts.motionPresets ?? 0}
					>
						<MotionPresetLibraryBlock query={query} onCount={(n) => setCount("motionPresets", n)} />
					</Group>
				)}
			</div>
		</div>
	);
}
