/* A cited source's display domain. Shown on research rows and section
 * evidence, so both surfaces render the same host for the same link. */
export function domainOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}
