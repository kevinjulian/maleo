// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vite-plus/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { VuiSheet } = await import("@components/editor-workspace/sheet.tsx");
const { overlayStackForDocument } = await import("@controllers/overlay/overlay-stack.ts");
const { Modal } = await import("./modal.tsx");
const { Sheet } = await import("./sheet.tsx");
import type { ReactElement } from "react";

let unmount: (() => void) | undefined;

function mount(element: ReactElement): HTMLElement {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	act(() => root.render(element));
	unmount = () =>
		act(() => {
			root.unmount();
			host.remove();
		});
	return host;
}

afterEach(() => {
	unmount?.();
	unmount = undefined;
	document.body.replaceChildren();
});

describe("shared overlay behavior", () => {
	test("one Escape closes nested sheet only and leaves modal focus-contained", () => {
		const closed: string[] = [];
		function Nested(): ReactElement {
			const [sheetOpen, setSheetOpen] = useState(true);
			return createElement(
				Modal,
				{ title: "Outer", onClose: () => closed.push("outer") },
				createElement("button", null, "Outer action"),
				createElement(Sheet, {
					open: sheetOpen,
					label: "Inner",
					onClose: () => {
						closed.push("inner");
						setSheetOpen(false);
					},
					children: createElement("button", null, "Inner action"),
				}),
			);
		}
		mount(createElement(Nested));
		void act(() =>
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
		);

		expect(closed).toEqual(["inner"]);
		const modal = document.querySelector<HTMLElement>(".cv-modal")!;
		expect(modal).not.toBeNull();
		void act(() =>
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })),
		);
		expect(modal.contains(document.activeElement)).toBe(true);
	});

	test("closing nested overlays returns focus one level at a time, ending at the opener", () => {
		function Flow(): ReactElement {
			const [modal, setModal] = useState(false);
			const [sheet, setSheet] = useState(false);
			return createElement(
				"div",
				null,
				createElement("button", { id: "opener", onClick: () => setModal(true) }, "Open"),
				modal
					? createElement(
							Modal,
							{ title: "Outer", onClose: () => setModal(false) },
							createElement(
								"button",
								{ id: "inner-opener", onClick: () => setSheet(true) },
								"More",
							),
							createElement(Sheet, {
								open: sheet,
								label: "Inner",
								onClose: () => setSheet(false),
								children: createElement("button", null, "Inner action"),
							}),
						)
					: null,
			);
		}
		mount(createElement(Flow));
		const opener = document.getElementById("opener")!;
		act(() => {
			opener.focus();
			opener.click();
		});
		const innerOpener = document.getElementById("inner-opener")!;
		act(() => {
			innerOpener.focus();
			innerOpener.click();
		});
		const escape = (): void => {
			act(() => {
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
			});
		};
		escape();
		expect(document.activeElement, "focus returns to the control that opened the sheet").toBe(
			innerOpener,
		);
		escape();
		expect(document.activeElement, "focus returns to the control that opened the modal").toBe(
			opener,
		);
	});

	/* Back is answered by the overlay stack's key owner (controllers/overlay/
	 * back-dismissal.ts), with the real primitives and the real window. */
	test("Back closes a sheet that owns the key", () => {
		const closed: string[] = [];
		mount(
			createElement(Sheet, {
				open: true,
				label: "Tools",
				onClose: () => closed.push("sheet"),
				children: createElement("button", null, "Tool"),
			}),
		);
		void act(() => window.dispatchEvent(new PopStateEvent("popstate")));
		expect(closed).toEqual(["sheet"]);
	});

	test("Back with a modal above a sheet closes neither, rather than the hidden sheet", () => {
		const closed: string[] = [];
		mount(
			createElement(
				"div",
				null,
				createElement(Sheet, {
					open: true,
					label: "Tools",
					onClose: () => closed.push("sheet"),
					children: createElement("button", null, "Tool"),
				}),
				createElement(
					Modal,
					{ title: "Confirm", onClose: () => closed.push("modal") },
					createElement("button", null, "OK"),
				),
			),
		);
		expect(overlayStackForDocument(document).keyOwner()?.dismissOnBack).toBeFalsy();
		void act(() => window.dispatchEvent(new PopStateEvent("popstate")));
		expect(closed).toEqual([]);
		expect(document.querySelector(".cv-modal")).not.toBeNull();
	});

	for (const order of ["vui-first", "modal-first"] as const) {
		test(`app modal paints above VUI sheet when mounted ${order}`, () => {
			const children = {
				vui: createElement(VuiSheet, {
					open: true,
					title: "VUI",
					onRequestClose: () => {},
					children: createElement("button", null, "VUI action"),
				}),
				modal: createElement(
					Modal,
					{ title: "App", onClose: () => {} },
					createElement("button", null, "App action"),
				),
			};
			mount(
				createElement(
					"div",
					null,
					...(order === "vui-first"
						? [children.vui, children.modal]
						: [children.modal, children.vui]),
				),
			);
			expect(
				overlayStackForDocument(document)
					.entries()
					.map((entry) => entry.zOrder),
			).toEqual([1020, 1100]);
		});
	}

	/* The dock is Modal's own phone position, not a Sheet. The assertion that
	 * matters is the pairing: backdrop and dialog either both dock or neither
	 * does, because the CSS splits one treatment across the two elements. */
	test("dock marks the backdrop and the dialog together, and only when asked", () => {
		mount(createElement(Modal, { title: "Docked", onClose: () => {}, dock: true }));
		expect(document.querySelector(".cv-modal-back-dock")).not.toBeNull();
		expect(document.querySelector(".cv-modal.cv-modal-dock")).not.toBeNull();
		unmount?.();
		unmount = undefined;
		document.body.replaceChildren();

		mount(createElement(Modal, { title: "Plain", onClose: () => {} }));
		expect(document.querySelector(".cv-modal")).not.toBeNull();
		expect(document.querySelector(".cv-modal-back-dock")).toBeNull();
		expect(document.querySelector(".cv-modal-dock")).toBeNull();
	});

	/* Sheet is the primitive that slides from an edge; Modal is not, at any
	 * width. A Modal that reached for a `ui-sheet*` class would be impersonating
	 * it again, which is the defect the dock prop replaced. */
	test("Modal borrows no Sheet class", () => {
		mount(
			createElement(
				Modal,
				{ title: "Docked", onClose: () => {}, dock: true },
				createElement("button", null, "Action"),
			),
		);
		expect(document.body.innerHTML).not.toMatch(/ui-sheet|sheet-mobile/);
	});

	const surfaces = [
		"New note",
		"Edit note",
		"New reference",
		"Edit reference",
		"Delete project reference",
		"Delete catalog reference",
		"Choose video template",
		"Choose preset",
		"Apply preset",
		"Render status",
	];
	test("converted surfaces open, tab and dismiss with Escape", () => {
		for (const title of surfaces) {
			let closes = 0;
			mount(
				createElement(
					Modal,
					{ title, onClose: () => closes++ },
					createElement("button", null, "Action"),
				),
			);
			const modal = document.querySelector<HTMLElement>(".cv-modal")!;
			expect(modal.contains(document.activeElement), `${title} did not take focus`).toBe(true);
			void act(() =>
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })),
			);
			expect(modal.contains(document.activeElement), `${title} leaked focus`).toBe(true);
			void act(() =>
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
			);
			expect(closes, `${title} did not dismiss`).toBe(1);
			unmount?.();
			unmount = undefined;
			document.body.replaceChildren();
		}
	});
});

