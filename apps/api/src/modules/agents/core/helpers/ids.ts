/* Shared id generation for agent-created clips.
 * One source for the "fresh numeric clip id" pattern (was duplicated inline). */

// A collision-resistant numeric id for a newly created clip/overlay. Time-based
// with a small random suffix so several created in the same ms don't collide.
export function freshClipId(): number {
	return Date.now() + Math.floor(Math.random() * 1000);
}
