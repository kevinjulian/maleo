import { describe, expect, it } from "vite-plus/test";
import { pathToView, viewToPath, SCRIPT_DENSITIES, type View } from "./routing.ts";

describe("pathToView — library routes", () => {
	it("maps /library/references to the references library", () => {
		expect(pathToView("/library/references", "")).toEqual({ kind: "library", type: "references" });
	});

	it("maps /library/voices to the voices library", () => {
		expect(pathToView("/library/voices", "")).toEqual({ kind: "library", type: "voices" });
	});

	it("maps defaulter library routes", () => {
		expect(pathToView("/library/presets", "")).toEqual({ kind: "library", type: "presets" });
		expect(pathToView("/library/templates", "")).toEqual({ kind: "library", type: "templates" });
		expect(pathToView("/library/elements", "")).toEqual({ kind: "library", type: "elements" });
	});

	it("maps a defaulter edit route", () => {
		expect(pathToView("/library/presets", "?edit=cp_1")).toEqual({
			kind: "library",
			type: "presets",
			editId: "cp_1",
		});
	});

	it("redirects retired library types (images/products/notes/sources) to references", () => {
		for (const legacy of ["images", "products", "notes", "sources"]) {
			expect(pathToView(`/library/${legacy}`, "")).toEqual({ kind: "library", type: "references" });
		}
	});

	it("redirects the old standalone /catalog and /sources routes to references", () => {
		expect(pathToView("/catalog", "")).toEqual({ kind: "library", type: "references" });
		expect(pathToView("/sources", "")).toEqual({ kind: "library", type: "references" });
	});

	it("unknown query values fall back to references", () => {
		expect(pathToView("/library/bogus", "")).toEqual({ kind: "library", type: "references" });
	});
});

describe("viewToPath", () => {
	it("round-trips every library view", () => {
		expect(viewToPath({ kind: "library", type: "references" })).toBe("/library/references");
		expect(viewToPath({ kind: "library", type: "voices" })).toBe("/library/voices");
		expect(viewToPath({ kind: "library", type: "presets" })).toBe("/library/presets");
		expect(viewToPath({ kind: "library", type: "presets", editId: "cp_1" })).toBe(
			"/library/presets?edit=cp_1",
		);
		expect(viewToPath({ kind: "library", type: "templates" })).toBe("/library/templates");
		expect(viewToPath({ kind: "library", type: "elements" })).toBe("/library/elements");
	});
});

describe("images routes", () => {
	/* The gallery and the lab are separate destinations. Before this the lab WAS
	 * the Images surface, and browsing generated images had no address at all. */
	it("maps the gallery and the lab to their own paths", () => {
		expect(pathToView("/images", "")).toEqual({ kind: "images" });
		expect(pathToView("/images/lab", "")).toEqual({ kind: "imagelab" });
	});

	it("round-trips both", () => {
		expect(viewToPath({ kind: "images" })).toBe("/images");
		expect(viewToPath({ kind: "imagelab" })).toBe("/images/lab");
	});

	it("keeps an old /imagelab bookmark working, landing on the lab", () => {
		// It used to be the whole Images surface, so a bookmark means "the lab".
		expect(pathToView("/imagelab", "")).toEqual({ kind: "imagelab" });
	});

	it("does not confuse the gallery with the retired /library/images alias", () => {
		// LEGACY_LIBRARY_TYPES still maps that onto references; the gallery is not it.
		expect(pathToView("/library/images", "")).toEqual({ kind: "library", type: "references" });
	});
});

describe("speech routes", () => {
	/* The same two-destination split as images: a gallery of every clip and a
	   synthesis session, each separately linkable. */
	it("maps the gallery and the lab to their own paths", () => {
		expect(pathToView("/speech", "")).toEqual({ kind: "speech" });
		expect(pathToView("/speech/lab", "")).toEqual({ kind: "speechlab" });
	});

	it("round-trips both", () => {
		expect(viewToPath({ kind: "speech" })).toBe("/speech");
		expect(viewToPath({ kind: "speechlab" })).toBe("/speech/lab");
	});

	/* A gallery narrowed by filter is shareable, so the query has to survive the
	   round trip into the view and back out to a path. */
	it("keeps the gallery reachable with filters in the query", () => {
		expect(pathToView("/speech", "?source=scene&q=intro")).toEqual({ kind: "speech" });
	});
});

