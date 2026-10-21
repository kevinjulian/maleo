/* Path <-> view mapping. Pure: no React, no network, no history.
 * The browser-history side of routing is app/history-sync.ts. */
import { WORKSPACE_QUERY_KEY } from "./active-workspace.ts";
import { oneOf } from "@maleo/shared";
/* The library's surfaces.
 *
 * `templates` and `elements` exist because three of the four defaulter families had no
 * library at all: a timeline template was reachable only from inside the video editor, and
 * clip templates and motion presets only from a sidebar menu. A record that supplies
 * defaults to every project should not require opening a project to find.
 *
 * `materials` is the generation context — Story, Visual, Voice and Rules — which had no
 * home at all: it lived inside a project's reference panel and its creative-direction
 * fields, so an operator could not reuse a brief they had already written.
 *
 * The route keys stay as they are. `presets` is labelled Project Presets and `elements`
 * Elements in the UI; renaming the paths would break every existing bookmark to buy
 * nothing an operator can see. Elements was called Custom Elements until it grew from
 * the saved blocks alone to the whole placeable catalogue, with the saved ones as one
 * group inside it — the label changed, `/library/elements` did not. */
export type LibraryType =
	| "references"
	| "voices"
	| "presets"
	| "materials"
	| "templates"
	| "elements";

const LIBRARY_TYPES: readonly LibraryType[] = [
	"references",
	"voices",
	"presets",
	"materials",
	"templates",
	"elements",
];
// Back-compat: old deep links / bookmarks to the retired standalone catalogues
// land on the merged References page instead of 404ing.
const LEGACY_LIBRARY_TYPES = ["images", "products", "notes", "sources"];

function toLibraryType(value: string | null): LibraryType {
	const known = oneOf(value, LIBRARY_TYPES);
	if (known) return known;
	if (value && LEGACY_LIBRARY_TYPES.includes(value)) return "references";
	return "references";
}

/* How much of the script table is showing. In the ADDRESS rather than in
 * storage: an outline is then a link someone can send, the back button means
 * something, and a view setting needs no persistence of its own. Same reasoning
 * that puts the workspace in a query parameter. */
export const SCRIPT_DENSITIES = ["outline", "read", "write"] as const;
export type ScriptDensity = (typeof SCRIPT_DENSITIES)[number];
export const DEFAULT_SCRIPT_DENSITY: ScriptDensity = "write";

export type View =
	| { kind: "content" }
	| { kind: "content-edit"; id: string }
	/* The script is its own destination, not a mode of the editor. Same reasoning
	 * as the two-destination splits below: a script is separately linkable and
	 * reachable without opening the editor first, and the editor's own view
	 * switcher is left exactly as it was. */
	| { kind: "content-script"; id: string; density: ScriptDensity }
	| { kind: "content-storyboard"; id: string }
	| { kind: "create" }
	| { kind: "library"; type: LibraryType; editId?: string; newGroup?: string }
	| { kind: "video" }
	/* Two destinations, not one surface with modes: browsing generated images and
	 * running a generation session are separately linkable, and neither is
	 * reachable only from inside the other. */
	| { kind: "images" }
	| { kind: "imagelab" }
	/* Speech is the same two-destination split as images: a gallery of every clip
	 * and a synthesis session, separately linkable. */
	| { kind: "speech" }
	| { kind: "speechlab" }
	/* The workspace surface: one destination with panels, addressed the way
	 * Settings already is. A panel that is not in the address cannot be linked,
	 * cannot be returned to with Back, and cannot be photographed by the visual
	 * suite — the same argument that made every Settings level a route. */
	| { kind: "workspace"; panel?: WorkspacePanel }
	/* God Mode: deployment administration, including what Settings used to be.
	 * Every level — section, then detail, then provider — is addressable, for the
	 * reason the old Settings tree was: a level that is not a route cannot be
	 * linked, returned to with Back, or photographed by the visual suite. */
	| {
			kind: "god";
			section: GodSection;
			detail?: string;
			provider?: string;
			template?: TemplateSelection;
	  }
	/* The signed-in person's own pages. Not workspace-scoped and not deployment
	 * administration, so neither of the two surfaces above; each section is a
	 * route for the same reason theirs are. */
	| { kind: "account"; section: AccountSection };

