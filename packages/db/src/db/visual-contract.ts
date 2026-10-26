import { getGlobalSetting } from "./global-settings.ts";
import type { Db } from "./handle.ts";

export const VISUAL_CONTRACT_SETTING = "visual.contract.version";

/** API and generation hosts cannot obtain writable data before explicit cleanup. */
export async function assertVisualContractReady(db: Db): Promise<void> {
	if ((await getGlobalSetting(VISUAL_CONTRACT_SETTING, db)) !== "1")
		throw new Error(
			"Visual preset migration is incomplete. Stop writers, back up Postgres, run bun run visuals:cleanup, then bun run visuals:cleanup --apply before starting this release.",
		);
}
