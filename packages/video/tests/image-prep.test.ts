import { afterEach, describe, expect, test } from "vite-plus/test";
import { dashboardAssetCandidates } from "../src/lib/image-prep";

const PREV = {
	MALEO_API_URL: process.env.MALEO_API_URL,
	MALEO_APP_URL: process.env.MALEO_APP_URL,
	MALEO_API_HOST: process.env.MALEO_API_HOST,
};

afterEach(() => {
	for (const [key, value] of Object.entries(PREV)) {
		if (value == null) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("dashboardAssetCandidates", () => {
	test("leaves non-route paths untouched", () => {
		expect(dashboardAssetCandidates("public/images/a.jpg")).toEqual(["public/images/a.jpg"]);
		expect(dashboardAssetCandidates("https://cdn.example.com/a.jpg")).toEqual([
			"https://cdn.example.com/a.jpg",
		]);
	});

	test("prefers configured dashboard url for api routes", () => {
		process.env.MALEO_API_URL = "http://dash.local:3030/";
		const out = dashboardAssetCandidates("/api/workspaces/p/collections/c/items/i/sheets/x.png");
		expect(out[0]).toBe(
			"http://dash.local:3030/api/workspaces/p/collections/c/items/i/sheets/x.png",
		);
	});

	test("includes localhost fallbacks for api routes", () => {
		delete process.env.MALEO_API_URL;
		delete process.env.MALEO_APP_URL;
		delete process.env.MALEO_API_HOST;
		const out = dashboardAssetCandidates("/api/workspaces/demo");
		expect(out).toContain("http://127.0.0.1:3030/api/workspaces/demo");
		expect(out).toContain("http://localhost:3030/api/workspaces/demo");
		expect(out).toContain("http://127.0.0.1:8090/api/workspaces/demo");
		expect(out).toContain("http://localhost:8090/api/workspaces/demo");
	});
});
