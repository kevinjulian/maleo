import { afterEach, describe, expect, it } from "vite-plus/test";
import { absoluteDashboardUrl, dashboardOrigin } from "./dashboard-origin.ts";

afterEach(() => {
	delete process.env.MALEO_API_ORIGIN;
	delete process.env.MALEO_API_PORT;
	delete process.env.PORT;
});

describe("dashboardOrigin", () => {
	it("falls back to localhost:MALEO_API_PORT", () => {
		process.env.MALEO_API_PORT = "4444";
		expect(dashboardOrigin()).toBe("http://localhost:4444");
	});
	it("keeps PORT as deploy fallback", () => {
		process.env.PORT = "5555";
		expect(dashboardOrigin()).toBe("http://localhost:5555");
	});
	it("normalizes MALEO_API_ORIGIN (drops trailing slash / path)", () => {
		process.env.MALEO_API_ORIGIN = "https://app.example.com/";
		expect(dashboardOrigin()).toBe("https://app.example.com");
	});
	it("fails fast when set but invalid (no silent localhost fallback)", () => {
		process.env.MALEO_API_ORIGIN = "not a url";
		expect(() => dashboardOrigin()).toThrow();
	});
	it("rejects non-http(s) schemes", () => {
		process.env.MALEO_API_ORIGIN = "ftp://host";
		expect(() => dashboardOrigin()).toThrow();
	});
	it("absoluteDashboardUrl prefixes relative paths, passes absolute through", () => {
		process.env.MALEO_API_ORIGIN = "https://app.example.com";
		expect(absoluteDashboardUrl("/uploads/x.png")).toBe("https://app.example.com/uploads/x.png");
		expect(absoluteDashboardUrl("http://other/y")).toBe("http://other/y");
	});
});
