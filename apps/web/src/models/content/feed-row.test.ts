import { describe, expect, it } from "vite-plus/test";
import { feedRowFromItem } from "./feed-row.ts";

describe("feedRowFromItem", () => {
	it("maps feed rows without status, campaign, platform, or open-editor metadata", () => {
		const row = feedRowFromItem({
			id: "p1",
			title: "Coffee story",
			type: "video",
			status: "ready",
			target_platform: "tiktok",
			campaign_id: "c1",
			brief_json: { goal: "ignored in list" },
			reference_notes: "internal",
			created_at: 10,
			updated_at: 20,
			output_count: 2,
			campaign_name: "Campaign",
			latest_output_status: "published",
			latest_output_updated_at: 30,
		});
		expect(row).toEqual({
			projectId: "p1",
			title: "Coffee story",
			type: "video",
			createdAt: 10,
			updatedAt: 30,
			thumbnailUrl: null,
			durationSec: null,
		});
	});
});
