import type { z } from "zod";
import type { storyboardSchema } from "../schema";

// Schema INPUT shape: fields with defaults (vignette, grain, …) stay optional, so
// the literal below doesn't need to restate every defaulted field.
export const sampleStoryboard: z.input<typeof storyboardSchema> = {
	scenes: [
		{
			image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=1200",
			label: "Hook",
			movement: "Slow Zoom In",
			transition: "fade",
			durationSec: 4,
			voiceover: "Skincare routine yang bikin glowing dalam 7 hari",
			visual: "Close up of serum bottle on marble surface",
			camera: "Close Up",
		},
		{
			image: "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=1200",
			label: "Product Detail",
			movement: "Slow Pan Left",
			transition: "slide",
			durationSec: 5,
			voiceover: "Formula ringan dengan hyaluronic acid dan niacinamide",
			visual: "Product texture being applied to skin",
			camera: "Medium Shot",
		},
		{
			image: "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=1200",
			label: "Results",
			movement: "Slight Push In",
			transition: "fade",
			durationSec: 4,
			voiceover: "Hasilnya? Kulit lembab seharian tanpa lengket",
			visual: "Before and after skin comparison",
			camera: "Close Up",
		},
		{
			image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=1200",
			label: "CTA",
			movement: "Static",
			transition: "fade",
			durationSec: 3,
			voiceover: "Cek link di bio sekarang",
			visual: "Product hero shot with brand logo",
			camera: "Wide Shot",
		},
	],
	accentColor: "#FF3E6C",
	bgColor: "#0B0B0F",
	fgColor: "#FFFFFF",
	musicMood: "chill",
	showLabels: false,
};
