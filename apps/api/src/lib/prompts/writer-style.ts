/* The writer style as narration craft, rendered from its template. */
import type { WriterStyleProfile } from "@maleo/shared";
import { renderPrompt } from "./registry.ts";

export function writerStyleCraftBlock(profile: WriterStyleProfile | undefined): string {
	return renderPrompt("prompt:writer:writerStyleCraftBlock", { profile }).text;
}