describe("the script is its own destination", () => {
	it("a script path resolves without opening the editor first", () => {
		expect(pathToView("/content/p-1/script", "")).toEqual({
			kind: "content-script",
			id: "p-1",
			density: "write",
		});
	});

	it("the editor's own path is unchanged by the script existing", () => {
		expect(pathToView("/content/p-1", "")).toEqual({ kind: "content-edit", id: "p-1" });
	});

	it("an id with a slash-safe encoding survives the round trip", () => {
		const path = viewToPath({ kind: "content-script", id: "a b/c", density: "write" });
		expect(pathToView(path, "")).toMatchObject({ kind: "content-script", id: "a b/c" });
	});

	it("the default density leaves the path clean", () => {
		// A link to a script should not grow a query string nobody asked for.
		expect(viewToPath({ kind: "content-script", id: "p-1", density: "write" })).toBe(
			"/content/p-1/script",
		);
	});

	it("a non-default density is in the address, so an outline is linkable", () => {
		expect(viewToPath({ kind: "content-script", id: "p-1", density: "outline" })).toBe(
			"/content/p-1/script?density=outline",
		);
		expect(pathToView("/content/p-1/script", "?density=outline")).toMatchObject({
			density: "outline",
		});
	});

	it("an unknown density falls back rather than failing the route", () => {
		expect(pathToView("/content/p-1/script", "?density=enormous")).toMatchObject({
			density: "write",
		});
	});

	it("every density round-trips", () => {
		for (const density of SCRIPT_DENSITIES) {
			const view = { kind: "content-script", id: "p-1", density } as const;
			const [path, search] = viewToPath(view).split("?");
			expect(pathToView(path!, search ?? "")).toEqual(view);
		}
	});
});

describe("storyboard authoring destination", () => {
	it("opens fourth editor view directly", () => {
		expect(pathToView("/content/p-1/storyboard", "")).toEqual({
			kind: "content-storyboard",
			id: "p-1",
		});
		expect(viewToPath({ kind: "content-storyboard", id: "p-1" })).toBe("/content/p-1/storyboard");
	});

	it("keeps script and editor paths distinct", () => {
		expect(pathToView("/content/p-1/script", "")).toMatchObject({ kind: "content-script" });
		expect(pathToView("/content/p-1", "")).toEqual({ kind: "content-edit", id: "p-1" });
	});
});

/* Proof for task 6.1: every settings level is addressable.
 *
 * The old shape kept everything below `/settings/credits` in component state,
 * which is why `visual/screens.ts` photographs the Env tab through a synthetic
 * click and why that tab went uncovered while 297 green snapshots passed. A
 * level that is not a route cannot be linked, cannot be photographed, and the
 * back button does not reach it. */
describe("settings routing", () => {
	const cases: [string, View][] = [
		["/god/general", { kind: "god", section: "general" }],
		["/god/users", { kind: "god", section: "users" }],
		["/god/workspaces/alpha", { kind: "god", section: "workspaces", detail: "alpha" }],
		["/god/usage", { kind: "god", section: "usage" }],
		["/god/usage/activity", { kind: "god", section: "usage", detail: "activity" }],
		["/god/providers", { kind: "god", section: "providers" }],
		["/god/providers/tts", { kind: "god", section: "providers", detail: "tts" }],
		[
			"/god/providers/tts/kokoro",
			{ kind: "god", section: "providers", detail: "tts", provider: "kokoro" },
		],
		["/god/security", { kind: "god", section: "security" }],
	];

	for (const [path, view] of cases) {
		it(`${path} round-trips`, () => {
			expect(pathToView(path, "")).toEqual(view);
			expect(viewToPath(view)).toBe(path);
		});
	}

	// Credits became Usage. An existing bookmark must land somewhere real rather
	// than falling through to the content list.
	it("old settings links land in matching God Mode levels", () => {
		expect(pathToView("/settings", "")).toEqual({ kind: "god", section: "providers" });
		expect(pathToView("/settings/credits", "")).toEqual({ kind: "god", section: "usage" });
		expect(pathToView("/settings/capabilities/tts/kokoro", "")).toEqual({
			kind: "god",
			section: "providers",
			detail: "tts",
			provider: "kokoro",
		});
		expect(pathToView("/settings/security/master-key", "")).toEqual({
			kind: "god",
			section: "security",
			detail: "master-key",
		});
	});

	it("an unknown legacy section falls back to providers", () => {
		expect(pathToView("/settings/nonsense", "")).toEqual({ kind: "god", section: "providers" });
	});

	// A provider segment only means something under capabilities; carrying one
	// elsewhere would put a path in the address bar that cannot be parsed back.
	it("a provider is only addressable under capabilities", () => {
		const view: View = { kind: "god", section: "usage", detail: "balance", provider: "kokoro" };
		expect(viewToPath(view)).toBe("/god/usage/balance");
	});
});