export function viewToPath(view: View): string {
	switch (view.kind) {
		case "content":
			return "/";
		case "content-edit":
			return `/content/${encodeURIComponent(view.id)}`;
		case "content-script": {
			const base = `/content/${encodeURIComponent(view.id)}/script`;
			/* The default is omitted, so the plain path stays the plain path — a link
			 * to a script should not grow a query string nobody asked for. */
			return view.density === DEFAULT_SCRIPT_DENSITY ? base : `${base}?density=${view.density}`;
		}
		case "content-storyboard":
			return `/content/${encodeURIComponent(view.id)}/storyboard`;
		case "create":
			return "/create";
		case "library": {
			// `new` opens the create form directly. A link that only reached the LIST
			// left the operator to find the button, which is the dead end this fixes.
			const params = new URLSearchParams();
			if (view.editId) params.set("edit", view.editId);
			else if (view.newGroup) params.set("new", view.newGroup);
			const query = params.toString();
			return `/library/${view.type}${query ? `?${query}` : ""}`;
		}
		case "video":
			return "/video";
		case "images":
			return "/images";
		case "imagelab":
			return "/images/lab";
		case "speech":
			return "/speech";
		case "speechlab":
			return "/speech/lab";
		case "workspace":
			return workspacePath(view);
		case "god":
			return godPath(view);
		case "account":
			return view.section === "profile" ? "/account" : `/account/${view.section}`;
	}
}

/* ─── Workspace routing ─── */

/* `danger` is a panel like the others as far as routing is concerned. Its
 * separation is a matter of presentation — see the workspace-administration
 * spec — not of addressing. */
export const WORKSPACE_PANELS = ["general", "members", "danger"] as const;
export type WorkspacePanel = (typeof WORKSPACE_PANELS)[number];

function workspacePath(view: Extract<View, { kind: "workspace" }>): string {
	return view.panel && view.panel !== "general" ? `/workspace/${view.panel}` : "/workspace";
}

function toWorkspaceView(pathname: string): View {
	const [, , panel] = pathname.split("/");
	const known = oneOf(panel ?? null, WORKSPACE_PANELS);
	return known ? { kind: "workspace", panel: known } : { kind: "workspace" };
}

/* ─── Settings routing ─── */

