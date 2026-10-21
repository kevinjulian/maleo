/* Live mirrors of the editing state, for the agent loop.
 *
 * An agent run lasts minutes. Any closure it captured at the start would
 * name-match against the scene list as it was then, so a scene the user added
 * mid-run would be invisible and a rename would be applied to the wrong beat.
 * These refs are read at use time instead, so the loop always sees the current
 * lists and the current style knobs.
 *
 * Split out of `create-content.tsx`.
 */
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { Scene, StyleKnobs } from "@maleo/shared";
import type { Post, Slide } from "@models/content/content-types.ts";

export interface LiveMirrors {
	scenesRef: MutableRefObject<Scene[]>;
	slidesRef: MutableRefObject<Slide[]>;
	postsRef: MutableRefObject<Post[]>;
	/** The chosen Video Director style knobs, so the scene-apply closure
	 *  resolves camera and transition against the current selection. */
	styleRef: MutableRefObject<StyleKnobs | undefined>;
}

export function useLiveMirrors(
	scenes: Scene[],
	slides: Slide[],
	posts: Post[],
	style: StyleKnobs | undefined,
): LiveMirrors {
	const scenesRef = useRef<Scene[]>(scenes);
	useEffect(() => {
		scenesRef.current = scenes;
	}, [scenes]);
	const slidesRef = useRef<Slide[]>(slides);
	useEffect(() => {
		slidesRef.current = slides;
	}, [slides]);
	const postsRef = useRef<Post[]>(posts);
	useEffect(() => {
		postsRef.current = posts;
	}, [posts]);
	const styleRef = useRef<StyleKnobs | undefined>(undefined);
	useEffect(() => {
		styleRef.current = style;
	}, [style]);

	return { scenesRef, slidesRef, postsRef, styleRef };
}
