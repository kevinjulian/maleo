/* The Inngest client — one instance shared by producers (send events) and the
 * serve handler (register functions). Runtime-agnostic: the SDK talks to the
 * Inngest server over HTTP, so this works identically under Bun in dev and prod.
 *
 * Env:
 *   INNGEST_BASE_URL   dev  -> http://127.0.0.1:8288  (inngest-cli dev)
 *                      prod -> http://inngest-server:8288 (Coolify internal DNS)
 *   INNGEST_EVENT_KEY  prod only (dev binary needs none)
 *   INNGEST_SIGNING_KEY prod only */
import { Inngest } from "inngest";

// Prod safety: a self-hosted deploy MUST point at its Inngest server explicitly —
// an unset base URL would fall back to the SDK cloud default and silently send
// events nowhere. Fail fast at boot instead of losing every run in production.
if (process.env.NODE_ENV === "production" && !process.env.INNGEST_BASE_URL?.trim()) {
	throw new Error(
		"INNGEST_BASE_URL is required in production (self-hosted Inngest server URL) — refusing to start with the cloud default.",
	);
}

export const inngest = new Inngest({
	// The Inngest app id. The API (the agent's durable functions) and the media
	// worker (generation-run) each serve this shared client, so they MUST register
	// as DISTINCT apps — the dev/cloud server dedups apps by id, and a shared id
	// makes the second sync clobber the first (the agent's functions then have no
	// handler → runs never trigger). The media worker sets INNGEST_APP_ID=maleo-media; the
	// dashboard keeps the default. Events route by name across apps regardless.
	id: process.env.INNGEST_APP_ID?.trim() || "maleo",
	// In dev the CLI injects the base URL; in prod set it explicitly to the
	// Coolify-internal inngest-server. Left undefined = SDK default (cloud), which
	// we never want for a self-hosted setup, so require it in prod via env.
	baseUrl: process.env.INNGEST_BASE_URL,
	eventKey: process.env.INNGEST_EVENT_KEY,
	isDev: process.env.NODE_ENV !== "production",
});
