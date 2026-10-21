/* Striped / generated frame: the image container used wherever a reference,
 * scene frame or media thumbnail is shown. Opens a Lightbox when enlargeable. */
import { useState } from "react";
import type { CSSProperties, ReactNode, JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { cn } from "@models/core/cn.ts";
import { gradFor } from "@models/core/measures.ts";
import { assetUrl } from "@api/client.ts";
import { IconButton, type IconButtonProps } from "./icon-button.tsx";
import { Lightbox } from "./lightbox.tsx";

/* Fullscreen image lightbox. Click scrim / Esc to close. */

interface FrameProps {
	generated?: boolean;
	seed?: number;
	aspect?: number;
	w?: number | string;
	src?: string;
	icon?: ReactNode;
	label?: string;
	children?: ReactNode;
	style?: CSSProperties;
	fit?: "cover" | "contain";
	/* When set, the top-left badge becomes a clickable view button that opens
	   an image lightbox. */
	enlargeable?: boolean;
	/* What the top-left badge says instead of the image glyph: a position in a
	   sequence, a favourite mark. Shown on a placeholder too. */
	badge?: ReactNode;
}

/* The badge over media: a translucent surface chip on the control-height
 * scale. The view control is a `span role="button"`, not an IconButton, because
 * a Frame is often already inside a button and buttons do not nest. */
const CHIP =
	"tw:absolute tw:z-3 tw:flex tw:items-center tw:justify-center tw:rounded-md tw:bg-[var(--surface-translucent)]";
const CORNER = {
	tl: "tw:top-1 tw:left-1",
	tr: "tw:top-1 tw:right-1",
	bl: "tw:bottom-1 tw:left-1",
	br: "tw:bottom-1 tw:right-1",
} as const;
export type FrameCorner = keyof typeof CORNER;
const BADGE = cn(CHIP, CORNER.tl, "tw:size-[var(--control-h-xs)] tw:text-[var(--fg-dim)]");
const REVEAL =
	"tw:opacity-0 tw:transition-opacity tw:group-hover/frame:opacity-100 tw:focus-within:opacity-100 tw:pointer-coarse:opacity-100";

/* A fact about the media, laid over it: a duration, a kind, a position. Works
 * over any `position: relative` media box, not only a Frame. */
export function FrameBadge({
	corner = "tl",
	className,
	children,
}: {
	corner?: FrameCorner;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<span
			data-slot="frame-badge"
			className={cn(
				CHIP,
				CORNER[corner],
				"tw:h-[var(--control-h-xs)] tw:min-w-[var(--control-h-xs)] tw:gap-1 tw:px-1 tw:text-[length:var(--type-label-size)] tw:font-semibold tw:tabular-nums tw:text-foreground",
				className,
			)}
		>
			{children}
		</span>
	);
}

/* The actions over the media. The group is the chip; the buttons inside are
 * the canonical IconButton, so they keep its name requirement, focus ring and
 * touch floor. `reveal` hides the group until the media (any ancestor carrying
 * `tw:group/frame`, which a Frame does) is hovered — and never from the
 * keyboard or a touch screen, which have no hover to reveal it with. */
export function FrameActions({
	corner = "tr",
	reveal,
	className,
	children,
}: {
	corner?: FrameCorner;
	reveal?: boolean;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<span
			data-slot="frame-actions"
			className={cn(CHIP, CORNER[corner], "tw:z-4 tw:gap-px", reveal && REVEAL, className)}
		>
			{children}
		</span>
	);
}
/* A primary action centred on a frame that has nothing in it yet. */
export const FRAME_CENTER =
	"tw:absolute tw:top-1/2 tw:left-1/2 tw:z-4 tw:-translate-x-1/2 tw:-translate-y-1/2";
export function FrameAction(props: IconButtonProps): JSX.Element {
	return (
		<IconButton
			size="xs"
			{...props}
			onClick={(e) => {
				e.stopPropagation();
				props.onClick?.(e);
			}}
		/>
	);
}
const VIEW =
	"tw:z-4 tw:cursor-pointer tw:opacity-0 tw:transition-opacity tw:group-hover/frame:opacity-100 tw:hover:text-foreground tw:focus-visible:opacity-100 tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring tw:pointer-coarse:opacity-100";
/* Placeholder hatching is glyph drawing, in a token colour. */
const HATCH =
	"repeating-linear-gradient(45deg,transparent,transparent 6px,var(--surface-tint) 6px,var(--surface-tint) 7px)";

/* Striped / generated frame */
export function Frame({
	generated,
	seed = 0,
	aspect = 9 / 16,
	w,
	src,
	icon,
	label,
	children,
	style: xs,
	fit = "cover",
	enlargeable,
	badge,
}: FrameProps): JSX.Element {
	const [lightbox, setLightbox] = useState(false);
	const fillClass = src
		? fit === "contain"
			? "tw:bg-secondary"
			: "tw:bg-background"
		: generated
			? "tw:border tw:border-border"
			: "tw:border tw:border-dashed tw:border-[var(--border-strong)]";
	const fill: CSSProperties = src ? {} : { background: generated ? gradFor(seed) : HATCH };
	const canView = enlargeable && (generated || src);
	const open = (e: { stopPropagation: () => void; preventDefault: () => void }): void => {
		e.stopPropagation();
		e.preventDefault();
		setLightbox(true);
	};
	return (
		<div
			data-slot="frame"
			className={cn(
				"cv-frame tw:group/frame tw:relative tw:flex tw:shrink-0 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-lg",
				fillClass,
			)}
			style={{ width: w || "100%", aspectRatio: String(aspect), ...fill, ...xs }}
		>
			{src && (
				<img
					src={assetUrl(src)}
					alt={label ?? "reference"}
					className={cn(
						"tw:absolute tw:inset-0 tw:size-full",
						fit === "contain" ? "tw:object-contain" : "tw:object-cover",
					)}
				/>
			)}
			{!generated && !src && (
				<div className="tw:flex tw:flex-col tw:items-center tw:gap-1 tw:p-2 tw:text-center tw:text-muted-foreground">
					{icon}
					{label && <span className="tw:text-[length:var(--type-label-size)]">{label}</span>}
				</div>
			)}
			{badge != null && !canView ? (
				<FrameBadge>{badge}</FrameBadge>
			) : (
				(generated || src) &&
				(canView ? (
					<span
						role="button"
						tabIndex={0}
						aria-label="View larger"
						data-slot="frame-view"
						className={cn(BADGE, VIEW)}
						onClick={open}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") open(e);
						}}
					>
						{Ic.expand(ICON.xs)}
					</span>
				) : (
					<div className={BADGE}>{Ic.image(ICON.xs)}</div>
				))
			)}
			{children}
			{lightbox && (
				<Lightbox src={src} seed={seed} label={label} onClose={() => setLightbox(false)} />
			)}
		</div>
	);
}
