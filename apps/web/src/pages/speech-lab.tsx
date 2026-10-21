/* The speech lab route: a synthesis session over one workspace.
 *
 * The image lab's surface with a different medium in it — the same
 * `imagelab-chat` shell, the same feed, the same two-part sticky composer (input
 * row above, tool row below) — so moving between the two labs does not feel like
 * moving between two products. Only the controls the medium requires differ: a
 * voice picker where the image lab has an aspect control, an audition button it
 * has no use for, and a character allowance, because synthesis is synchronous and
 * a whole script would outlast the request.
 *
 * The gallery it feeds is its own route (/speech), the same split the image lab
 * and images gallery already use.
 */
import { useCallback, useRef, useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { SpeechBubble } from "@components/speech/speech-bubble.tsx";
import { ProviderOptions, VoiceOptions } from "@components/speech/composer-options.tsx";
import { useVoiceSample } from "@hooks/timeline/use-voice-sample.ts";
import { useSpeechSession, MAX_SYNTHESIS_CHARS } from "@hooks/speech-lab/use-speech-session.ts";
import { PromptComposer } from "@design-system/patterns/prompt-composer.tsx";
import "@components/speech/speech-lab.css";

export function SpeechLabPage(): JSX.Element {
	const feedRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const sample = useVoiceSample();
	const [voiceOpen, setVoiceOpen] = useState(false);
	const [providerOpen, setProviderOpen] = useState(false);

	/* The feed is scrolled by whoever appends to it — on history load and when a
	 * synthesis lands — rather than by an effect on the clip list, which would
	 * also fire on every unrelated re-render. */
	const scrollToBottom = useCallback(() => {
		requestAnimationFrame(() => {
			if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
		});
	}, []);

	const session = useSpeechSession({ onFeedGrew: scrollToBottom });
	/* The CHOSEN provider's voices, not the effective provider's. This surface
	 * persists nothing, so it can offer any registered provider without changing
	 * what the next project render uses. */
	const voices = session.voices;
	const picked = voices.find((v) => v.id === session.voice);
	const pickedProvider = session.providers.find((p) => p.id === session.provider);

	const reuse = (text: string): void => {
		session.setText(text);
		inputRef.current?.focus();
	};

	return (
		<div className="imagelab-chat">
			<div ref={feedRef} className="imagelab-feed">
				{session.clips.length === 0 && (
					<div className="imagelab-empty">
						{Ic.chat(ICON.display)}
						<span>
							Nothing synthesized in <strong>{session.workspace}</strong> yet. Type a line below.
						</span>
					</div>
				)}
				{session.clips.map((clip) => (
					<SpeechBubble
						key={clip.id}
						clip={clip}
						playing={sample.isPlaying(clip.id)}
						onPlay={() => clip.asset_url && sample.play(clip.id, clip.asset_url)}
						onReuse={reuse}
					/>
				))}
			</div>

			<div className="imagelab-composer-wrap">
				{session.error && <div className="spklab-notice">{session.error}</div>}
				{session.status && session.providers.length === 0 && (
					/* No provider at all offers no voices, so saying so is the only
					   honest thing the composer can do — a voice list would be choices
					   that fail at synthesis. */
					<div className="spklab-notice">
						No speech provider is configured, so nothing can be synthesized yet.
					</div>
				)}
				{pickedProvider && pickedProvider.health !== "ready" && (
					/* Registered but not reachable. Named, because "cannot synthesize"
					   with no reason sends an operator to the logs. */
					<div className="spklab-notice">
						{pickedProvider.label} is {pickedProvider.health} — choose another provider or set it up
						in Settings.
					</div>
				)}

				{providerOpen && (
					<ProviderOptions
						providers={session.providers}
						selected={session.provider}
						onSelect={(id) => {
							session.setProvider(id);
							setProviderOpen(false);
						}}
					/>
				)}

				{voiceOpen && (
					<VoiceOptions
						voices={voices}
						selected={session.voice}
						onSelect={(id) => {
							session.setVoice(id);
							setVoiceOpen(false);
						}}
					/>
				)}

				<PromptComposer
					elevated
					label="Text to synthesize"
					value={session.text}
					onValueChange={session.setText}
					onSubmit={() => void session.submit()}
					canSubmit={session.canSubmit}
					busy={session.busy}
					disabled={session.busy}
					placeholder="What should be said?"
					submitLabel="Synthesize"
					inputRef={inputRef}
					tools={
						<>
							{/* Rendered from the payload — no provider id or label is written
					    here, which is what keeps registering one from being an edit in
					    this file. Hidden when there is only one: a choice of one is not
					    a choice, and the control would only take up room. */}
							{session.providers.length > 1 && (
								<button
									type="button"
									className="imagelab-ratio-trigger"
									onClick={() => setProviderOpen((o) => !o)}
									aria-label="Speech provider"
								>
									{Ic.settings(ICON.sm)}
									<b>{pickedProvider?.label ?? "Provider"}</b>
								</button>
							)}

							<button
								type="button"
								className="imagelab-ratio-trigger"
								disabled={voices.length === 0}
								onClick={() => setVoiceOpen((o) => !o)}
								aria-label="Voice"
							>
								{Ic.chat(ICON.sm)}
								<b>{picked?.name ?? "Voice"}</b>
							</button>

							{/* Auditioning before spending a synthesis on it. Same control, same
					    clip, same single-playback rule as every other surface. */}
							{picked?.sampleUrl ? (
								<button
									type="button"
									className={`imagelab-tool-btn${sample.isPlaying(picked.id) ? " active" : ""}`}
									aria-label={`${sample.isPlaying(picked.id) ? "Stop" : "Play"} ${picked.name} sample`}
									onClick={() => sample.play(picked.id, picked.sampleUrl!)}
								>
									{sample.isPlaying(picked.id) ? Ic.x(ICON.md) : Ic.play(ICON.md)}
								</button>
							) : null}

							{/* The allowance, shown while typing rather than as a refusal after
					    submitting. The server enforces the same number. */}
							<span className={`spklab-count${session.overLimit ? " over" : ""}`}>
								{session.remaining} / {MAX_SYNTHESIS_CHARS}
							</span>
						</>
					}
				/>
			</div>
		</div>
	);
}
