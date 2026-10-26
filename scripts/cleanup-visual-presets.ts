/** Retired visual cleanup. Dry run uses a read-only transaction and skips bootstrap. */
import { databaseConfig } from "../packages/db/src/db/database-config.ts";
import { runtimeDatabaseUrl } from "../packages/db/src/db/connection.ts";
import { createSql } from "../packages/db/src/db/pg.ts";
import { pgDb } from "../packages/db/src/db/handle.ts";
import { loadMigrations, migrate } from "../packages/db/src/db/migrate.ts";
import { cleanContentVisuals } from "../packages/db/src/db/visual-cleanup.ts";

if (import.meta.main) {
	const args = process.argv.slice(2);
	if (args.some((arg) => arg !== "--apply"))
		throw new Error("Usage: bun run visuals:cleanup [--apply]");
	const apply = args.includes("--apply");
	const config = databaseConfig();
	const sql = createSql(await runtimeDatabaseUrl(), {
		max: 1,
		ssl: config.kind === "url" ? config.ssl : false,
	});
	try {
		if (apply) await migrate(sql, loadMigrations());
		const db = pgDb(sql);
		const report = apply
			? await cleanContentVisuals(true, db)
			: await db.transaction(async (tx) => {
					await tx.exec("SET TRANSACTION READ ONLY");
					return cleanContentVisuals(false, tx);
				});
		console.log(JSON.stringify({ apply, ...report }));
	} finally {
		await sql.end();
	}
	// The embedded Postgres child keeps this maintenance process alive after its pool closes.
	process.exit(0);
}
