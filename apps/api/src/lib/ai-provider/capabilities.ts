/* The AI capabilities a provider can implement. Modelled on
 * `packages/media/src/providers/capabilities.ts` (ADR 0002) so both seams
 * resolve the same way. Only `text` exists today; the list is a tuple rather
 * than a bare string so adding (say) `embedding` later is one entry, and
 * selection keeps working per-capability without coupling text to it. */
export const CAPABILITIES = ["text"] as const;
export type Capability = (typeof CAPABILITIES)[number];
