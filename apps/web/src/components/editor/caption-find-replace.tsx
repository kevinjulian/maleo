import { useState, type JSX } from "react";
import type { Clip } from "@maleo/shared";
import { Input } from "@design-system/components/input.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Note } from "@design-system/components/note.tsx";
import { captionReplacements } from "@models/captions/caption-find.ts";

interface Props {
	cues: readonly Clip[];
	locked: (track: number) => boolean;
	/** Applies every update as one undoable step; returns an error message or null. */
	apply: (updates: Array<{ id: string; text: string }>) => string | null;
}

export function CaptionFindReplace({ cues, locked, apply }: Props): JSX.Element {
	const [find, setFind] = useState("");
	const [replace, setReplace] = useState("");
	const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
	const plan = captionReplacements(cues, find, replace, locked);
	function replaceAll(): void {
		const error = apply(plan.updates);
		setResult(
			error
				? { ok: false, message: error }
				: {
						ok: true,
						message: `Replaced text in ${plan.updates.length} captions.${plan.skipped ? ` Skipped ${plan.skipped} locked or emptied captions.` : ""}`,
					},
		);
	}
	return (
		<div role="search" aria-label="Find and replace in captions" className="tw:space-y-1">
			<SearchField
				size="sm"
				label="Find in captions"
				value={find}
				onValueChange={(value) => {
					setFind(value);
					setResult(null);
				}}
			/>
			{find && (
				<div className="tw:flex tw:items-center tw:gap-2">
					<Input
						size="xs"
						aria-label="Replace with"
						placeholder="Replace with"
						value={replace}
						onChange={(event) => setReplace(event.target.value)}
					/>
					<Button size="xs" disabled={!plan.updates.length} onClick={replaceAll}>
						Replace all
					</Button>
				</div>
			)}
			{find && !result && (
				<Note tone="muted" role="status">
					{plan.matches} {plan.matches === 1 ? "caption matches" : "captions match"}
				</Note>
			)}
			{result && (
				<Note tone={result.ok ? "muted" : "error"} role={result.ok ? "status" : "alert"}>
					{result.message}
				</Note>
			)}
		</div>
	);
}
