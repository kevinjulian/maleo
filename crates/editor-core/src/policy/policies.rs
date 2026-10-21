//! The move and trim policies over the transaction: a port of
//! `edit/policies.ts`. Everything a policy decides is in the projection before
//! the commit.

use super::axis::{SnapOptions, resolve_row, snap};
use super::linking::{expand, members_of, move_together, trim_together};
use super::model::{ItemOut, Operation, OverlapStrategy, Projection, SnapCandidate, State};
use super::placement::{OverlapOptions, overlap_operations, resolve_overlap, row_items};
use super::trim::{Edge, EditResult, ripple, roll, slide, slip, to_operation};

/// Snapping for one sample (`Pick<SnapOptions, "thresholdPx" | "scale" | "bypass">`).
#[derive(Clone, Debug)]
pub struct SnapSettings {
    pub threshold_px: f64,
    pub scale: f64,
    pub bypass: bool,
}

/// What a gesture is (`MoveIntent` / `TrimIntent`). Decoded by hand from
/// `{"policy": "move" | "trim", …}`: a derived internally tagged enum buffers
/// through serde's generic content tree, which cost the WASM module its budget.
#[derive(Clone, Debug)]
pub enum Intent {
    Move {
        id: String,
        candidates: Vec<SnapCandidate>,
        /// Use the session's cross axis, as passing `crossAxis` does in TS.
        cross_axis: bool,
    },
    Trim {
        id: String,
        edge: Edge,
        kind: TrimKind,
        neighbour_id: Option<String>,
        candidates: Vec<SnapCandidate>,
    },
}

