/* The document handle rule calls name (`p1-envelope-inspector` design I2).
 *
 * Inspector, keying and canvas rules read the document inside the engine. One
 * follower handle per engine holds the last document asked about and is
 * reopened only when another document is asked about, so repeated reads of the
 * same document admit it once. The other parts of the scope are fixed empty
 * lists: these rules read only the document. */
import { editorEngine } from "./engine-registry.ts";
import { engineExecutor, type EngineExecutor } from "./engine-executor.ts";
import type { Engine } from "./engine.ts";
import type { EditorDoc, EditScope } from "./scope.ts";

const NONE: never[] = [];
const scopes = new WeakMap<EditorDoc, EditScope>();
let follower: { engine: Engine; executor: EngineExecutor } | undefined;

/** `doc` as the scope the follower compares by identity. */
export function documentScope(doc: EditorDoc): EditScope {
	let scope = scopes.get(doc);
	if (!scope) {
		scope = { doc, slides: NONE, posts: NONE, mediaAssets: NONE };
		scopes.set(doc, scope);
	}
	return scope;
}

/** A handle holding `doc` in `engine`. */
export function documentHandle(doc: EditorDoc, engine: Engine = editorEngine()): number {
	if (follower?.engine !== engine) follower = { engine, executor: engineExecutor(engine) };
	return follower.executor.handleFor(documentScope(doc));
}
