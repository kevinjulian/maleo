//! Edit policies the host gesture loop calls per pointer sample (task 4.2):
//! the trim family, placement and overlap, linking, snapping and the cross
//! axis, ported from `packages/vui/src/kernel/edit/`. The gesture loop itself —
//! recognizers, thresholds, pixels — stays in the host (design decision 2).

pub mod axis;
pub mod decode;
pub mod linking;
pub mod model;
pub mod placement;
pub mod policies;
pub mod session;
pub mod trim;
