/* The identity layer.
 *
 * better-auth owns its tables (the four core ones and the rate-limit counts) and migrates them itself; everything
 * else about who may do what lives in our schema. See AUTH_OWNED_TABLES in
 * @maleo/db/unified-schema for why that boundary exists and how far it goes.
 *
 * Three things here are deliberate and easy to undo by accident:
 *
 *   - the tables are PREFIXED. Unprefixed, this library wants `user`, `session`,
 *     `account` and `verification` in a database that already holds forty
 *     tables. Renaming them later is a migration, so it is done on day one.
 *   - passwords are argon2id via Bun.password, not the library's default scrypt.
 *   - `Secure` on the session cookie follows the transport. A browser does not
 *     store a Secure cookie delivered over http://127.0.0.1, so hardcoding it
 *     would break every local sign-in rather than harden anything.
 */
import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { PASSWORD_MIN_LENGTH } from "@maleo/shared";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { openDb, runtimeGeneration, runtimeSql } from "@maleo/db/connection";
import { AUTH_OWNED_TABLES } from "@maleo/db/schema";
import type { Sql } from "@maleo/db/pg";
import { listWorkspaces } from "@maleo/db/workspaces";
import { addWorkspaceMember } from "@maleo/db/workspace-members";
import { invitationAuthorisation } from "./invitation-context.ts";
import { selfRegistrationEnabled } from "./registration-policy.ts";

/* Two roles wear the name "owner" and they are not the same thing.
 *
 * INSTANCE_OWNER lives on the user row and governs registration policy for the
 * deployment. The workspace owner lives on workspace_members and governs one
 * tenant. An account may hold either, both, or neither. */
export const INSTANCE_OWNER = "instance_owner";
export const MEMBER = "member";

/** Table names, kept in step with the schema-ownership exemption by assertion. */
const MODEL_NAMES = {
	user: "auth_user",
	session: "auth_session",
	account: "auth_account",
	verification: "auth_verification",
	rateLimit: "auth_rate_limit",
	apiKey: "auth_apikey",
} as const;

/* The exemption and these names are the same fact stated in two packages, and
 * @maleo/db must not depend on better-auth to state it. So the drift is caught
 * here, at import, rather than by a table quietly appearing outside the
 * exemption where only the ownership test would notice. */
{
	const declared = [...AUTH_OWNED_TABLES].sort();
	const configured = Object.values(MODEL_NAMES).sort();
	if (declared.join() !== configured.join()) {
		throw new Error(
			`auth table names disagree with the schema-ownership exemption: ` +
				`config has [${configured.join(", ")}], AUTH_OWNED_TABLES has [${declared.join(", ")}]`,
		);
	}
}

/** Accounts on this deployment: the count decides whether a sign-up is the
 *  bootstrap or a refusal.
 *
 *  The table name is interpolated from MODEL_NAMES, which the block above pins
 *  to the schema-ownership exemption — so this cannot drift to a table that
 *  does not exist. */
async function accountCount(): Promise<number> {
	return (
		(await openDb().get<{ c: number }>(`SELECT count(*) AS c FROM ${MODEL_NAMES.user}`))?.c ?? 0
	);
}

/* The runtime pool, shaped as the `pg.Pool` better-auth recognises: it hands it
 * to Kysely's PostgresDialect. Each connection is resolved from the runtime at
 * `connect()`, so the library follows the runtime rather than capturing one
 * pool — a test that resets the database, or a reconnect, is seen at once. */
function postgresPool(sql: () => Promise<Sql>) {
	return {
		async connect() {
			const reserved = await (await sql()).reserve();
			return {
				async query(text: string, params: unknown[] = []) {
					// SAFETY: Kysely binds only values its PostgresDialect already hands to
					// `pg`, which postgres.js accepts as plain parameters.
					const rows = await reserved.unsafe(text, params as never[]);
					return { rows: [...rows], rowCount: rows.count, command: rows.command };
				},
				release() {
					reserved.release();
				},
			};
		},
		async end() {},
	};
}
const runtimePool = postgresPool(runtimeSql);

