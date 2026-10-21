/* The bar under the timeline: the tool rail, or the selected clip's controls.
 *
 * Split out of `timeline-editor.tsx`. The two branches are one decision — what
 * the bottom slot IS at a given width and selection — so they belong in one
 * place rather than as a ternary inside a 200-line render.
 *
 * Keyed off `phone` rather than `coarse` because this is the bar the RAIL
 * becomes at that width: the gesture gating upstream is the pointer question,
 * this one is the layout question. Deselecting restores the rail. */
import type { JSX } from "react";
import { TimelineClipBar } from "./timeline-clip-bar.tsx";
import { TimelineRail } from "./timeline-rail.tsx";

/* Both children own their prop types; this reuses them rather than restating
 * them, so a rename in either lands here as a type error instead of a drift. */
type ClipBarProps = Parameters<typeof TimelineClipBar>[0];

interface TimelineBottomBarProps extends Pick<
	ClipBarProps,
	"groupOptions" | "sheet" | "onSheet" | "onDeselect" | "actions"
> {
	phone: boolean;
	/** Null when nothing is selected — the rail branch. */
	subject: ClipBarProps["subject"] | null;
	chromeStore: Parameters<typeof TimelineRail>[0]["chromeStore"];
	clipTab: ClipBarProps["activeGroup"];
	setClipTab: (k: Parameters<ClipBarProps["onOpenGroup"]>[0]) => void;
}

export function TimelineBottomBar({
	phone,
	subject,
	groupOptions,
	chromeStore,
	clipTab,
	setClipTab,
	sheet,
	onSheet,
	onDeselect,
	actions,
}: TimelineBottomBarProps): JSX.Element {
	if (!phone || !subject) return <TimelineRail chromeStore={chromeStore} phone={phone} />;
	return (
		<TimelineClipBar
			subject={subject}
			groupOptions={groupOptions}
			/* Nothing reads as active until properties are actually showing.
			   `clipTab` defaults to "content" and persists across selections, so
			   passing it unconditionally lit the first control the instant a clip was
			   tapped — announcing a panel that selection deliberately does not open. */
			activeGroup={sheet === "clip-props" ? clipTab : ""}
			/* Opens properties AT that group, rather than only marking it active. The
			   bar's controls are the phone's replacement for the inspector's icon
			   rail, and a rail button that changes a tab nothing is showing is a
			   control that does nothing. */
			onOpenGroup={(k) => {
				chromeStore.patch("animationInspector", null);
				setClipTab(k);
				onSheet("clip-props");
			}}
			sheet={sheet}
			onSheet={onSheet}
			onDeselect={onDeselect}
			actions={actions}
		/>
	);
}
