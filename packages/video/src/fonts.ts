// Single font load shared by the render (Root → StoryboardReel) and the in-browser
// preview (@remotion/player). Both sides MUST load the same font or text metrics
// (wrapping, width, caption positions) diverge → preview != render. @remotion/
// google-fonts integrates with Remotion's delayRender, so frames wait until the
// font is ready on both the headless render and the Player.
import { loadFont } from "@remotion/google-fonts/Inter";

/* Load ONLY the weights and subsets the compositions actually use.
 *
 * An unqualified loadFont() pulls every weight x style x subset of Inter. Each
 * variation is a network fetch wrapped in a delayRender handle the renderer blocks
 * on, and there are hundreds: bundling a composition takes under a second, while the
 * fonts alone ran past two minutes without finishing. That made local rendering
 * unusable and slowed the editor preview with the same warning.
 *
 * Weights cover every value used across the compositions and overlay presets;
 * off-scale values (620, 650, 850, 950) snap to the nearest loaded weight. Italic is
 * kept because the quote preset and the caption config both use it.
 *
 * Subsets are latin + latin-ext: the product writes English and Indonesian. Text in
 * Cyrillic, Greek or Vietnamese would fall back to a system font — if that becomes a
 * real case, add the subset here rather than dropping the option, which would
 * restore the stall.
 *
 * Remotion v5 makes weights + subsets mandatory, so this is also the forward path. */
const loaded = loadFont(undefined, {
	weights: ["300", "400", "500", "600", "700", "800", "900"],
	subsets: ["latin", "latin-ext"],
});

// The CSS family name to use in composition styles ("Inter"). Re-exported so call
// sites can reference the loaded family instead of a bare string.
export const FONT_FAMILY = loaded.fontFamily;

// Importing this module is enough to trigger the load (side effect above). Call
// this explicitly before mounting the Player to make the dependency obvious.
export function ensureFonts(): string {
	return loaded.fontFamily;
}
