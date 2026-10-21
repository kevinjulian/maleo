// @vitest-environment happy-dom
/* The popup itself — its entries, Escape and focus return — is Base UI's and
 * is driven in a real browser by visual/account-shell.spec.ts. Base UI picks
 * its layout-effect hook when first imported, and bun shares modules across
 * test files, so a popup opened here would pass or fail on file order. What is
 * pinned here is what does not need the popup open. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let signOutStatus = 200;
const realFetch = globalThis.fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});
globalThis.fetch = (() =>
	Promise.resolve(
		new Response(JSON.stringify(signOutStatus === 200 ? { success: true } : { message: "boom" }), {
			status: signOutStatus,
			headers: { "content-type": "application/json" },
		}),
	)) as unknown as typeof fetch;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { UserMenu, roleLabel } = await import("./user-menu.tsx");
const { useSignOut } = await import("@hooks/auth/use-sign-out.ts");

let unmount: (() => void) | undefined;
beforeEach(() => {
	signOutStatus = 200;
	window.localStorage.setItem("maleo.activeWorkspace", "alpha");
});
afterEach(() => {
	unmount?.();
	unmount = undefined;
	document.body.innerHTML = "";
});

async function mount(element: ReturnType<typeof createElement>): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(element);
	});
	unmount = () => act(() => root.unmount());
	return host;
}

describe("the user menu trigger", () => {
	test("is named by the account and shows its initials", async () => {
		const user = {
			id: "u1",
			email: "owner@example.com",
			name: "Ada Lovelace",
			role: "instance_owner",
		};
		const host = await mount(createElement(UserMenu, { user, onOpenAccount: () => {} }));
		const trigger = host.querySelector("button")!;
		expect(trigger.getAttribute("aria-label")).toBe("owner@example.com");
		expect(trigger.textContent).toBe("AL");
	});

	test("labels the role", () => {
		expect(roleLabel("instance_owner")).toBe("Instance owner");
		expect(roleLabel(undefined)).toBe("Member");
	});
});

describe("signing out", () => {
	function Probe({ onSignedOut }: { onSignedOut: () => void }) {
		const { pending, error, leave } = useSignOut(onSignedOut);
		return createElement(
			"button",
			{ onClick: () => void leave() },
			error ?? (pending ? "pending" : "idle"),
		);
	}

	async function click(host: HTMLElement): Promise<void> {
		await act(async () => {
			host.querySelector("button")!.click();
		});
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});
	}

	test("success forgets the workspace and leaves", async () => {
		let left = 0;
		const host = await mount(
			createElement(Probe, {
				onSignedOut: () => {
					left += 1;
				},
			}),
		);
		await click(host);
		expect(left).toBe(1);
		expect(window.localStorage.getItem("maleo.activeWorkspace")).toBeNull();
	});

	test("failure says so, stays, and keeps the workspace", async () => {
		signOutStatus = 500;
		let left = 0;
		const host = await mount(
			createElement(Probe, {
				onSignedOut: () => {
					left += 1;
				},
			}),
		);
		await click(host);
		expect(left).toBe(0);
		expect(host.textContent).toBe("boom");
		expect(window.localStorage.getItem("maleo.activeWorkspace")).toBe("alpha");
	});
});
