/* One source of colour for the painted layer and the styled layer.
 *
 * A canvas cannot read a custom property, so a painted timeline drifts from the
 * CSS around it the moment somebody re-themes: the styled chrome follows the new
 * token and the painted clips keep the colour that was compiled into them. So
 * the tokens are resolved — once, from the VUI root — into the palette the
 * painter uses, and `@maleo/vui/theme` says so beside the declarations.
 *
 * Every token has a fallback, because a consumer who imports no theme still gets
 * a legible timeline rather than a black rectangle.
 */
import type { PaintPalette } from "./paint.ts";

/** Which token each painted surface takes its colour from. */
export const PAINT_PALETTE_TOKENS = {
	background: "--vui-surface",
	item: "--vui-range",
	itemSelected: "--vui-accent",
	itemLocked: "--vui-surface-raised",
	itemLabel: "--vui-fg",
	ruler: "--vui-bg",
	rulerText: "--vui-muted",
	playhead: "--vui-playhead",
	snapGuide: "--vui-snap-guide",
	paddedMark: "--vui-border",
} as const satisfies Record<keyof PaintPalette, string>;

/** What the painter uses when a consumer imports no theme. Mirrors `theme.css`. */
export const DEFAULT_PAINT_PALETTE: PaintPalette = {
	background: "#20232b",
	item: "#6c5ce7",
	itemSelected: "#7c66ff",
	itemLocked: "#292d37",
	itemLabel: "#f5f6f8",
	ruler: "#17191f",
	rulerText: "#9ca3b2",
	playhead: "#ff5c7a",
	snapGuide: "#f5c451",
	paddedMark: "#3a3f4c",
};

/** Reads one custom property. Whatever it returns is what gets painted. */
export type TokenReader = (token: string) => string | undefined;

/**
 * Resolve the palette from a token reader.
 *
 * A token that reads empty falls back rather than painting an empty fill style,
 * which most contexts silently ignore — leaving the previous colour on the
 * surface and making the mistake look like a caching bug.
 */
export function resolvePaintPalette(
	read: TokenReader,
	fallback: PaintPalette = DEFAULT_PAINT_PALETTE,
): PaintPalette {
	/* Written out per surface rather than folded over the token table, so the
	 * returned value IS a `PaintPalette` by inference: a loop over entries can
	 * only build an open dictionary and then claim to be the palette, which is
	 * the claim a new surface added to the type would silently pass. */
	const pick = (surface: keyof PaintPalette): string => {
		const value = read(PAINT_PALETTE_TOKENS[surface])?.trim();
		return value !== undefined && value.length > 0 ? value : fallback[surface];
	};
	return {
		background: pick("background"),
		item: pick("item"),
		itemSelected: pick("itemSelected"),
		itemLocked: pick("itemLocked"),
		itemLabel: pick("itemLabel"),
		ruler: pick("ruler"),
		rulerText: pick("rulerText"),
		playhead: pick("playhead"),
		snapGuide: pick("snapGuide"),
		paddedMark: pick("paddedMark"),
	};
}

/** Anything computed styles can be read from. Structural, so a test can be one. */
export interface ComputedStyleSource {
	getPropertyValue(property: string): string;
}

/** A reader over resolved styles — in a browser, `getComputedStyle(vuiRoot)`. */
export function tokenReaderFrom(styles: ComputedStyleSource): TokenReader {
	return (token) => styles.getPropertyValue(token);
}
