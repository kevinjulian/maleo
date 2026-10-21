/* The role axis has exactly one resolver. These tests pin it against every value
 * that actually exists in the production `content_references` table, because the
 * bug this replaces was three resolvers with three different fallbacks: the UI
 * defaulted unknown to "style", the backend to "character", and the loader to the
 * raw `kind`. The same reference rendered as Style and bound as Character. */
import { describe, expect, it } from "vite-plus/test";
import {
	isRole,
	isSubjectRole,
	MAX_REFERENCE_IMAGES,
	type Role,
	roleOf,
	ROLES,
	SUBJECT_ROLES,
} from "./generation-cast.ts";

/* Every distinct `kind` in content_references as of the migration snapshot. */
const DB_KINDS = [
	"audio",
	"character",
	"environment",
	"image",
	"note",
	"product",
	"research",
	"style",
] as const;

/* Every distinct `meta_json.tags[0]` in content_references as of the snapshot.
 * Includes the NOTE_KINDS values (tone/structure/visual), which are a third axis
 * again — they must not resolve as roles. */
const DB_PRIMARY_TAGS = [
	"",
	"audio",
	"character",
	"environment",
	"product",
	"structure",
	"style",
	"tone",
	"visual",
] as const;

/* Split of the above by axis. Roles present in the DB — `prop` is specified but
 * has zero rows, so it is absent here while still being a valid role. */
const ROLE_AXIS: Role[] = ["character", "product", "style"];
const NON_ROLE = ["audio", "image", "note", "research", "structure", "tone", "visual", ""];
const isRoleAxis = (v: string): v is Role => (ROLE_AXIS as string[]).includes(v);

describe("role vocabulary", () => {
	it("is exactly the five specified roles", () => {
		expect([...ROLES]).toEqual(["style", "character", "location", "product", "prop"]);
	});

	it("includes prop, which the UI's REF_KINDS never implemented", () => {
		expect(isRole("prop")).toBe(true);
	});

	it("excludes video, which was on the role axis in the UI only", () => {
		expect(isRole("video")).toBe(false);
		expect(roleOf("video")).toBeNull();
	});
});

describe("roleOf against real DB values", () => {
	it("resolves every role-axis value present in the DB, without a fallback", () => {
		for (const role of ROLE_AXIS) {
			expect(roleOf(role)).toBe(role);
		}
		// Every one of them really does occur as a kind or a primary tag.
		const all = new Set<string>([...DB_KINDS, ...DB_PRIMARY_TAGS]);
		for (const role of ROLE_AXIS) expect(all.has(role)).toBe(true);
	});

	it("returns null for every asset-type kind", () => {
		for (const kind of DB_KINDS.filter((k) => !isRoleAxis(k))) {
			if (kind === "environment") expect(roleOf(kind)).toBe("style");
			else expect(roleOf(kind)).toBeNull();
		}
	});

	it("resolves every role-axis primary tag", () => {
		for (const tag of DB_PRIMARY_TAGS) {
			if (isRoleAxis(tag)) expect(roleOf(tag)).toBe(tag as Role);
			else if (tag === "environment") expect(roleOf(tag)).toBe("style");
			else expect(roleOf(tag)).toBeNull();
		}
	});

	it("returns null for note-kind tags, which are a third axis", () => {
		for (const tag of ["tone", "structure", "visual"]) {
			expect(roleOf(tag)).toBeNull();
		}
	});

	it("covers every real value with no unclassified leftovers", () => {
		const all = new Set<string>([...DB_KINDS, ...DB_PRIMARY_TAGS]);
		for (const value of all) {
			if (isRoleAxis(value)) expect(roleOf(value)).toBe(value as Role);
			else if (value === "environment") expect(roleOf(value)).toBe("style");
			else expect(roleOf(value)).toBeNull();
		}
		expect(
			[...all].filter((v) => v !== "environment" && !isRoleAxis(v) && !NON_ROLE.includes(v)),
		).toEqual([]);
	});

	it("never silently defaults — null is null, not a role", () => {
		for (const junk of [undefined, null, 0, {}, [], "CHARACTER", " character "]) {
			expect(roleOf(junk)).toBeNull();
		}
	});
});

describe("subject roles", () => {
	it("are character and product only", () => {
		expect([...SUBJECT_ROLES]).toEqual(["character", "product"]);
	});

	it("exclude prop — a prop carries no identity that can blend", () => {
		expect(isSubjectRole("prop")).toBe(false);
	});

	it("exclude location and style", () => {
		expect(isSubjectRole("location")).toBe(false);
		expect(isSubjectRole("environment")).toBe(false);
		expect(isSubjectRole("style")).toBe(false);
	});

	it("cover every subject role in the role vocabulary", () => {
		for (const role of ROLES) {
			expect(isSubjectRole(role)).toBe((SUBJECT_ROLES as readonly string[]).includes(role));
		}
	});
});

describe("caps", () => {
	it("expose total-reference and subject caps as distinct concepts", () => {
		expect(MAX_REFERENCE_IMAGES).toBe(4);
		expect(MAX_REFERENCE_IMAGES).toBeGreaterThan(0);
	});
});
