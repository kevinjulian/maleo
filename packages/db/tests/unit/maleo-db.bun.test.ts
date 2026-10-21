import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { listApprovals, recordApproval } from "../../src/db/approvals.ts";
import {
	createCampaign,
	getCampaign,
	listCampaigns,
	updateCampaign,
} from "../../src/db/campaigns.ts";
import { closeMaleoDb, openDb } from "../../src/db/connection.ts";
import { resolveLegacySqlitePath } from "../../src/db/legacy-sqlite.ts";
import { setDraftCampaign } from "../../src/db/drafts.ts";

const testDbDir = join(tmpdir(), "maleo-db-db-tests");
const testDbPath = join(testDbDir, "maleo.db");

async function resetDbFile(): Promise<void> {
	await closeMaleoDb();
	rmSync(testDbPath, { force: true });
	rmSync(`${testDbPath}-shm`, { force: true });
	rmSync(`${testDbPath}-wal`, { force: true });
}

// Insert a draft directly (drafts is the content record of record).
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

describe("maleo-db", () => {
	beforeEach(async () => {
		process.env.MALEO_DB_PATH = testDbPath;
		mkdirSync(dirname(testDbPath), { recursive: true });
		await resetDbFile();
	});

	afterEach(async () => {
		await resetDbFile();
		delete process.env.MALEO_DB_PATH;
		if (existsSync(testDbDir)) {
			rmSync(testDbDir, { recursive: true, force: true });
		}
	});

	test("resolves an explicit db path", () => {
		expect(resolveLegacySqlitePath()).toBe(testDbPath);
	});

	test("campaign counts reflect linked drafts and open drafts", async () => {
		const campaign = await createCampaign({
			name: "Shared DB campaign",
			goal: "Keep operations metadata in db",
			status: "active",
			workspaces: ["veronika"],
		});

		await insertDraft("veronika", { status: "waiting_approval", campaign_id: campaign.id });
		await insertDraft("veronika", { status: "ready_to_publish", campaign_id: campaign.id });
		await insertDraft("veronika", { status: "published", campaign_id: campaign.id });
		// Unscoped draft must not count toward the campaign.
		await insertDraft("sienna", { status: "waiting_approval", campaign_id: null });

		const campaigns = await listCampaigns();
		expect(campaigns).toHaveLength(1);
		expect(campaigns[0]?.draft_count).toBe(3);
		expect(campaigns[0]?.open_draft_count).toBe(2);
	});

	test("updates campaign status", async () => {
		const campaign = await createCampaign({
			name: "Unified content metadata",
			goal: "Draft remains the content record",
			status: "draft",
			workspaces: ["veronika"],
		});
		const updated = await updateCampaign(campaign.id, { status: "active" });
		expect(updated?.status).toBe("active");
	});

	test("setDraftCampaign links a draft to a campaign", async () => {
		const campaign = await createCampaign({
			name: "Link campaign",
			status: "active",
			workspaces: ["veronika"],
		});
		const draftId = await insertDraft("veronika", {
			status: "waiting_approval",
			campaign_id: null,
		});
		expect(await setDraftCampaign("veronika", draftId, campaign.id)).toBe(true);
		expect((await getCampaign(campaign.id))?.draft_count).toBe(1);
	});

	test("recordApproval keys on the draft and is retrievable via listApprovals", async () => {
		const draftId = await insertDraft("veronika", { status: "waiting_approval" });
		const approval = await recordApproval({
			workspace: "veronika",
			draft_id: draftId,
			decision: "approve",
			reason_code: "preflight_ok",
		});
		expect(approval.draft_id).toBe(draftId);
		expect(approval.decision).toBe("approve");

		const history = await listApprovals("veronika", draftId);
		expect(history).toHaveLength(1);
		expect(history[0]?.decision).toBe("approve");
		expect(history[0]?.reason_code).toBe("preflight_ok");
	});
});
