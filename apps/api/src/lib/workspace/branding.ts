// Workspace visual identity derivation. Source of truth = maleo-db workspaces
// table; this module computes the values written there at sync/scaffold time.
// Config.yaml `branding:` block is the authoring surface; anything omitted
// falls back to a stable name-hashed palette so new workspaces need zero code.

export interface WorkspaceBranding {
	color: string;
	color_bright: string;
	color_deep: string;
	tagline: string;
	initials: string;
}

export interface BrandingInput {
	color?: string | null;
	color_bright?: string | null;
	color_deep?: string | null;
	tagline?: string | null;
	initials?: string | null;
}

// Deterministic 32-bit hash of a name → stable per-name color with no fixed
// palette (so no two-workspaces-share-a-swatch collisions). Output is hex, not
// hsl(), because callers append an alpha suffix (e.g. `${color}33`) which only
// works on 6-digit hex.
function hashUint(name: string): number {
	let h = 0;
	for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
	return h >>> 0;
}

// HSL (h in 0..360, s/l in 0..1) → "#rrggbb". Standard HSL→RGB conversion.
function hslToHex(h: number, s: number, l: number): string {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	const hex = (v: number) =>
		Math.round((v + m) * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function defaultInitials(name: string): string {
	return name.slice(0, 2).toUpperCase();
}

// Generate a stable color triple from the name's hue. Fixed saturation/lightness
// keep the base legible on light backgrounds and white text readable on the
// avatar gradient; bright/deep are lighter/darker shades of the same hue.
function generatedColors(name: string) {
	const hue = hashUint(name) % 360;
	return {
		color: hslToHex(hue, 0.62, 0.55),
		bright: hslToHex(hue, 0.7, 0.7),
		deep: hslToHex(hue, 0.65, 0.32),
	};
}

// Resolve full branding for a workspace, filling any missing field from a color
// generated off the name hash. Pass the `branding` block from config.yaml (or
// null) — explicit values always win.
export function deriveBranding(name: string, input?: BrandingInput | null): WorkspaceBranding {
	const gen = generatedColors(name);
	return {
		color: input?.color ?? gen.color,
		color_bright: input?.color_bright ?? gen.bright,
		color_deep: input?.color_deep ?? gen.deep,
		tagline: input?.tagline ?? "workspace",
		initials: (input?.initials ?? defaultInitials(name)).toUpperCase(),
	};
}
