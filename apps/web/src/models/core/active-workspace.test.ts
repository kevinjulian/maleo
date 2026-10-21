/* Which workspace a load starts in.
 *
 * The precedence is the whole decision, and getting it wrong is invisible: a
 * client that preferred its stored value would open a SHARED link in whatever
 * tenant the recipient last used, showing them a different project list under
 * the sender's URL and no sign that anything was substituted. */
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
	FALLBACK_WORKSPACE,
	getActiveWorkspace,
	resetActiveWorkspaceForTests,
	resolveInitialWorkspace,
	setActiveWorkspace,
	subscribeActiveWorkspace,
} from "./active-workspace.ts";

afterEach(() => resetActiveWorkspaceForTests());

describe("resolving the workspace a load starts in", () => {
	test("the url wins, so a shared link opens the tenant it was shared from", () => {
		expect(resolveInitialWorkspace("?workspace=veronika", "kunti")).toBe("veronika");
	});

	test("the stored value carries a fresh tab when the url names none", () => {
		expect(resolveInitialWorkspace("", "kunti")).toBe("kunti");
	});

	test("a first ever load lands in the workspace that owns everything", () => {
		// Landing anywhere else shows an operator an empty app and reads as data
		// loss, even though nothing moved.
		expect(resolveInitialWorkspace("", null)).toBe(FALLBACK_WORKSPACE);
		expect(FALLBACK_WORKSPACE).toBe("default");
	});

	test("a junk value is ignored rather than carried onto every request", () => {
		for (const junk of ["../escape", "has space", "with/slash", "   "]) {
			expect(resolveInitialWorkspace(`?workspace=${encodeURIComponent(junk)}`, null)).toBe(
				FALLBACK_WORKSPACE,
			);
		}
	});

	test("junk in storage falls through to the url, then to the floor", () => {
		expect(resolveInitialWorkspace("?workspace=veronika", "../escape")).toBe("veronika");
		expect(resolveInitialWorkspace("", "../escape")).toBe(FALLBACK_WORKSPACE);
	});
});

describe("switching", () => {
	test("notifies subscribers so every scoped surface re-reads", () => {
		let fired = 0;
		subscribeActiveWorkspace(() => {
			fired += 1;
		});

		setActiveWorkspace("veronika");

		expect(getActiveWorkspace()).toBe("veronika");
		expect(fired).toBe(1);
	});

	test("switching to the workspace already active is a no-op", () => {
		let fired = 0;
		setActiveWorkspace("veronika");
		subscribeActiveWorkspace(() => {
			fired += 1;
		});

		setActiveWorkspace("veronika");

		expect(fired).toBe(0);
	});

	test("an invalid name is refused rather than becoming the active tenant", () => {
		setActiveWorkspace("veronika");

		setActiveWorkspace("../escape");

		expect(getActiveWorkspace()).toBe("veronika");
	});
});