const isProduction = (): boolean => process.env.NODE_ENV === "production";

/** Self-registration is closed unless an operator opens it. The first account
 *  is the exception, and it is handled at the sign-up seam rather than here —
 *  `disableSignUp` is static, and a static refusal would refuse the first
 *  account too, leaving a deployment with no way to create one. */
export { selfRegistrationEnabled } from "./registration-policy.ts";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/* Origins allowed to carry a session, read from the same allowlist CORS uses.
 *
 * One list, not two. better-auth checks the request origin against this to
 * refuse cross-site requests, and `cors()` in index.ts decides who may read the
 * response — a deployment that configured one and forgot the other would be
 * half-open or inexplicably broken, depending which half. */
const trustedOrigins = (): string[] => {
	const declared = [
		...(process.env.MALEO_API_CORS_ORIGINS ?? "").split(","),
		// The public origin, which under the default reverse-proxy deployment is
		// the WEB origin rather than this one: the browser's Origin header names
		// the proxy it talked to, not the API behind it.
		process.env.MALEO_API_PUBLIC_URL ?? "",
	]
		.map((s) => s.trim())
		.filter(Boolean);

	/* Development trusts loopback, production trusts nothing it was not told.
	 *
	 * `bun run dev` serves the web client on :3030 and the API on :8090, and the
	 * proxy means the browser's origin is the former. Requiring configuration for
	 * that would make every fresh clone fail its first sign-in with "Invalid
	 * origin" — and the fix an operator reaches for under that pressure is to
	 * disable the origin check outright, which is worse than the default being
	 * loose on a loopback interface. */
	if (isProduction()) return declared;
	// Any port: the web client, the API and the visual suite each pick their own,
	// and pinning them here would break the moment one is overridden.
	return [...declared, "http://localhost:*", "http://127.0.0.1:*"];
};

/* Per key. The library's default — 10 requests a day — would refuse an MCP client
 * within its first session: connecting alone is several requests, and an agent
 * then reads and polls continuously. A minute window sized for that still bounds
 * what a leaked key can do. */
const API_KEY_RATE_LIMIT = { enabled: true, timeWindow: 60_000, maxRequests: 300 };

