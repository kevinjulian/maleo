/* Maleo option selection. Base UI owns keyboard selection; VUI owns phone
 * modality/history. Both presentations render the same typed option list. */
import {
	useEffect,
	useId,
	useRef,
	useState,
	type ButtonHTMLAttributes,
	type JSX,
	type ReactElement,
	type ReactNode,
} from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { oneOf } from "@maleo/shared";
import { cn } from "@models/core/cn.ts";
import { FLOATING_ATTR, useFloatingContainer } from "@hooks/ui/use-overlay.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { fieldClass, type FieldSize } from "./field-recipe.ts";
import { Sheet } from "./sheet.tsx";
import { IconButton } from "./icon-button.tsx";
import "./select.css";

export interface SelectOption {
	value: string | number;
	label: ReactNode;
	icon?: ReactNode;
	description?: ReactNode;
	disabled?: boolean;
	group?: string;
}
export type SelectWidth = "auto" | "full";
export type SelectProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"size" | "value" | "defaultValue" | "onChange" | "children"
> & {
	options: readonly SelectOption[];
	value?: string | number | null;
	defaultValue?: string | number;
	onValueChange?: (value: string) => void;
	size?: FieldSize;
	width?: SelectWidth | null;
	required?: boolean;
	phoneBreakpoint?: number;
	trigger?: ReactElement<{ children?: ReactNode }>;
	placeholder?: string;
};

export function Select({
	options,
	value,
	defaultValue,
	onValueChange,
	size = "sm",
	width,
	phoneBreakpoint = 640,
	trigger,
	placeholder = "Choose…",
	name,
	form,
	required,
	disabled,
	id,
	className,
	...rest
}: SelectProps): JSX.Element {
	const generatedId = useId(),
		triggerRef = useRef<HTMLButtonElement>(null),
		typingIntent = useRef(false);
	const [local, setLocal] = useState(String(defaultValue ?? options[0]?.value ?? ""));
	const current = value !== undefined ? String(value ?? "") : local;
	const [open, setOpen] = useState(false);
	const query = `(max-width: ${phoneBreakpoint - (phoneBreakpoint === 640 ? 1 : 0)}px)`;
	const [phone, setPhone] = useState(
		() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
	);
	const container = useFloatingContainer();
	const [editor, setEditor] = useState(phoneBreakpoint === 860);
	useEffect(() => {
		const mq = window.matchMedia?.(query);
		if (!mq) return;
		const change = () => setPhone(mq.matches);
		change();
		mq.addEventListener("change", change);
		return () => mq.removeEventListener("change", change);
	}, [query]);
	useEffect(() => {
		const owner = triggerRef.current?.form;
		const reset = () => {
			if (value === undefined) setLocal(String(defaultValue ?? options[0]?.value ?? ""));
		};
		owner?.addEventListener("reset", reset);
		return () => owner?.removeEventListener("reset", reset);
	}, [value, defaultValue, options]);
	const selected = options.find((option) => String(option.value) === current);
	const label =
		rest["aria-label"] ?? triggerRef.current?.labels?.[0]?.textContent?.trim() ?? "Options";
	const close = () => setOpen(false);
	const commit = (next: string | null) => {
		const option = options.find((item) => String(item.value) === next);
		if (!option || option.disabled) return;
		if (next !== current) {
			setLocal(String(next));
			onValueChange?.(String(next));
		}
		close();
	};
	const rows = (
		<BaseSelect.List data-slot="select-list" className="option-list" aria-label={label}>
			{!options.length && <p className="option-empty">No options available</p>}
			{options.map((option, index) => (
				<div key={String(option.value)}>
					{option.group && option.group !== options[index - 1]?.group && (
						<div className="option-group">{option.group}</div>
					)}
					<BaseSelect.Item
						value={String(option.value)}
						disabled={option.disabled}
						className="option-row"
						data-slot="select-option"
						data-value={String(option.value)}
					>
						{option.icon && <span className="option-icon">{option.icon}</span>}
						<span className="option-copy">
							<BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
							{option.description && (
								<span className="option-description">{option.description}</span>
							)}
						</span>
						<BaseSelect.ItemIndicator className="option-check">
							{Ic.check(ICON.sm)}
						</BaseSelect.ItemIndicator>
					</BaseSelect.Item>
				</div>
			))}
		</BaseSelect.List>
	);
	const popup = (
		<BaseSelect.Positioner
			align="start"
			sideOffset={4}
			alignItemWithTrigger={false}
			collisionPadding={8}
			positionMethod="fixed"
			className={phone ? "option-positioner-sheet" : "option-positioner"}
			{...(!phone ? { [FLOATING_ATTR]: "" } : {})}
		>
			<BaseSelect.Popup
				data-slot="select-popup"
				className={phone ? "option-popup-sheet" : "option-popup"}
				finalFocus={triggerRef}
			>
				{rows}
			</BaseSelect.Popup>
		</BaseSelect.Positioner>
	);
	return (
		<BaseSelect.Root
			value={current}
			open={open}
			modal={false}
			disabled={disabled}
			required={required}
			name={name}
			form={form}
			items={options.map((option) => ({ ...option, value: String(option.value) }))}
			onValueChange={(next, details) => {
				// Base UI reconciles dynamic item registration with its initial value. That
				// synthetic reconciliation must not overwrite the feature's controlled value.
				// Closed-trigger typeahead uses the same event, but has a real key origin.
				if (details.event.type === "base-ui" && !typingIntent.current) {
					details.cancel();
					return;
				}
				typingIntent.current = false;
				commit(next);
			}}
			onOpenChange={(next, details) => {
				if (details.reason === "window-resize") return;
				setEditor(
					phoneBreakpoint === 860 ||
						!!triggerRef.current?.closest(".cv-shell,.tl2-clip-sheet,.tl2-panel-sheet"),
				);
				setOpen(next);
			}}
		>
			<BaseSelect.Trigger
				ref={triggerRef}
				id={id ?? generatedId}
				form={form}
				data-slot="select"
				data-value={current}
				data-size={size}
				render={trigger}
				className={cn(!trigger && fieldClass(size, width !== "auto"), "option-trigger", className)}
				{...rest}
				onKeyDownCapture={(event) => {
					typingIntent.current =
						event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
					rest.onKeyDownCapture?.(event);
				}}
				onKeyUpCapture={(event) => {
					typingIntent.current = false;
					rest.onKeyUpCapture?.(event);
				}}
			>
				{trigger ? (
					trigger.props.children
				) : (
					<>
						<span className="option-value">
							{selected ? selected.label : current ? `${current} (unavailable)` : placeholder}
						</span>
						{Ic.chevD(ICON.xs)}
					</>
				)}
			</BaseSelect.Trigger>
			{phone ? (
				<Sheet
					edge="bottom"
					open={open}
					onClose={close}
					label={label}
					size="min(70svh, 480px)"
					className="option-sheet"
				>
					<div data-editor-options={editor} className="option-sheet-content">
						<div className="option-sheet-header">
							<strong>{label}</strong>
							<IconButton aria-label="Close options" onClick={close}>
								{Ic.x(ICON.md)}
							</IconButton>
						</div>
						{popup}
					</div>
				</Sheet>
			) : (
				<BaseSelect.Portal container={container}>{popup}</BaseSelect.Portal>
			)}
		</BaseSelect.Root>
	);
}

/** Validate against the same source array used to build options. */
export function onSelect<T extends string>(
	allowed: readonly T[],
	apply: (value: T) => void,
): (value: string) => void {
	return (value) => {
		const next = oneOf(value, allowed);
		if (next !== undefined) apply(next);
	};
}
