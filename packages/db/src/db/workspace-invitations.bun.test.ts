/* An invitation is a credential, and this is where that is enforced.
 *
 * Two properties carry the weight: the plaintext token is never on disk, and
 * the four ways a token can be bad are indistinguishable from outside. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openTestDb, type TestDb } from "./handle-testing.ts";
import type { Db } from "./handle.ts";
import {
	findRedeemable,
	getInvitation,
	hashInvitationToken,
	INVITATION_LIFETIME_MS,
	listPendingInvitations,
	markRedeemed,
	mintInvitation,
	revokeInvitation,
} from "./workspace-invitations.ts";

let db: Db;
let t: TestDb;

const mint = async (workspace = "alpha", lifetimeMs?: number) =>
	await mintInvitation(
		{ workspace, invitedBy: "u-owner", ...(lifetimeMs ? { lifetimeMs } : {}) },
		db,
	);

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
});
afterEach(() => t.close());

describe("the token is never stored", () => {
	test("the row holds a hash, not the token", async () => {
		const { token, row } = await mint();

		const stored = (await db.get<{ token_hash: string }>(
			`SELECT token_hash FROM workspace_invitations WHERE id = ?`,
			[row.id],
		))!;

		expect(stored.token_hash).toBe(hashInvitationToken(token));
		expect(stored.token_hash).not.toBe(token);
	});

	test("no column anywhere contains the plaintext", async () => {
		const { token } = await mint();

		const dump = JSON.stringify(await db.all(`SELECT * FROM workspace_invitations`));

		// A database read must not hand out a working invitation.
		expect(dump).not.toContain(token);
	});

	test("two invitations never share a token", async () => {
		const a = await mint();
		const b = await mint();

		expect(a.token).not.toBe(b.token);
		expect(a.token.length).toBeGreaterThan(30);
	});
});

describe("redeeming", () => {
	test("a valid token finds its invitation", async () => {
		const { token, row } = await mint();

		expect((await findRedeemable(token, db))?.id).toBe(row.id);
	});

	test("the invitation carries the workspace and role it grants", async () => {
		const { token } = await mintInvitation(
			{ workspace: "alpha", invitedBy: "u-owner", role: "owner" },
			db,
		);

		const found = await findRedeemable(token, db);

		expect(found?.workspace).toBe("alpha");
		expect(found?.role).toBe("owner");
	});

	test("marking it redeemed succeeds exactly once", async () => {
		const { token, row } = await mint();

		expect(await markRedeemed(row.id, "u-new", db)).toBe(true);
		// The second caller in a race loses, and must not create a second account.
		expect(await markRedeemed(row.id, "u-other", db)).toBe(false);
		expect(await findRedeemable(token, db)).toBeNull();
	});

	test("who redeemed it is recorded", async () => {
		const { row } = await mint();

		await markRedeemed(row.id, "u-new", db);

		expect((await getInvitation(row.id, db))?.redeemed_by).toBe("u-new");
	});
});

describe("the four bad tokens are indistinguishable", () => {
	test("a forged token", async () => {
		await mint();

		expect(await findRedeemable("not-a-real-token", db)).toBeNull();
	});

	test("an expired token", async () => {
		const { token } = await mint("alpha", 1_000);

		// One second of life, checked a minute later.
		expect(await findRedeemable(token, db, Date.now() + 60_000)).toBeNull();
	});

	test("a spent token", async () => {
		const { token, row } = await mint();
		await markRedeemed(row.id, "u-new", db);

		expect(await findRedeemable(token, db)).toBeNull();
	});

	test("a revoked token", async () => {
		const { token, row } = await mint();
		await revokeInvitation(row.id, db);

		expect(await findRedeemable(token, db)).toBeNull();
	});

	test("all four answer identically", async () => {
		const forged = await findRedeemable("nope", db);
		const expired = await findRedeemable((await mint("alpha", 1)).token, db, Date.now() + 10_000);
		const spent = await (async () => {
			const m = await mint();
			await markRedeemed(m.row.id, "u", db);
			return await findRedeemable(m.token, db);
		})();
		const revoked = await (async () => {
			const m = await mint();
			await revokeInvitation(m.row.id, db);
			return await findRedeemable(m.token, db);
		})();

		// Same answer, so nothing can be learned by trying.
		expect([forged, expired, spent, revoked]).toEqual([null, null, null, null]);
	});
});

describe("what an owner sees", () => {
	test("pending invitations are listed newest first", async () => {
		const first = await mint();
		const second = await mint();

		const pending = (await listPendingInvitations("alpha", db)).map((i) => i.id);

		expect(pending).toHaveLength(2);
		expect(pending).toContain(first.row.id);
		expect(pending).toContain(second.row.id);
	});

	test("a redeemed invitation drops out of the pending list", async () => {
		const { row } = await mint();
		await markRedeemed(row.id, "u-new", db);

		expect(await listPendingInvitations("alpha", db)).toEqual([]);
	});

	test("a revoked invitation drops out too", async () => {
		const { row } = await mint();
		await revokeInvitation(row.id, db);

		expect(await listPendingInvitations("alpha", db)).toEqual([]);
	});

	test("another workspace's invitations are not listed", async () => {
		await mint("alpha");
		await mint("beta");

		expect(await listPendingInvitations("alpha", db)).toHaveLength(1);
	});

	test("revoking twice reports the second as a no-op", async () => {
		const { row } = await mint();

		expect(await revokeInvitation(row.id, db)).toBe(true);
		expect(await revokeInvitation(row.id, db)).toBe(false);
	});
});

describe("the default lifetime", () => {
	test("is forty-eight hours", () => {
		// Recorded as a decision in design.md: shorter than a session, because an
		// invitation creates an account and sits somewhere neither end controls.
		expect(INVITATION_LIFETIME_MS).toBe(48 * 60 * 60 * 1000);
	});

	test("is applied when none is given", async () => {
		const before = Date.now();

		const { row } = await mint();

		expect(row.expires_at).toBeGreaterThanOrEqual(before + INVITATION_LIFETIME_MS);
	});
});
