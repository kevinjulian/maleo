import { Topbar } from "@design-system/patterns/topbar.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
/* The frame for pages that belong to the person rather than a workspace: a
 * back control and where you are ("Account"), then one centered column whose
 * page heading names the page. No sidebar — the pages it holds are reached from
 * the user menu and left the way they came. */
import type { JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";

export function BareShell({
	onBack,
	children,
}: {
	onBack: () => void;
	children: ReactNode;
}): JSX.Element {
	return (
		<div className="tw:flex tw:min-h-dvh tw:flex-col">
			<Topbar>
				<IconButton onClick={onBack} aria-label="Back" title="Back">
					{Ic.arrowLeft(ICON.md)}
				</IconButton>
				<span className="crumb-cur">Account</span>
			</Topbar>
			<main className="tw:mx-auto tw:w-full tw:max-w-[44rem] tw:px-[var(--page-pad)] tw:py-12">
				{children}
			</main>
		</div>
	);
}
