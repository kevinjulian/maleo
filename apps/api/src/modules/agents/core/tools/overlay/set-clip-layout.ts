import { defineTool } from "../../types.ts";
import { setLayoutArgs } from "../../helpers/schemas.ts";
import { defaultClipLayout, type ClipLayout } from "@maleo/shared";
import { sceneEditCommand, updateClip } from "@maleo/shared/editor";
import { clipAt, runDocument, runEdit } from "../../edit-document.ts";

export const setClipLayout = defineTool({
	name: "set_clip_layout",
	kind: "mutate",
	edits: true,
	contentType: ["video"],
	intents: ["edit_element"],
	input: setLayoutArgs,
	description:
		'set_clip_layout { target: "scene"|"video"|"text", index, xPct?, yPct?, widthPct?, heightPct?, fit?, opacity?, rotationDeg? } - place/resize a clip on the canvas (percent of frame); e.g. shrink + offset a scene, or move a text box',
	handler: async (ctx, args) => {
		const patch: Partial<ClipLayout> = {
			...(args.xPct != null ? { xPct: args.xPct } : {}),
			...(args.yPct != null ? { yPct: args.yPct } : {}),
			...(args.widthPct != null ? { widthPct: args.widthPct } : {}),
			...(args.heightPct != null ? { heightPct: args.heightPct } : {}),
			...(args.opacity != null ? { opacity: Math.max(0, Math.min(1, args.opacity)) } : {}),
			...(args.rotationDeg != null ? { rotationDeg: args.rotationDeg } : {}),
			...(args.fit ? { fit: args.fit } : {}),
		};
		const doc = runDocument(ctx.job);
		const clip = clipAt(doc, args.target, args.index);
		const label =
			args.target === "text" ? "text overlay" : args.target === "video" ? "overlay clip" : "scene";
		let layout: ClipLayout;
		// A partial box is completed the way the editor completes it (`normalizeLayout`).
		if (clip.scene) {
			layout = { ...defaultClipLayout("scene"), ...clip.scene.layout, ...patch };
			runEdit(ctx.job, sceneEditCommand(doc, clip.scene.id, { layout }));
		} else {
			const key = clip.text ? "text" : "video";
			const payload = clip[key]!;
			layout = {
				...defaultClipLayout(clip.text ? "text" : clip.type === "video" ? "video" : "image"),
				...payload.layout,
				...patch,
			};
			runEdit(ctx.job, updateClip(clip.id, { [key]: { ...payload, layout } }));
		}
		return {
			note: `Placed ${label} ${args.index + 1} (x ${Math.round(layout.xPct ?? 0)}%, y ${Math.round(layout.yPct ?? 0)}%, w ${Math.round(layout.widthPct ?? 100)}%)`,
		};
	},
});
