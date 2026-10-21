//! How a row behaves when things land on it: a port of `edit/placement.ts`.

use std::collections::BTreeSet;

use super::model::{Item, ItemOut, MoveEntry, Operation, OverlapStrategy, Place, PlacementPolicy, Row, Span, State, TrimEntry, js_min, not_before};

/// `rowItems(state, rowId)`: the row's items in start order, stable for ties.
pub fn row_items<'a>(state: &'a State, row_id: Option<&str>) -> Vec<&'a Item> {
    state.row_items(row_id)
}

/// `rowOf(state, rowId)`: an item without a row belongs to the only row, if there is one.
fn row_of<'a>(state: &'a State, row_id: Option<&str>) -> Option<&'a Row> {
    match row_id {
        None => (state.rows.len() == 1).then(|| &state.rows[0]),
        Some(id) => state.row(id),
    }
}

/// `removeItem(state, id)`: magnetic rows close the gap in the same operation.
pub fn remove_item(state: &State, id: &str) -> Option<Operation> {
    let item = state.item(id)?;
    let remove = Operation::Remove { items: vec![ItemOut::from(item)] };
    if row_of(state, item.row_id.as_deref()).map(|row| row.placement) != Some(PlacementPolicy::Magnetic) {
        return Some(remove);
    }
    let gap = item.duration_ticks;
    let entries: Vec<MoveEntry> = row_items(state, item.row_id.as_deref())
        .into_iter()
        .filter(|other| other.id != id && not_before(other.start_ticks, item.end_ticks()))
        .map(|other| MoveEntry {
            id: other.id.clone(),
            from: Place { start_ticks: other.start_ticks, row_id: other.row_id.clone() },
            to: Place { start_ticks: other.start_ticks - gap, row_id: other.row_id.clone() },
        })
        .collect();
    if entries.is_empty() {
        return Some(remove);
    }
    Some(Operation::Composite { operations: vec![remove, Operation::Move { entries }] })
}

/// What a row's strategy decided about a proposed placement (`OverlapResolution`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct OverlapResolution {
    pub valid: bool,
    pub reason: Option<String>,
    pub moves: Vec<MoveEntry>,
    pub trims: Vec<TrimEntry>,
    pub removed: Vec<ItemOut>,
    pub overlapping: Vec<String>,
}

pub struct OverlapOptions<'a> {
    pub deliberate: bool,
    pub moving: Option<&'a BTreeSet<String>>,
}

fn span_of(item: &Item) -> Span {
    Span { start_ticks: item.start_ticks, duration_ticks: item.duration_ticks, source_in_ticks: item.source.as_ref().map(|source| source.in_point_ticks) }
}

/// `resolveOverlap(state, rowId, proposed, strategy, options)`: what WOULD happen.
pub fn resolve_overlap(
    state: &State,
    row_id: Option<&str>,
    start_ticks: f64,
    duration_ticks: f64,
    strategy: OverlapStrategy,
    options: &OverlapOptions,
) -> OverlapResolution {
    let moving = |id: &str| options.moving.is_some_and(|moving| moving.contains(id));
    let proposed_end = start_ticks + duration_ticks;
    let hits: Vec<&Item> =
        row_items(state, row_id).into_iter().filter(|item| !moving(&item.id) && item.start_ticks < proposed_end && item.end_ticks() > start_ticks).collect();
    if hits.is_empty() {
        return OverlapResolution { valid: true, ..OverlapResolution::default() };
    }
    let overlapping: Vec<String> = hits.iter().map(|item| item.id.clone()).collect();
    if strategy == OverlapStrategy::Permit || (options.deliberate && strategy != OverlapStrategy::Reject) {
        return OverlapResolution { valid: true, overlapping, ..OverlapResolution::default() };
    }
    match strategy {
        OverlapStrategy::Reject => OverlapResolution {
            valid: false,
            reason: Some(format!("@maleo/vui: this row does not permit overlap, and this position overlaps {}", overlapping.join(", "))),
            overlapping,
            ..OverlapResolution::default()
        },
        OverlapStrategy::Insert => {
            let shift = duration_ticks;
            let first = hits.iter().map(|item| item.start_ticks).fold(f64::INFINITY, js_min);
            let moves = row_items(state, row_id)
                .into_iter()
                .filter(|item| !moving(&item.id) && not_before(item.start_ticks, first))
                .map(|item| MoveEntry {
                    id: item.id.clone(),
                    from: Place { start_ticks: item.start_ticks, row_id: item.row_id.clone() },
                    to: Place { start_ticks: item.start_ticks + shift, row_id: item.row_id.clone() },
                })
                .collect();
            OverlapResolution { valid: true, moves, overlapping, ..OverlapResolution::default() }
        }
        OverlapStrategy::Overwrite => {
            let mut trims = Vec::new();
            let mut removed = Vec::new();
            for item in hits {
                let from = span_of(item);
                if item.start_ticks >= start_ticks && item.end_ticks() <= proposed_end {
                    removed.push(ItemOut::from(item));
                } else if item.start_ticks < start_ticks {
                    let to = Span { duration_ticks: start_ticks - item.start_ticks, ..from.clone() };
                    trims.push(TrimEntry { id: item.id.clone(), from, to });
                } else {
                    let cut = proposed_end - item.start_ticks;
                    let to = Span {
                        start_ticks: proposed_end,
                        duration_ticks: from.duration_ticks - cut,
                        source_in_ticks: from.source_in_ticks.map(|source_in| source_in + cut),
                    };
                    trims.push(TrimEntry { id: item.id.clone(), from, to });
                }
            }
            OverlapResolution { valid: true, trims, removed, overlapping, ..OverlapResolution::default() }
        }
        OverlapStrategy::Permit => unreachable!("permit returned above"),
    }
}

/// `overlapOperations(resolution)`.
pub fn overlap_operations(resolution: &OverlapResolution) -> Vec<Operation> {
    let mut operations = Vec::new();
    if !resolution.moves.is_empty() {
        operations.push(Operation::Move { entries: resolution.moves.clone() });
    }
    if !resolution.trims.is_empty() {
        operations.push(Operation::Reshape { entries: resolution.trims.clone() });
    }
    if !resolution.removed.is_empty() {
        operations.push(Operation::Remove { items: resolution.removed.clone() });
    }
    operations
}

/// `compact(state, rowId)`: a magnetic row re-laid contiguously from its first item.
pub fn compact(state: &State, row_id: Option<&str>) -> Vec<MoveEntry> {
    let items = row_items(state, row_id);
    let mut cursor = items.first().map_or(0.0, |item| item.start_ticks);
    let mut entries = Vec::new();
    for item in items {
        if item.start_ticks != cursor {
            let row_id = row_id.map(str::to_owned);
            entries.push(MoveEntry {
                id: item.id.clone(),
                from: Place { start_ticks: item.start_ticks, row_id: row_id.clone() },
                to: Place { start_ticks: cursor, row_id },
            });
        }
        cursor += item.duration_ticks;
    }
    entries
}
