import { describe, expect, test } from "vite-plus/test";
import type { ReactElement } from "react";
import { VuiSheet } from "./sheet.tsx";
import { type VuiDismissReason } from "./overlay.tsx";
import { allowsVuiDismiss } from "./overlay.tsx";

type OverlayElement = ReactElement<{
	open: boolean;
	label: string;
	className: string;
	dismissOnEscape: boolean;
	dismissOnScrim: boolean;
	onRequestClose: (reason: VuiDismissReason) => void;
}>;

describe("VUI sheet contracts", () => {
	test("opens bottom, right, and fullscreen fixtures with dialog semantics", () => {
		for (const placement of ["bottom", "right", "fullscreen"] as const) {
			const element = VuiSheet({
				open: true,
				title: "Inspector",
				placement,
				children: null,
				onRequestClose: () => {},
				dismissOnEscape: false,
				dismissOnScrim: false,
			}) as OverlayElement;
			expect(element.props.open).toBe(true);
			expect(element.props.label).toBe("Inspector");
			expect(element.props.className).toContain(`vui-sheet-${placement}`);
			expect(element.props.dismissOnEscape).toBe(false);
			expect(element.props.dismissOnScrim).toBe(false);
		}
	});

	test("forwards consumer-owned close reasons", () => {
		const reasons: VuiDismissReason[] = [];
		const element = VuiSheet({
			open: true,
			title: "Inspector",
			children: null,
			onRequestClose: (reason) => reasons.push(reason),
		}) as OverlayElement;
		element.props.onRequestClose("close-button");
		element.props.onRequestClose("escape");
		element.props.onRequestClose("scrim");
		expect(reasons).toEqual(["close-button", "escape", "scrim"]);
	});

	test("suppresses disabled Escape and scrim paths without suppressing close button", () => {
		expect(allowsVuiDismiss("close-button", false, false)).toBe(true);
		expect(allowsVuiDismiss("escape", false, true)).toBe(false);
		expect(allowsVuiDismiss("scrim", true, false)).toBe(false);
		expect(allowsVuiDismiss("escape", true, false)).toBe(true);
		expect(allowsVuiDismiss("scrim", false, true)).toBe(true);
	});
});
