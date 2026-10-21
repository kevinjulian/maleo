import { describe, expect, test } from "vite-plus/test";
import { normalizeCatalogueImage } from "./workspace-catalogue.ts";

describe("normalizeCatalogueImage", () => {
	test("maps catalogue wire fields to RefImage fields", () => {
		const image = normalizeCatalogueImage({
			id: "ref-1",
			label: "Host",
			kind: "character",
			tags: ["cast"],
			note: "red coat",
			seed: 7,
			default: false,
			src: "/api/image-gen/files/host.png",
			workspace: "default",
			collection: "characters",
			item_id: "host",
		});

		expect(image.imageUrl).toBe("/api/image-gen/files/host.png");
		expect(image.description).toBe("red coat");
		expect(image.role).toBe("character");
		expect(image.seed).toBe(7);
	});

	test("keeps existing RefImage fields when present", () => {
		const image = normalizeCatalogueImage({
			id: "ref-2",
			label: "Existing",
			kind: "location",
			role: "style",
			tags: [],
			note: "wire note",
			description: "client description",
			seed: 0,
			default: false,
			src: "/wire.png",
			imageUrl: "/client.png",
			workspace: "default",
			collection: "references",
			item_id: "existing",
		});

		expect(image.imageUrl).toBe("/client.png");
		expect(image.description).toBe("client description");
		expect(image.role).toBe("style");
	});
});
