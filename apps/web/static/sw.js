/* Service worker: installability only.
 *
 * This file is NOT part of the client bundle. Bun's HTML bundler emits one
 * module graph rooted at src/app/index.html, and a worker is a second graph
 * with a different global scope, so it ships as flat dependency-free
 * JavaScript with its own route in src/app/serve.ts.
 *
 * It exists because a browser will not offer to install a site without a
 * registered worker that has a `fetch` handler. That is the entire job.
 *
 * ── Why there is no caching here ──
 *
 * A worker that caches api responses can serve authenticated data after the
 * session behind it expired, and can serve a storyboard that is no longer the
 * one on the server. Worse, a worker persists on a device across deploys: it
 * keeps running the logic it was installed with until a new script replaces
 * it. Shipping cache logic to every operator's phone is a decision with its
 * own failure modes and its own change; unlocking the install prompt is not.
 *
 * So `fetch` passes straight through. This worker is deliberately close to
 * inert. If you are here to add offline support, that is a spec change first —
 * see openspec/specs/web-pwa-shell.
 */

/* Bump to force browsers to treat this as a new script.
 *
 * Byte-for-byte comparison is what triggers an update, so a worker that never
 * changes can never be replaced — and there is no other lever once it is on a
 * device. Keeping a version here means a future change has one. */
const VERSION = "2";

self.addEventListener("install", () => {
	/* Nothing to precache. Activate immediately rather than waiting for every
	 * tab holding the old worker to close. */
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	/* Take over already-open pages, so a newly installed worker governs the
	 * session that installed it instead of the one after it. */
	event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
	/* Registered, and intentionally empty. Not calling respondWith() lets the
	 * request proceed to the network untouched — which is both the required
	 * handler and the behaviour we want. */
});

/* Referenced so the constant is not dropped as dead code by any future
 * minifier, and so `VERSION` is greppable from a running worker. */
self.__MALEO_SW_VERSION = VERSION;
