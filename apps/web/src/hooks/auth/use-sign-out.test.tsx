// @vitest-environment happy-dom
import { expect, test, vi } from "vite-plus/test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createPreviewMediaSession } from "@services/preview-media/session.ts";
import { useSignOut, type SignOutState } from "./use-sign-out.ts";
vi.mock("@api/auth.ts", () => ({ signOut: vi.fn(async () => {}) }));
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

test("sign-out waits for preview worker disposal before navigation", async () => {
	const workers: FakeWorker[] = [];
	class FakeWorker {
		onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
		onerror = null;
		sent: unknown[] = [];
		constructor() {
			workers.push(this);
		}
		postMessage(message: unknown) {
			this.sent.push(message);
		}
		terminate() {}
	}
	vi.stubGlobal("Worker", FakeWorker);
	const session = createPreviewMediaSession({
		resolve: async (source) => ({ url: source.url, credentials: "omit" }),
		changed: () => {},
	});
	const navigate = vi.fn();
	let state: SignOutState | undefined;
	function Harness() {
		state = useSignOut(navigate);
		return null;
	}
	const root = createRoot(document.createElement("div"));
	try {
		await act(async () => root.render(createElement(Harness)));
		let done: Promise<void> | undefined;
		await act(async () => {
			done = state!.leave();
			await Promise.resolve();
		});
		expect(workers[0]!.sent).toContainEqual({ type: "dispose" });
		expect(navigate).not.toHaveBeenCalled();
		await act(async () => {
			workers[0]!.onmessage?.(new MessageEvent("message", { data: { type: "disposed" } }));
			await done;
		});
		expect(navigate).toHaveBeenCalledOnce();
	} finally {
		await act(async () => root.unmount());
		await session.dispose();
		vi.unstubAllGlobals();
	}
});
