//! Trim, ripple, roll, slip and slide: a port of `edit/trim.ts`. Each returns
//! entries rather than applying anything, so a projection and the committed
//! operation come from one computation.

use super::model::{Item, MoveEntry, Operation, Place, Span, State, TrimEntry, js_max, js_min, not_before};
use super::placement::row_items;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edge {
    Start,
    End,
}

/// What an edit produced, and whether the media let it happen in full (`EditResult`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EditResult {
    pub trims: Vec<TrimEntry>,
    pub moves: Vec<MoveEntry>,
    pub clamped: bool,
    pub applied_ticks: f64,
    pub reason: Option<String>,
}

fn nothing() -> EditResult {
    EditResult::default()
}

pub fn span_of(item: &Item) -> Span {
    Span { start_ticks: item.start_ticks, duration_ticks: item.duration_ticks, source_in_ticks: item.source.as_ref().map(|source| source.in_point_ticks) }
}

/// `clampToSource(item, edge, deltaTicks)`: how far this edge may travel, and
/// whether the media stopped it short. A duration never reaches zero.
pub fn clamp_to_source(item: &Item, edge: Edge, delta_ticks: f64) -> (f64, bool) {
    let mut delta = delta_ticks;
    if let Some(source) = &item.source {
        match edge {
            Edge::Start => {
                let room = source.in_point_ticks - source.available_start_ticks;
                if delta < -room {
                    delta = -room;
                }
            }
            Edge::End => {
                let out_point = source.in_point_ticks + item.duration_ticks;
                let room = source.available_end_ticks - out_point;
                if delta > room {
                    delta = room;
                }
            }
        }
    }
    let resulting = match edge {
        Edge::Start => item.duration_ticks - delta,
        Edge::End => item.duration_ticks + delta,
    };
    if resulting <= 0.0 {
        delta = match edge {
            Edge::Start => item.duration_ticks - 1.0,
            Edge::End => 1.0 - item.duration_ticks,
        };
    }
    // `delta === 0 ? 0 : delta` normalizes the negative zero `-room` produces.
    (if delta == 0.0 { 0.0 } else { delta }, delta != delta_ticks)
}

/// One edge of one item. Nothing else changes.
pub fn trim(state: &State, id: &str, edge: Edge, delta_ticks: f64) -> EditResult {
    let Some(item) = state.item(id) else { return nothing() };
    let (applied, clamped) = clamp_to_source(item, edge, delta_ticks);
    if applied == 0.0 {
        return EditResult { clamped, ..nothing() };
    }
    let from = span_of(item);
    let to = match edge {
        Edge::Start => Span {
            start_ticks: from.start_ticks + applied,
            duration_ticks: from.duration_ticks - applied,
            source_in_ticks: from.source_in_ticks.map(|source_in| source_in + applied),
        },
        Edge::End => Span { duration_ticks: from.duration_ticks + applied, ..from.clone() },
    };
    EditResult { trims: vec![TrimEntry { id: id.to_owned(), from, to }], moves: vec![], clamped, applied_ticks: applied, reason: None }
}

/// One edge, and every later item on the row shifts by the same delta.
pub fn ripple(state: &State, id: &str, edge: Edge, delta_ticks: f64) -> EditResult {
    let Some(item) = state.item(id) else { return nothing() };
    let trimmed = trim(state, id, edge, delta_ticks);
    if trimmed.trims.is_empty() {
        return trimmed;
    }
    let shift = match edge {
        Edge::Start => -trimmed.applied_ticks,
        Edge::End => trimmed.applied_ticks,
    };
    let boundary = item.end_ticks();
    let moves = row_items(state, item.row_id.as_deref())
        .into_iter()
        .filter(|other| other.id != id && not_before(other.start_ticks, boundary))
        .map(|other| MoveEntry {
            id: other.id.clone(),
            from: Place { start_ticks: other.start_ticks, row_id: other.row_id.clone() },
            to: Place { start_ticks: other.start_ticks + shift, row_id: other.row_id.clone() },
        })
        .collect();
    EditResult { moves, ..trimmed }
}

