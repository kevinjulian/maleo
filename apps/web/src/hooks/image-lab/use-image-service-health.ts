/* The generation service's health, polled while the screen is open.
 *
 * A failed probe reports "not configured" rather than leaving the last good
 * status on screen: a stale green dot is worse than an honest red one.
 */
import { useEffect, useState } from "react";
import { fetchImageGenHealth } from "@api/image-gen.ts";
import type { Health } from "@models/image-lab/image-job.ts";

const HEALTH_POLL_MS = 10_000;

export function useImageServiceHealth(): Health | null {
	const [health, setHealth] = useState<Health | null>(null);

	useEffect(() => {
		let alive = true;
		const tick = async () => {
			try {
				const h = await fetchImageGenHealth<Health>();
				if (alive) setHealth(h);
			} catch {
				if (alive) setHealth({ configured: false, ok: false });
			}
		};
		void tick();
		const id = setInterval(() => void tick(), HEALTH_POLL_MS);
		return () => {
			alive = false;
			clearInterval(id);
		};
	}, []);

	return health;
}
