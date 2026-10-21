import { useEffect, useRef, useState, type JSX } from "react";

/* A two-step button for reversible but consequential admin actions: the first
 * press arms it and names what will happen, the second commits. Escape or
 * Cancel disarms and returns focus to the original button. Irreversible or
 * privilege-changing actions use the typed confirmation instead. */
export function ConfirmAction({
	label,
	confirmLabel,
	onConfirm,
	disabled,
}: {
	label: string;
	confirmLabel: string;
	onConfirm: () => void;
	disabled?: boolean;
}): JSX.Element {
	const [armed, setArmed] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const wasArmed = useRef(false);
	useEffect(() => {
		if (wasArmed.current && !armed) trigger.current?.focus();
		wasArmed.current = armed;
	}, [armed]);
	if (!armed) {
		return (
			<button ref={trigger} type="button" disabled={disabled} onClick={() => setArmed(true)}>
				{label}
			</button>
		);
	}
	return (
		<span
			className="god-confirm-inline"
			role="group"
			aria-label={`Confirm ${label.toLowerCase()}`}
			onKeyDown={(event) => {
				if (event.key === "Escape") setArmed(false);
			}}
		>
			<button
				type="button"
				className="god-confirm-commit"
				autoFocus
				disabled={disabled}
				onClick={() => {
					setArmed(false);
					onConfirm();
				}}
			>
				{confirmLabel}
			</button>
			<button type="button" onClick={() => setArmed(false)}>
				Cancel
			</button>
		</span>
	);
}
