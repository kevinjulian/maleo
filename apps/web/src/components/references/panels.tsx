/* Maleo — Content-First Create · the speaker (voice) picker.

 * The three reference-browsing panels that used to live here — ReferencesPanel,
 * ReferenceLibraryPanel, and RefCatalogue in scene.tsx — are replaced by the one
 * ReferenceLibrary in library.tsx. What remains is the voice surface, which is a
 * different model: a Speaker has no image and is never cast into a frame. */
import { useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { resolveVoice } from "@models/references/voice-library.ts";
import type { Speaker, TtsVoiceOption } from "@maleo/shared";
import { useVoiceSample } from "@hooks/timeline/use-voice-sample.ts";

/* ════ Inline voice picker ════ */
interface VoicePickerProps {
	speakers: Speaker[];
	value: string | undefined;
	onChange: (id: string) => void;
	onManage?: () => void;
	/** Provider catalogue, supplied by the surface that already fetched it. A
	 *  Speaker carries no sample url of its own — it is resolved through here so
	 *  the picker never has to fetch, and shows no control when nothing matches. */
	voiceOptions?: TtsVoiceOption[];
}
export function VoicePicker({
	speakers,
	value,
	onChange,
	onManage,
	voiceOptions,
}: VoicePickerProps): JSX.Element {
	const [open, setOpen] = useState(false);
	const sample = useVoiceSample();
	const sampleUrlFor = (speaker: Speaker): string | null => {
		const match = (voiceOptions ?? []).find((v) => v.id === speaker.voiceId || v.id === speaker.id);
		return match?.sampleUrl ?? null;
	};
	const cur = speakers.find((s) => s.id === value) || speakers[0];
	const info = resolveVoice(cur);
	return (
		<div style={{ position: "relative" }}>
			<button className="cv-voicepick" onClick={() => setOpen((o) => !o)}>
				<span
					style={{
						width: 8,
						height: 8,
						borderRadius: 3,
						background: `oklch(0.6 0.15 ${info.hue})`,
					}}
				/>
				{info.name}
				<span style={{ color: "var(--muted)", display: "flex" }}>{Ic.chevD(ICON.xs)}</span>
			</button>
			{open && (
				<>
					<div
						aria-hidden="true"
						style={{ position: "fixed", inset: 0, zIndex: 40 }}
						onClick={() => setOpen(false)}
					/>
					<div className="cv-voicemenu">
						{speakers.map((c) => {
							const ci = resolveVoice(c);
							const url = sampleUrlFor(c);
							return (
								<div key={c.id} className="cv-voicemenu-row">
									<button
										className="cv-voicemenu-it"
										onClick={() => {
											onChange(c.id);
											setOpen(false);
										}}
									>
										<span
											style={{
												width: 8,
												height: 8,
												borderRadius: 3,
												background: `oklch(0.6 0.15 ${ci.hue})`,
											}}
										/>
										<span style={{ flex: 1, textAlign: "left" }}>{ci.name}</span>
										{c.id === value && (
											<span style={{ color: "var(--ai)" }}>{Ic.check(ICON.sm)}</span>
										)}
									</button>
									{url && (
										<button
											className="cv-voicesample"
											aria-label={`${sample.isPlaying(c.id) ? "Stop" : "Play"} ${ci.name} sample`}
											onClick={() => sample.play(c.id, url)}
										>
											{sample.isPlaying(c.id) ? Ic.x(ICON.xs) : Ic.play(ICON.xs)}
										</button>
									)}
								</div>
							);
						})}
						<button
							className="cv-voicemenu-it add"
							onClick={() => {
								setOpen(false);
								onManage?.();
							}}
							style={onManage ? {} : { display: "none" }}
						>
							{Ic.plus(ICON.sm)} Add voice
						</button>
					</div>
				</>
			)}
		</div>
	);
}
