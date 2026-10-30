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
import { textSelectionSchema } from "@maleo/shared";
import { z } from "zod";
import {
	getGlobalSetting,
	setGlobalSetting,
	TEXT_PROVIDER_SETTING,
} from "@maleo/db/global-settings";

const textProviderSelectionSchema = z
	.object({
		default: textSelectionSchema.partial({ model: true }).optional(),
	})
	.strict();

export async function readTextProviderSelection(): Promise<ProviderSelection> {
	const raw = await getGlobalSetting(TEXT_PROVIDER_SETTING);
	if (!raw) return {};
	try {
		const parsed = textProviderSelectionSchema.safeParse(JSON.parse(raw));
		if (!parsed.success)
			throw new Error(
				"Saved text selection is invalid. Ask the instance owner to select an available model.",
			);
		return parsed.data;
	} catch {
		throw new Error(
			"Saved text selection is invalid. Ask the instance owner to select an available model.",
		);
	}
}

export async function writeTextProviderSelection(choice: ProviderChoice | null): Promise<void> {
	if (!choice) {
		await setGlobalSetting(TEXT_PROVIDER_SETTING, null);
		return;
	}
	await setGlobalSetting(TEXT_PROVIDER_SETTING, JSON.stringify({ default: choice }));
}
