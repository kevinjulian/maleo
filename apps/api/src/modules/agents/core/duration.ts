/* Duration intent helpers for chat requests.
 *
 * These do not classify intent by themselves; they only recover an explicit
 * duration contract ("2 menit", "120 seconds") so routing and planning can honor
 * a user-stated length even when the client did not send target_duration_sec. */

const NUMBER_WORDS: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	satu: 1,
	dua: 2,
	tiga: 3,
	empat: 4,
	lima: 5,
	enam: 6,
	tujuh: 7,
	delapan: 8,
	sembilan: 9,
	sepuluh: 10,
};

function amount(raw: string): number {
	const normalized = raw.trim().toLowerCase().replace(",", ".");
	return Number(normalized) || NUMBER_WORDS[normalized] || 0;
}

export function extractRequestedDurationSec(text: string): number | undefined {
	const minute = text.match(
		/\b(\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\s*(?:menit|minute|minutes|min|mins|m)\b/i,
	);
	if (minute) {
		const sec = Math.round(amount(minute[1]!) * 60);
		if (sec > 0) return sec;
	}
	const second = text.match(
		/\b(\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\s*(?:detik|second|seconds|sec|secs|s)\b/i,
	);
	if (second) {
		const sec = Math.round(amount(second[1]!));
		if (sec > 0) return sec;
	}
	return undefined;
}

export function looksLikeSpecificTimelineEdit(text: string): boolean {
	return (
		/\b(?:scene|scenes|clip|clips|beat|section|slide|post|frame|gambar|adegan|bagian)\s*(?:#?\d+|pertama|kedua|ketiga|ini|that|this)\b/i.test(
			text,
		) ||
		(/\b(?:ubah|edit|change|update|ganti|perbaiki|pendekkan|panjangkan|trim|crop)\b/i.test(text) &&
			/\b(?:scene|clip|beat|section|slide|post|frame|gambar|adegan|durasi|duration)\b/i.test(text))
	);
}
