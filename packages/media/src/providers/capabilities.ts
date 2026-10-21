/* The content-generation capabilities a provider can implement. A provider
 * declares the subset it supports; selection resolves per-capability, so the
 * user can pick a TTS provider and a different image provider without coupling. */
export const CAPABILITIES = ["image", "tts", "video"] as const;
export type Capability = (typeof CAPABILITIES)[number];
