import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { listApprovals, recordApproval } from "@maleo/db/approvals";
import { createCampaign, getCampaign, listCampaigns, updateCampaign } from "@maleo/db/campaigns";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { setDraftCampaign } from "@maleo/db/drafts";

const testDbDir = join(tmpdir(), "maleo-dashboard-ops-tests");
const testDbPath = join(testDbDir, "operations.db");

async function resetDbFile(): Promise<void> {
	await closeMaleoDb();
	rmSync(testDbPath, { force: true });
	rmSync(`${testDbPath}-shm`, { force: true });
	rmSync(`${testDbPath}-wal`, { force: true });
}

async function insertDraft(
	workspace: string,
	opts: { status?: string; campaign_id?: string | null } = {},
): Promise<string> {
	const db = openDb();
	const id = randomUUID();
	const now = Date.now();
	await db.run(
		`INSERT INTO drafts
		 (workspace, id, action_id, revision, action, reasoning, content, status, created_at, updated_at, campaign_id)
		 VALUES (?, ?, ?, 1, 'POST', 'reason', 'content', ?, ?, ?, ?)`,
		[
			workspace,
			id,
			`act_${id.slice(0, 8)}`,
			opts.status ?? "waiting_approval",
			now,
			now,
			opts.campaign_id ?? null,
		],
	);
	return id;
}

describe("operations-db", () => {
	beforeEach(async () => {
		process.env.MALEO_DB_PATH = testDbPath;
		mkdirSync(dirname(testDbPath), { recursive: true });
		await resetDbFile();
	});

	afterEach(async () => {
		await resetDbFile();
		if (existsSync(testDbDir)) {
			rmSync(testDbDir, { recursive: true, force: true });
		}
	});

	test("campaign counts reflect linked drafts and records approval history", async () => {
		const campaign = await createCampaign({
			name: "Ramadan Beauty Push",
			goal: "Publish 10 skincare storyboards",
			status: "active",
			workspaces: ["veronika"],
		});

		const draftId = await insertDraft("veronika", {
			status: "waiting_approval",
			campaign_id: campaign.id,
		});
		await insertDraft("veronika", { status: "published", campaign_id: campaign.id });

		await recordApproval({
			workspace: "veronika",
			draft_id: draftId,
			decision: "approve",
			reason_code: "manual_review",
		});

		const campaigns = await listCampaigns();
		expect(campaigns).toHaveLength(1);
		expect(campaigns[0]?.draft_count).toBe(2);
		expect(campaigns[0]?.open_draft_count).toBe(1);

		const history = await listApprovals("veronika", draftId);
		expect(history[0]?.decision).toBe("approve");
		expect(history[0]?.reason_code).toBe("manual_review");
	});

	test("updates campaign and links a draft via setDraftCampaign", async () => {
		const campaign = await createCampaign({
			name: "June Push",
			goal: "Initial goal",
			status: "draft",
			workspaces: ["veronika"],
		});
		const updatedCampaign = await updateCampaign(campaign.id, {
			status: "active",
			goal: "Updated goal",
		});
		expect(updatedCampaign?.status).toBe("active");
		expect(updatedCampaign?.goal).toBe("Updated goal");

		const draftId = await insertDraft("veronika", {
			status: "waiting_approval",
			campaign_id: null,
		});
		expect((await getCampaign(campaign.id))?.draft_count).toBe(0);
		expect(await setDraftCampaign("veronika", draftId, campaign.id)).toBe(true);
		expect((await getCampaign(campaign.id))?.draft_count).toBe(1);
	});
});
