//! The cross axis and snapping: `resolveRow` and the data-driven half of
//! `createCrossAxis` (`edit/cross-axis.ts`), and `snap` (`edit/gestures.ts`).

use std::collections::BTreeSet;

use super::model::{CrossAxis, Item, Refusal, SnapCandidate, js_max};

impl CrossAxis {
    /// The row containing `y_px`: a walk over cumulative offsets, never a
    /// division by a uniform height.
    pub fn row_at(&self, y_px: f64) -> Option<&str> {
        if y_px < 0.0 {
            return None;
        }
        let mut top = 0.0;
        for metric in &self.rows {
            let bottom = top + js_max(0.0, metric.height_px);
            if y_px >= top && y_px < bottom {
                return Some(&metric.id);
            }
            top = bottom;
        }
        None
    }

    pub fn accepts(&self, row_id: &str, item: &Item) -> bool {
        self.rows.iter().find(|metric| metric.id == row_id).and_then(|metric| metric.accepts.as_ref()).is_none_or(|kinds| kinds.contains(&item.kind))
    }

    /// Where a rerouting axis sends a refused item: the host's table when it
    /// gave one, otherwise the nearest accepting row counted in rows.
    pub fn reroute(&self, item: &Item, refused: &str) -> Option<String> {
        if let Some(table) = &self.reroutes {
            return table.get(&item.kind).and_then(|rows| rows.get(refused)).cloned().flatten();
        }
        let order: Vec<&str> = self.rows.iter().map(|metric| metric.id.as_str()).collect();
        let from = order.iter().position(|id| *id == refused)?;
        for distance in 1..order.len() {
            let before = from.checked_sub(distance).map(|index| order[index]);
            let after = order.get(from + distance).copied();
            for candidate in [before, after].into_iter().flatten() {
                if self.accepts(candidate, item) {
                    return Some(candidate.to_owned());
                }
            }
        }
        None
    }
}

/// What the cross axis decided for one edit (`RowResolution`).
#[derive(Clone, Debug, PartialEq)]
pub struct RowResolution {
    pub resolved: Option<String>,
    pub refused: bool,
    pub destination: Option<String>,
}

/// `resolveRow(adapter, yPx, item)`. No axis is the single-row consumer.
pub fn resolve_row(axis: Option<&CrossAxis>, y_px: f64, item: &Item) -> RowResolution {
    let none = RowResolution { resolved: None, refused: false, destination: None };
    let Some(axis) = axis else { return none };
    let Some(resolved) = axis.row_at(y_px) else { return none };
    if axis.accepts(resolved, item) {
        return RowResolution { resolved: Some(resolved.to_owned()), refused: false, destination: Some(resolved.to_owned()) };
    }
    let destination = match axis.refusal {
        Refusal::Reroute => axis.reroute(item, resolved),
        Refusal::Decline => None,
    };
    RowResolution { resolved: Some(resolved.to_owned()), refused: true, destination }
}

/// How snapping behaves for one edit (`SnapOptions`).
pub struct SnapOptions<'a> {
    pub threshold_px: f64,
    pub scale: f64,
    pub moving: Option<&'a BTreeSet<String>>,
    pub bypass: bool,
}

/// `snap(ticks, candidates, options)`: the nearest candidate within the
/// threshold, the first winning a tie, a moving item's own candidates excluded.
pub fn snap(ticks: f64, candidates: &[SnapCandidate], options: &SnapOptions) -> (f64, Option<SnapCandidate>) {
    if options.bypass {
        return (ticks, None);
    }
    let threshold_ticks = options.threshold_px / options.scale;
    let mut best: Option<&SnapCandidate> = None;
    let mut best_distance = f64::INFINITY;
    for candidate in candidates {
        if candidate.item_id.as_ref().is_some_and(|id| options.moving.is_some_and(|moving| moving.contains(id))) {
            continue;
        }
        let distance = (candidate.ticks - ticks).abs();
        // `distance > thresholdTicks` skips; a NaN distance falls through as in JS.
        if distance > threshold_ticks {
            continue;
        }
        if distance < best_distance {
            best = Some(candidate);
            best_distance = distance;
        }
    }
    match best {
        Some(candidate) => (candidate.ticks, Some(candidate.clone())),
        None => (ticks, None),
    }
}
