import { describe, expect, it } from "vite-plus/test";
import { hasPendingEdits, pendingKeyUpdates } from "./status-views.ts";

describe("pendingKeyUpdates", () => {
	it("drops blank fields so an untouched input never clears its key", () => {
		expect(pendingKeyUpdates({ A: "", B: "v" })).toEqual({ B: "v" });
	});

	it("sends nothing when every field is blank", () => {
		expect(pendingKeyUpdates({ A: "", B: "" })).toEqual({});
	});
});

describe("hasPendingEdits", () => {
	it("is false when nothing has been typed", () => {
		expect(hasPendingEdits({ A: "", B: "" })).toBe(false);
		expect(hasPendingEdits({})).toBe(false);
	});

	it("is true as soon as one field has a value", () => {
		expect(hasPendingEdits({ A: "", B: "x" })).toBe(true);
	});
});
