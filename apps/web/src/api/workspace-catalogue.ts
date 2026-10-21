/* The workspace catalogue the editor picks from: reference images, voices and
 * persisted product records, plus the global asset writes that add to it. */
import { del, get, post, put } from "./client.ts";
import type {
	RefImage,
	CatalogueImage,
	CatalogueProduct,
	ReferenceEntityWire,
	TtsProviderOption,
} from "@maleo/shared";
import { setVoiceCatalogue, type Voice } from "@models/references/voice-library.ts";
import { hashHue } from "@models/core/measures.ts";
import { BASE } from "./base.ts";

export interface ContentCatalogue {
	images: RefImage[];
	/** The EFFECTIVE provider's voices — what a surface that BINDS a voice may
	 *  offer. See the note in `fetchContentCatalogue` before widening this. */
	voices: Voice[];
	/** Every registered provider and its voices, for surfaces that only browse or
	 *  audition. Empty from a server that predates the field. */
	voiceProviders: TtsProviderOption[];
	products: CatalogueProduct[];
}

type CatalogueImageWire = CatalogueImage &
	Partial<RefImage> & {
		description?: string | null;
		note?: string | null;
		role?: string | null;
		src?: string | null;
	};

function normalizeCatalogueProduct(
	product: CatalogueProduct & {
		image_url?: string | null;
		images?: string[] | null;
		description?: string | null;
	},
): CatalogueProduct {
	return {
		...product,
		src:
			product.src ||
			product.image_url ||
			product.images?.find((item) => typeof item === "string" && item.trim()) ||
			"",
		note: product.note || product.description || "",
	};
}

export function normalizeCatalogueImage(image: CatalogueImageWire): RefImage {
	const imageUrl = image.imageUrl || image.src || "";
	const description = image.description || image.note || "";
	const role = image.role || image.kind || undefined;
	return {
		...image,
		tags: image.tags ?? [],
		role,
		description,
		seed: image.seed ?? hashHue(image.id),
		imageUrl,
	};
}

export async function fetchContentCatalogue(): Promise<ContentCatalogue | null> {
	try {
		const res = await get<{
			images: CatalogueImageWire[];
			voices: Voice[];
			voice_providers?: TtsProviderOption[];
			products?: CatalogueProduct[];
		}>(`${BASE}/catalogue`);
		/* The hue arrives WITH the voice now. It used to be recomputed here with
		 * `hashHue(voice.id)` while `VOICE_LIB` carried hand-picked values, so the
		 * same voice drew in two colours depending on which of the two a surface
		 * happened to read. One derivation, server-side, is what makes them agree.
		 *
		 * Registering the catalogue is what lets the synchronous `resolveVoice` see
		 * it — see models/references/voice-library.ts. */
		const voices = res.voices ?? [];
		/* ONLY the effective provider's voices, never the union of every provider's.
		 *
		 * `resolveVoice` looks a bound speaker up in here BY BARE VOICE ID to get
		 * its description and colour. Voice ids are unique within a provider and
		 * not across them, so registering the union would let a speaker bound to
		 * one provider's voice resolve against another provider's entry with the
		 * same id — wrong description, wrong colour, and no error anywhere.
		 *
		 * A surface that wants every provider's voices reads `voiceProviders`
		 * below, which is exactly why that arrives as its own field. */
		setVoiceCatalogue(voices);
		return {
			images: (res.images ?? []).map((image) => normalizeCatalogueImage(image)),
			voices,
			voiceProviders: res.voice_providers ?? [],
			products: (res.products ?? []).map((product) =>
				normalizeCatalogueProduct(
					product as CatalogueProduct & {
						image_url?: string | null;
						images?: string[] | null;
						description?: string | null;
					},
				),
			),
		};
	} catch {
		return null;
	}
}

export async function deleteGlobalReference(refId: string): Promise<void> {
	await del(`${BASE}/assets/${encodeURIComponent(refId)}`);
}

export async function deleteWorkspaceReferenceEntity(refId: string): Promise<void> {
	await del(`${BASE}/reference-entities/${encodeURIComponent(refId)}`);
}

export async function saveWorkspaceReferenceEntity(ref: RefImage): Promise<RefImage> {
	const res = await put<{ reference: ReferenceEntityWire }>(
		`${BASE}/reference-entities/${encodeURIComponent(ref.id)}`,
		{
			role: ref.role ?? ref.tags?.[0] ?? "style",
			label: ref.label,
			description: ref.description ?? "",
			imageUrl: ref.imageUrl ?? null,
			tags: ref.tags ?? (ref.role ? [ref.role] : []),
			origin: ref.generated ? "generated" : "linked",
		},
	);
	return normalizeCatalogueImage({
		id: res.reference.id,
		label: res.reference.label,
		role: typeof res.reference.role === "string" ? res.reference.role : "style",
		kind: typeof res.reference.role === "string" ? res.reference.role : "style",
		tags: res.reference.tags,
		description: res.reference.description,
		note: res.reference.description,
		src: res.reference.imageUrl ?? "",
		seed: ref.seed,
		default: res.reference.primary,
		workspace: ref.workspace ?? "",
		collection: ref.collection ?? "",
		item_id: ref.item_id ?? res.reference.id,
	});
}

export async function saveGlobalReferenceAsset(
	id: string,
	image: {
		label: string;
		tags?: string[];
		note?: string;
		seed?: number;
		default?: boolean;
		src?: string;
		prompt?: string;
		gen?: boolean;
	},
): Promise<void> {
	if (!image.src?.trim()) return;
	await post(`${BASE}/assets`, {
		scope: "workspace",
		kind: image.tags?.[0] ?? "style",
		label: image.label,
		tags: image.tags ?? [],
		note: image.note || null,
		seed: image.seed ?? 0,
		default: image.default === true,
		src: image.src,
		source_type: image.gen ? "generated_reference" : "reference",
		source_ref: id,
		collection: "references",
		item_id: id,
		meta_json: { id, tags: image.tags ?? [], prompt: image.prompt },
	});
}
