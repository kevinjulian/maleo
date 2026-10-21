import { describe, expect, it } from "vite-plus/test";
import { contentFeedUrl } from "./feed.ts";

describe("contentFeedUrl", () => {
	it("adds type query only when a content type filter is active", () => {
		expect(contentFeedUrl({ offset: 0, searchQuery: "", typeFilter: "all" })).toBe(
			"/api/operations/content/feed?limit=20&offset=0",
		);
		expect(contentFeedUrl({ offset: 20, searchQuery: "coffee", typeFilter: "video" })).toBe(
			"/api/operations/content/feed?limit=20&offset=20&search=coffee&type=video",
		);
		expect(
			contentFeedUrl({ offset: 20, searchQuery: "coffee", typeFilter: "video", sort: "name" }),
		).toBe("/api/operations/content/feed?limit=20&offset=20&search=coffee&type=video&sort=name");
	});
});
