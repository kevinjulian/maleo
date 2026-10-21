/* "Used by N projects · M diverged", on a preset row.
 *
 * The reverse of the editor's section tag: there, one project says which preset supplied an
 * element; here, one preset says which projects it supplies and which have drifted off it.
 * Both read the same stored provenance, so they cannot disagree — which is the point of
 * deriving it rather than keeping a counter.
 *
 * It answers the question the library could not answer before: is this preset still what
 * people use, or has everyone edited their way off it?
 *
 * Loaded per row, lazily, and silent on failure. A count that cannot be fetched should not
 * turn a working list into an error state, and an absent line is honest — it says nothing
 * rather than claiming zero.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { getContentPresetUsage, type PresetUsage } from "@api/presets.ts";
import { elementLabel } from "@models/presets/element-labels.ts";

function valueLabel(value: unknown): string {
	if (value === undefined) return "unset";
	if (value === null) return "none";
	if (typeof value === "string") return value || "empty";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		const json = JSON.stringify(value);
		return json && json.length > 64 ? `${json.slice(0, 61)}...` : json || "value";
	} catch {
		return "value";
	}
}

export function PresetUsageLine({ presetId }: { presetId: string }): JSX.Element | null {
	const [usage, setUsage] = useState<PresetUsage | null>(null);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		let live = true;
		void getContentPresetUsage(presetId)
			.then((next) => {
				if (live) setUsage(next);
			})
			.catch(() => {
				/* a missing count must not break the list */
			});
		return () => {
			live = false;
		};
	}, [presetId]);

	if (!usage) return null;
	if (usage.using === 0) {
		return (
			<div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
				Not used by any project yet
			</div>
		);
	}

	return (
		<div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
			<span>
				Used by {usage.using} {usage.using === 1 ? "project" : "projects"}
			</span>
			{usage.diverged > 0 && (
				<>
					{" · "}
					<button
						type="button"
						onClick={() => setOpen((prev) => !prev)}
						style={{
							background: "none",
							border: "none",
							padding: 0,
							font: "inherit",
							color: "var(--fg)",
							cursor: "pointer",
							textDecoration: "underline",
							textUnderlineOffset: 2,
						}}
						title="Projects that have edited their way off this preset"
					>
						{usage.diverged} diverged
					</button>
				</>
			)}
			{open && usage.projects.length > 0 && (
				<ul
					style={{
						listStyle: "none",
						margin: "6px 0 0",
						padding: 0,
						display: "flex",
						flexDirection: "column",
						gap: 3,
					}}
				>
					{usage.projects.map((project) => (
						<li
							key={project.id}
							style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}
						>
							<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
								{project.title}
							</span>
							{/* Naming the elements plus both values: "diverged" without saying in what
							    is a number nobody can act on, and a path without values still forces a
							    second trip to inspect the project. */}
							<span
								style={{
									color: "var(--fg-dim, var(--muted))",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{(project.divergedDetails?.length
									? project.divergedDetails
									: project.diverged.map((path) => ({
											path,
											projectValue: undefined,
											defaulterValue: undefined,
										}))
								)
									.map(
										(item) =>
											`${elementLabel(item.path)}: ${valueLabel(item.defaulterValue)} -> ${valueLabel(item.projectValue)}`,
									)
									.join("; ")}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
