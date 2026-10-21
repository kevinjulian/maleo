import { z } from "zod";

export const CLIP_BLEND_MODES = ["normal", "multiply", "screen"] as const;
export const clipBlendModeSchema = z.enum(CLIP_BLEND_MODES);
export const clipColorSchema = z
	.object({
		brightness: z.number().finite().min(0).max(2),
		contrast: z.number().finite().min(0).max(2),
		saturation: z.number().finite().min(0).max(3),
	})
	.strict();
export const clipMaskSchema = z
	.object({
		shape: z.enum(["rectangle", "ellipse"]),
		xPct: z.number().finite().min(0).max(100),
		yPct: z.number().finite().min(0).max(100),
		widthPct: z.number().finite().positive().max(100),
		heightPct: z.number().finite().positive().max(100),
		rotationDeg: z.number().finite().min(-180).max(180),
		featherPct: z.number().finite().min(0).max(50),
		inverted: z.boolean(),
	})
	.strict()
	.refine(
		(m) => m.xPct + m.widthPct <= 100 && m.yPct + m.heightPct <= 100,
		"Mask must fit the local clip box before rotation",
	);
export type ClipMask = z.infer<typeof clipMaskSchema>;
export type ClipColor = z.infer<typeof clipColorSchema>;
export type ClipBlendMode = z.infer<typeof clipBlendModeSchema>;
export type ClipCompositing = {
	mask?: ClipMask | null;
	color?: ClipColor;
	blendMode?: ClipBlendMode;
};

export function hasClipCompositing(layout: ClipCompositing | undefined): boolean {
	return Boolean(
		layout?.mask ||
		(layout?.blendMode && layout.blendMode !== "normal") ||
		(layout?.color && Object.values(layout.color).some((v) => v !== 1)),
	);
}

/** Physical local coordinates keep rotation circular on rectangular clip boxes. */
export function clipMaskImage(mask: ClipMask, width: number, height: number): string {
	clipMaskSchema.parse(mask);
	if (![width, height].every((n) => Number.isFinite(n) && n > 0))
		throw new Error("Invalid mask box");
	const x = (width * mask.xPct) / 100,
		y = (height * mask.yPct) / 100;
	const w = (width * mask.widthPct) / 100,
		h = (height * mask.heightPct) / 100;
	const cx = x + w / 2,
		cy = y + h / 2;
	const blur = (Math.min(width, height) * mask.featherPct) / 300;
	const fill = mask.inverted ? "black" : "white";
	const shape =
		mask.shape === "ellipse"
			? `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}"/>`
			: `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
		`<defs>` +
		`<filter id="f" x="-100%" y="-100%" width="300%" height="300%">` +
		`<feGaussianBlur stdDeviation="${blur}"/>` +
		`</filter>` +
		`</defs>` +
		`<rect width="100%" height="100%" fill="${mask.inverted ? "white" : "black"}"/>` +
		`<g fill="${fill}" transform="rotate(${mask.rotationDeg} ${cx} ${cy})"${blur ? ' filter="url(#f)"' : ""}>${shape}</g>` +
		`</svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Validate authored fields before tolerant legacy readers or render schemas strip them. */
export function clipCompositingBlockers(input: unknown): string[] {
	const blockers: string[] = [],
		object = z.record(z.unknown());
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			value.forEach(visit);
			return;
		}
		const row = object.safeParse(value);
		if (!row.success) return;
		const layout = object.safeParse(row.data.layout);
		if (layout.success)
			for (const [name, schema] of [
				["mask", clipMaskSchema.nullable()],
				["color", clipColorSchema],
				["blendMode", clipBlendModeSchema],
			] as const) {
				if (layout.data[name] !== undefined && !schema.safeParse(layout.data[name]).success)
					blockers.push(
						`${typeof row.data.label === "string" ? row.data.label : "Clip"}: invalid ${name}. Repair compositing before export.`,
					);
			}
		for (const [name, child] of Object.entries(row.data)) if (name !== "layout") visit(child);
	};
	visit(input);
	return [...new Set(blockers)];
}
