/* A project whose free lanes declare their groups, so lane heights differ.
 *
 * The editor-chat fixture with its track flags set: lane 0 audio, lane 1 text
 * (holding the fixture's text clip), lane 2 visual, lane 3 text. Every height
 * tier is present, and they are interleaved, so a row resolved from an assumed
 * uniform height lands on the wrong lane. */
import type { BrowserContext } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { editorChatProjectDetail, EDITOR_CHAT_PROJECT_ID } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");

export const TYPED_LANES_PROJECT_ID = EDITOR_CHAT_PROJECT_ID;
export const TYPED_LANE_GROUPS = ["audio", "text", "visual", "text"] as const;

export async function typedLanesFixture(
	context: BrowserContext,
	groups: readonly string[] = TYPED_LANE_GROUPS,
): Promise<void> {
	await replayApi(context, HAR);
	const trackFlags = Object.fromEntries(groups.map((group, row) => [row, { group }]));
	await context.route(
		new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
		(route) => {
			if (route.request().method() !== "GET") return route.fallback();
			return route.fulfill({
				json: {
					...editorChatProjectDetail,
					storyboards: editorChatProjectDetail.storyboards.map((storyboard) => ({
						...storyboard,
						storyboard_json: { ...storyboard.storyboard_json, trackFlags },
					})),
				},
			});
		},
	);
}
