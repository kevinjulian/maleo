import { describe, expect, it } from "vite-plus/test";
import { resolveUploadFilePath } from "./upload-files.ts";

describe("resolveUploadFilePath", () => {
	it("resolves safe upload path under public uploads", () => {
		expect(
			resolveUploadFilePath("/uploads/example.png")?.endsWith("/public/uploads/example.png"),
		).toBe(true);
	});

	it("rejects traversal and nested paths", () => {
		expect(resolveUploadFilePath("/uploads/../secret.txt")).toBeNull();
		expect(resolveUploadFilePath("/uploads/nested/example.png")).toBeNull();
		expect(resolveUploadFilePath("/files/example.png")).toBeNull();
	});
});
