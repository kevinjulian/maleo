/* The voice catalogue: narration and dialogue voices, searchable and auditionable.
 *
 * A different asset kind from references — a narration catalogue, not a
 * visual/creative reference — which is why it keeps its own surface rather
 * than becoming a fourth tab under References.
 *
 * It lists EVERY registered provider, not just the effective one. This surface
 * binds nothing: it browses and it auditions, and both are reading. Restricting
 * it to the effective provider hid voices that were installed, healthy and
 * already baked, and made hearing one clip cost a change to what every project
 * renders with. The surfaces that BIND a voice still see the effective provider
 * alone — that list arrives as a separate field for exactly that reason.
 *
 * The play control is not a new capability. `/catalogue` has always sent each
 * voice's `sampleUrl`, and the scene picker and Project Settings have always
 * offered the control; this page received the field and dropped it, so the one
 * surface whose whole purpose is auditioning voices was the only one that could
 * not play them. It reuses `useVoiceSample`, whose single shared audio element is
 * what keeps "only one clip plays at a time" true ACROSS surfaces rather than
 * within each one.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";
import type { TtsProviderOption, TtsVoiceOption } from "@maleo/shared";
import { useContentCatalogue } from "@hooks/catalog/use-content-catalogue.ts";
import { sampleKey, useVoiceSample } from "@hooks/timeline/use-voice-sample.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { LibraryHeader } from "./library-chrome.tsx";
import {
	EmptyState,
	ErrorState,
	LoadingState,
	collectionPhase,
} from "@design-system/patterns/collection.tsx";
import { LibraryToolbar } from "./library-toolbar.tsx";
import { Chip } from "@design-system/components/chip.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { VoiceCloneCreate } from "./voice-clone-create.tsx";
import { deleteVoiceClone } from "@api/voice-clones.ts";

function voiceColor(hue: number): string {
	return `oklch(0.62 0.14 ${hue})`;
}

/** A voice with the provider it belongs to, which is part of its identity here:
 *  two providers may ship a voice with the same name, and one with the same id. */
export interface CatalogueRow {
	provider: string;
	providerLabel: string;
	voice: TtsVoiceOption;
}

/** Rows sharing a provider and a language, which is how the list is broken up. */
export interface RowSection {
	key: string;
	providerLabel: string;
	lang: string;
	rows: CatalogueRow[];
}

/* Sections rather than one run of 75 entries. The grouping keys are the provider
 * and language each voice already carries, so they cost no extra data — and the
 * pair is what makes two rows both reading "Bella" tell themselves apart. */
export function sectionize(rows: CatalogueRow[]): RowSection[] {
	const sections = new Map<string, RowSection>();
	for (const row of rows) {
		const lang = (row.voice.lang ?? "").toUpperCase() || "OTHER";
		const key = `${row.provider}:${lang}`;
		const found = sections.get(key);
		if (found) found.rows.push(row);
		else sections.set(key, { key, providerLabel: row.providerLabel, lang, rows: [row] });
	}
	return [...sections.values()];
}

/** Every provider's voices as one flat list of rows, in registry order. */
export function voiceRows(providers: readonly TtsProviderOption[]): CatalogueRow[] {
	return providers.flatMap((p) =>
		p.voices.map((voice) => ({ provider: p.id, providerLabel: p.label, voice })),
	);
}

/* Search runs over every provider unless one is chosen. Narrowing first would
 * make a name that exists under another provider read as "no results", which is
 * the opposite of what a library search is for. */
export function filterVoiceRows(
	rows: CatalogueRow[],
	query: string,
	provider: string | null,
): CatalogueRow[] {
	const ql = query.trim().toLowerCase();
	return rows.filter((row) => {
		if (provider && row.provider !== provider) return false;
		if (!ql) return true;
		const { name, desc, lang } = row.voice;
		return `${name} ${desc} ${lang ?? ""} ${row.providerLabel}`.toLowerCase().includes(ql);
	});
}

