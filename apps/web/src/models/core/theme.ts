/* The one theme store. The top bar toggle and the Preferences page both read
 * it, so the stored choice and the `dark` class cannot drift between copies —
 * which is what two components each holding their own `useState` did.
 *
 * `light` and `dark` are the values the old toggle wrote, so an existing choice
 * survives unchanged; `system` is new and is also what "nothing stored" means. */
import { oneOf } from "@maleo/shared";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

const KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

export function readTheme(): Theme {
	try {
		return oneOf(window.localStorage.getItem(KEY), THEMES) ?? "system";
	} catch {
		return "system";
	}
}

export function resolveDark(theme: Theme): boolean {
	if (theme !== "system") return theme === "dark";
	return window.matchMedia?.(DARK_QUERY).matches ?? false;
}

function apply(theme: Theme): void {
	document.documentElement.classList.toggle("dark", resolveDark(theme));
}

export function setTheme(theme: Theme): void {
	try {
		window.localStorage.setItem(KEY, theme);
	} catch {
		/* private window or quota: the choice lasts this page only */
	}
	apply(theme);
	for (const listener of listeners) listener();
}

export function subscribeTheme(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/* At boot, before any shell renders: the bare shell has no toggle to apply it,
 * and `system` has to follow the OS changing under an open tab. */
export function initTheme(): void {
	apply(readTheme());
	window.matchMedia?.(DARK_QUERY).addEventListener?.("change", () => {
		if (readTheme() === "system") apply("system");
	});
}
