/* Reference UI barrel. Implementations split by concern under ./references/:
 *   - reference-writes : the four fire-and-forget persist* calls
 *   - ref-transforms   : pure ref/product transforms
 *   - tiers.ts         : workspace -> project -> scene scope rules (pure)
 *   - library.tsx      : ReferenceLibrary, the one browse/edit surface
 *   - entity-editor.tsx: the one entity form (role, label, description, image)
 *   - scene-cast.tsx   : SceneCastPicker, casting from the project's selection
 *   - panels.tsx       : VoicePicker
 * Import paths into this module stay stable for all existing consumers. */
export * from "@api/reference-writes.ts";
export * from "@models/references/ref-transforms.ts";
export * from "@models/references/tiers.ts";
export * from "@components/references/reference-library.tsx";
export * from "@components/references/entity-editor.tsx";
export * from "@components/references/scene-cast.tsx";
export * from "@components/references/panels.tsx";
