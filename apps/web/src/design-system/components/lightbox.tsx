/* Fullscreen image lightbox. Click scrim / Esc to close.
 *
 * The viewer is a dark surface in both themes — media is judged against the
 * letterbox, not against the app ground — so the root carries `dark` and every
 * token below resolves to its dark value. That is what lets the Close control be
 * the canonical IconButton and the caption an ordinary text role; it used to be
 * five literal colours in a style object. The sizes left in viewport units are
 * media geometry, not spacing. */
import { createPortal } from "react-dom";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { gradFor } from "@models/core/measures.ts";
import { assetUrl } from "@api/client.ts";
import { OverlayHostContext, useOverlay } from "@hooks/ui/use-overlay.ts";
import { IconButton } from "./icon-button.tsx";

const MEDIA = "tw:rounded-lg tw:shadow-[var(--shadow-3)]";

export function Lightbox({
	src,
	seed,
	label,
	onClose,
}: {
	src?: string;
	seed?: number;
	label?: string;
	onClose: () => void;
}): JSX.Element | null {
	const { host, mounted, panelRef } = useOverlay<HTMLDivElement>({
		open: true,
		onClose,
		zOrder: 1140,
	});
	const tree = (
		<div
			ref={panelRef}
			role="dialog"
			aria-modal="true"
			aria-label={label ? `Image: ${label}` : "Image preview"}
			tabIndex={-1}
			data-slot="lightbox"
			className="dark tw:fixed tw:inset-0 tw:flex tw:items-center tw:justify-center tw:bg-[color-mix(in_srgb,var(--media-bg)_80%,transparent)] tw:p-8"
		>
			{/* The backdrop: a click outside the image closes it. Escape closes it
			 * through the overlay stack, so this is the pointer path only. */}
			<div aria-hidden="true" className="tw:absolute tw:inset-0" onClick={onClose} />
			<IconButton
				aria-label="Close"
				className="tw:absolute tw:top-4 tw:right-4"
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
			>
				{Ic.x(ICON.lg)}
			</IconButton>
			<div className="tw:relative tw:flex tw:max-h-[88vh] tw:max-w-[min(900px,92vw)] tw:flex-col tw:items-center tw:gap-3">
				{src ? (
					<img
						src={assetUrl(src)}
						alt={label ?? "reference"}
						className={`${MEDIA} tw:max-h-[82vh] tw:max-w-full tw:object-contain`}
					/>
				) : (
					<div
						className={`${MEDIA} tw:aspect-square tw:w-[min(520px,80vw)]`}
						style={{ background: gradFor(seed ?? 0) }}
					/>
				)}
				{label && <span className="tw:text-sm tw:font-medium tw:text-foreground">{label}</span>}
			</div>
		</div>
	);
	if (!host) return tree;
	return mounted
		? createPortal(
				<OverlayHostContext.Provider value={host}>{tree}</OverlayHostContext.Provider>,
				host,
			)
		: null;
}
