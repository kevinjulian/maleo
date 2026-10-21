import {
	useEffect,
	useId,
	useRef,
	useState,
	type CSSProperties,
	type JSX,
	type ReactNode,
} from "react";

const cx = (...values: Array<string | undefined>): string => values.filter(Boolean).join(" ");
/** One destination in the inspector's rail. The icon is the consumer's node. */
export interface VuiInspectorCategory {
	id: string;
	label: string;
	icon: ReactNode;
}

export function VuiPreviewStage({
	children,
	className,
	style,
}: {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
}): JSX.Element {
	return (
		<div className={cx("vui-preview-stage", className)} data-vui-slot="preview-stage" style={style}>
			{children}
		</div>
	);
}

export function VuiTransport({
	playing,
	currentSec,
	durationSec,
	onTogglePlay,
	onStop,
	className,
}: {
	playing: boolean;
	currentSec: number;
	durationSec: number;
	onTogglePlay: () => void;
	onStop: () => void;
	className?: string;
}): JSX.Element {
	const tc = (sec: number): string =>
		`${Math.floor(Math.max(0, sec) / 60)}:${String(Math.floor(Math.max(0, sec) % 60)).padStart(2, "0")}`;
	return (
		<div
			className={cx("vui-transport", className)}
			data-vui-slot="transport"
			aria-label="Preview playback controls"
		>
			<button
				type="button"
				className="vui-play"
				onClick={onTogglePlay}
				aria-label={playing ? "Pause preview" : "Play preview"}
			>
				{playing ? "||" : "▶"}
			</button>
			<button type="button" onClick={onStop}>
				Stop
			</button>
			<output>
				{tc(currentSec)} / {tc(durationSec)}
			</output>
		</div>
	);
}

export function VuiInspectorRail({
	categories,
	active,
	onSelect,
	header,
	children,
	className,
}: {
	categories: VuiInspectorCategory[];
	active: string;
	onSelect: (id: string) => void;
	header?: ReactNode;
	children: ReactNode;
	className?: string;
}): JSX.Element {
	return (
		<div className={cx("vui-inspector-rail", className)} data-vui-slot="inspector-rail">
			<nav className="vui-category-rail" data-vui-slot="category-rail">
				{categories.map((category) => (
					<button
						type="button"
						key={category.id}
						data-vui-slot="category"
						data-vui-category={category.id}
						title={category.label}
						aria-label={category.label}
						aria-pressed={active === category.id}
						className={active === category.id ? "is-active" : undefined}
						onClick={() => onSelect(category.id)}
					>
						{category.icon}
					</button>
				))}
			</nav>
			<div className="vui-inspector-body">
				{header}
				{children}
			</div>
		</div>
	);
}

/**
 * A titled, collapsible section.
 *
 * `className` composes onto the root beside the package's own, the way
 * `VuiInspectorRail` already takes one. Without it a consumer composing this
 * into their own surface has no supported way to style it: the spacing is
 * reachable through tokens, but anything else means matching `.vui-accordion`,
 * which the contract documents as private and changeable in a patch release.
 */
export function AccordionSection({
	label,
	defaultOpen = false,
	open,
	onOpenChange,
	focusKey,
	right,
	className,
	children,
}: {
	label: string;
	defaultOpen?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	focusKey?: string | number | null;
	right?: ReactNode;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	const [innerOpen, setInnerOpen] = useState(defaultOpen);
	const isOpen = open ?? innerOpen;
	const id = useId();
	const body = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!isOpen || focusKey == null) return;
		const frame = requestAnimationFrame(() =>
			body.current?.querySelector<HTMLElement>("input,textarea,select,button,[tabindex]")?.focus(),
		);
		return () => cancelAnimationFrame(frame);
	}, [isOpen, focusKey]);
	const toggle = (): void => {
		const next = !isOpen;
		if (open == null) setInnerOpen(next);
		onOpenChange?.(next);
	};
	return (
		<section className={cx("vui-accordion", className)} data-vui-slot="accordion">
			<button
				type="button"
				data-vui-slot="accordion-header"
				aria-expanded={isOpen}
				aria-controls={id}
				onClick={toggle}
			>
				<span data-vui-slot="accordion-label">{label}</span>
				<span data-vui-slot="accordion-tools">
					{right}{" "}
					<svg
						aria-hidden="true"
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d={isOpen ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"} />
					</svg>
				</span>
			</button>
			{isOpen && (
				<div ref={body} id={id} data-vui-slot="accordion-body" className="vui-accordion-body">
					{children}
				</div>
			)}
		</section>
	);
}
