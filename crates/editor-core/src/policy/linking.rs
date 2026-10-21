//! Items that are one thing to a person: a port of `edit/linking.ts`.

use std::collections::BTreeSet;

use super::model::{Item, MoveEntry, Operation, Place, State, js_max, js_min};
use super::trim::{Edge, EditResult, trim};

/// `expand(state, ids)`: everything that travels with these items, to a fixed point.
pub fn expand(state: &State, ids: &[&str]) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    let mut pending: Vec<String> = ids.iter().map(|id| (*id).to_owned()).collect();
    while let Some(id) = pending.pop() {
        if found.contains(&id) {
            continue;
        }
        let Some(item) = state.item(&id) else { continue };
        found.insert(id.clone());
        pending.extend(item.linked_to.iter().cloned());
        let Some(group) = &item.group_id else { continue };
        for other in state.values() {
            if other.group_id.as_ref() == Some(group) && !found.contains(&other.id) {
                pending.push(other.id.clone());
            }
        }
    }
    found
}

/// `membersOf(state, ids)`: the members in painting order.
pub fn members_of<'a>(state: &'a State, ids: &BTreeSet<String>) -> Vec<&'a Item> {
    // One member is its own painting order; skipping the scan is what keeps a
    // single-item drag independent of the timeline's length.
    if let [only] = ids.iter().collect::<Vec<_>>().as_slice() {
        return state.item(only).into_iter().collect();
    }
    state.ordered().filter(|item| ids.contains(&item.id)).collect()
}

/// `moveTogether(state, ids, deltaTicks, rowId)`: one delta for every member,
/// clamped once so nothing crosses the start of the timeline.
pub fn move_together(state: &State, ids: &[&str], delta_ticks: f64, row_id: Option<&str>) -> Option<Operation> {
    let members = members_of(state, &expand(state, ids));
    if members.is_empty() {
        return None;
    }
    let earliest = members.iter().map(|member| member.start_ticks).fold(f64::INFINITY, js_min);
    let applied = js_max(delta_ticks, -earliest);
    if applied == 0.0 && row_id.is_none() {
        return None;
    }
    let entries = members
        .iter()
        .map(|member| MoveEntry {
            id: member.id.clone(),
            from: Place { start_ticks: member.start_ticks, row_id: member.row_id.clone() },
            to: Place { start_ticks: member.start_ticks + applied, row_id: row_id.map(str::to_owned).or_else(|| member.row_id.clone()) },
        })
        .collect();
    Some(Operation::Move { entries })
}

/// `trimTogether(state, id, edge, deltaTicks)`: every linked member at the same
/// edge by the smallest delta any of them can take.
pub fn trim_together(state: &State, id: &str, edge: Edge, delta_ticks: f64) -> EditResult {
    let members = members_of(state, &expand(state, &[id]));
    let applied = members
        .iter()
        .map(|member| trim(state, &member.id, edge, delta_ticks).applied_ticks)
        .fold(delta_ticks, |smallest, applied| if applied.abs() < smallest.abs() { applied } else { smallest });
    if applied == 0.0 {
        return EditResult { clamped: true, ..EditResult::default() };
    }
    let mut trims = Vec::new();
    let mut clamped = false;
    for member in &members {
        let result = trim(state, &member.id, edge, applied);
        trims.extend(result.trims);
        clamped = clamped || result.clamped;
    }
    EditResult { trims, moves: vec![], clamped: clamped || applied != delta_ticks, applied_ticks: applied, reason: None }
}