export function VoicesLibrary(): JSX.Element {
	const { voiceProviders, loading, failed, reload } = useContentCatalogue();
	const phase = collectionPhase({ count: voiceProviders.length, loading, failed });
	const sample = useVoiceSample();
	const [q, setQ] = useState("");
	const [provider, setProvider] = useState<string | null>(null);

	/* Chips come from the payload, never from a list held here — naming a
	 * provider in this file is what the accepted spec forbids, and is what made
	 * adding one an edit in every package that rendered one. */
	const providerChips = useMemo(
		() => voiceProviders.map((p) => ({ id: p.id, label: p.label })),
		[voiceProviders],
	);

	const rows = useMemo(() => voiceRows(voiceProviders), [voiceProviders]);
	/* Which providers can be cloned for comes from the payload, not from a name
	 * held here — the same rule the provider chips already follow. */
	const cloningProviders = useMemo(() => voiceProviders.filter((p) => p.clones), [voiceProviders]);
	const filtered = useMemo(() => filterVoiceRows(rows, q, provider), [rows, q, provider]);
	const ql = q.trim();

	const sections = useMemo(() => sectionize(filtered), [filtered]);
	// More than one section means the headings are earning their place.
	const showHeadings = sections.length > 1;

	return (
		<div className="pg">
			{/* What is listed, not what one provider happens to hold. */}
			<LibraryHeader type="voices" count={filtered.length} />
			<LibraryToolbar
				query={q}
				onQuery={setQ}
				placeholder="Search voices"
				groups={providerChips}
				group={provider}
				onGroup={setProvider}
				groupLabel="Filter by provider"
			/>
			<VoiceCloneCreate providers={cloningProviders} onCreated={reload} />
			{phase === "loading" ? (
				<LoadingState label="Loading voices…" />
			) : phase === "failed" ? (
				<ErrorState title="Could not load voices" onRetry={reload} retrying={loading} />
			) : filtered.length === 0 ? (
				<EmptyState label={`No voices${ql ? ` for “${q}”` : ""}.`} />
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640 }}>
					{sections.map((section) => (
						<div key={section.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
							{showHeadings && (
								<div className="catalog-voice-group">
									{section.providerLabel} · {section.lang}
								</div>
							)}
							{section.rows.map(({ provider: providerId, voice }) => {
								/* Provider-qualified: the shared player tracks one sounding clip
								   across every mounted picker, and a bare id would let this
								   provider's row light up for another provider's voice. */
								const key = sampleKey(providerId, voice.id);
								return (
									<div key={key} className="collection-card collection-card-row">
										<span
											style={{
												width: 30,
												height: 30,
												borderRadius: "50%",
												flexShrink: 0,
												background: voiceColor(voice.hue ?? 0),
											}}
										/>
										<div style={{ flex: 1, minWidth: 0 }}>
											<div style={{ fontSize: 13.5, fontWeight: 600 }}>{voice.name}</div>
											<div
												style={{
													fontSize: 12,
													color: "var(--muted)",
													whiteSpace: "nowrap",
													overflow: "hidden",
													textOverflow: "ellipsis",
												}}
											>
												{voice.desc}
											</div>
										</div>
										{/* Absent when this voice has not been baked. That is the ordinary
										    state for an environment that has never run the bake, so it
										    degrades to a name-only entry rather than a dead control. */}
										{voice.sampleUrl ? (
											<button
												type="button"
												className="cv-voicesample"
												aria-label={`${sample.isPlaying(key) ? "Stop" : "Play"} ${voice.name} sample`}
												onClick={() => sample.play(key, voice.sampleUrl!)}
											>
												{sample.isPlaying(key) ? Ic.x(ICON.xs) : Ic.play(ICON.xs)}
											</button>
										) : null}
										{voice.cloned && <Chip>Cloned</Chip>}
										<Chip>{voice.lang}</Chip>
										{/* A hide, not a delete: a metered synthesis still names this
										    voice, and tidying the library must not make that spend
										    unattributable. */}
										{voice.cloned && (
											<IconButton
												size="xs"
												danger
												aria-label={`Remove ${voice.name}`}
												onClick={() => {
													void deleteVoiceClone(voice.id).then(reload);
												}}
											>
												{Ic.trash(ICON.xs)}
											</IconButton>
										)}
									</div>
								);
							})}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
