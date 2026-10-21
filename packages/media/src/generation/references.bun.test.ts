import { afterEach, expect, test } from "bun:test";
import { materializeManagedReferences } from "./references.ts";

const oldUrl = process.env.MALEO_API_URL;
const oldToken = process.env.MALEO_SERVICE_TOKEN;
afterEach(() => {
	if (oldUrl === undefined) delete process.env.MALEO_API_URL;
	else process.env.MALEO_API_URL = oldUrl;
	if (oldToken === undefined) delete process.env.MALEO_SERVICE_TOKEN;
	else process.env.MALEO_SERVICE_TOKEN = oldToken;
});

test("managed reference uses internal service, keeps arbitrary URL unfetched, and cleans temp bytes", async () => {
	process.env.MALEO_API_URL = "http://api.internal:8090";
	process.env.MALEO_SERVICE_TOKEN = "test-token";
	const id = "00000000-0000-4000-8000-000000000001";
	const managed = `https://browser.example/api/media/${id}`;
	const style = JSON.stringify({
		reference_urls: [managed, "https://remote.invalid/arbitrary.png"],
		voice_ref_url: managed,
	});
	let calls = 0;
	const refs = await materializeManagedReferences(style, "owner", async (input, init) => {
		calls++;
		expect(String(input)).toBe(`http://api.internal:8090/internal/media/${id}?workspace=owner`);
		expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
		return new Response("reference bytes", { headers: { "content-type": "image/png" } });
	});
	const result = JSON.parse(refs.styleJson!) as { reference_urls: string[]; voice_ref_url: string };
	expect(calls).toBe(1);
	expect(result.reference_urls[1]).toBe("https://remote.invalid/arbitrary.png");
	expect(result.reference_urls[0]).toBe(result.voice_ref_url);
	expect(await Bun.file(result.voice_ref_url).text()).toBe("reference bytes");
	await refs.cleanup();
	expect(await Bun.file(result.voice_ref_url).exists()).toBe(false);
});
