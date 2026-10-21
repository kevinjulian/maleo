import { resolve } from "node:path";

export function resolveDataDir(): string {
	const explicit = process.env.MALEO_DATA_DIR?.trim();
	return explicit ? resolve(explicit) : resolve(import.meta.dir, "../../..", "data");
}
