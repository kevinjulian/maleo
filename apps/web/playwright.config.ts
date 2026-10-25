/* Visual regression config.
 *
 * These screenshots exist because the type checker and the test suite cannot
 * see rendering. Three regressions during the layering restructure — a
 * malformed @media that discarded a thousand stylesheet lines, a <link>-order
 * split that resolved --page-pad to its mobile value on desktop, and a state
 * class inheriting a button's colours — passed both and were caught by eye.
 *
 * The suite replays authored api responses from a HAR envelope, so it runs without the
 * api, video or image services and does not change when their data does.
 */
import { defineConfig, devices, type PlaywrightTestOptions } from "@playwright/test";

const PORT = Number(process.env.MALEO_VISUAL_PORT ?? 3031);
if (PORT !== 3031) {
	throw new Error(
		`MALEO_VISUAL_PORT must be 3031: authored fixture URLs include port 3031, received ${PORT}`,
	);
}

/* The dev server bundles on demand, so the first page load pays for the whole
 * client bundle. The webServer readiness probe only fetches the HTML shell and
 * returns before the script it references is built, which left the workers to
 * race on that build: three of the nine editor rails timed out on a cold run
 * waiting 20s for `.tl2-timeline`, and the same suite passed on a warm one.
 *
 * `warmup` is a dependency project rather than a globalSetup so it is ordered
 * against the server by the runner, and it loads a real page rather than
 * probing a URL, because compiling the bundle is what needs to happen once.
 * Retries stay at 0: the flake was in the load, not in a diff, and a retry
 * would have hidden it. */
const shared = {
	baseURL: `http://127.0.0.1:${PORT}`,
	...devices["Desktop Chrome"],
	deviceScaleFactor: 1,
	colorScheme: "light",
	timezoneId: "UTC",
	locale: "en-US",
} satisfies Partial<PlaywrightTestOptions>;

