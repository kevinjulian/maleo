/* The Postgres client, configured once.
 *
 * One setting here is load-bearing: every timestamp in the schema is epoch
 * milliseconds, which does not fit `integer`, so those columns are `bigint` —
 * and the driver hands `bigint` back as a string by default. That would turn
 * every `created_at: number` in the codebase into text. The parser below
 * returns a number instead, and throws rather than rounds when a value is
 * outside the range a JavaScript number holds exactly. */
import postgres from "postgres";

export type Sql = postgres.Sql;

const INT8_OID = 20;
// SUM over bigint and AVG over anything return numeric, also a string by default.
const NUMERIC_OID = 1700;

function parseInt8(value: string): number {
	const n = Number(value);
	if (!Number.isSafeInteger(n)) {
		throw new RangeError(`bigint ${value} is outside the safe integer range`);
	}
	return n;
}

function parseNumeric(value: string): number {
	const n = Number(value);
	if (!Number.isFinite(n)) throw new RangeError(`numeric ${value} is not a finite number`);
	return n;
}

export interface SqlOptions {
	/** Pool size. */
	max?: number;
	/** TLS, as decided by database-config: off-host connections are encrypted. */
	ssl?: false | "require" | "verify-full";
}

export function createSql(url: string, options: SqlOptions = {}): Sql {
	return postgres(url, {
		max: options.max ?? 10,
		ssl: options.ssl ?? false,
		onnotice: () => {},
		types: {
			int8: {
				to: INT8_OID,
				from: [INT8_OID],
				serialize: (value: number) => String(value),
				parse: parseInt8,
			},
			numeric: {
				to: NUMERIC_OID,
				from: [NUMERIC_OID],
				serialize: (value: number) => String(value),
				parse: parseNumeric,
			},
		},
	});
}
