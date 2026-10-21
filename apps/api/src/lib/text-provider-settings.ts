/* Persistence for the AI text provider choice.
 *
 * Stored as one row in `global_settings` under `ai.text.provider`, shaped as a
 * map from day one:
 *
 *   { "default": { "providerId": "api", "model": "gpt-5.5", "thinking": "medium" } }
 *
 * The requirement is scalar — one AI for everything — but per-task routing is
 * the obvious next step, and `{ "default": … }` is exactly a per-task map with
 * one entry. Shipping the scalar flat would force a settings migration later;
 * this costs one JSON level now and zero migration then.
 *
 * One row rather than three (`ai.text.provider`, `.model`, `.thinking`) because
 * a model and a thinking level are only meaningful relative to a provider, and
 * separate rows make a torn write possible: provider updated, model still
 * pointing at the previous provider's catalog. */
import type { ProviderChoice, ProviderSelection } from "./ai-provider/index.ts";
import {
	getGlobalSetting,
	setGlobalSetting,
	TEXT_PROVIDER_SETTING,
} from "@maleo/db/global-settings";

export async function readTextProviderSelection(): Promise<ProviderSelection> {
	const raw = await getGlobalSetting(TEXT_PROVIDER_SETTING);
	if (!raw) return {};
	try {
		// SAFETY: the row is written only by `writeTextProviderSelection` below, as
		// `{ default: ProviderChoice }`; a row from a bad write fails the check under it.
		const parsed = JSON.parse(raw) as ProviderSelection;
		// A row that survived a bad write must not take the generation path down
		// with it — an unreadable selection is treated as unconfigured, which
		// falls through to the env default and then the first ready provider.
		if (!parsed?.default?.providerId) return {};
		return { default: parsed.default };
	} catch {
		return {};
	}
}

export async function writeTextProviderSelection(choice: ProviderChoice | null): Promise<void> {
	if (!choice) {
		await setGlobalSetting(TEXT_PROVIDER_SETTING, null);
		return;
	}
	await setGlobalSetting(TEXT_PROVIDER_SETTING, JSON.stringify({ default: choice }));
}
