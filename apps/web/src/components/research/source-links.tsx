/* The cited sources behind a piece of narration, as a collapsed list.
 *
 * One home for two surfaces: the story plan card renders it per planned section
 * at approval time, and the script view renders it per scene while prose is
 * being edited. They showed the same thing two ways before this moved here, and
 * a citation that reads differently depending on where you look at it is worse
 * than one that reads the same in both places.
 *
 * A quote here is not a claim the planner made about itself. `sourceEvidence`
 * survived `validateQuotedEvidence` on the server, which requires the
 * normalized quote to appear inside the excerpt that was actually retrieved —
 * url membership alone is rejected. So "evidence matches" means checked, and
 * "sources" means cited but unmatched.
 *
 * Presentational only. It never fetches, never revalidates, and never writes.
 */
import { useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { domainOf } from "@models/core/source-url.ts";
import { ChipButton } from "@design-system/components/chip.tsx";

export interface SourceLinksProps {
	/** Cited urls. A planned section can carry these with no matched quote. */
	urls: string[];
	/** Quotes that were validated against retrieved text, when there are any. */
	evidence?: Array<{ url: string; quote: string }>;
}

export function SourceLinks({ urls, evidence = [] }: SourceLinksProps): JSX.Element {
	const [open, setOpen] = useState(false);
	const matched = evidence.length > 0;
	return (
		<div style={{ fontSize: 11, color: "var(--muted)", display: "grid", gap: 4 }}>
			<ChipButton
				style={{ width: "fit-content" }}
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				title={matched ? "Show matched evidence" : "Show cited sources"}
			>
				{Ic.layers(ICON.xs)}{" "}
				{matched
					? `${evidence.length} evidence match${evidence.length === 1 ? "" : "es"}`
					: `${urls.length} source${urls.length === 1 ? "" : "s"}`}{" "}
				{open ? "▴" : "▾"}
			</ChipButton>
			{open && (
				<div style={{ display: "grid", gap: 6, paddingLeft: 4 }}>
					{(matched ? evidence : urls.map((url) => ({ url, quote: "" }))).map((item, i) => (
						<div key={`${item.url}:${i}`} style={{ display: "grid", gap: 2 }}>
							<a
								href={item.url}
								target="_blank"
								rel="noopener noreferrer"
								style={{ color: "var(--info)" }}
								title={item.url}
							>
								{domainOf(item.url)} ↗
							</a>
							{item.quote && (
								<div style={{ color: "var(--fg-dim)", lineHeight: 1.4 }}>“{item.quote}”</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
