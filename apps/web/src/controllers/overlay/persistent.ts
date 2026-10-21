/* The marker an overlay's background pass leaves alone.
 *
 * Internal on purpose, and NOT re-exported from `./index.tsx`: a consumer who
 * set this on their own body child would opt that subtree out of every overlay's
 * background, which is not something the package can promise to keep working.
 * It exists for the workspace's mobile action region, whose whole purpose is to
 * be the way out of a sheet.
 *
 * Its own module because `overlay.tsx` and `workspace.tsx` both need it and
 * `index.tsx` re-exports everything either of them exports.
 */
export const VUI_PERSISTENT_ATTRIBUTE = "data-vui-persistent";
