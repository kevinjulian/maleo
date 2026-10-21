/* The library route: /library/:type.
 *
 * One page rather than three, because the route already models it that way —
 * `View` carries `{ kind: "library"; type: LibraryType }` and `toLibraryType`
 * centralises the fallback that maps legacy values onto references. Three
 * pages would need three route entries and either duplicate that fallback or
 * re-export it three ways.
 */
import type { JSX } from "react";
import type { LibraryType } from "@models/core/routing.ts";
import { PresetsLibrary } from "@components/catalog/presets-library.tsx";
import { MaterialsLibrary } from "@components/catalog/materials-library.tsx";
import { TemplatesLibrary } from "@components/catalog/templates-library.tsx";
import { ElementsLibrary } from "@components/catalog/elements-library.tsx";
import { ReferencesLibrary } from "@components/catalog/references-library.tsx";
import { VoicesLibrary } from "@components/catalog/voices-library.tsx";
import "@components/catalog/library.css";
import "@components/catalog/catalog-form.css";

export function LibraryPage({
	type,
	editId,
	newGroup,
}: {
	type: LibraryType;
	editId?: string;
	newGroup?: string;
}): JSX.Element {
	if (type === "voices") return <VoicesLibrary />;
	if (type === "presets") return <PresetsLibrary initialEditId={editId} />;
	if (type === "materials")
		return <MaterialsLibrary initialEditId={editId} initialNewGroup={newGroup} />;
	if (type === "templates") return <TemplatesLibrary />;
	if (type === "elements") return <ElementsLibrary />;
	return <ReferencesLibrary />;
}
