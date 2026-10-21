import { describe, expect, it, test } from "vite-plus/test";
import { accountBackTarget, shellFor, type Shell } from "./shell.ts";
import type { View } from "./routing.ts";

/* One row per View kind. `satisfies Record<View["kind"], …>` makes a new kind
 * without a row a compile error, so a route cannot ship without a shell. */
const CASES = {
	content: [{ kind: "content" }, "app"],
	"content-edit": [{ kind: "content-edit", id: "p" }, "fullscreen"],
	"content-script": [{ kind: "content-script", id: "p", density: "write" }, "fullscreen"],
	"content-storyboard": [{ kind: "content-storyboard", id: "p" }, "fullscreen"],
	create: [{ kind: "create" }, "fullscreen"],
	library: [{ kind: "library", type: "references" }, "app"],
	video: [{ kind: "video" }, "app"],
	images: [{ kind: "images" }, "app"],
	imagelab: [{ kind: "imagelab" }, "app"],
	speech: [{ kind: "speech" }, "app"],
	speechlab: [{ kind: "speechlab" }, "app"],
	workspace: [{ kind: "workspace" }, "app"],
	god: [{ kind: "god", section: "general" }, "god"],
	account: [{ kind: "account", section: "security" }, "bare"],
} satisfies Record<View["kind"], [View, Shell]>;

describe("shellFor", () => {
	for (const [kind, [view, shell]] of Object.entries(CASES)) {
		it(`renders ${kind} in the ${shell} shell`, () => {
			expect(shellFor(view)).toBe(shell);
		});
	}
});

describe("accountBackTarget", () => {
	test("returns to where the operator came from", () => {
		expect(accountBackTarget({ kind: "images" })).toEqual({ kind: "images" });
		expect(accountBackTarget({ kind: "god", section: "users" })).toEqual({
			kind: "god",
			section: "users",
		});
	});

	test("lands on content with no origin, or from another account page", () => {
		expect(accountBackTarget(null)).toEqual({ kind: "content" });
		expect(accountBackTarget({ kind: "account", section: "profile" })).toEqual({ kind: "content" });
	});
});
