import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const referenceStyle = z
	.object({
		reference_urls: z.array(z.string()).optional(),
		intent: z
			.object({
				references: z.array(z.object({ url: z.string().optional() }).passthrough()).optional(),
			})
			.passthrough()
			.optional(),
		voice_ref_url: z.string().optional(),
	})
	.passthrough();

function mediaId(raw: string): string | null {
	try {
		const pathname = new URL(raw, "http://local.invalid").pathname;
		return /^\/api\/media\/([0-9a-f-]{36})$/.exec(pathname)?.[1] ?? null;
	} catch {
		return null;
	}
}

/** Fetch only managed IDs from the API's authenticated internal route. Other
 * references keep the existing provider validator; arbitrary hosts are never
 * fetched here. Files live only for this provider call. */
export async function materializeManagedReferences(
	styleJson: string | undefined,
	workspace: string,
	fetchImpl: (input: URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ styleJson: string | undefined; cleanup: () => Promise<void> }> {
	const none = { styleJson, cleanup: async () => {} };
	if (!styleJson) return none;
	let style: z.infer<typeof referenceStyle>;
	try {
		style = referenceStyle.parse(JSON.parse(styleJson));
	} catch {
		return none;
	}
	const intent = style.intent;
	const raw = [
		...(style.reference_urls ?? []),
		...(intent?.references?.map((ref) => ref.url) ?? []),
		style.voice_ref_url,
	].filter((value): value is string => typeof value === "string");
	const ids = new Map(
		raw
			.map((value) => [value, mediaId(value)])
			.filter((pair): pair is [string, string] => pair[1] != null),
	);
	if (ids.size === 0) return none;
	const base = process.env.MALEO_API_URL?.trim();
	const token = process.env.MALEO_SERVICE_TOKEN?.trim();
	if (!base || !token)
		throw new Error(
			"managed references require MALEO_API_URL and MALEO_SERVICE_TOKEN on the worker",
		);
	const dir = await mkdtemp(join(tmpdir(), "maleo-media-ref-"));
	try {
		const paths = new Map<string, string>();
		for (const id of ids.values()) {
			if (!paths.has(id)) {
				const endpoint = new URL(`/internal/media/${id}`, base);
				endpoint.searchParams.set("workspace", workspace);
				const response = await fetchImpl(endpoint, {
					headers: { authorization: `Bearer ${token}` },
				});
				if (!response.ok)
					throw new Error(`managed reference ${id} unavailable (${response.status})`);
				const type = response.headers.get("content-type") ?? "application/octet-stream";
				const ext =
					type === "image/jpeg"
						? "jpg"
						: type === "audio/mpeg"
							? "mp3"
							: type.split("/")[1]?.split(";")[0] || "bin";
				const path = join(dir, `${id}.${ext}`);
				await Bun.write(path, response);
				paths.set(id, path);
			}
		}
		const local = (value: string | undefined): string | undefined =>
			value && ids.has(value) ? paths.get(ids.get(value)!) : value;
		if (style.reference_urls)
			style.reference_urls = style.reference_urls.map((value) => local(value) ?? value);
		if (intent?.references)
			intent.references = intent.references.map((ref) => ({ ...ref, url: local(ref.url) }));
		style.voice_ref_url = local(style.voice_ref_url);
		return {
			styleJson: JSON.stringify(style),
			cleanup: () => rm(dir, { recursive: true, force: true }),
		};
	} catch (error) {
		await rm(dir, { recursive: true, force: true });
		throw error;
	}
}
