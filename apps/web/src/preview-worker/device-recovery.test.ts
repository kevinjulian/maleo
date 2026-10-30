import { afterEach, expect, test, vi } from "vite-plus/test";
import { createDeviceRecovery } from "./device-recovery.ts";

afterEach(() => vi.useRealTimers());

function setup(retry: () => Promise<boolean>) {
	vi.useFakeTimers();
	const failed = vi.fn(),
		changed = vi.fn();
	const recovery = createDeviceRecovery({
		retry,
		failed,
		changed,
		after: (ms, run) => {
			const id = setTimeout(run, ms);
			return () => clearTimeout(id);
		},
	});
	return { recovery, failed, changed };
}

test("device recovery starts once, retries timeout, and ignores late completion", async () => {
	let late!: (accepted: boolean) => void;
	const retry = vi
		.fn()
		.mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					late = resolve;
				}),
		)
		.mockResolvedValueOnce(true);
	const { recovery, failed, changed } = setup(retry);
	recovery.start();
	recovery.start();
	expect(retry).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(1500);
	expect(retry).toHaveBeenCalledTimes(2);
	expect(changed).toHaveBeenCalledOnce();
	late(true);
	await Promise.resolve();
	expect(changed).toHaveBeenCalledOnce();
	expect(failed).not.toHaveBeenCalled();
	recovery.dispose();
});

test("two failed or timed out attempts become one terminal failure", async () => {
	const retry = vi
		.fn()
		.mockRejectedValueOnce(new Error("no adapter"))
		.mockImplementationOnce(() => new Promise<boolean>(() => {}));
	const { recovery, failed, changed } = setup(retry);
	recovery.start();
	await vi.advanceTimersByTimeAsync(3000);
	expect(retry).toHaveBeenCalledTimes(2);
	expect(failed).toHaveBeenCalledWith("WebGPU recovery failed after two attempts");
	expect(changed).not.toHaveBeenCalled();
	recovery.dispose();
});

test("disposal cancels pending retries and late callbacks", async () => {
	let late!: (accepted: boolean) => void;
	const retry = vi.fn(
		() =>
			new Promise<boolean>((resolve) => {
				late = resolve;
			}),
	);
	const { recovery, failed, changed } = setup(retry);
	recovery.start();
	recovery.dispose();
	late(true);
	await vi.advanceTimersByTimeAsync(5000);
	expect(retry).toHaveBeenCalledOnce();
	expect(failed).not.toHaveBeenCalled();
	expect(changed).not.toHaveBeenCalled();
});