function sourceFiles(root: string): string[] {
	return readdirSync(root).flatMap((name) => {
		const path = join(root, name);
		return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".tsx") ? [path] : [];
	});
}

describe("overlay boundary", () => {
	/* Named scrims AND hand-rolled ones. The first spelling of this test looked
	 * for the two primitive class names, which a surface writing its own scrim
	 * under its own name walks straight past — `catalog-ref-detail-scrim` and
	 * `tl2-materials-scrim` both did, and with them went the focus trap, the
	 * Escape handler, the focus restore and the stack entry.
	 *
	 * A scrim ALONE is not the offence. Six surfaces render one to dismiss a
	 * popover, a menu or a rail drawer, and none of them claims the page: no
	 * `aria-modal`, no focus to trap, nothing to restore. What makes an overlay
	 * is the pair — a scrim plus a dialog that says the rest of the page is
	 * unavailable — and that pair belongs to the primitives. */
	test("only primitives render app scrims", () => {
		const components = join(import.meta.dirname, "..");
		const allowed = new Set([
			/* The three overlays and the mechanism they share. */
			join(import.meta.dirname, "modal.tsx"),
			join(import.meta.dirname, "sheet.tsx"),
			join(import.meta.dirname, "lightbox.tsx"),
		]);
		const offenders = sourceFiles(components).filter((path) => {
			if (path.endsWith(".test.tsx") || allowed.has(path)) return false;
			const source = readFileSync(path, "utf8");
			if (/cv-modal-back|ui-sheet-scrim/.test(source)) return true;
			return /-scrim"/.test(source) && /aria-modal/.test(source);
		});
		expect(offenders).toEqual([]);
	});

	test("app primitives keep no overlay stack, focus restore or body lock", () => {
		for (const name of ["modal.tsx", "sheet.tsx", "lightbox.tsx"]) {
			const source = readFileSync(join(import.meta.dirname, name), "utf8");
			expect(source, name).not.toMatch(/WeakMap|activeElement|body\.style\.overflow/);
		}
	});

	test("only controllers/overlay keeps overlay state, anywhere in the app", () => {
		/* One overlay stack per document, and Back answered by that stack: a second
		 * list is how Back once closed a sheet hidden beneath a modal. Scanned over
		 * the whole client so a list cannot reappear one directory over. The router
		 * listens to popstate for navigation, which is not overlay state. */
		const src = join(import.meta.dirname, "../..");
		const owner = join(src, "controllers/overlay");
		const router = join(src, "app/history-sync.ts");
		const files = sourceFiles(src).filter(
			(path) => !path.includes(".test.") && !path.startsWith(owner) && path !== router,
		);
		expect(files.length).toBeGreaterThan(200);
		const offenders = files.filter((path) =>
			/WeakMap<Document|OverlayRegistration\[\]|addEventListener\(\s*["']popstate["']|history\.pushState/.test(
				readFileSync(path, "utf8"),
			),
		);
		expect(offenders.map((path) => path.slice(src.length + 1))).toEqual([]);
	});
});
