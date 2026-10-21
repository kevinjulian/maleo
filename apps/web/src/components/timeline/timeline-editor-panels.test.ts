import { describe, expect, it } from "vite-plus/test";
import { findTextTemplate } from "@models/clip-templates/registry.ts";
import { textTemplateValuesFromClip } from "./timeline-editor-panels.tsx";

describe("text template inspector values", () => {
	it("derives generated cinematic title fields from rendered clip content", () => {
		const template = findTextTemplate("rve-cinematic-title-intro");
		expect(
			textTemplateValuesFromClip(template, "rve-cinematic-title-intro", "Mulai dari Dalam"),
		).toMatchObject({
			title: "Mulai dari Dalam",
			subtitle: "A Cinematic Experience",
		});
	});

	it("maps multiline generated content onto structured text fields", () => {
		const template = findTextTemplate("rve-lower-third");
		expect(
			textTemplateValuesFromClip(template, "rve-lower-third", "Kevin\nDirector"),
		).toMatchObject({
			name: "Kevin",
			role: "Director",
		});
	});
});