impl Intent {
    pub fn from_value(value: serde_json::Value) -> Result<Self, String> {
        let text = |name: &str| value.get(name).and_then(serde_json::Value::as_str).map(str::to_owned);
        let id = text("id").ok_or("an intent needs a string `id`")?;
        let candidates = super::decode::candidates(&value)?;
        match text("policy").as_deref() {
            Some("move") => Ok(Intent::Move { id, candidates, cross_axis: value.get("crossAxis").and_then(serde_json::Value::as_bool).unwrap_or(false) }),
            Some("trim") => {
                let edge = match text("edge").as_deref() {
                    Some("start") => Edge::Start,
                    Some("end") => Edge::End,
                    other => return Err(format!("unknown edge {other:?}")),
                };
                let kind = match text("kind").as_deref() {
                    Some("trim") => TrimKind::Trim,
                    Some("ripple") => TrimKind::Ripple,
                    Some("roll") => TrimKind::Roll,
                    Some("slip") => TrimKind::Slip,
                    Some("slide") => TrimKind::Slide,
                    other => return Err(format!("unknown trim kind {other:?}")),
                };
                Ok(Intent::Trim { id, edge, kind, neighbour_id: text("neighbourId"), candidates })
            }
            other => Err(format!("unknown policy {other:?}")),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrimKind {
    Trim,
    Ripple,
    Roll,
    Slip,
    Slide,
}

/// One sample of a gesture (`MoveUpdate` / `TrimUpdate`).
#[derive(Clone, Debug)]
pub struct Update {
    pub delta_ticks: f64,
    pub y_px: Option<f64>,
    pub snap: Option<SnapSettings>,
    pub deliberate: bool,
}

fn missing(id: &str) -> Projection {
    Projection { valid: false, reason: Some(format!("@maleo/vui: {id} is not in this timeline")), ..Projection::default() }
}

fn overlap_of(state: &State, row_id: Option<&str>) -> OverlapStrategy {
    row_id.and_then(|id| state.row(id)).map_or(OverlapStrategy::Permit, |row| row.overlap)
}

/// `movePolicy().project`.
pub fn project_move(state: &State, id: &str, candidates: &[SnapCandidate], cross_axis: bool, update: &Update) -> Projection {
    let Some(subject) = state.item(id) else { return missing(id) };
    let moving = expand(state, &[id]);
    let members = members_of(state, &moving);
    let proposed = subject.start_ticks + update.delta_ticks;
    let (snapped, candidate) = match &update.snap {
        Some(settings) => snap(
            proposed,
            candidates,
            &SnapOptions { threshold_px: settings.threshold_px, scale: settings.scale, moving: Some(&moving), bypass: settings.bypass },
        ),
        None => (proposed, None),
    };
    let delta = super::model::js_max(snapped, 0.0) - subject.start_ticks;
    let axis = if cross_axis { state.cross_axis.as_ref() } else { None };
    let row = resolve_row(axis, update.y_px.unwrap_or(0.0), subject);
    let destination = if update.y_px.is_none() { subject.row_id.clone() } else { row.destination.clone() };

    let mut projection = Projection { valid: true, ..Projection::default() };
    for member in members {
        let mut moved = ItemOut::from(member);
        moved.start_ticks = member.start_ticks + delta;
        // Only the item under the pointer changes row; an item moved off every row drops `rowId`.
        if member.id == id {
            moved.row_id = destination.clone();
        }
        projection.set(moved);
    }
    let overlap = resolve_overlap(
        state,
        destination.as_deref(),
        subject.start_ticks + delta,
        subject.duration_ticks,
        overlap_of(state, destination.as_deref()),
        &OverlapOptions { deliberate: update.deliberate, moving: Some(&moving) },
    );
    let declined = row.refused && row.destination.is_none();
    projection.valid = overlap.valid && !declined;
    projection.reason =
        if declined { Some(format!("@maleo/vui: row {} does not accept {id}", row.resolved.as_deref().unwrap_or("undefined"))) } else { overlap.reason };
    projection.destination_row = destination;
    projection.row_refused = row.refused.then_some(true);
    projection.snapped_to = candidate;
    projection
}

/// `movePolicy().toOperation`.
pub fn move_operation(state: &State, id: &str, projection: &Projection) -> Option<Operation> {
    let subject = state.item(id)?;
    let moved = projection.item(id)?;
    let delta = moved.start_ticks - subject.start_ticks;
    let destination = projection.destination_row.as_deref();
    let shift = move_together(state, &[id], delta, destination)?;
    let moving = expand(state, &[id]);
    let overlap = resolve_overlap(
        state,
        destination,
        moved.start_ticks,
        subject.duration_ticks,
        overlap_of(state, destination),
        &OverlapOptions { deliberate: false, moving: Some(&moving) },
    );
    let consequences = overlap_operations(&overlap);
    if consequences.is_empty() {
        return Some(shift);
    }
    Some(Operation::Composite { operations: std::iter::once(shift).chain(consequences).collect() })
}

fn apply_edit(state: &State, id: &str, edge: Edge, kind: TrimKind, neighbour: Option<&str>, delta: f64) -> EditResult {
    match kind {
        TrimKind::Ripple => ripple(state, id, edge, delta),
        TrimKind::Roll => match neighbour {
            None => EditResult { reason: Some("@maleo/vui: a roll needs the item on the other side of the boundary".to_owned()), ..EditResult::default() },
            Some(neighbour) => roll(state, id, neighbour, delta),
        },
        TrimKind::Slip => slip(state, id, delta),
        TrimKind::Slide => slide(state, id, delta),
        TrimKind::Trim => trim_together(state, id, edge, delta),
    }
}

/// `projectEntries(base, result)`: trims, then moves, laid over the base.
fn project_entries(state: &State, result: &EditResult) -> Projection {
    let mut projection = Projection { valid: true, ..Projection::default() };
    for entry in &result.trims {
        let Some(item) = state.item(&entry.id) else { continue };
        let mut out = ItemOut::from(item);
        out.start_ticks = entry.to.start_ticks;
        out.duration_ticks = entry.to.duration_ticks;
        if item.source.is_some()
            && let Some(source_in) = entry.to.source_in_ticks
        {
            out.source_in_ticks = Some(source_in);
        }
        projection.set(out);
    }
    for entry in &result.moves {
        let Some(item) = state.item(&entry.id) else { continue };
        let mut out = ItemOut::from(item);
        out.start_ticks = entry.to.start_ticks;
        out.row_id = entry.to.row_id.clone();
        projection.set(out);
    }
    projection
}

/// `trimPolicy().project`.
pub fn project_trim(state: &State, id: &str, edge: Edge, kind: TrimKind, neighbour: Option<&str>, candidates: &[SnapCandidate], update: &Update) -> Projection {
    let Some(subject) = state.item(id) else { return missing(id) };
    let edge_ticks = match edge {
        Edge::Start => subject.start_ticks,
        Edge::End => subject.start_ticks + subject.duration_ticks,
    };
    let proposed = edge_ticks + update.delta_ticks;
    let (snapped, candidate) = match &update.snap {
        Some(settings) => {
            let moving = expand(state, &[id]);
            snap(
                proposed,
                candidates,
                &SnapOptions { threshold_px: settings.threshold_px, scale: settings.scale, moving: Some(&moving), bypass: settings.bypass },
            )
        }
        None => (proposed, None),
    };
    let result = apply_edit(state, id, edge, kind, neighbour, snapped - edge_ticks);
    let mut projection = project_entries(state, &result);
    projection.valid = !result.trims.is_empty() || !result.moves.is_empty();
    projection.reason = result.reason;
    projection.snapped_to = candidate;
    projection.clamped = result.clamped.then_some(true);
    projection
}

/// `trimPolicy().toOperation`.
pub fn trim_operation(state: &State, id: &str, edge: Edge, kind: TrimKind, neighbour: Option<&str>, projection: &Projection) -> Option<Operation> {
    let subject = state.item(id)?;
    let edited = projection.item(id)?;
    let subject_in = subject.source.as_ref().map(|source| source.in_point_ticks);
    let delta = match kind {
        TrimKind::Slip => edited.source_in_ticks.unwrap_or(0.0) - subject_in.unwrap_or(0.0),
        TrimKind::Slide => edited.start_ticks - subject.start_ticks,
        _ if edge == Edge::Start => edited.start_ticks - subject.start_ticks,
        _ => edited.duration_ticks - subject.duration_ticks,
    };
    to_operation(&apply_edit(state, id, edge, kind, neighbour, delta))
}

/// `rowEdgeCandidates(state, rowId)`.
pub fn row_edge_candidates(state: &State, row_id: Option<&str>) -> Vec<SnapCandidate> {
    row_items(state, row_id)
        .into_iter()
        .flat_map(|item| {
            [
                SnapCandidate { ticks: item.start_ticks, kind: "item-start".to_owned(), item_id: Some(item.id.clone()) },
                SnapCandidate { ticks: item.start_ticks + item.duration_ticks, kind: "item-end".to_owned(), item_id: Some(item.id.clone()) },
            ]
        })
        .collect()
}
