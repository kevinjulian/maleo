/* A studio's heading, in one place.
 *
 * Template Studio used `.tl2-editor-heading`; Motion Studio wrote the same
 * values inline — `var(--font-display)`, 16px, 600, `-0.2px`, and a 12px muted
 * line under it. Identical output, two implementations, which is the state two
 * surfaces are in just before they stop matching.
 *
 * At compact width it is a back control and a title. The subtitle is a line of
 * explanation, and the viewport with the least height to spend is the wrong one
 * to spend it on; the back control replaces the workspace's own close, which
 * sits at the far corner from where a thumb rests.
 */
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";

export interface StudioHeadingProps {
	title: string;
	subtitle: string;
	compact: boolean;
	/** Leave the studio. Rendered as the compact heading's back control. */
	onBack?: () => void;
}

export function StudioHeading({
	title,
	subtitle,
	compact,
	onBack,
}: StudioHeadingProps): JSX.Element {
	if (compact) {
		return (
			<div className="tl2-editor-heading is-compact">
				{onBack && (
					<IconButton
						size="xs"
						className="tl2-editor-heading-back"
						type="button"
						onClick={onBack}
						title="Close"
						aria-label={`Close ${title}`}
					>
						{Ic.chevronLeft(ICON.lg)}
					</IconButton>
				)}
				<b>{title}</b>
			</div>
		);
	}
	return (
		<div className="tl2-editor-heading">
			<b>{title}</b>
			<small>{subtitle}</small>
		</div>
	);
}