/// The boundary between two adjacent items; the smaller travel of the two wins.
pub fn roll(state: &State, earlier_id: &str, later_id: &str, delta_ticks: f64) -> EditResult {
    let (Some(earlier), Some(later)) = (state.item(earlier_id), state.item(later_id)) else { return nothing() };
    if earlier.end_ticks() != later.start_ticks {
        return EditResult { reason: Some(format!("@maleo/vui: {earlier_id} and {later_id} do not share a boundary")), ..nothing() };
    }
    let (earlier_delta, earlier_clamped) = clamp_to_source(earlier, Edge::End, delta_ticks);
    let (later_delta, later_clamped) = clamp_to_source(later, Edge::Start, delta_ticks);
    let applied = if earlier_delta.abs() < later_delta.abs() { earlier_delta } else { later_delta };
    if applied == 0.0 {
        return EditResult { clamped: true, ..nothing() };
    }
    let earlier_from = span_of(earlier);
    let later_from = span_of(later);
    EditResult {
        trims: vec![
            TrimEntry {
                id: earlier_id.to_owned(),
                to: Span { duration_ticks: earlier_from.duration_ticks + applied, ..earlier_from.clone() },
                from: earlier_from,
            },
            TrimEntry {
                id: later_id.to_owned(),
                to: Span {
                    start_ticks: later_from.start_ticks + applied,
                    duration_ticks: later_from.duration_ticks - applied,
                    source_in_ticks: later_from.source_in_ticks.map(|source_in| source_in + applied),
                },
                from: later_from,
            },
        ],
        moves: vec![],
        clamped: earlier_clamped || later_clamped || applied != delta_ticks,
        applied_ticks: applied,
        reason: None,
    }
}

/// The source range moves; the position and duration do not.
pub fn slip(state: &State, id: &str, delta_ticks: f64) -> EditResult {
    let Some(item) = state.item(id) else { return nothing() };
    let Some(source) = &item.source else {
        return EditResult { reason: Some(format!("@maleo/vui: {id} has no media to slip")), ..nothing() };
    };
    let applied = if delta_ticks < 0.0 {
        js_max(delta_ticks, source.available_start_ticks - source.in_point_ticks)
    } else {
        js_min(delta_ticks, source.available_end_ticks - (source.in_point_ticks + item.duration_ticks))
    };
    if applied == 0.0 {
        return EditResult { clamped: delta_ticks != 0.0, ..nothing() };
    }
    let from = span_of(item);
    let to = Span { source_in_ticks: Some(from.source_in_ticks.unwrap_or(0.0) + applied), ..from.clone() };
    EditResult { trims: vec![TrimEntry { id: id.to_owned(), from, to }], moves: vec![], clamped: applied != delta_ticks, applied_ticks: applied, reason: None }
}

/// The item moves; its neighbours absorb it at their facing edges; its source is untouched.
pub fn slide(state: &State, id: &str, delta_ticks: f64) -> EditResult {
    let Some(item) = state.item(id) else { return nothing() };
    let siblings = row_items(state, item.row_id.as_deref());
    // `findIndex` is -1 when absent, and `siblings[-2]` / `siblings[0]` follow from it.
    let index = siblings.iter().position(|sibling| sibling.id == id).map_or(-1, |found| found as isize);
    let at = |position: isize| usize::try_from(position).ok().and_then(|position| siblings.get(position).copied());
    let before = at(index - 1);
    let after = at(index + 1);

    let mut applied = delta_ticks;
    if applied < 0.0
        && let Some(before) = before
    {
        applied = js_max(applied, -(before.duration_ticks - 1.0));
    }
    if applied > 0.0
        && let Some(after) = after
    {
        applied = js_min(applied, after.duration_ticks - 1.0);
    }
    if applied == 0.0 {
        return EditResult { clamped: delta_ticks != 0.0, ..nothing() };
    }
    let from = span_of(item);
    let mut trims = vec![TrimEntry { id: id.to_owned(), to: Span { start_ticks: from.start_ticks + applied, ..from.clone() }, from }];
    if let Some(before) = before {
        let before_from = span_of(before);
        trims.push(TrimEntry {
            id: before.id.clone(),
            to: Span { duration_ticks: before_from.duration_ticks + applied, ..before_from.clone() },
            from: before_from,
        });
    }
    if let Some(after) = after {
        let after_from = span_of(after);
        trims.push(TrimEntry {
            id: after.id.clone(),
            to: Span {
                start_ticks: after_from.start_ticks + applied,
                duration_ticks: after_from.duration_ticks - applied,
                source_in_ticks: after_from.source_in_ticks.map(|source_in| source_in + applied),
            },
            from: after_from,
        });
    }
    EditResult { trims, moves: vec![], clamped: applied != delta_ticks, applied_ticks: applied, reason: None }
}

/// `toOperation(result)`: one operation for one edit.
pub fn to_operation(result: &EditResult) -> Option<Operation> {
    let mut operations = Vec::new();
    if !result.trims.is_empty() {
        operations.push(Operation::Reshape { entries: result.trims.clone() });
    }
    if !result.moves.is_empty() {
        operations.push(Operation::Move { entries: result.moves.clone() });
    }
    match operations.len() {
        0 => None,
        1 => operations.pop(),
        _ => Some(Operation::Composite { operations }),
    }
}
