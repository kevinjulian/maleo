/* Maleo — the timeline editor's left rail.
 *
 * The destination table, the Alt+digit shortcut that indexes it, and the nav
 * that draws it are one thing: adding a destination means adding a row, and the
 * shortcut and the tooltip both follow from its position. Kept apart from the
 * editor because the rail reads two chrome fields and nothing else — no
 * document, no selection, no derived arrays.
 *
 * The left rail is GLOBAL only — every destination talks to shared assets or the
 * whole storyboard, never a single selected scene (clip-first model). Per-scene
 * editing lives exclusively in the right-hand scene drawer. */
import { Fragment, useEffect } from "react";
import type { JSX } from "react";
import { Tooltip } from "@design-system/components/tooltip.tsx";
import { Ic } from "@design-system/icons/index.tsx";
import { isTypingTarget, railTargetForKey } from "@models/timeline/editor-chrome.ts";
import type { RailItem } from "@models/timeline/timeline-editor-model.ts";
import { useChromeField, type EditorChromeStore } from "@stores/editor-chrome-store.ts";

const RAIL: RailItem[] = [
	{ key: "media", label: "Assets", icon: Ic.image, group: 0 },
	{ key: "chat", label: "Chat", icon: Ic.chat, group: 0 },
	{ key: "style", label: "Style", icon: Ic.palette, group: 1 },
	{ key: "templates", label: "Templates", icon: Ic.layers, group: 1 },
	{ key: "elements", label: "Elements", icon: Ic.elements, group: 1 },
	{ key: "transitions", label: "Transitions", icon: Ic.swap, group: 1 },
	{ key: "effects", label: "Effects", icon: Ic.spark, group: 1 },
	{ key: "captions", label: "Captions", icon: Ic.captions, group: 2 },
	{ key: "settings", label: "Project", icon: (s = 18) => Ic.settings(s), group: 2 },
];
const PHONE_RAIL = RAIL.filter((r) => r.key !== "chat");
const shortcutOf = (key: RailItem["key"]): number => {
	const i = RAIL.findIndex((r) => r.key === key);
	return i === 9 ? 0 : i + 1;
};

/* On a phone Chat is the workspace's other view, switched above the editor, so
 * the bar does not offer it a second time. Alt+2 still reaches it: the
 * shortcut indexes the full table, and opening chat on a phone IS the view. */
export function TimelineRail({
	chromeStore,
	phone = false,
}: {
	chromeStore: EditorChromeStore;
	phone?: boolean;
}): JSX.Element {
	const [rail, setRail] = useChromeField(chromeStore, "rail");
	const [panelOpen, setPanelOpen] = useChromeField(chromeStore, "panelOpen");

	// Alt+1..9/0 jumps straight to a rail destination (Alt so browser tab
	// switching on Cmd/Ctrl+digit keeps working). Ignored while typing.
	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			const item = railTargetForKey(RAIL, e, isTypingTarget(e.target));
			if (!item) return;
			e.preventDefault();
			setRail(item.key);
			setPanelOpen(true);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		/* `tl2-bottombar` carries the shared structure — see rail.css. It is inert
		   above the phone breakpoint, where this is a left column and not a bar. */
		<nav className="tl2-rail tl2-bottombar" aria-label="Editor tools" data-app-overlay-persistent>
			{(phone ? PHONE_RAIL : RAIL).map((r, i, items) => (
				<Fragment key={r.key}>
					{i > 0 && items[i - 1]!.group !== r.group && (
						<span className="tl2-rail-sep" aria-hidden />
					)}
					<Tooltip side="right" label={`${r.label} (Alt+${shortcutOf(r.key)})`}>
						<button
							className={`tl2-railbtn ${rail === r.key && panelOpen ? "on" : ""}`}
							onClick={() => {
								if (rail === r.key) setPanelOpen((o) => !o);
								else {
									setRail(r.key);
									setPanelOpen(true);
								}
							}}
							aria-label={r.label}
						>
							{r.icon(17)}
						</button>
					</Tooltip>
				</Fragment>
			))}
		</nav>
	);
}
