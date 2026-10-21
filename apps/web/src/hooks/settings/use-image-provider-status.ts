import { useCallback, useEffect, useState } from "react";
import { fetchImageProviderStatus, saveImageProvider } from "@api/image-provider.ts";
import type { ImageProviderStatus } from "@models/settings/image-provider.ts";

export interface ImageProviderStatusModel {
	status: ImageProviderStatus | null;
	busy: boolean;
	error: string | null;
	load: () => Promise<void>;
	update: (providerId: string) => Promise<void>;
}

export function useImageProviderStatus(): ImageProviderStatusModel {
	const [status, setStatus] = useState<ImageProviderStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async (): Promise<void> => {
		try {
			setStatus(await fetchImageProviderStatus());
			setError(null);
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : String(loadError));
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const update = useCallback(
		async (providerId: string): Promise<void> => {
			setBusy(true);
			setError(null);
			try {
				setStatus(await saveImageProvider(providerId));
			} catch (saveError) {
				setError(saveError instanceof Error ? saveError.message : String(saveError));
				await load();
			} finally {
				setBusy(false);
			}
		},
		[load],
	);

	return { status, busy, error, load, update };
}
