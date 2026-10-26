import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { DEFAULT_MUSIC_EMOTION_CUES } from "@maleo/shared";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@design-system/components/popover.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";
import { get } from "@api/client.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";

import {
	StockAudioResults,
	type StockItem,
	type StockResponse,
} from "@components/timeline/media/stock-browser.tsx";
import { TextPresetPreview, TransitionPreview } from "./timeline-editor-panels.tsx";
import type { TimelineTemplatePreviewAudio } from "@api/templates.ts";
import { Button } from "@design-system/components/button.tsx";
import { AudioPreview } from "@design-system/components/audio-preview.tsx";

export const TIMELINE_TITLE_CHOICES = [
	{ value: "", label: "None", description: "No section title" },
	{ value: "plain", label: "Text", description: "Plain section title" },
] as const;

type PickerChoice<T extends string> = { value: T; label: string; description?: string };

function Chevron(): JSX.Element {
	return Ic.chevR(ICON.sm);
}

function PreviewPicker<T extends string>({
	label,
	value,
	choices,
	disabled,
	onChange,
	renderPreview,
}: {
	label: string;
	value: T;
	choices: readonly PickerChoice<T>[];
	disabled?: boolean;
	onChange: (value: T) => void;
	renderPreview: (choice: PickerChoice<T>) => ReactNode;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const [previewValue, setPreviewValue] = useState<T>(value);
	const selected = choices.find((choice) => choice.value === value) ?? choices[0]!;
	const previewChoice = choices.find((choice) => choice.value === previewValue) ?? selected;
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) setPreviewValue(value);
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="tl2-selection-trigger"
					disabled={disabled}
					aria-label={`Choose ${label}`}
				>
					<span>
						<b>{selected.label}</b>
						<small>{selected.description}</small>
					</span>
					<Chevron />
				</button>
			</PopoverTrigger>
			<PopoverContent className="tl2-selection-popover" align="start" sideOffset={6}>
				<PopoverHeader>
					<PopoverTitle>{label}</PopoverTitle>
				</PopoverHeader>
				<div className="tl2-selection-featured" aria-live="polite">
					{renderPreview(previewChoice)}
				</div>
				<div className="tl2-selection-grid" role="listbox" aria-label={label}>
					{choices.map((choice) => (
						<button
							key={choice.value || "none"}
							type="button"
							className={`tl2-selection-option ${choice.value === value ? "on" : ""}`}
							role="option"
							aria-selected={choice.value === value}
							autoFocus={choice.value === value}
							onMouseEnter={() => setPreviewValue(choice.value)}
							onFocus={() => setPreviewValue(choice.value)}
							onClick={() => {
								onChange(choice.value);
								setOpen(false);
							}}
						>
							<span>
								<b>{choice.label}</b>
								<small>{choice.description}</small>
							</span>
						</button>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}

export function TitlePresetPicker({
	label,
	value,
	disabled,
	onChange,
}: {
	label: string;
	value: "plain" | "";
	disabled?: boolean;
	onChange: (value: "plain" | "") => void;
}): JSX.Element {
	return (
		<PreviewPicker
			label={label}
			value={value}
			choices={TIMELINE_TITLE_CHOICES}
			disabled={disabled}
			onChange={onChange}
			renderPreview={(choice) =>
				choice.value ? (
					<TextPresetPreview preset="plain" content="Section title" />
				) : (
					<span className="tl2-selection-empty">No title</span>
				)
			}
		/>
	);
}

export function TransitionPresetPicker<T extends string>({
	value,
	choices,
	onChange,
}: {
	value: T;
	choices: readonly T[];
	onChange: (value: T) => void;
}): JSX.Element {
	const options = choices.map((choice) => ({
		value: choice,
		label: choice.replaceAll("_", " "),
		description: "Scene-to-scene transition",
	}));
	return (
		<PreviewPicker
			label="Scene transition"
			value={value}
			choices={options}
			onChange={onChange}
			renderPreview={(choice) => <TransitionPreview type={choice.value} />}
		/>
	);
}

const QUICK_SFX = [
	"subtle transition stinger",
	"whoosh transition",
	"soft swoosh accent",
	"short cinematic riser",
	"soft click transition",
	"subtle pop accent",
	"gentle interface tick",
];
/* Derived from the shipped palette so the suggestions can never drift from the cues
 * the product actually resolves — the first hand-written version of this list still
 * offered "low tense drone" and "uplifting rising strings" after both were retired
 * for returning zero results from the provider. */
const QUICK_MUSIC = Object.values(DEFAULT_MUSIC_EMOTION_CUES).map((entry) => entry.cue);

/* The picker serves both stock libraries: SFX come from Freesound, background music
 * from Maleo's curated library. Only search type, suggestions, and setup hint
 * differ, so the two share one control rather than one being a copy of the other. */
export function StockSfxPicker({
	label,
	value,
	audio,
	kind = "sfx",
	onChange,
}: {
	label: string;
	value: string;
	audio: TimelineTemplatePreviewAudio | null;
	kind?: "sfx" | "music";
	onChange: (value: string, audio: TimelineTemplatePreviewAudio | null) => void;
}): JSX.Element {
	const isMusic = kind === "music";
	const noun = isMusic ? "music" : "SFX";
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState(value);
	const [submitted, setSubmitted] = useState(value);
	const [data, setData] = useState<StockResponse | null>(null);
	const [loading, setLoading] = useState(false);
	useEffect(() => {
		if (!open) return;
		let active = true;
		setLoading(true);
		void get<StockResponse>(
			`/api/stock/search?type=${kind}${submitted ? `&q=${encodeURIComponent(submitted)}` : ""}`,
		)
			.then((response) => {
				if (active) setData(response);
			})
			.catch(() => {
				if (active) setData({ configured: true, items: [], error: "search failed" });
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [open, submitted, kind]);
	const selectedTitle = useMemo(() => value || "None", [value]);
	const choose = (item: StockItem): void => {
		onChange(item.title?.trim() || submitted || item.id, {
			url: item.url,
			title: item.title,
			author: item.author,
			durationSec: item.dur,
		});
		setOpen(false);
	};
	const search = (next: string): void => {
		setQuery(next);
		setSubmitted(next.trim());
	};
	return (
		<div className="tl2-sfx-picker">
			<Popover
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					if (next && value) {
						setQuery(value);
						setSubmitted(value);
					}
				}}
			>
				<PopoverTrigger asChild>
					<button type="button" className="tl2-selection-trigger" aria-label={`Choose ${label}`}>
						<span>
							<b>{selectedTitle}</b>
							<small>Search and preview stock {noun}</small>
						</span>
						<Chevron />
					</button>
				</PopoverTrigger>
				<PopoverContent
					className="tl2-selection-popover tl2-sfx-popover"
					align="start"
					sideOffset={6}
				>
					<PopoverHeader>
						<PopoverTitle>{label}</PopoverTitle>
					</PopoverHeader>
					<form
						className="tw:mb-2 tw:flex tw:items-center tw:gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							search(query);
						}}
					>
						<SearchField
							size="sm"
							autoFocus
							label={`Search stock ${noun}`}
							placeholder={`Search stock ${noun}…`}
							value={query}
							onValueChange={setQuery}
						/>
						<Button variant="primary" size="sm" type="submit">
							Search
						</Button>
					</form>
					<div className="tl2-sfx-quick" aria-label={`Suggested ${noun}`}>
						{(isMusic ? QUICK_MUSIC : QUICK_SFX).map((cue) => (
							<button type="button" key={cue} onClick={() => search(cue)}>
								{cue}
							</button>
						))}
					</div>
					<button
						type="button"
						className={`tl2-sfx-none ${value ? "" : "on"}`}
						onClick={() => {
							onChange("", null);
							setOpen(false);
						}}
					>
						{Ic.x(ICON.xs)} No {noun}
					</button>
					{submitted && (
						<button
							type="button"
							className="tl2-sfx-use-query"
							onClick={() => {
								onChange(submitted, null);
								setOpen(false);
							}}
						>
							{Ic.check(ICON.xs)} Use “{submitted}” as cue
						</button>
					)}
					<div className="tl2-sfx-results">
						{loading ? (
							<p className="tl2-picker-state">
								<span className="cv-spin" /> Searching…
							</p>
						) : !data?.configured ? (
							<p className="tl2-picker-state">
								{data?.note ?? `Configure ${noun} in Settings for stock preview.`}
							</p>
						) : data?.items.length ? (
							<StockAudioResults
								items={data.items}
								isSelected={(item) => item.title === value}
								onSelect={choose}
							/>
						) : (
							<p className="tl2-picker-state">
								{data?.error ? `Search error: ${data.error}` : `No ${noun} found.`}
							</p>
						)}
					</div>
				</PopoverContent>
			</Popover>
			{audio?.url && (
				<AudioPreview
					className="fc-music-audio tl2-selected-sfx-audio"
					src={audio.url}
					durationSec={audio.durationSec}
					label={label}
				/>
			)}
		</div>
	);
}
