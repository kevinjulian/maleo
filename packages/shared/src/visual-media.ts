import { z } from "zod";

/** Percentage window in original pixels, before destination fit or rotation. */
export const sourceCropSchema = z
	.object({
		xPct: z.number().finite().min(0).max(99),
		yPct: z.number().finite().min(0).max(99),
		widthPct: z.number().finite().min(1).max(100),
		heightPct: z.number().finite().min(1).max(100),
	})
	.refine(
		(crop) => crop.xPct + crop.widthPct <= 100 && crop.yPct + crop.heightPct <= 100,
		"Crop must remain inside source",
	);
export type SourceCrop = z.infer<typeof sourceCropSchema>;
export const FULL_SOURCE_CROP: SourceCrop = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 };

/** Fit cropped intrinsic aspect; full source grows behind its retained window. */
export function sourceCropGeometry(
	source: { width: number; height: number },
	destination: { width: number; height: number },
	crop: SourceCrop,
	fit: "contain" | "cover" | "stretch",
) {
	sourceCropSchema.parse(crop);
	if (
		![source.width, source.height, destination.width, destination.height].every(
			(value) => Number.isFinite(value) && value > 0,
		)
	)
		throw new Error("Invalid media dimensions");
	const aspect = (source.width * crop.widthPct) / (source.height * crop.heightPct);
	const wide = aspect > destination.width / destination.height;
	const width =
		fit === "stretch" || (fit === "contain" ? wide : !wide)
			? destination.width
			: destination.height * aspect;
	const height =
		fit === "stretch" || (fit === "contain" ? !wide : wide)
			? destination.height
			: destination.width / aspect;
	return {
		width,
		height,
		left: (destination.width - width) / 2,
		top: (destination.height - height) / 2,
		sourceWidth: (width * 100) / crop.widthPct,
		sourceHeight: (height * 100) / crop.heightPct,
		sourceLeft: (-width * crop.xPct) / crop.widthPct,
		sourceTop: (-height * crop.yPct) / crop.heightPct,
	};
}
