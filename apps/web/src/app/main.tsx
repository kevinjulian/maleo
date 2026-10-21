import React from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "./auth-gate.tsx";
import { initTheme } from "@models/core/theme.ts";

initTheme();

const root = createRoot(document.getElementById("root")!);
root.render(<AuthGate />);

/* Register the service worker that makes the client installable.
 *
 * After render, and failure-tolerant on purpose. Registration is not on the
 * path to a working app — it unlocks the install prompt and nothing else — so
 * an unsupported browser, a private window, or an insecure origin must cost a
 * console warning rather than a blank screen. Awaiting it before render, or
 * letting it reject unhandled, would trade a real feature for a cosmetic one.
 *
 * The `in navigator` check is what covers the http:// dev origin: the property
 * is absent outside a secure context, and `127.0.0.1` counts as secure while a
 * LAN IP does not — so reaching the dev server from a phone lands here. */
if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
			console.warn(
				"service worker registration failed; the app still runs, but it is not installable",
				err,
			);
		});
	});
}
