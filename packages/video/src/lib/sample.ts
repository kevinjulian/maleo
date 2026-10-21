import type { Product } from "../schema";

export const sampleProduct: Product = {
	brand: "Maleo",
	title: "Velvet Glow Serum",
	subtitle: "Dewy skin in 7 days",
	price: "189.000",
	currency: "IDR",
	bullets: ["Hyaluronic + Niacinamide", "Lightweight, non-sticky", "Vegan, cruelty-free"],
	cta: "Shop now",
	images: [
		"https://images.unsplash.com/photo-1556228720-195a672e8a03?w=1200",
		"https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=1200",
		"https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=1200",
	],
	accentColor: "#FF3E6C",
	bgColor: "#0B0B0F",
	fgColor: "#FFFFFF",
	musicMood: "upbeat",
	templateId: "classic",
};
