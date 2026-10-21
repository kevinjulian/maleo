import { describe, expect, it } from "vite-plus/test";
import { adminErrorMessage } from "./admin-errors.ts";

describe("adminErrorMessage", () => {
	it("names the workspace that blocks an account deletion", () => {
		expect(adminErrorMessage('409 {"error":"last_workspace_owner:alpha"}')).toContain(
			"only owner of alpha",
		);
	});

	it("does not mistake a last-owner refusal for the final-workspace one", () => {
		expect(adminErrorMessage("last_workspace_owner")).toBe("Transfer workspace ownership first.");
		expect(adminErrorMessage("last_workspace")).toContain("final workspace");
	});

	it("passes an unknown error through", () => {
		expect(adminErrorMessage("network down")).toBe("network down");
	});
});
