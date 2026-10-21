import type { JSX, KeyboardEvent, MouseEvent, ReactNode } from "react";

export interface VuiShortcutMap {
	play?: string | false;
	delete?: string | false;
	undo?: string | false;
	redo?: string | false;
	save?: string | false;
}

export interface VuiKeyboardScopeProps {
	children: ReactNode;
	className?: string;
	onClick?: (event: MouseEvent<HTMLDivElement>) => void;
	shortcuts?: VuiShortcutMap;
	onShortcut?: (name: keyof VuiShortcutMap, event: KeyboardEvent<HTMLDivElement>) => void;
}

const DEFAULT_SHORTCUTS: Required<VuiShortcutMap> = {
	play: " ",
	delete: "Delete",
	undo: "Mod+z",
	redo: "Mod+y",
	save: "Mod+s",
};
const SHORTCUT_NAMES = ["play", "delete", "undo", "redo", "save"] as const;

function matchesShortcut(event: KeyboardEvent<HTMLDivElement>, shortcut: string): boolean {
	const parts = shortcut.split("+");
	const modifier = parts.length > 1 ? (parts[0] ?? "") : "";
	const key = parts.length > 1 ? (parts[1] ?? "") : shortcut;
	const wantsModifier = modifier === "Mod";
	if (wantsModifier !== (event.metaKey || event.ctrlKey)) return false;
	return event.key === key || (key.length === 1 && event.key.toLowerCase() === key.toLowerCase());
}

/** Controls that consume every key versus controls that only consume activation keys. */
const EDITING_CONTROLS = "input,textarea,select,[role=slider],[contenteditable=true]";
const ACTIVATION_CONTROLS = "button,a[href],[role=checkbox]";

function focusedControlOwns(target: EventTarget | null, key: string): boolean {
	if (!target || (typeof target !== "object" && typeof target !== "function")) return false;
	// SAFETY: EventTarget from browser or test realm may expose Element.closest without sharing HTMLElement's realm.
	const candidate = target as EventTarget & { closest?: (selectors: string) => unknown };
	if (typeof candidate.closest !== "function") return false;
	if (candidate.closest(EDITING_CONTROLS)) return true;
	return (key === " " || key === "Enter") && Boolean(candidate.closest(ACTIVATION_CONTROLS));
}

/** Own editor shortcuts without intercepting focused controls. */
export function VuiKeyboardScope({
	children,
	className,
	onClick,
	shortcuts,
	onShortcut,
}: VuiKeyboardScopeProps): JSX.Element {
	const stopParentShortcut = (event: KeyboardEvent<HTMLDivElement>): void => {
		const target = event.target;
		if (focusedControlOwns(target, event.key)) return;
		const active = { ...DEFAULT_SHORTCUTS, ...shortcuts };
		for (const name of SHORTCUT_NAMES) {
			const shortcut = active[name];
			if (shortcut !== false && matchesShortcut(event, shortcut)) {
				event.stopPropagation();
				onShortcut?.(name, event);
				return;
			}
		}
	};
	return (
		<div
			role="presentation"
			className={className ? `vui-keyboard-scope ${className}` : "vui-keyboard-scope"}
			data-vui-slot="keyboard-scope"
			onClick={onClick}
			onKeyDownCapture={stopParentShortcut}
		>
			{children}
		</div>
	);
}
