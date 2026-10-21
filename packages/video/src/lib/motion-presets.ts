export type MotionParams = {
	from: { scale: number; x: number; y: number };
	to: { scale: number; x: number; y: number };
};

export type MotionPresetId =
	| "static"
	| "slow-zoom-in"
	| "slow-zoom-out"
	| "slow-pan-left"
	| "slow-pan-right"
	| "slight-push-in"
	| "slight-pull-out"
	| "tilt-up"
	| "tilt-down"
	| "follow-tracking"
	| "orbit"
	| "handheld"
	| "ken-burns"
	| "glitch";

export const MOTION_PRESETS = {
	static: {
		from: { scale: 1.02, x: 0, y: 0 },
		to: { scale: 1.02, x: 0, y: 0 },
	},
	"slow-zoom-in": {
		from: { scale: 1.0, x: 0, y: 0 },
		to: { scale: 1.15, x: 0, y: 0 },
	},
	"slow-zoom-out": {
		from: { scale: 1.15, x: 0, y: 0 },
		to: { scale: 1.0, x: 0, y: 0 },
	},
	"slow-pan-left": {
		from: { scale: 1.08, x: 30, y: 0 },
		to: { scale: 1.08, x: -30, y: 0 },
	},
	"slow-pan-right": {
		from: { scale: 1.08, x: -30, y: 0 },
		to: { scale: 1.08, x: 30, y: 0 },
	},
	"slight-push-in": {
		from: { scale: 1.0, x: 0, y: 0 },
		to: { scale: 1.08, x: 0, y: -10 },
	},
	"slight-pull-out": {
		from: { scale: 1.08, x: 0, y: -10 },
		to: { scale: 1.0, x: 0, y: 0 },
	},
	"tilt-up": {
		from: { scale: 1.06, x: 0, y: 20 },
		to: { scale: 1.06, x: 0, y: -20 },
	},
	"tilt-down": {
		from: { scale: 1.06, x: 0, y: -20 },
		to: { scale: 1.06, x: 0, y: 20 },
	},
	"follow-tracking": {
		from: { scale: 1.0, x: -25, y: 0 },
		to: { scale: 1.06, x: 25, y: -8 },
	},
	orbit: {
		from: { scale: 1.05, x: -20, y: 10 },
		to: { scale: 1.05, x: 20, y: -10 },
	},
	handheld: {
		from: { scale: 1.03, x: -4, y: -3 },
		to: { scale: 1.03, x: 4, y: 3 },
	},
	"ken-burns": {
		from: { scale: 1.0, x: 0, y: 0 },
		to: { scale: 1.18, x: -30, y: -20 },
	},
	glitch: {
		from: { scale: 1.02, x: -6, y: 3 },
		to: { scale: 1.02, x: 6, y: -3 },
	},
} satisfies Record<MotionPresetId, MotionParams>;

const UI_MOVEMENT_MAP: Record<string, MotionPresetId> = {
	Static: "static",
	"Slow Pan": "slow-pan-left",
	"Slow Pan Left": "slow-pan-left",
	"Slow Pan Right": "slow-pan-right",
	"Slow Zoom In": "slow-zoom-in",
	"Slow Zoom Out": "slow-zoom-out",
	"Slight Push In": "slight-push-in",
	"Slight Pull Out": "slight-pull-out",
	"Follow / Tracking": "follow-tracking",
	"Tilt Up": "tilt-up",
	"Tilt Down": "tilt-down",
	Orbit: "orbit",
	Handheld: "handheld",
	Glitch: "glitch",
	"Glitch / Flicker": "glitch",
	"Slow Motion": "slow-zoom-in",
	"Time Lapse": "slow-zoom-out",
};

const isMotionPresetId = (id: string): id is MotionPresetId => Object.hasOwn(MOTION_PRESETS, id);

export function resolveMotion(movement?: string): MotionParams {
	if (!movement) return MOTION_PRESETS["ken-burns"];
	const presetId = UI_MOVEMENT_MAP[movement] ?? movement;
	return isMotionPresetId(presetId) ? MOTION_PRESETS[presetId] : MOTION_PRESETS["ken-burns"];
}
