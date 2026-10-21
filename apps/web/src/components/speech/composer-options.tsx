/* The speech composer's two option lists: which provider synthesizes, and which
 * of its voices speaks.
 *
 * They live here rather than inline in the page because they are the same list
 * twice — a popover of rows, one of which is active — and because the page has a
 * 200-line ceiling that composition, not logic, was pushing it through.
 *
 * Both are presentational. The decision about which provider can serve, and what
 * voices follow from it, is `resolveProviderChoice` in the session hook; these
 * render what it returned.
 */
import type { JSX } from "react";
import type { TtsProviderOption, TtsVoiceOption } from "@maleo/shared";

/** One popover of selectable rows, which is all either list is. */
function OptionPopover({ children }: { children: React.ReactNode }): JSX.Element {
	return (
		<div className="imagelab-option-popover">
			<div className="imagelab-option-list">{children}</div>
		</div>
	);
}

export function ProviderOptions({
	providers,
	selected,
	onSelect,
}: {
	providers: TtsProviderOption[];
	selected: string;
	onSelect: (id: string) => void;
}): JSX.Element {
	return (
		<OptionPopover>
			{providers.map((p) => (
				<button
					key={p.id}
					type="button"
					/* Offered but not selectable when it cannot serve. A choice that
					   fails at the point of use is worse than one withheld, because the
					   text and the voice are already chosen by the time it fails. */
					disabled={p.health !== "ready"}
					className={`imagelab-option-row${selected === p.id ? " active" : ""}`}
					onClick={() => onSelect(p.id)}
				>
					<strong>{p.label}</strong>
					<small>
						{p.health === "ready" ? `${p.voices.length} voices` : `${p.health} — not available`}
					</small>
				</button>
			))}
		</OptionPopover>
	);
}

export function VoiceOptions({
	voices,
	selected,
	onSelect,
}: {
	voices: TtsVoiceOption[];
	selected: string;
	onSelect: (id: string) => void;
}): JSX.Element {
	return (
		<OptionPopover>
			{/* Empty is a real state: a provider that cannot serve has no voices to
			    offer, and saying so beats an empty box. */}
			{voices.length === 0 && <div className="imagelab-ref-empty">No voices available.</div>}
			{voices.map((v) => (
				<button
					key={v.id}
					type="button"
					className={`imagelab-option-row${selected === v.id ? " active" : ""}`}
					onClick={() => onSelect(v.id)}
				>
					<strong>{v.name}</strong>
					<small>{v.desc}</small>
				</button>
			))}
		</OptionPopover>
	);
}
