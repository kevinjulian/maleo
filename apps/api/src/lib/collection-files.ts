import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import YAML from "yaml";
import { z } from "zod";
import { workspacePath } from "./workspace-paths.ts";
import {
	readWorkspaceConfig,
	readWorkspaceConfigText,
	writeWorkspaceConfigText,
} from "./config-yaml.ts";

export type ItemType = "image" | "text";

export interface ItemMeta {
	id: string;
	label: string;
	active: boolean;
	type: ItemType;
	created_at: number;
}

export interface ItemDetail extends ItemMeta {
	prompt: string;
	sheets: string[];
	description?: string;
}

export interface CollectionInfo {
	slug: string;
	label: string;
	template_key: string;
}

const DEFAULT_COLLECTIONS: CollectionInfo[] = [
	{ slug: "characters", label: "Characters", template_key: "character" },
	{ slug: "environments", label: "Locations", template_key: "location" },
];

function collectionDir(workspace: string, collection: string): string {
	return join(workspacePath(workspace, "collections"), collection);
}

function itemDir(workspace: string, collection: string, id: string): string {
	return join(collectionDir(workspace, collection), id);
}

function promptPath(workspace: string, collection: string, id: string): string {
	return join(itemDir(workspace, collection, id), "prompt.md");
}

function descriptionPath(workspace: string, collection: string, id: string): string {
	return join(itemDir(workspace, collection, id), "description.md");
}

function readDescription(workspace: string, collection: string, id: string): string | undefined {
	const fp = descriptionPath(workspace, collection, id);
	if (!existsSync(fp)) return undefined;
	try {
		const text = readFileSync(fp, "utf8").trim();
		return text || undefined;
	} catch {
		return undefined;
	}
}

