/* Browser history <-> view state. The React half of what was services/routing.ts (now models/core/routing.ts).
 *
 * It sits at the shell root rather than in a hooks cluster because it has one
 * consumer, app.tsx, and the rule for models/core applies here too: one consumer
 * means it belongs inside that consumer. The pure path mapping it calls is in
 * models/core/routing.ts, which three roles read. */
import { useEffect, useRef } from "react";
import {
	pathToView,
	viewToPath,
	withWorkspace,
	type View,
	type NavigationMode,
} from "@models/core/routing.ts";
import {
	getActiveWorkspace,
	resolveInitialWorkspace,
	setActiveWorkspace,
	subscribeActiveWorkspace,
} from "@models/core/active-workspace.ts";

export function useHistorySync(
	view: View,
	setView: (v: View) => void,
): (next: View, mode?: NavigationMode) => void {
	const skipPush = useRef(false);
	const navigationMode = useRef<NavigationMode>("push");
	const prevPath = useRef(withWorkspace(viewToPath(view), getActiveWorkspace()));
	useEffect(() => {
		if (
			location.pathname === "/settings" ||
			location.pathname.startsWith("/settings/") ||
			location.pathname.startsWith("/god/pipelines")
		) {
			const target = withWorkspace(viewToPath(view), getActiveWorkspace());
			const current = withWorkspace(location.pathname + location.search, getActiveWorkspace());
			if (target !== current) history.replaceState(history.state, "", target);
		}
	}, []);

	useEffect(() => {
		const onPopState = () => {
			const nextWorkspace = resolveInitialWorkspace(location.search, getActiveWorkspace());
			const nextView = pathToView(location.pathname, location.search);
			// Sheet Back changes UI history at the same route. It must not consume
			// the next real navigation or remount the current editor.
			if (withWorkspace(viewToPath(nextView), nextWorkspace) === prevPath.current) return;
			skipPush.current = true;
			// Back/forward can cross a workspace boundary, because a switch pushes an
			// entry. The address is the record of which tenant an entry was in, so
			// restoring the view without the workspace would show one workspace's URL
			// alongside another's data.
			setActiveWorkspace(resolveInitialWorkspace(location.search, getActiveWorkspace()));
			setView(pathToView(location.pathname, location.search));
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [setView]);

	/* Switching is a navigation. It changes what every surface shows, so it goes
	 * into history and into the address rather than into state the address then
	 * contradicts — which is what makes the link shareable at all. */
	useEffect(
		() =>
			subscribeActiveWorkspace(() => {
				const next = withWorkspace(viewToPath(view), getActiveWorkspace());
				if (next === prevPath.current) return;
				prevPath.current = next;
				if (history.state?.uiSheet) history.replaceState(null, "", next);
				else history.pushState(null, "", next);
			}),
		[view],
	);

	useEffect(() => {
		const newPath = withWorkspace(viewToPath(view), getActiveWorkspace());
		if (newPath === prevPath.current) {
			navigationMode.current = "push";
			return;
		}
		const previousPath = prevPath.current;
		prevPath.current = newPath;
		if (skipPush.current) {
			skipPush.current = false;
			return;
		}
		// Navigation from a Sheet consumes its temporary history entry.
		const mode = navigationMode.current;
		navigationMode.current = "push";
		if (history.state?.uiSheet) history.replaceState(null, "", newPath);
		else if (mode !== "push") history.replaceState(history.state, "", newPath);
		else history.pushState({ explorerPrevious: previousPath }, "", newPath);
	}, [view]);
	return (next, mode = "push") => {
		const target = withWorkspace(viewToPath(next), getActiveWorkspace());
		if ((mode === "back" || mode === "close") && history.state?.explorerPrevious === target) {
			history.back();
			return;
		}
		navigationMode.current = mode;
		setView(next);
	};
}
