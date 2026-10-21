export interface CharacterLock {
	subject?: string;
	hair?: string;
	outfit?: string;
	face?: string;
	body?: string;
	expression?: string;
}

export interface StyleProfile {
	character?: CharacterLock;
	style?: string;
	camera?: string;
	post_processing?: string;
	aspect_ratio?: string;
	lighting_default?: string;
	mood_default?: string;
	color_palette?: string;
	depth_of_field?: string;
	global_tokens?: string;
	scene_extras?: string;
	negative?: string;
}

export interface SceneOverrides {
	action?: string;
	framing?: string;
	angle?: string;
	time_of_day?: string;
	weather?: string;
	lighting?: string;
	mood?: string;
	gaze?: string;
	props?: string;
	location?: string;
}

const DEFAULT_STYLE: StyleProfile = {
	style: "photorealistic candid photograph",
	camera: "Kodak Portra 400 35mm film, 85mm f/1.8 lens",
	post_processing:
		"low-saturation premium color grading, subtle film grain, slight chromatic aberration, gentle highlight roll-off",
	aspect_ratio: "4:5",
	lighting_default: "natural soft lighting, golden hour ambience",
	mood_default: "candid, unposed, documentary",
	color_palette: "muted earth tones",
	depth_of_field: "shallow with creamy bokeh",
	negative:
		"deformed limbs, distorted hands or feet, warped face, plastic skin, over-smoothed face, harsh studio flash, glossy advertisement look, compression artifacts, broken proportions, AI badge, sparkle icon, diamond mark, text watermark, signature, logo",
};

function pruneEmpty(v: unknown): unknown {
	if (Array.isArray(v)) {
		const cleaned = v.map(pruneEmpty).filter((x) => x !== undefined && x !== "");
		return cleaned.length > 0 ? cleaned : undefined;
	}
	if (v && typeof v === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v)) {
			const cleaned = pruneEmpty(val);
			if (cleaned !== undefined && cleaned !== "") out[k] = cleaned;
		}
		return Object.keys(out).length > 0 ? out : undefined;
	}
	return v;
}

export function buildImagePrompt(
	userPrompt: string,
	style?: StyleProfile,
	scene?: SceneOverrides,
): string {
	const s: StyleProfile = { ...DEFAULT_STYLE, ...style };
	const sc: SceneOverrides = scene ?? {};

	const spec: Record<string, unknown> = {
		render: {
			style: s.style,
			camera: s.camera,
			aspect_ratio: s.aspect_ratio,
			depth_of_field: s.depth_of_field,
			post_processing: s.post_processing,
			color_palette: s.color_palette,
			global_tokens: s.global_tokens,
		},
		subject: s.character
			? {
					subject: s.character.subject,
					hair: s.character.hair,
					face: s.character.face,
					outfit: s.character.outfit,
					body: s.character.body,
					expression: s.character.expression,
					note: "MUST remain identical across all generated images of this character",
				}
			: undefined,
		scene: {
			raw_prompt: userPrompt,
			action: sc.action,
			framing: sc.framing,
			angle: sc.angle,
			gaze: sc.gaze,
			props: sc.props,
			location: sc.location,
		},
		atmosphere: {
			lighting: sc.lighting ?? s.lighting_default,
			mood: sc.mood ?? s.mood_default,
			time_of_day: sc.time_of_day,
			weather: sc.weather,
			extras: s.scene_extras,
		},
		negative: s.negative,
	};

	const cleaned = pruneEmpty(spec);
	const json = JSON.stringify(cleaned, null, 2);

	return [
		"Render this image specification exactly. Treat 'subject' as a locked",
		"character whose appearance must stay consistent across all generations.",
		"Use 'scene' for what is happening in this specific image. Apply",
		"'atmosphere' and 'render' globally. The 'negative' list must NOT appear.",
		"",
		"```json",
		json,
		"```",
		"",
		"Fill the full frame edge-to-edge — no borders, no letterboxing, no decorative frames.",
	].join("\n");
}
