/** Public-web URL policy shared by BrowserOS MCP calls and research parsing. */

export type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_SCHEMES = new Set([
	"file:",
	"data:",
	"javascript:",
	"chrome:",
	"chrome-extension:",
	"about:",
	"blob:",
	"ws:",
	"wss:",
	"ftp:",
]);

/** Reject non-public destinations before BrowserOS receives them. */
export function classifyResearchUrl(raw: string): UrlVerdict {
	if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "empty url" };
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return { ok: false, reason: "unparseable url" };
	}
	const scheme = url.protocol.toLowerCase();
	if (scheme !== "http:" && scheme !== "https:")
		return { ok: false, reason: `blocked scheme ${scheme}` };
	if (BLOCKED_SCHEMES.has(scheme)) return { ok: false, reason: `blocked scheme ${scheme}` };
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (!host) return { ok: false, reason: "no host" };
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal")
	) {
		return { ok: false, reason: "loopback/local host" };
	}
	if (isPrivateOrReservedHost(host)) return { ok: false, reason: "private/reserved host" };
	return { ok: true, url };
}

function isPrivateOrReservedHost(host: string): boolean {
	if (host === "::1" || host === "::") return true;
	const firstHextet = Number.parseInt(host.split(":", 1)[0] || "0", 16);
	if (
		(firstHextet >= 0xfc00 && firstHextet <= 0xfdff) ||
		(firstHextet >= 0xfe80 && firstHextet <= 0xfebf)
	)
		return true;
	// IPv4-mapped IPv6 may use dotted (`::ffff:127.0.0.1`) or hexadecimal
	// (`::ffff:7f00:1`) notation. Convert the latter before IPv4 policy checks.
	const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
	if (mappedHex) {
		const high = Number.parseInt(mappedHex[1], 16);
		const low = Number.parseInt(mappedHex[2], 16);
		host = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
	}
	const v4inV6 = host.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
	const dotted = v4inV6 ? v4inV6[1] : host;
	const m = dotted.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!m) return false;
	const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
	if (octets.some((n) => n > 255)) return true;
	const [a, b] = octets;
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	if (a >= 224) return true;
	return false;
}

export function researchUrlDedupeKey(url: URL): string {
	const path = url.pathname.replace(/\/+$/, "") || "/";
	return `${url.hostname.toLowerCase()}${path.toLowerCase()}`;
}

export function researchUrlDomain(rawUrl: string): string {
	try {
		return new URL(rawUrl).hostname.replace(/^www\./, "");
	} catch {
		return rawUrl;
	}
}
