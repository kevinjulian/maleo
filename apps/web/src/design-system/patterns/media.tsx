/* MediaGrid and MediaCard — a collection of assets, and one asset in it.
 *
 * Five surfaces drew this separately: the image gallery, the reference library,
 * the editor's media browser, stock results and material assets. Each chose its
 * own grid floor, border, selected look and failure state, and two of them put
 * buttons inside a whole-card button.
 *
 * The card has ONE activation (`onActivate`), which is a real button. Anything
 * else interactive — a menu, an add button, an attribution link — goes in
 * `actions` and is rendered beside that button, never inside it. Facts about
 * the media (duration, kind, a favourite mark) go in `overlay` as FrameBadges.
 */
import type { HTMLAttributes, JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { cn } from "@models/core/cn.ts";
import { cssVars } from "@models/core/css-vars.ts";
import "./media.css";
import { Checkbox } from "@design-system/components/checkbox.tsx";

export interface MediaGridProps {
	/** Thumbnail tiles or thumbnail-led record rows; both keep list semantics. */
	layout?: "grid" | "list";
	/** Names the collection: "Generated images", "Stock results". */
	label: string;
	/** The narrowest a column may get, in px. The grid fills the region with as
	 *  many as fit; the default suits a page, 72 suits a rail panel. */
	min?: number;
	/** `compact` tightens the gap and the overlay caption for a rail panel. */
	density?: "comfortable" | "compact";
	className?: string;
	children: ReactNode;
}

/* A list, not `role="grid"`: there is no cell-to-cell keyboard model here, and
 * claiming one would promise arrow keys that do nothing. */
export function MediaGrid({
	label,
	min = 150,
	density = "comfortable",
	layout = "grid",
	className,
	children,
}: MediaGridProps): JSX.Element {
	return (
		<ul
			data-slot="media-grid"
			role="list"
			aria-label={label}
			data-density={density}
			data-layout={layout}
			className={cn("ui-media-grid", className)}
			style={cssVars({ "--ui-media-min": `${min}px` })}
		>
			{children}
		</ul>
	);
}

export interface MediaCardProps extends Omit<HTMLAttributes<HTMLLIElement>, "title"> {
	/** Compact editor picker tile; retains one activation and separate actions. */
	variant?: "card" | "picker";
	/** List rows keep preview beside copy; caption overlays belong to tiles. */
	layout?: "grid" | "list";
	/** The media itself: an `<img>`, a `<video>`, or a Frame. The card owns the box. */
	preview: ReactNode;
	/** Width over height of the preview box. */
	aspect?: number;
	/** `cover` fills the box and crops; `contain` shows the whole asset on the
	 *  ground. Use `contain` where the crop would hide what the asset is. */
	fit?: "cover" | "contain";
	/** A colour behind the preview, when the item has one of its own (a seed). */
	ground?: string;
	title?: ReactNode;
	meta?: ReactNode;
	/** Where the title goes: under the preview with `meta`, or laid over its foot. */
	caption?: "below" | "overlay";
	/** FrameBadges: facts about the media. Not interactive. */
	overlay?: ReactNode;
	/** Interactive controls, rendered beside the activation, not inside it. */
	actions?: ReactNode;
	/** Given (true or false), the card is a selectable and announces it. */
	selected?: boolean;
	/** Explicit selection stays independent of preview activation and actions. */
	selection?: {
		label: string;
		checked: boolean;
		disabled?: boolean;
		onCheckedChange: (checked: boolean) => void;
	};
	/** The preview could not be shown. Says so in its place; the item stays. */
	unavailable?: string;
	/** The glyph beside `unavailable`: what kind of item this is (film, text). */
	unavailableIcon?: ReactNode;
	/** The pointer tooltip for the whole card: how to use it ("drag onto the timeline"). */
	hint?: string;
	onActivate?: () => void;
	/** The activation's accessible name, where the visible title is not enough. */
	label?: string;
}

export function MediaCard({
	preview,
	aspect = 1,
	fit = "cover",
	ground,
	title,
	meta,
	caption = "below",
	layout = "grid",
	variant = "card",
	overlay,
	actions,
	selected,
	selection,
	unavailable,
	unavailableIcon,
	hint,
	onActivate,
	label,
	className,
	...rest
}: MediaCardProps): JSX.Element {
	if (variant === "picker") layout = "grid";
	if (layout === "list") caption = "below";
	const body = (
		<>
			<span
				className="ui-media-preview"
				data-fit={fit}
				style={{ aspectRatio: String(aspect), background: ground }}
			>
				{unavailable ? (
					<span className="ui-media-gone">
						{unavailableIcon ?? Ic.image(layout === "list" ? ICON.md : ICON.lg)}
						<span>{unavailable}</span>
					</span>
				) : (
					preview
				)}
				{variant !== "picker" && caption === "overlay" && title != null && (
					<span className="ui-media-caption">{title}</span>
				)}
				{overlay}
			</span>
			{variant !== "picker" && caption === "below" && (title != null || meta != null) && (
				<span className="ui-media-copy">
					{title != null && <span className="ui-media-title">{title}</span>}
					{meta != null && <span className="ui-media-meta">{meta}</span>}
				</span>
			)}
		</>
	);
	return (
		/* `group/frame` so FrameActions' hover reveal works on a card as on a Frame. */
		<li
			data-slot="media-card"
			data-variant={variant}
			data-layout={layout}
			data-selected={selection?.checked ?? selected}
			data-selectable={Boolean(selection)}
			title={hint}
			className={cn("ui-media-card tw:group/frame", className)}
			{...rest}
		>
			{onActivate ? (
				<button
					type="button"
					className="ui-media-main"
					aria-pressed={selection ? undefined : selected}
					aria-label={label}
					onClick={onActivate}
				>
					{body}
				</button>
			) : (
				<div className="ui-media-main" aria-label={label}>
					{body}
				</div>
			)}
			{selection ? (
				<div className="ui-media-controls">
					{actions}
					<span className="ui-media-selection">
						<Checkbox
							aria-label={selection.label}
							checked={selection.checked}
							disabled={selection.disabled}
							onCheckedChange={selection.onCheckedChange}
						/>
					</span>
				</div>
			) : (
				actions
			)}
		</li>
	);
}
