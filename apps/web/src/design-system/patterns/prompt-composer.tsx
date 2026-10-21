/* PromptComposer — write a prompt and send it.
 *
 * Chat, the image lab and the speech lab each built this: a growing textarea,
 * a send button, a row of context above and options below. They agreed on the
 * Enter rule only after a fix (plain Enter sends, Shift+Enter is a new line,
 * the Enter that confirms an input-method candidate does neither) and on
 * nothing else — two shapes, two send buttons, two focus treatments.
 *
 * It owns the text entry and the send gesture. It never clears the draft: the
 * feature decides when a submission was accepted and sets `value` itself, so a
 * failed send leaves the text where it was.
 */
import type { JSX, KeyboardEvent, ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { cn } from "@models/core/cn.ts";
import { isSubmitEnter } from "@models/core/keys.ts";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { Spinner } from "@design-system/components/spinner.tsx";
import "./prompt-composer.css";

/** The tallest the entry grows before it scrolls, in px. */
const MAX_INPUT_HEIGHT = 120;

export interface PromptComposerProps {
	/** The text entry's accessible name. A placeholder is not one. */
	label: string;
	value: string;
	onValueChange: (value: string, event: React.ChangeEvent<HTMLTextAreaElement>) => void;
	onSubmit: () => void;
	/** Whether a send would be accepted now. Defaults to "there is text". */
	canSubmit?: boolean;
	/** A send is in flight: the control reports it and further sends are ignored. */
	busy?: boolean;
	/** The entry cannot be typed in (no workspace, no provider). */
	disabled?: boolean;
	placeholder?: string;
	submitLabel: string;
	/** The send control's name while busy, such as "Generating image". */
	busyLabel?: string;
	submitIcon?: ReactNode;
	/** Above the box: what the prompt is about, what is queued, attachments. */
	context?: ReactNode;
	/** Below the text, inside the box: options such as ratio, voice, references. */
	tools?: ReactNode;
	/** Anchored to the box: a mention or command list, an options popover. */
	popup?: ReactNode;
	rows?: number;
	/** Lifts the box off a scrolling page it floats over. */
	elevated?: boolean;
	className?: string;
	inputRef?: Ref<HTMLTextAreaElement>;
	/** Runs before the send rule. Call `preventDefault()` to claim the key — a
	 *  command list taking Enter to choose an item, say. */
	onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
	/** Combobox wiring and caret tracking for an entry that drives a list. */
	inputProps?: Omit<
		TextareaHTMLAttributes<HTMLTextAreaElement>,
		| "value"
		| "onChange"
		| "onKeyDown"
		| "disabled"
		| "placeholder"
		| "rows"
		| "aria-label"
		| "className"
	>;
}

export function PromptComposer({
	label,
	value,
	onValueChange,
	onSubmit,
	canSubmit = value.trim() !== "",
	busy,
	disabled,
	placeholder,
	submitLabel,
	busyLabel,
	submitIcon,
	context,
	tools,
	popup,
	rows = 1,
	elevated,
	className,
	inputRef,
	onKeyDown,
	inputProps,
}: PromptComposerProps): JSX.Element {
	const ready = canSubmit && !busy && !disabled;
	const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		onKeyDown?.(event);
		if (event.defaultPrevented || !isSubmitEnter(event)) return;
		// Enter never adds a line here, whether or not the send is accepted.
		event.preventDefault();
		if (ready) onSubmit();
	};
	return (
		<div
			data-slot="prompt-composer"
			data-elevated={elevated || undefined}
			className={cn("ui-prompt", className)}
		>
			{context}
			<div className="ui-prompt-box">
				{popup}
				<div className="ui-prompt-row">
					<textarea
						{...inputProps}
						ref={inputRef}
						data-prompt="input"
						className="ui-prompt-input"
						aria-label={label}
						rows={rows}
						value={value}
						placeholder={placeholder}
						disabled={disabled}
						onChange={(event) => onValueChange(event.target.value, event)}
						onKeyDown={keyDown}
						onInput={(event) => {
							const el = event.currentTarget;
							el.style.height = "auto";
							el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
						}}
					/>
					<IconButton
						size="sm"
						data-prompt="submit"
						aria-label={busy ? (busyLabel ?? submitLabel) : submitLabel}
						title={submitLabel}
						aria-busy={busy || undefined}
						disabled={!ready && !busy}
						aria-disabled={busy || undefined}
						className="tw:rounded-full! tw:bg-primary! tw:text-primary-foreground!"
						onClick={() => {
							if (ready) onSubmit();
						}}
					>
						{busy ? <Spinner /> : (submitIcon ?? Ic.send(ICON.md))}
					</IconButton>
				</div>
				{tools != null && <div className="ui-prompt-tools">{tools}</div>}
			</div>
		</div>
	);
}