const build = (database = runtimePool) =>
	betterAuth({
		database,
		// Without this the origin is inferred per request, which makes the origin
		// check circular: an attacker's request supplies the value it is checked
		// against. Unset in development, where everything is one loopback origin.
		...(process.env.MALEO_API_PUBLIC_URL ? { baseURL: process.env.MALEO_API_PUBLIC_URL } : {}),
		trustedOrigins: trustedOrigins(),
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path !== "/sign-in/email") return;
				const email =
					typeof ctx.body?.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
				if (!email) return;
				const row = await openDb().get<{ suspended: boolean }>(
					`SELECT suspended FROM ${MODEL_NAMES.user} WHERE lower(email) = ?`,
					[email],
				);
				if (row?.suspended)
					throw new APIError("UNAUTHORIZED", { message: "Invalid email or password" });
			}),
		},
		user: {
			modelName: MODEL_NAMES.user,
			additionalFields: {
				/* The instance role. `input: false` is the load-bearing half: without
				 * it a sign-up body could name its own role, and the first-account
				 * rule below would be decoration. */
				role: { type: "string", required: false, defaultValue: MEMBER, input: false },
				suspended: { type: "boolean", required: false, defaultValue: false, input: false },
			},
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						const first = (await accountCount()) === 0;
						/* Three ways past closed registration, and no fourth.
						 *
						 * The first account, because a deployment with no accounts and no way
						 * to make one is bricked. An operator who deliberately opened
						 * registration. And a verified invitation — the redemption route sets
						 * that only after finding a live token, and it travels with the call
						 * stack that earned it rather than as a flag another request in
						 * flight could observe. See invitation-context.ts. */
						const invited = invitationAuthorisation() !== null;
						if (!first && !invited && !(await selfRegistrationEnabled())) {
							throw new APIError("FORBIDDEN", {
								message: "registration is closed on this deployment",
							});
						}
						return { data: { ...user, role: first ? INSTANCE_OWNER : MEMBER } };
					},
					after: async (user) => {
						/* SAFETY: `role` is declared as a user additionalField above and set
						 * by the `before` hook that ran immediately prior, so it is present
						 * on this row; the library's base user type simply does not carry
						 * it. A missing value compares unequal and skips the grant, which
						 * is the safe direction. */
						if ((user as { role?: string }).role !== INSTANCE_OWNER) return;
						/* Every workspace that already exists becomes reachable by the
						 * account that just claimed the deployment. Without this, a
						 * developer who turns auth on against their existing database
						 * signs in successfully and finds all of their work gone —
						 * listing is scoped to membership, and they have none. */
						for (const ws of await listWorkspaces()) {
							await addWorkspaceMember({ workspace: ws.name, user_id: user.id, role: "owner" });
						}
					},
				},
			},
		},
		account: { modelName: MODEL_NAMES.account },
		verification: { modelName: MODEL_NAMES.verification },
		emailAndPassword: {
			enabled: true,
			minPasswordLength: PASSWORD_MIN_LENGTH,
			password: {
				// Bun.password defaults to argon2id, so there is no bcrypt or scrypt
				// dependency to add and keep current.
				hash: (password) => Bun.password.hash(password),
				verify: ({ hash, password }) => Bun.password.verify(password, hash),
			},
		},
		session: {
			modelName: MODEL_NAMES.session,
			expiresIn: SESSION_MAX_AGE_SECONDS,
			/* Off, so the Security page can list sessions. better-auth refuses
			 * `list-sessions` once a session is a day old by default, which would fail
			 * for nearly every operator. The gate otherwise covers only `unlink-account`
			 * (no social providers here) and `delete-user` (not enabled); password
			 * change still requires the current password. */
			freshAge: 0,
		},
		advanced: {
			// Follows the transport in development, always on in production.
			useSecureCookies: isProduction(),
			defaultCookieAttributes: {
				httpOnly: true,
				sameSite: "lax",
			},
		},
		// Credential stuffing is the attack this exists for. Counts live in the
		// database: in memory they are per process, and every API replica would add
		// its own allowance of guesses.
		/* User-owned API keys, the credential an MCP client sends as Bearer. A key
		 * acts as its owner: it reaches exactly the workspaces the owner is a member
		 * of, and only through `/mcp`. Hashed at rest; shown once at creation. */
		plugins: [
			apiKey({
				schema: { apikey: { modelName: MODEL_NAMES.apiKey } },
				defaultPrefix: "maleo_",
				rateLimit: API_KEY_RATE_LIMIT,
			}),
		],
		rateLimit: {
			enabled: true,
			storage: "database",
			modelName: MODEL_NAMES.rateLimit,
			window: 60,
			max: 100,
			customRules: {
				"/sign-in/email": { window: 60, max: 5 },
				"/sign-up/email": { window: 60, max: 5 },
			},
		},
	});

/* Rebuilt when the runtime database is reopened or the environment changes
 * production-ness, so options read at build time (the cookie policy among them)
 * follow the process as it is now. */
let memo: { generation: number; production: boolean; instance: ReturnType<typeof build> } | null =
	null;

export function getAuth(): ReturnType<typeof build> {
	const generation = runtimeGeneration();
	const production = isProduction();
	if (!memo || memo.generation !== generation || memo.production !== production) {
		memo = { generation, production, instance: build() };
	}
	return memo.instance;
}

export { MODEL_NAMES };

/* Create the library's own tables if they are not there yet.
 *
 * The library migrates its own tables; the migration sequence in
 * @maleo/db owns every other one and leaves these alone (AUTH_OWNED_TABLES).
 *
 * Idempotent: `getMigrations` diffs the live database against the declared
 * shape and returns nothing to run when it already matches. Maintenance may
 * supply its own pool before runtime admission. */
export async function ensureAuthTables(sql?: Sql): Promise<void> {
	const auth = sql ? build(postgresPool(async () => sql)) : getAuth();
	const { runMigrations } = await getMigrations(auth.options);
	await runMigrations();
}
