import { AsyncLocalStorage } from "node:async_hooks";
import type { CapturedTextSelection } from "@maleo/shared";
import { refreshConfig } from "@maleo/shared/provider-config";
import { selectReadyProvider } from "./ai-provider/selection.ts";
import { textEndpointIdentity } from "./ai-provider/providers/api/discovery.ts";

const selections = new AsyncLocalStorage<CapturedTextSelection | undefined>();

export function scopedTextSelection(): CapturedTextSelection | undefined {
	return selections.getStore();
}

export async function assertCapturedTextSelection(capture?: CapturedTextSelection): Promise<void> {
	if (!capture) return;
	await refreshConfig();
	if (capture.endpointIdentity !== textEndpointIdentity()) {
		throw new Error(
			"This run's text endpoint changed. Restore the original endpoint or start a new run.",
		);
	}
	await selectReadyProvider("text", { default: capture.selection });
	if (capture.endpointIdentity !== textEndpointIdentity()) {
		throw new Error(
			"This run's text endpoint changed. Restore the original endpoint or start a new run.",
		);
	}
}

/** Restore at every independently entered execution boundary; legacy jobs keep global resolution. */
export async function withTextSelection<T>(
	capture: CapturedTextSelection | undefined,
	run: () => Promise<T>,
): Promise<T> {
	if (!capture) return selections.run(undefined, run);
	return selections.run(capture, async () => {
		await assertCapturedTextSelection(capture);
		return run();
	});
}
