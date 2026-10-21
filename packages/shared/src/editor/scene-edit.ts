/* A scene edit as a command, made the way the editor makes it.
 *
 * A scene is several entities in the document: its clip (with the scene payload),
 * any `vis:` clips, and its marker, which may be shared with neighbours of the same
 * story beat. The editor edits a scene through one projection — `resequenceScenes`
 * written back with `rebuildDocWith` — and records the command `diffScopeToCommand`
 * derives from it. This derives the command the same way, so a caller that names
 * the edit (the agent's `update_scene`) gets the command a hand edit records,
 * without a second copy of the projection's rules. Scenes read from a document
 * carry their position, so later scenes stay where they are, as they do by hand.
 *
 * Both sides of the comparison are rebuilt, so the derived commands name clips by
 * id and apply to the document whatever order its clips are stored in. */
import { resequenceScenes } from "../scene-timing.ts";
import { fromTimelineDoc, rebuildDocWith, type TimelineDoc } from "../timeline-doc.ts";
import type { Scene } from "../timeline-model.ts";
import type { EditorCommand } from "./commands.ts";
import { diffScopeToCommand } from "./scope-diff.ts";

/** The command that applies `edit` to scene `sceneId`, or throws when the scene does
 *  not exist or the edit cannot be expressed as per-entity commands. */
export function sceneEditCommand(
	doc: TimelineDoc,
	sceneId: number,
	edit: Partial<Scene> | "remove",
): EditorCommand {
	const scenes = fromTimelineDoc(doc).scenes;
	if (!scenes.some((scene) => scene.id === sceneId)) throw new Error(`No scene with id ${sceneId}`);
	const next =
		edit === "remove"
			? scenes.filter((scene) => scene.id !== sceneId)
			: scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...edit } : scene));
	const scope = (d: TimelineDoc) => ({ mediaAssets: [], doc: d, slides: [], posts: [] });
	// Both sides normalized the same way, so a document the editor has not yet
	// normalized does not turn one scene's edit into an edit of every scene.
	const command = diffScopeToCommand(
		scope(rebuildDocWith(doc, { scenes: resequenceScenes(scenes) })),
		scope(rebuildDocWith(doc, { scenes: resequenceScenes(next) })),
	);
	if (command.type === "scope.replace")
		throw new Error(`scene ${sceneId} edit could not be expressed as clip and marker commands`);
	return command;
}
