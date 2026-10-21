import { Fragment } from "react";
import type { JSX } from "react";
import type { TtsVoiceOption } from "@maleo/shared";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { useVoiceSample } from "@hooks/timeline/use-voice-sample.ts";

/* Voice picker, with a per-voice audition control.
 *
 * A native <select> cannot carry a play button inside an <option>, and this is
 * the surface where the narrator is actually chosen — so the select is replaced
 * by a listbox of rows. The control appears only for a voice whose sample has
 * been baked; an unbaked voice stays listed and selectable rather than being
 * hidden or shown with a button that cannot work. */
/* Voices grouped by language, in catalogue order within each group.
 *
 * Grouping appears only when a provider actually offers more than one language.
 * A six-voice English catalogue reads fine flat, and forcing a single "ENGLISH"
 * heading over it would add structure the list does not need; fifty-four voices
 * across nine languages read as noise without it.
 *
 * `preferLang` floats the narration language the project is set to, so an
 * operator writing Japanese is not scrolling past forty other voices to reach
 * the five that can speak it. */
function groupVoicesByLanguage(
	voices: TtsVoiceOption[],
	preferLang: string | undefined,
): Array<{ lang: string; voices: TtsVoiceOption[] }> {
	const groups = new Map<string, TtsVoiceOption[]>();
	for (const voice of voices) {
		const lang = (voice.lang ?? "").toUpperCase() || "OTHER";
		const bucket = groups.get(lang);
		if (bucket) bucket.push(voice);
		else groups.set(lang, [voice]);
	}
	// Base-language match, so a project set to "en" floats both EN-US and EN-GB.
	const prefer = (preferLang ?? "").toUpperCase().split(/[-_]/)[0] ?? "";
	return [...groups.entries()]
		.map(([lang, langVoices]) => ({ lang, voices: langVoices }))
		.sort(
			(a, b) =>
				Number(b.lang.startsWith(prefer) && prefer !== "") -
				Number(a.lang.startsWith(prefer) && prefer !== ""),
		);
}

export function VoiceOptionList({
	voices,
	value,
	disabled,
	preferLang,
	onChange,
}: {
	voices: TtsVoiceOption[];
	value: string;
	disabled?: boolean;
	/** The project's narration language, floated to the top when it matches. */
	preferLang?: string;
	onChange: (voice: string) => void;
}): JSX.Element {
	const sample = useVoiceSample();
	if (disabled && voices.length === 0) return <p className="fc-cap-desc">No voices available</p>;

	const groups = groupVoicesByLanguage(voices, preferLang);
	const showHeadings = groups.length > 1;

	const renderVoice = (voice: TtsVoiceOption): JSX.Element => (
		<div
			key={voice.id}
			className="cv-voicelist-row"
			role="option"
			aria-selected={value === voice.id}
		>
			<button
				type="button"
				className={`cv-voicelist-pick ${value === voice.id ? "on" : ""}`}
				onClick={() => onChange(voice.id)}
			>
				<span>{voice.name}</span>
				{voice.desc ? <small>{voice.desc}</small> : null}
			</button>
			{voice.sampleUrl ? (
				<button
					type="button"
					className="cv-voicesample"
					aria-label={`${sample.isPlaying(voice.id) ? "Stop" : "Play"} ${voice.name} sample`}
					onClick={() => sample.play(voice.id, voice.sampleUrl!)}
				>
					{sample.isPlaying(voice.id) ? Ic.x(ICON.xs) : Ic.play(ICON.xs)}
				</button>
			) : null}
		</div>
	);

	return (
		<div className="cv-voicelist" role="listbox" aria-label="Voice">
			{/* The provider's own default: selectable, but there is no clip to audition. */}
			<div className="cv-voicelist-row" role="option" aria-selected={value === ""}>
				<button
					type="button"
					className={`cv-voicelist-pick ${value === "" ? "on" : ""}`}
					onClick={() => onChange("")}
				>
					<span>Provider default</span>
				</button>
			</div>
			{groups.map((group) => (
				<Fragment key={group.lang}>
					{showHeadings ? (
						<div className="cv-voicelist-group" role="presentation">
							{group.lang}
						</div>
					) : null}
					{group.voices.map(renderVoice)}
				</Fragment>
			))}
		</div>
	);
}
