/* Which frame a route renders in. Pure, and the only place the answer lives:
 * a page does not pick its own layout, so "one route, one shell" is a table
 * rather than a convention spread across pages. */
import type { View } from "./routing.ts";

export type Shell = "app" | "god" | "bare" | "fullscreen";

export function shellFor(view: View): Shell {
	switch (view.kind) {
		case "create":
		case "content-edit":
		case "content-script":
		case "content-storyboard":
			return "fullscreen";
		case "god":
			return "god";
		case "account":
			return "bare";
		case "content":
		case "library":
		case "video":
		case "images":
		case "imagelab":
		case "speech":
		case "speechlab":
		case "workspace":
			return "app";
	}
}

/** Where an account page's back control leads: the route the operator came
 *  from, or the content list when they arrived at the account page directly. */
export function accountBackTarget(cameFrom: View | null): View {
	return cameFrom && shellFor(cameFrom) !== "bare" ? cameFrom : { kind: "content" };
}
