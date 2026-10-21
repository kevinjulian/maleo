/* Maleo — scene CRUD for the timeline editor. The reel is sequential, so every
 * add/insert/duplicate/remove/reorder re-sequences the scene starts. Lifted out
 * so the editor holds state, not scene-array plumbing. */
import type { Dispatch, SetStateAction } from "react";
import type { Scene } from "@maleo/shared";
import { resequenceScenes } from "@maleo/shared";
import { sceneInsertIndex } from "@models/timeline/timeline-clips.ts";

export interface SceneOps {
	addScene: () => void;
	addSceneAt: (t: number) => void;
	dupScene: (s: Scene) => void;
	rmScene: (id: number) => void;
	reorder: (fromId: number, toId: number) => void;
	/** Patch one field of one scene, re-sequencing the reel. */
	upd: (id: number, f: keyof Scene, v: unknown) => void;
	/** A media URL dropped from All Media / Stock becomes a new scene's frame. */
	addSceneWithMedia: (url: string, mediaAssetId?: string) => void;
}

export function useSceneOps(input: {
	scenes: Scene[];
	setScenes: Dispatch<SetStateAction<Scene[]>>;
	setPreviewSceneId: Dispatch<SetStateAction<number | undefined>>;
	setEditorSceneId: Dispatch<SetStateAction<number | undefined>>;
	editorSceneId: number | undefined;
	firstCastId: string | undefined;
}): SceneOps {
	const { scenes, setScenes, setPreviewSceneId, setEditorSceneId, editorSceneId, firstCastId } =
		input;

	const newSceneDefaults = (): Scene => ({
		id: Date.now(),
		dur: 3,
		name: "New Scene",
		shot: "Medium Shot",
		move: "Static",
		transition: "fade",
		vis: "",
		vo: "",
		castId: firstCastId,
		img: false,
		refIds: [],
		voiceIds: [],
		noteIds: [],
	});
	const upd = (id: number, f: keyof Scene, v: unknown): void =>
		setScenes((ss) => resequenceScenes(ss.map((s) => (s.id === id ? { ...s, [f]: v } : s))));

	const addSceneWithMedia = (url: string, mediaAssetId?: string): void => {
		if (!url) return;
		const ns: Scene = { ...newSceneDefaults(), img: true, src: url, mediaAssetId };
		setScenes((ss) => resequenceScenes([...ss, ns]));
		setPreviewSceneId(ns.id);
	};

	const addScene = (): void => {
		const ns = newSceneDefaults();
		setScenes((ss) => resequenceScenes([...ss, ns]));
		setPreviewSceneId(ns.id);
		setEditorSceneId(ns.id);
	};
	// Splice a new scene INTO the reel at time t (right-click → Add scene). The reel
	// is sequential, so later scenes ripple right by the new scene's duration.
	const addSceneAt = (t: number): void => {
		const ns = newSceneDefaults();
		setScenes((ss) => {
			const idx = sceneInsertIndex(
				ss.map((s) => ({ start: s.start, dur: Math.max(1, s.dur) })),
				t,
			);
			const a = [...ss];
			a.splice(idx, 0, ns);
			return resequenceScenes(a);
		});
		setPreviewSceneId(ns.id);
		setEditorSceneId(ns.id);
	};
	const dupScene = (s: Scene): void => {
		const ns: Scene = { ...s, id: Date.now(), img: false, src: undefined, endSrc: undefined };
		setScenes((ss) => {
			const i = ss.findIndex((x) => x.id === s.id);
			const a = [...ss];
			a.splice(i + 1, 0, ns);
			return resequenceScenes(a);
		});
		setPreviewSceneId(ns.id);
	};
	const rmScene = (id: number): void => {
		if (scenes.length <= 1) return;
		setScenes((ss) => resequenceScenes(ss.filter((s) => s.id !== id)));
		if (editorSceneId === id) setEditorSceneId(undefined);
	};

	// Drag-to-reorder video clips: reinsert the dragged scene at the drop target.
	const reorder = (fromId: number, toId: number): void => {
		if (fromId === toId) return;
		setScenes((ss) => {
			const from = ss.findIndex((s) => s.id === fromId);
			const to = ss.findIndex((s) => s.id === toId);
			if (from < 0 || to < 0) return ss;
			const a = [...ss];
			const [moved] = a.splice(from, 1);
			a.splice(to, 0, moved);
			return resequenceScenes(a);
		});
	};
	return { addScene, addSceneAt, dupScene, rmScene, reorder, upd, addSceneWithMedia };
}
