import { describe, expect, test } from "bun:test";
import { toItem } from "./stock.ts";

describe("stock result mapping", () => {
	test("preserves attribution and license fields", () => {
		expect(
			toItem({
				id: "asset-1",
				kind: "image",
				provider: "Example Stock",
				url: "https://cdn.example/asset.jpg",
				pageUrl: "https://stock.example/assets/1",
				author: "Example Creator",
				authorUrl: "https://stock.example/creators/example",
				license: "Example License",
				licenseUrl: "https://stock.example/license",
			}),
		).toMatchObject({
			provider: "Example Stock",
			pageUrl: "https://stock.example/assets/1",
			author: "Example Creator",
			authorUrl: "https://stock.example/creators/example",
			license: "Example License",
			licenseUrl: "https://stock.example/license",
		});
	});
});