export default defineConfig({
	testDir: "./visual",
	// A screenshot diff is never worth retrying: a flaky visual check gets muted
	// within a week, which is worse than not having one.
	retries: 0,
	fullyParallel: true,
	/* Leave cores and memory for the shared Bun server and browser renderers.
	 * At 75%, two current 759-case runs hit 3 and 8 boot/playback failures;
	 * every failing case passed alone (2026-10-13). Four workers on eight cores
	 * retain parallel coverage without competing for the same capacity. */
	workers: "50%",
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
	outputDir: "./visual/.output",
	snapshotPathTemplate: "{testDir}/baselines/{arg}{ext}",
	expect: {
		toHaveScreenshot: {
			/* Font rasterisation differs by a hair across machines; a real layout
			 * or colour change moves far more than this.
			 *
			 * What it does NOT catch, measured rather than guessed: 0.002 over a
			 * 393x659 phone capture allows 518 pixels, and a redesign of a studio's
			 * whole bottom bar — a gear removed, a 17-character uppercase label
			 * added, six glyph buttons added — moved 189 pixels on the Template
			 * Studio capture and 184 on Motion Studio. Both passed against their
			 * old baselines, and `--update-snapshots` declined to rewrite them.
			 *
			 * Do not tighten this. Catching 189 on that capture needs a budget near
			 * 150, which is inside the rasterisation noise the number exists to
			 * absorb, so the trade is silent misses for flaky failures — and a
			 * flaky visual check gets muted within a week, same reasoning as
			 * `retries: 0` above. A sparse control change on a light background is
			 * not a thing a pixel budget can separate from font hinting, in either
			 * direction.
			 *
			 * The counter-measure is a control inventory, not a smaller number:
			 * `visual/control-inventory.ts`, applied on the surfaces whose
			 * requirements name their controls. */
			maxDiffPixelRatio: 0.002,
			animations: "disabled",
			caret: "hide",
		},
	},
	use: shared,
	projects: [
		{ name: "warmup", testMatch: /warmup\.setup\.ts$/, use: shared },
		{
			name: "visual",
			/* `touch-targets` is ignored here for the same reason `mobile-editor` is:
			   it asserts the coarse-pointer floor, which this project's fine pointer
			   does not apply. Run here it would fail — and passing it by loosening
			   the assertion is how a floor ends up "enforced" in a comment. */
			testIgnore: [
				/warmup\.setup\.ts$/,
				/mobile-editor\.spec\.ts$/,
				/phone-chat-workspace\.spec\.ts$/,
				/vui-reduced-motion\.spec\.ts$/,
				/touch-targets\.spec\.ts$/,
				/canvas-pinch\.spec\.ts$/,
			],
			dependencies: ["warmup"],
			use: shared,
		},
		/* The phone composition needs its own project, because the thing under
		 * test is not a narrow desktop window.
		 *
		 * `hasTouch` + `isMobile` are what make Chromium report `pointer: coarse`,
		 * and half the rules in this change key off that rather than off width —
		 * the 16px input floor, the compact lane metrics, the hidden rail
		 * tooltips. A 393px viewport on a fine pointer exercises none of them, so
		 * a suite that only narrowed the window would pass while the phone stayed
		 * broken. */
		/* The render budget (openspec/changes/optimize-timeline-renders). Its own
		 * project because it is not a screenshot: it drives four interactions and
		 * reads the render tallies the components keep, so it shares the server and
		 * the HAR replay with the visual suite and nothing else. Serial, because
		 * two workers loading the editor at once measure each other's contention. */
		{
			name: "perf",
			testDir: "./perf",
			dependencies: ["warmup"],
			fullyParallel: false,
			workers: 1,
			use: shared,
		},
		/* Reduced motion, as the CSS sees it.
		 *
		 * The `matchMedia` stub the suites install in `beforeEach` is JavaScript
		 * only and never reaches a CSS `prefers-reduced-motion` query, so the
		 * package's own reduced-motion rules were unexercised. Playwright's
		 * `reducedMotion` emulation sets the real media feature, so this project
		 * runs the VUI overlay, sheet and timeline flows with transitions
		 * genuinely disabled and asserts the behavior is unchanged. */
		{
			name: "reduced-motion",
			testMatch: /vui-reduced-motion\.spec\.ts$/,
			dependencies: ["warmup"],
			use: { ...shared, contextOptions: { reducedMotion: "reduce" } },
		},
		{
			name: "mobile",
			/* The clarification card runs here too. It is a form inside the chat
			   panel, and the phone composition is where a radio group, a text input
			   and two actions actually compete for width — a narrow desktop window
			   would not exercise the coarse-pointer rules that decide whether it is
			   usable.

			   So does `touch-targets`, and it can only run here: the hit-target
			   floor keys off `pointer: coarse`, which `hasTouch` + `isMobile`
			   produce and a narrowed desktop window does not. A floor asserted in
			   the visual project would pass by measuring a control the rule never
			   applied to. */
			testMatch:
				/(mobile-editor|phone-chat-workspace|story-clarification|post-research-clarification|touch-targets|canvas-pinch)\.spec\.ts$/,
			dependencies: ["warmup"],
			use: {
				...shared,
				...devices["iPhone 15"],
				/* Chromium, not the WebKit the device descriptor selects: the rest
				 * of this suite is Chromium and the browser is not what is under
				 * test here. */
				defaultBrowserType: "chromium",
				deviceScaleFactor: 1,
			},
		},
	],
	/* The suite builds what it runs: the editor executes through the Rust
	 * engine's WASM, which is a git-ignored build output, so a stale one on the
	 * machine would answer for source no longer in the tree. Built in
	 * `webServer.command` rather than as a project beside `warmup` because it
	 * has to exist before the first page loads, and `webServer` runs once for
	 * the whole run. Cargo makes a repeat build cheap. */
	webServer: {
		/* `MALEO_API_URL` points at the discard port, so a request no fixture
		 * route answers is refused instead of reaching a developer's running API
		 * on :8090 — which would write fixture data into a real workspace and
		 * make a screenshot depend on what that API happens to hold. */
		command: `bun ../../scripts/editor-engine.mts build && MALEO_API_URLS= MALEO_API_URL=http://127.0.0.1:9 MALEO_WEB_HMR=0 MALEO_WEB_PORT=${PORT} bun src/app/serve.ts`,
		url: `http://127.0.0.1:${PORT}`,
		/* Never reuse. This port is the suite's alone, so anything already on it
		 * is a leftover from a killed run serving a bundle built from older
		 * source; reusing one compared stale pixels and reported them as current.
		 * A leftover now fails the start with "port in use" instead. */
		reuseExistingServer: false,
		timeout: 60_000,
	},
});
