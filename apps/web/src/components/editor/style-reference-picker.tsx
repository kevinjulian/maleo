import { useState } from "react";
import type { JSX } from "react";
import type { RefImage } from "@maleo/shared";
import { SearchField } from "@design-system/components/search-field.tsx";
import { Frame } from "@design-system/components/frame.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { referenceTags } from "@models/references/reference-vocabulary.ts";

/* Global style: pick a reference image whose look applies to every generation.
 *
 * Rendered inline in its section rather than behind a modal, so picking a look never
 * leaves the panel. */
export function StyleReferencePicker({
	refs,
	value,
	onChange,
}: {
	refs: RefImage[];
	value: string;
	onChange: (id: string) => void;
}): JSX.Element {
	const [q, setQ] = useState("");
	// Prefer refs tagged "style"; offer an "All images" fallback toggle.
	const styleTagged = refs.filter((r) => referenceTags(r).includes("style"));
	const hasStyleTag = styleTagged.length > 0;
	const [allImages, setAllImages] = useState(!hasStyleTag);
	const scoped = allImages || !hasStyleTag ? refs : styleTagged;
	const selected = refs.find((r) => r.id === value) ?? null;
	const ql = q.trim().toLowerCase();
	const list = scoped.filter(
		(r) =>
			!ql ||
			(r.label + " " + (r.description || "") + " " + referenceTags(r).join(" "))
				.toLowerCase()
				.includes(ql),
	);
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			{selected && (
				<div className="fc-style-sel">
					<div style={{ width: 38, flexShrink: 0 }}>
						<Frame
							generated={!selected.imageUrl}
							src={selected.imageUrl}
							seed={selected.seed}
							aspect={1}
							w="100%"
							fit="contain"
						/>
					</div>
					<span className="fc-style-lbl">{selected.label}</span>
					<IconButton size="xs" title="Clear style" onClick={() => onChange("")}>
						{Ic.x(ICON.xs)}
					</IconButton>
				</div>
			)}
			<SearchField
				size="sm"
				label="Search references"
				placeholder="Search references…"
				value={q}
				onValueChange={setQ}
			/>
			{hasStyleTag && (
				<div className="cv-cat-filters">
					<button className={!allImages ? "on" : ""} onClick={() => setAllImages(false)}>
						Style ({styleTagged.length})
					</button>
					<button className={allImages ? "on" : ""} onClick={() => setAllImages(true)}>
						All images ({refs.length})
					</button>
				</div>
			)}
			{list.length === 0 ? (
				<p className="cv-cat-empty">No reference images yet — add some in the Reference Library.</p>
			) : (
				<div className="fc-style-grid">
					{value && (
						<button type="button" className="fc-style-card" onClick={() => onChange("")}>
							<div className="fc-style-none">{Ic.x(ICON.md)}</div>
							<span className="fc-style-card-lbl">None</span>
						</button>
					)}
					{list.map((r) => (
						<button
							key={r.id}
							type="button"
							className={`fc-style-card ${r.id === value ? "on" : ""}`}
							title={r.label}
							onClick={() => onChange(r.id)}
						>
							<Frame
								generated={!r.imageUrl}
								src={r.imageUrl}
								seed={r.seed}
								aspect={1}
								w="100%"
								fit="contain"
							/>
							<span className="fc-style-card-lbl">{r.label}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
