/* Human labels for element paths.
 *
 * The stored keys are addresses — `settings.brandAccent` is what a source map is keyed by,
 * not what a person should read. Kept in one place because two surfaces name these: the
 * apply confirmation listing what it will replace, and the library listing what a project
 * has diverged on. Two maps would let the same element be called two things.
 */
const LABELS: Readonly<Record<string, string>> = {
	style: "Style",
	projectReferences: "References",
	pacingDevices: "Retention overlays",
	"settings.aspectRatio": "Aspect ratio",
	"settings.timelineTemplateId": "Template",
	"settings.globalStyleRefId": "Style reference",
	"settings.voiceProvider": "Voice provider",
	"settings.voice": "Voice",
	"settings.language": "Language",
	"settings.brandAccent": "Brand accent",
	"settings.brandFont": "Brand font",
	"settings.brandLogoUrl": "Brand logo",
	"settings.backgroundFill": "Background",
	"settings.renderBackend": "Render backend",
};

/** The label for a path, falling back to the path itself. A path with no label is still
 *  more useful shown than hidden — it says which element, just less nicely. */
export function elementLabel(path: string): string {
	return LABELS[path] ?? path;
}
