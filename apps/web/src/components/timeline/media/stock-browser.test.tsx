import { describe, expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { StockAttribution } from "./stock-browser.tsx";

describe("stock attribution", () => {
	test("links provider, creator, and asset license", () => {
		const html = renderToStaticMarkup(
			<StockAttribution
				item={{
					id: "1",
					thumb: "",
					url: "https://cdn.example/1.mp3",
					kind: "audio",
					provider: "Example Stock",
					pageUrl: "https://stock.example/assets/1",
					author: "Example Creator",
					authorUrl: "https://stock.example/creators/1",
					license: "CC0",
					licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
				}}
			/>,
		);
		expect(html).toContain('href="https://stock.example/assets/1"');
		expect(html).toContain('href="https://stock.example/creators/1"');
		expect(html).toContain('href="https://creativecommons.org/publicdomain/zero/1.0/"');
	});
});