describe("account routes", () => {
	it("maps each account section and round-trips it", () => {
		for (const section of ["profile", "security", "preferences"] as const) {
			const view: View = { kind: "account", section };
			expect(pathToView(`/account/${section}`, "")).toEqual(view);
			expect(pathToView(viewToPath(view), "")).toEqual(view);
		}
	});

	it("maps bare /account to profile", () => {
		expect(pathToView("/account", "")).toEqual({ kind: "account", section: "profile" });
		expect(viewToPath({ kind: "account", section: "profile" })).toBe("/account");
	});

	it("falls back to profile for an unknown section", () => {
		expect(pathToView("/account/api-keys", "")).toEqual({ kind: "account", section: "profile" });
	});
});

describe("workflow-first explorer routes", () => {
	it("round trips workflow context, disclosures and nested inspection", () => {
		const view: View = {
			kind: "god",
			section: "pipelines",
			template: {
				section: "workflows",
				workflow: "workflow:a/b ?",
				stage: "stage:a",
				implementation: true,
				inspect: "prompt:p",
				query: "direction",
				trail: [{ id: "tool:a", workflow: "workflow:a/b ?", stage: "stage:a" }],
			},
		};
		const url = new URL(viewToPath(view), "http://localhost");
		expect(pathToView(url.pathname, url.search)).toEqual(view);
	});
	it("inventory retains context without pretending it limits inventory", () => {
		const view: View = {
			kind: "god",
			section: "pipelines",
			template: { section: "instructions", workflow: "workflow:a", inspect: "prompt:a" },
		};
		const url = new URL(viewToPath(view), "http://localhost");
		expect(url.pathname).toBe("/god/pipelines/instructions");
		expect(pathToView(url.pathname, url.search)).toEqual(view);
		expect(pathToView("/god/pipelines", "")).toEqual({ kind: "god", section: "pipelines" });
	});
	it("malformed URLs and trails cannot crash navigation; query and history are bounded", () => {
		const params = new URLSearchParams({
			q: "x".repeat(300),
			effect: "edit",
			policy: "invented",
			text: "1",
		});
		for (const raw of ["{", "null", "[]", '{"id":5}']) params.append("via", raw);
		expect(pathToView("/god/pipelines/workflows/%ZZ", params.toString())).toMatchObject({
			template: { workflow: "%ZZ", query: "x".repeat(256) },
		});
		const result = pathToView("/god/pipelines/workflows/%ZZ", params.toString());
		expect(result.kind === "god" && result.template?.filters).toBeUndefined();
		for (let i = 0; i < 20; i++)
			params.append("via", JSON.stringify({ id: `tool:${i}`, private: "ignored" }));
		const bounded = pathToView("/god/pipelines", params.toString());
		expect(bounded.kind === "god" && bounded.template?.trail).toHaveLength(16);
		expect(bounded).toMatchObject({ template: { omitted: true } });
	});
});

it("legacy catalog links normalize without losing canonical ID or inventing context", () => {
	expect(
		pathToView("/god/pipelines/definitions/prompts", "?inspect=prompt%3Ap&source=old&text=1"),
	).toMatchObject({ template: { section: "instructions", inspect: "prompt:p" } });
	expect(pathToView("/god/pipelines/definitions/profiles", "?inspect=profile%3Aedit")).toEqual({
		kind: "god",
		section: "pipelines",
		template: { section: "workflows", inspect: "profile:edit" },
	});
	expect(
		pathToView(
			"/god/pipelines/definitions/operations",
			"?inspect=operation%3Aremoved&stage=unknown",
		),
	).toMatchObject({
		template: { section: "workflows", inspect: "operation:removed", stage: "unknown" },
	});
});
