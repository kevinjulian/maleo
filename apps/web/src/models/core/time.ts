// Relative time formatting shared by the content and video screens.
export function timeAgo(ts: number | null | undefined): string {
	if (!ts) return "—";
	const ms = Date.now() - ts;
	if (ms < 0) return new Date(ts).toLocaleTimeString();
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 30) return `${d}d ago`;
	return new Date(ts).toLocaleDateString();
}