export const SETTINGS_SECTIONS = ["usage", "capabilities", "security"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Usage's children, promoted from the tab strip that used to live inside it. */
export const USAGE_SECTIONS = ["balance", "activity", "transactions", "policy"] as const;
export type UsageSection = (typeof USAGE_SECTIONS)[number];

/* Former `/settings/...` addresses, mapped to their God Mode level so saved
 * links keep working. Capabilities became Providers; `/settings/credits` was
 * the one deep link before that and already meant Usage. */
function legacySettingsView(pathname: string): View {
	const [, , section, detail, provider] = pathname.split("/");
	if (section === "credits") return { kind: "god", section: "usage" };
	const known = oneOf(section ?? null, SETTINGS_SECTIONS);
	if (!known) return { kind: "god", section: "providers" };
	return {
		kind: "god",
		section: known === "capabilities" ? "providers" : known,
		...(detail ? { detail } : {}),
		...(known === "capabilities" && provider ? { provider } : {}),
	};
}

export const ACCOUNT_SECTIONS = ["profile", "security", "preferences", "mcp"] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

export const TEMPLATE_SECTIONS = [
	"workflows",
	"tools",
	"instructions",
	"profiles",
	"prompts",
	"operations",
] as const;
export type TemplateSection = (typeof TEMPLATE_SECTIONS)[number];
export type TemplateLocation = { id: string; workflow?: string; stage?: string };
export type TemplateQueryFilters = {
	content?: string;
	effect?: string;
	policy?: string;
	source?: string;
	gates?: boolean;
	repeats?: boolean;
};
export type TemplateSelection = {
	section: TemplateSection;
	workflow?: string;
	stage?: string;
	open?: string[];
	inspect?: string;
	/** Definition open in the right drawer; `trail` holds the drawer's own Back history. */
	peek?: string;
	trail?: TemplateLocation[];
	omitted?: boolean;
	implementation?: boolean;
	query?: string;
	filters?: TemplateQueryFilters;
	promptText?: boolean;
};
export type NavigationMode = "push" | "replace" | "back" | "close";
export const GOD_SECTIONS = [
	"users",
	"workspaces",
	"projects",
	"general",
	"authentication",
	"providers",
	"security",
	"usage",
	"audit",
	"pipelines",
] as const;
export type GodSection = (typeof GOD_SECTIONS)[number];

function godPath(view: Extract<View, { kind: "god" }>): string {
	const parts = ["god", view.section];
	if (view.section === "pipelines") {
		const value = view.template;
		if (value?.section === "workflows" && value.workflow)
			parts.push("workflows", encodeURIComponent(value.workflow));
		else if (value?.section === "tools") parts.push("tools");
		else if (value?.section === "instructions" || value?.section === "prompts")
			parts.push("instructions");
		const params = new URLSearchParams();
		if (value?.section !== "workflows" && value?.workflow) params.set("context", value.workflow);
		if (value?.stage) params.set("stage", value.stage);
		if (value?.implementation) params.set("impl", "1");
		if (value?.inspect) params.set("inspect", value.inspect);
		if (value?.peek) params.set("peek", value.peek);
		for (const frame of (value?.trail ?? []).slice(-16))
			params.append("via", JSON.stringify(frame));
		if (value?.omitted || (value?.trail?.length ?? 0) > 16) params.set("omitted", "1");
		if (value?.query) params.set("q", value.query.slice(0, 256));
		const query = params.toString();
		return `/${parts.join("/")}${query ? `?${query}` : ""}`;
	}
	if (view.detail) parts.push(encodeURIComponent(view.detail));
	if (view.section === "providers" && view.provider) parts.push(encodeURIComponent(view.provider));
	return `/${parts.join("/")}`;
}

function templateTrail(params: URLSearchParams): TemplateLocation[] {
	return params
		.getAll("via")
		.slice(-16)
		.flatMap((raw) => {
			try {
				const v: unknown = JSON.parse(raw);
				if (
					!v ||
					typeof v !== "object" ||
					Array.isArray(v) ||
					!("id" in v) ||
					typeof v.id !== "string" ||
					!v.id
				)
					return [];
				return [
					{
						id: v.id,
						...("workflow" in v && typeof v.workflow === "string" ? { workflow: v.workflow } : {}),
						...("stage" in v && typeof v.stage === "string" ? { stage: v.stage } : {}),
					},
				];
			} catch {
				return [];
			}
		});
}
function safeRouteId(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
function toGodView(pathname: string, params: URLSearchParams): View {
	const segments = pathname.split("/");
	const [, , raw, detail, provider] = segments;
	const section = oneOf(raw ?? null, GOD_SECTIONS) ?? "general";
	if (section === "pipelines") {
		if (!detail && !params.size) return { kind: "god", section };
		const legacy = detail === "definitions" ? provider : detail;
		const category =
			legacy === "tools"
				? "tools"
				: legacy === "prompts" || legacy === "instructions"
					? "instructions"
					: "workflows";
		const workflow =
			detail === "workflows" && provider
				? safeRouteId(provider)
				: params.get("context") || undefined;
		const trail = templateTrail(params);
		return {
			kind: "god",
			section,
			template: {
				section: category,
				...(workflow ? { workflow } : {}),
				...(params.get("stage") ? { stage: params.get("stage")! } : {}),
				...(params.get("impl") === "1" ? { implementation: true } : {}),
				...(params.get("inspect") ? { inspect: params.get("inspect")! } : {}),
				...(params.get("peek") ? { peek: params.get("peek")! } : {}),
				...(trail.length ? { trail } : {}),
				...(params.get("omitted") === "1" || params.getAll("via").length > 16
					? { omitted: true }
					: {}),
				...(params.get("q") ? { query: params.get("q")!.slice(0, 256) } : {}),
			},
		};
	}
	return {
		kind: "god",
		section,
		...(detail ? { detail: safeRouteId(detail) } : {}),
		...(provider ? { provider: safeRouteId(provider) } : {}),
	};
}

/* The active workspace rides ALONGSIDE the view, not inside it.
 *
 * Every route is reachable in every workspace, so making the tenant part of the
 * `View` union would add the same field to nine variants and force every
 * `setView` call site to carry a value it has no opinion about. It is a query
 * parameter appended to whatever path the view maps to, which is also what makes
 * a shared link open its own tenant: the workspace survives copy-paste because
 * it is in the address rather than in this tab's memory. */
export function withWorkspace(path: string, workspace: string): string {
	const [base, existing] = path.split("?");
	const params = new URLSearchParams(existing);
	params.set(WORKSPACE_QUERY_KEY, workspace);
	return `${base}?${params.toString()}`;
}

export function pathToView(path: string, search: string): View {
	const p = path.replace(/\/+$/, "") || "/";
	const params = new URLSearchParams(search);

	if (p === "/workspace" || p.startsWith("/workspace/")) return toWorkspaceView(p);
	if (p === "/god" || p.startsWith("/god/")) return toGodView(p, params);
	if (p === "/account" || p.startsWith("/account/")) {
		return {
			kind: "account",
			section: oneOf(p.split("/")[2] ?? null, ACCOUNT_SECTIONS) ?? "profile",
		};
	}
	if (p === "/" || p === "" || p === "/content" || p === "/operations") return { kind: "content" };
	if (p === "/create") {
		// Back-compat: /create?project=<id> now opens the content editor.
		const projectId = params.get("project");
		return projectId ? { kind: "content-edit", id: projectId } : { kind: "create" };
	}

	const scriptMatch = p.match(/^\/content\/([^/]+)\/script$/);
	if (scriptMatch) {
		return {
			kind: "content-script",
			id: decodeURIComponent(scriptMatch[1]!),
			density: oneOf(params.get("density"), SCRIPT_DENSITIES) ?? DEFAULT_SCRIPT_DENSITY,
		};
	}

	const storyboardMatch = p.match(/^\/content\/([^/]+)\/storyboard$/);
	if (storyboardMatch)
		return { kind: "content-storyboard", id: decodeURIComponent(storyboardMatch[1]!) };

	const contentEditMatch = p.match(/^\/content\/([^/]+)$/);
	if (contentEditMatch) {
		return { kind: "content-edit", id: decodeURIComponent(contentEditMatch[1]!) };
	}

	// Library routes (/library/:type) + back-compat for old catalogue/catalog/sources.
	const libraryMatch = p.match(/^\/library\/([^/]+)$/);
	if (libraryMatch) {
		const type = toLibraryType(decodeURIComponent(libraryMatch[1]!));
		const editId = params.get("edit")?.trim() || undefined;
		if (editId) return { kind: "library", type, editId };
		const newGroup = params.get("new")?.trim() || undefined;
		return newGroup ? { kind: "library", type, newGroup } : { kind: "library", type };
	}
	if (p === "/catalogue") return { kind: "library", type: toLibraryType(params.get("tab")) };
	if (p === "/catalog") return { kind: "library", type: "references" };
	if (p === "/sources") return { kind: "library", type: "references" };
	if (p === "/video") return { kind: "video" };
	if (p === "/images") return { kind: "images" };
	if (p === "/images/lab") return { kind: "imagelab" };
	if (p === "/speech") return { kind: "speech" };
	if (p === "/speech/lab") return { kind: "speechlab" };
	// Back-compat: the lab used to be the whole Images surface and lived here, so
	// existing bookmarks land on the lab rather than 404ing to the content list.
	if (p === "/imagelab") return { kind: "imagelab" };
	if (p === "/settings" || p.startsWith("/settings/")) return legacySettingsView(p);

	return { kind: "content" };
}
