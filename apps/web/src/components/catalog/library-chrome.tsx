/* The frame every library surface shares: the heading and empty state.
 *
 * The search box and the card style objects that used to live here are gone.
 * Search is now `library-toolbar.tsx`, one control for every surface; the cards
 * are `.collection-card` in library.css. Both were inline here so that an earlier
 * extraction could be checked against unchanged baselines — a constraint this
 * change spends deliberately.
 */
import React from "react";
import type { JSX } from "react";
import type { LibraryType } from "@models/core/routing.ts";
import { PageHeader } from "@design-system/components/page.tsx";
import { Chip } from "@design-system/components/chip.tsx";

/* Product vocabulary, not implementation vocabulary. "Defaulter" is an internal
 * term for the mechanism these records share and must not appear here; each surface
 * names the specific record instead. Elements are described as the blocks you place
 * on a timeline, NOT as a default source, because they never seeded anything — and
 * Custom Elements is a group inside that surface rather than the name of it. */
const HEADINGS = {
	references: {
		title: "References",
		blurb: "Images, products, and notes any content project can pull from.",
	},
	voices: { title: "Voices", blurb: "Voice catalogue for narration and dialogue." },
	presets: {
		title: "Project Presets",
		blurb: "A reusable starting bundle: Project Materials plus one Video Template.",
	},
	materials: {
		title: "Materials",
		blurb:
			"Reusable generation context — Story, Visual, Voice, and Rules a project generates from.",
	},
	templates: {
		title: "Video Templates",
		blurb: "Reusable video structure and timing: section titling, pacing, and audio policy.",
	},
	elements: {
		title: "Elements",
		blurb: "Plain text, five shapes, and motion compositions you create.",
	},
} satisfies Record<LibraryType, { title: string; blurb: string }>;

export function LibraryHeader({
	type,
	count,
	action,
}: {
	type: LibraryType;
	count?: number;
	action?: React.ReactNode;
}): JSX.Element {
	const h = HEADINGS[type];
	return (
		<PageHeader
			title={h.title}
			lead={h.blurb}
			action={
				<>
					{count != null && (
						<Chip>
							{count} {count === 1 ? "item" : "items"}
						</Chip>
					)}
					{action}
				</>
			}
		/>
	);
}
