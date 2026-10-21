/* Creating a cloned voice from a recording.
 *
 * Offered only for a provider that actually clones — the payload says which, so
 * this file names none. A provider that speaks its own declared voices cannot
 * use a recording, and offering the form under it would mint a voice nothing
 * can ever speak.
 *
 * The result is an ordinary catalogue voice. There is no "clones" tab and no
 * second list: a clone appears in the voice library beside declared voices,
 * which is the whole reason it is a row with an id rather than a file passed
 * around.
 */
import { useId, useState } from "react";
import type { ChangeEvent, JSX } from "react";
import type { TtsProviderOption } from "@maleo/shared";
import { VOICE_CLONE_AUDIO_ACCEPT, VOICE_CLONE_AUDIO_EXTENSIONS } from "@maleo/shared";
import { ApiError } from "@api/client.ts";
import { createVoiceClone } from "@api/voice-clones.ts";
import { Button } from "@design-system/components/button.tsx";
import { Field } from "@design-system/components/field.tsx";
import { Input } from "@design-system/components/input.tsx";
import { Select } from "@design-system/components/select.tsx";
import { Note } from "@design-system/components/note.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";

export interface VoiceCloneCreateProps {
	/** The providers that clone, as the catalogue reports them. */
	providers: readonly TtsProviderOption[];
	/** Called once a clone exists, so the catalogue re-reads. */
	onCreated: () => void;
}

/* The API's own words when it refuses. A machine-readable code reads better as
 * a sentence, and anything else falls back to the thrown message — never to a
 * generic failure, which is what sends an operator to the logs. */
function message(error: unknown): string {
	if (error instanceof ApiError) {
		const body: unknown = error.body;
		if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
			return body.error.replaceAll("_", " ");
		}
	}
	return error instanceof Error ? error.message : String(error);
}

export function VoiceCloneCreate({
	providers,
	onCreated,
}: VoiceCloneCreateProps): JSX.Element | null {
	const [open, setOpen] = useState(false);
	const [label, setLabel] = useState("");
	const [provider, setProvider] = useState(providers[0]?.id ?? "");
	const [file, setFile] = useState<File | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/* Remounts the file input to clear it. `Input` forwards no ref, and teaching
	 * it to — a 95-call-site primitive — is a larger change than this one control
	 * needs. */
	const [pickerKey, setPickerKey] = useState(0);
	const nameId = useId();
	const audioId = useId();
	const providerId = useId();
	const formatsId = useId();

	// No cloning provider registered is not an error state; there is simply
	// nothing to offer, so the control is absent rather than present and dead.
	if (providers.length === 0) return null;

	const chosen = providers.find((p) => p.id === provider) ?? providers[0]!;
	const unconfigured = chosen.health !== "ready";

	function reset(): void {
		setLabel("");
		setFile(null);
		setError(null);
		setPickerKey((k) => k + 1);
	}

	function pick(event: ChangeEvent<HTMLInputElement>): void {
		setFile(event.target.files?.[0] ?? null);
		setError(null);
	}

	async function submit(): Promise<void> {
		if (!file || !label.trim() || busy) return;
		setBusy(true);
		setError(null);
		try {
			await createVoiceClone({ provider: chosen.id, label: label.trim(), audio: file });
			reset();
			setOpen(false);
			onCreated();
		} catch (err) {
			// Shown, never swallowed: a refused upload with no message reads as a
			// silently broken button.
			setError(message(err));
		} finally {
			setBusy(false);
		}
	}

	if (!open) {
		return (
			<Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
				{Ic.plus(ICON.xs)} Clone a voice
			</Button>
		);
	}

	return (
		<section className="form" aria-label="Clone a voice">
			<Note tone="muted">
				A few seconds of clear speech. {chosen.label} narrates in the voice it hears.
			</Note>

			{providers.length > 1 && (
				<Field as="div">
					<label className="form-label" htmlFor={providerId}>
						Provider
					</label>
					<Select
						size="md"
						id={providerId}
						value={chosen.id}
						onValueChange={(e) => setProvider(e)}
						options={[...(providers.map((p) => ({ value: p.id, label: p.label })) ?? [])]}
					/>
				</Field>
			)}

			<Field as="div">
				<label className="form-label" htmlFor={nameId}>
					Name
				</label>
				<Input
					id={nameId}
					value={label}
					onChange={(e) => setLabel(e.target.value)}
					placeholder="Bu Sri"
					disabled={busy}
				/>
			</Field>

			<Field as="div">
				<label className="form-label" htmlFor={audioId}>
					Recording
				</label>
				<Input
					key={pickerKey}
					id={audioId}
					type="file"
					/* The exact formats, not `audio/*`. A wide accept let a file be
					 * chosen that the upload then refused — the worst order to learn
					 * it in. Both this string and the hint below come from one list. */
					accept={VOICE_CLONE_AUDIO_ACCEPT}
					aria-describedby={formatsId}
					onChange={pick}
					disabled={busy}
				/>
				<Note as="span" tone="muted" id={formatsId}>
					{VOICE_CLONE_AUDIO_EXTENSIONS.join(", ")}
				</Note>
			</Field>

			{/* Stated before the attempt, not discovered after an upload: the provider
			    is registered but has nowhere to send a synthesis. */}
			{unconfigured && (
				<Note tone="warn">
					{chosen.label} is not configured yet. The voice will be saved, but nothing can speak it
					until its service URL is set in Settings.
				</Note>
			)}
			{error && (
				<Note tone="error" role="alert">
					{error}
				</Note>
			)}

			<div className="form-actions">
				<Button
					variant="primary"
					size="sm"
					disabled={busy || !file || !label.trim()}
					onClick={() => void submit()}
				>
					{busy ? "creating…" : "Create voice"}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					onClick={() => {
						reset();
						setOpen(false);
					}}
				>
					Cancel
				</Button>
			</div>
		</section>
	);
}
