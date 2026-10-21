/* A saved clip composition's shape.
 *
 * Re-exported from `@maleo/shared`, where `compositionConfigSchema` defines it,
 * rather than declared a second time here. The local copy drifted the moment the
 * schema landed — its `params` stayed a dictionary and its overlay list was a
 * separate structural type the compiler had no reason to reconcile. The module
 * that loads and saves one lives in clip-templates/state/. */
export type { CompositionConfig, CompositionOverlayJson } from "@maleo/shared";
