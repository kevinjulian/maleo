export function getVuiFocusable(root: HTMLElement): HTMLElement[] {
	return Array.from(
		root.querySelectorAll<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
		),
	).filter(
		(element) =>
			!element.hasAttribute("hidden") &&
			!element.matches(":disabled, [aria-disabled='true'], [data-disabled]"),
	);
}
