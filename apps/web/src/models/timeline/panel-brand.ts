/* Maleo — shared panel brand palette. The menu previews render with the same
 * accent/bg/fg the scene uses, so the template/data preview looks visually equal
 * to what the clip will actually be on the timeline. */
export type BrandPalette = { accentColor: string; bgColor: string; fgColor: string };
export const DEFAULT_BRAND: BrandPalette = {
	accentColor: "#7C66FF",
	bgColor: "#0B0B0F",
	fgColor: "#FFFFFF",
};