function writeDescription(workspace: string, collection: string, id: string, desc: string): void {
	const dir = itemDir(workspace, collection, id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(descriptionPath(workspace, collection, id), desc, "utf8");
}

function configKey(collection: string): string {
	return `collections_${collection}`;
}

/* `collections_*` is the one key `WorkspaceSchema` cannot declare: `configKey`
 * builds it from a caller argument, so the key is not knowable statically. It
 * reaches here as `unknown` — passthrough is why it survives the parse at all —
 * and it is parsed at the point of use instead.
 *
 * `type` is optional here and `ItemMeta` declares it required, which is a
 * disagreement the stored files settle: three real entries omit it
 * (`tuyul`'s character, and the `environments` lists in `kunti` and `veronika`),
 * so the assertion this replaces was claiming a field those files do not have.
 * The default is inert either way — the only reader, `content-catalogue.ts`,
 * uses `id`, `label`, `active`, `sheets`, `description` and `prompt`, and never
 * reads `type`. */
const ItemMetaSchema = z.object({
	id: z.string(),
	label: z.string(),
	active: z.boolean(),
	type: z.enum(["image", "text"]).default("image"),
	created_at: z.number(),
});

async function readItemsMeta(workspace: string, collection: string): Promise<ItemMeta[]> {
	try {
		const raw = (await readWorkspaceConfig(workspace))[configKey(collection)];
		if (!Array.isArray(raw)) return [];
		// Per entry, so one bad row is dropped rather than hiding the whole
		// collection — `z.array(...).catch([])` would discard every sibling with it.
		return raw.flatMap((entry) => {
			const parsed = ItemMetaSchema.safeParse(entry);
			return parsed.success ? [parsed.data] : [];
		});
	} catch {
		return [];
	}
}

async function writeItemsMeta(
	workspace: string,
	collection: string,
	items: ItemMeta[],
): Promise<void> {
	const text = await readWorkspaceConfigText(workspace);
	const doc = YAML.parseDocument(text);
	doc.set(configKey(collection), items);
	await writeWorkspaceConfigText(workspace, String(doc));
}

function listSheets(workspace: string, collection: string, id: string): string[] {
	const dir = itemDir(workspace, collection, id);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
		.sort()
		.reverse();
}

export function listCollections(_workspace: string): CollectionInfo[] {
	/* `image_collections` used to be read here as an operator override. It is in
	 * none of the workspace config files, written by nothing in `packages` or
	 * `apps`, and had exactly this one reader — so this function has always
	 * returned the defaults. The read and its two assertions went with it. */
	return DEFAULT_COLLECTIONS;
}

export async function listItems(workspace: string, collection: string): Promise<ItemDetail[]> {
	const metas = await readItemsMeta(workspace, collection);
	return metas.map((m) => {
		const pp = promptPath(workspace, collection, m.id);
		const prompt = existsSync(pp) ? readFileSync(pp, "utf8") : "";
		return {
			...m,
			prompt,
			sheets: listSheets(workspace, collection, m.id),
			description: readDescription(workspace, collection, m.id),
		};
	});
}

export async function getItem(
	workspace: string,
	collection: string,
	id: string,
): Promise<ItemDetail | null> {
	const metas = await readItemsMeta(workspace, collection);
	const meta = metas.find((m) => m.id === id);
	if (!meta) return null;
	const pp = promptPath(workspace, collection, id);
	const prompt = existsSync(pp) ? readFileSync(pp, "utf8") : "";
	return {
		...meta,
		prompt,
		sheets: listSheets(workspace, collection, id),
		description: readDescription(workspace, collection, id),
	};
}

export async function createItem(
	workspace: string,
	collection: string,
	label: string,
	promptTemplate: string,
	type: ItemType = "image",
): Promise<ItemDetail> {
	const id = randomUUID().slice(0, 8);
	const dir = itemDir(workspace, collection, id);
	mkdirSync(dir, { recursive: true });
	if (type === "image") {
		writeFileSync(promptPath(workspace, collection, id), promptTemplate, "utf8");
	}

	const metas = await readItemsMeta(workspace, collection);
	const entry: ItemMeta = { id, label, active: true, type, created_at: Date.now() };
	await writeItemsMeta(workspace, collection, [...metas, entry]);

	return { ...entry, prompt: type === "image" ? promptTemplate : "", sheets: [] };
}

export async function updateItem(
	workspace: string,
	collection: string,
	id: string,
	updates: { label?: string; prompt?: string; active?: boolean; description?: string },
): Promise<ItemDetail | null> {
	const metas = await readItemsMeta(workspace, collection);
	const idx = metas.findIndex((m) => m.id === id);
	if (idx === -1) return null;

	const updated = { ...metas[idx]! };
	if (updates.label !== undefined) updated.label = updates.label;
	if (updates.active !== undefined) updated.active = updates.active;

	const next = [...metas];
	next[idx] = updated;
	await writeItemsMeta(workspace, collection, next);

	if (updates.prompt !== undefined) {
		const dir = itemDir(workspace, collection, id);
		mkdirSync(dir, { recursive: true });
		writeFileSync(promptPath(workspace, collection, id), updates.prompt, "utf8");
	}
	if (updates.description !== undefined) {
		writeDescription(workspace, collection, id, updates.description);
	}

	return getItem(workspace, collection, id);
}

export async function deleteItem(
	workspace: string,
	collection: string,
	id: string,
): Promise<boolean> {
	const metas = await readItemsMeta(workspace, collection);
	const filtered = metas.filter((m) => m.id !== id);
	if (filtered.length === metas.length) return false;

	await writeItemsMeta(workspace, collection, filtered);

	const dir = itemDir(workspace, collection, id);
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	return true;
}

export function saveSheet(
	workspace: string,
	collection: string,
	id: string,
	imageBuffer: Buffer,
	ext = "png",
): string {
	const dir = itemDir(workspace, collection, id);
	mkdirSync(dir, { recursive: true });
	const filename = `sheet-${Date.now()}.${ext}`;
	writeFileSync(join(dir, filename), imageBuffer);
	return filename;
}

export function sheetFilePath(
	workspace: string,
	collection: string,
	id: string,
	filename: string,
): string | null {
	const fp = join(itemDir(workspace, collection, id), filename);
	return existsSync(fp) ? fp : null;
}
