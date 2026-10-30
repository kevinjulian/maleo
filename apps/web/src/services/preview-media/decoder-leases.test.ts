import { expect, test } from "vite-plus/test";
import { openDecoderLeases } from "./decoder-leases.ts";

test("WASM grants two slots per codec kind across owners and releases them in queued order", async () => {
	const first = openDecoderLeases(),
		second = openDecoderLeases();
	try {
		const a = await first.request("video"),
			b = await second.request("video");
		let granted = false;
		const next = first.request("video").then((lease) => {
			granted = true;
			return lease;
		});
		const audio = await second.request("audio");
		await Promise.resolve();
		expect(granted).toBe(false);
		// A worker cannot return another owner's active slot.
		second.release(a);
		await Promise.resolve();
		expect(granted).toBe(false);
		first.release(a);
		const c = await next;
		expect(granted).toBe(true);
		expect(c).not.toBe(a);
		second.release(b);
		first.release(c);
		second.release(audio);
	} finally {
		first.close();
		second.close();
	}
});

test("worker closure cancels its pending requests and makes slots available to siblings", async () => {
	const first = openDecoderLeases(),
		second = openDecoderLeases();
	try {
		await first.request("video");
		await first.request("video");
		const cancelled = expect(first.request("video")).rejects.toThrow("closed");
		const sibling = second.request("video");
		first.close();
		await cancelled;
		const lease = await sibling;
		second.release(lease);
		await expect(first.request("audio")).rejects.toThrow("closed");
	} finally {
		first.close();
		second.close();
	}
});
