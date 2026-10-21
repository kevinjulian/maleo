import type { JSX, ReactNode } from "react";
import { Select } from "@design-system/components/select.tsx";
import { Button, ButtonLink } from "@design-system/components/button.tsx";
import { Note } from "@design-system/components/note.tsx";
import { ToggleGroup, ToggleGroupItem } from "@design-system/components/toggle-group.tsx";
import { InspectorSection, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { Toolbar } from "@design-system/patterns/toolbar.tsx";

export type CaptionAvailability =
	| { state: "ready" }
	| { state: "busy" }
	| { state: "checking" }
	| { state: "unavailable"; reason: string; setup: boolean };

interface Props {
	mode: "first" | "regenerate";
	sourceOptions: Array<{ value: string; label: string }>;
	sourceValue: string;
	onSourceChange: (value: string) => void;
	rangeLabel: string | null;
	language: string;
	onLanguageChange: (value: string) => void;
	replaceEdited: boolean;
	onReplaceEditedChange: (replace: boolean) => void;
	availability: CaptionAvailability;
	onGenerate: () => void;
	onCancel?: () => void;
	/** Secondary entry beside Generate, such as SRT import on the first card. */
	secondary?: ReactNode;
}

/** One generate form for the empty-state card and the regenerate step, so the two never drift. */
export function CaptionGenerateForm(props: Props): JSX.Element {
	const { mode, availability } = props;
	const reason =
		availability.state === "checking"
			? "Checking caption worker…"
			: availability.state === "unavailable"
				? availability.reason
				: null;
	return (
		<InspectorSection
			title={mode === "first" ? "Generate captions" : "Regenerate captions"}
			defaultOpen
		>
			<PropertyRow label="Source" as="div">
				<Select
					aria-label="Caption source"
					value={props.sourceValue}
					onValueChange={props.onSourceChange}
					options={[{ value: "all", label: "All audible sources" }, ...props.sourceOptions]}
				/>
			</PropertyRow>
			{props.rangeLabel && <Note>Range {props.rangeLabel}</Note>}
			<PropertyRow label="Language" as="div">
				<Select
					aria-label="Caption language"
					value={props.language}
					onValueChange={props.onLanguageChange}
					options={[
						{ value: "auto", label: "Detect language" },
						{ value: "en", label: "English" },
						{ value: "id", label: "Indonesian" },
					]}
				/>
			</PropertyRow>
			{mode === "regenerate" && (
				<PropertyRow label="Edited captions" as="div">
					<ToggleGroup
						aria-label="Edited captions"
						size="sm"
						value={props.replaceEdited ? "replace" : "keep"}
						onValueChange={(value) => props.onReplaceEditedChange(value === "replace")}
					>
						<ToggleGroupItem value="keep">Keep my edits</ToggleGroupItem>
						<ToggleGroupItem value="replace">Replace edited captions in this range</ToggleGroupItem>
					</ToggleGroup>
				</PropertyRow>
			)}
			<Toolbar label="Caption generation">
				<Button
					variant="primary"
					size="sm"
					disabled={availability.state !== "ready"}
					onClick={props.onGenerate}
				>
					{mode === "first" ? "Generate captions" : "Regenerate"}
				</Button>
				{props.onCancel && (
					<Button variant="ghost" size="sm" onClick={props.onCancel}>
						Cancel
					</Button>
				)}
				{props.secondary}
			</Toolbar>
			{reason && (
				<Note
					as="div"
					tone={availability.state === "unavailable" ? "warn" : "muted"}
					role="status"
					data-caption-availability=""
				>
					{reason}{" "}
					{availability.state === "unavailable" && availability.setup && (
						<ButtonLink size="xs" variant="ghost" href="/settings">
							Caption setup
						</ButtonLink>
					)}
				</Note>
			)}
		</InspectorSection>
	);
}
