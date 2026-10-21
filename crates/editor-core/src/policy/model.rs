//! The policy model: the timeline as the edit policies read it, and what they
//! produce. A port of the parts of `packages/vui/src/kernel/model/types.ts` and
//! `edit/operations.ts` the policies touch.
//!
//! Ticks are f64 because the TS computes in JavaScript numbers; every value the
//! policies produce is an integer whenever their inputs are, exactly as in TS.

use std::collections::BTreeMap;

use serde::Serialize;

/// The media behind an item, in its own ticks (`ItemSource`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSource {
    pub in_point_ticks: f64,
    pub available_start_ticks: f64,
    pub available_end_ticks: f64,
}

/// One thing on the timeline (`TimelineItem`, time and identity only).
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub id: String,
    pub row_id: Option<String>,
    pub start_ticks: f64,
    pub duration_ticks: f64,
    pub kind: String,
    pub source: Option<ItemSource>,
    pub group_id: Option<String>,
    pub linked_to: Vec<String>,
}

impl Item {
    pub fn end_ticks(&self) -> f64 {
        self.start_ticks + self.duration_ticks
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlacementPolicy {
    Magnetic,
    Free,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverlapStrategy {
    Reject,
    Insert,
    Overwrite,
    Permit,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub id: String,
    pub placement: PlacementPolicy,
    pub overlap: OverlapStrategy,
}

/// The cross axis as data (`CrossAxisAdapter` without callbacks): row heights,
/// which kinds each row takes, and where a refused item goes.
#[derive(Clone, Debug, PartialEq)]
pub struct CrossAxis {
    pub rows: Vec<RowMetric>,
    pub refusal: Refusal,
    /// `kind → refused row → destination`, the host's own reroute rule
    /// precomputed. Absent means the default: the nearest accepting row.
    pub reroutes: Option<BTreeMap<String, BTreeMap<String, Option<String>>>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RowMetric {
    pub id: String,
    pub height_px: f64,
    /// The kinds this row takes; absent means every kind.
    pub accepts: Option<Vec<String>>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Refusal {
    #[default]
    Decline,
    Reroute,
}

/// `TimelineState`, as the policies read it. The base of a transaction never
/// changes, so the orders the policies read on every pointer sample — painting
/// order, and each row's items by start — are resolved once, here.
#[derive(Clone, Debug)]
pub struct State {
    pub rows: Vec<Row>,
    pub items: Vec<Item>,
    index: BTreeMap<String, usize>,
    /// `state.order` resolved through `state.items`.
    ordered: Vec<usize>,
    /// `state.items.values()`: insertion order, a later duplicate winning.
    values: Vec<usize>,
    /// `rowItems(state, rowId)` for every row: `order`, filtered, stable-sorted by start.
    by_row: BTreeMap<Option<String>, Vec<usize>>,
    pub cross_axis: Option<CrossAxis>,
}

impl State {
    pub fn from_json(json: &str) -> Result<Self, String> {
        let (rows, items, cross_axis) = super::decode::state(&super::decode::parse(json)?)?;
        Ok(State::new(rows, items, cross_axis))
    }

    pub fn new(rows: Vec<Row>, items: Vec<Item>, cross_axis: Option<CrossAxis>) -> Self {
        let mut index = BTreeMap::new();
        for (position, item) in items.iter().enumerate() {
            // A later duplicate replaces an earlier one, as `Map.set` does.
            index.insert(item.id.clone(), position);
        }
        let ordered: Vec<usize> = items.iter().filter_map(|item| index.get(&item.id).copied()).collect();
        let values: Vec<usize> = (0..items.len()).filter(|position| index.get(&items[*position].id) == Some(position)).collect();
        let mut by_row: BTreeMap<Option<String>, Vec<usize>> = BTreeMap::new();
        for &position in &ordered {
            by_row.entry(items[position].row_id.clone()).or_default().push(position);
        }
        for bucket in by_row.values_mut() {
            bucket.sort_by(|a, b| items[*a].start_ticks.partial_cmp(&items[*b].start_ticks).unwrap_or(std::cmp::Ordering::Equal));
        }
        State { rows, items, index, ordered, values, by_row, cross_axis }
    }

    pub fn item(&self, id: &str) -> Option<&Item> {
        self.index.get(id).map(|&position| &self.items[position])
    }

    pub fn values(&self) -> impl Iterator<Item = &Item> {
        self.values.iter().map(|&position| &self.items[position])
    }

    pub fn ordered(&self) -> impl Iterator<Item = &Item> {
        self.ordered.iter().map(|&position| &self.items[position])
    }

    /// The row's items in start order (`rowItems`).
    pub fn row_items(&self, row_id: Option<&str>) -> Vec<&Item> {
        self.by_row.get(&row_id.map(str::to_owned)).map_or_else(Vec::new, |bucket| bucket.iter().map(|&position| &self.items[position]).collect())
    }

    pub fn row(&self, id: &str) -> Option<&Row> {
        self.rows.iter().find(|row| row.id == id)
    }
}

/// Where an item sits (`Placement`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub start_ticks: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_id: Option<String>,
}

/// What an item covers (`Span`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub start_ticks: f64,
    pub duration_ticks: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_in_ticks: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MoveEntry {
    pub id: String,
    pub from: Place,
    pub to: Place,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TrimEntry {
    pub id: String,
    pub from: Span,
    pub to: Span,
}

/// An item as an operation or projection reports it: identity and time.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemOut {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_id: Option<String>,
    pub start_ticks: f64,
    pub duration_ticks: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_in_ticks: Option<f64>,
}

impl From<&Item> for ItemOut {
    fn from(item: &Item) -> Self {
        ItemOut {
            id: item.id.clone(),
            row_id: item.row_id.clone(),
            start_ticks: item.start_ticks,
            duration_ticks: item.duration_ticks,
            source_in_ticks: item.source.as_ref().map(|source| source.in_point_ticks),
        }
    }
}

/// A committed edit (`Operation`), limited to what the policies produce.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Operation {
    Move { entries: Vec<MoveEntry> },
    Reshape { entries: Vec<TrimEntry> },
    Remove { items: Vec<ItemOut> },
    Composite { operations: Vec<Operation> },
}

/// Somewhere an edit may prefer to land (`SnapCandidate`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapCandidate {
    pub ticks: f64,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
}

/// The in-flight result of an interaction (`Projection`): only the items the
/// edit changes, in the order the TS map holds them.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    pub items: Vec<ItemOut>,
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_row: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_refused: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapped_to: Option<SnapCandidate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clamped: Option<bool>,
}

impl Projection {
    pub fn empty() -> Self {
        Projection { valid: true, ..Projection::default() }
    }

    pub fn item(&self, id: &str) -> Option<&ItemOut> {
        self.items.iter().find(|item| item.id == id)
    }

    /// `Map.set`: an existing id keeps its position and takes the new value.
    pub fn set(&mut self, item: ItemOut) {
        match self.items.iter_mut().find(|existing| existing.id == item.id) {
            Some(existing) => *existing = item,
            None => self.items.push(item),
        }
    }
}

/// `!(a < b)`: the negation of the TS `a < b` guards, which is not `a >= b` when
/// either side is `NaN`, so it is kept as written rather than simplified.
#[allow(clippy::neg_cmp_op_on_partial_ord)]
pub fn not_before(a: f64, b: f64) -> bool {
    !(a < b)
}

/// `Math.min(a, b)` with JavaScript's `NaN` rule.
pub fn js_min(a: f64, b: f64) -> f64 {
    crate::keyframes::js_min(a, b)
}

/// `Math.max(a, b)` with JavaScript's `NaN` rule.
pub fn js_max(a: f64, b: f64) -> f64 {
    crate::keyframes::js_max(a, b)
}
