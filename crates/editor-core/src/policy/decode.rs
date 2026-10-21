//! Hand decoders for the policy inputs. Every input is parsed once into a
//! `serde_json::Value` and read field by field: derived `Deserialize` impls for
//! these types cost the WASM module more than the policies themselves.

use std::collections::BTreeMap;

use serde_json::Value;

use super::model::{CrossAxis, Item, ItemSource, OverlapStrategy, PlacementPolicy, Refusal, Row, RowMetric, SnapCandidate};
use super::policies::{SnapSettings, Update};

pub type Decoded<T> = Result<T, String>;

pub fn parse(json: &str) -> Decoded<Value> {
    serde_json::from_str(json).map_err(|error| error.to_string())
}

fn field<'a>(value: &'a Value, name: &str) -> Option<&'a Value> {
    value.get(name).filter(|found| !found.is_null())
}

fn number(value: &Value, name: &str) -> Decoded<f64> {
    field(value, name).and_then(Value::as_f64).ok_or_else(|| format!("`{name}` is not a number"))
}

fn optional_number(value: &Value, name: &str) -> Decoded<Option<f64>> {
    field(value, name).map(|found| found.as_f64().ok_or_else(|| format!("`{name}` is not a number"))).transpose()
}

fn text(value: &Value, name: &str) -> Decoded<String> {
    field(value, name).and_then(Value::as_str).map(str::to_owned).ok_or_else(|| format!("`{name}` is not a string"))
}

fn optional_text(value: &Value, name: &str) -> Decoded<Option<String>> {
    field(value, name).map(|found| found.as_str().map(str::to_owned).ok_or_else(|| format!("`{name}` is not a string"))).transpose()
}

fn flag(value: &Value, name: &str) -> bool {
    field(value, name).and_then(Value::as_bool).unwrap_or(false)
}

fn list<'a>(value: &'a Value, name: &str) -> Decoded<&'a [Value]> {
    match field(value, name) {
        None => Ok(&[]),
        Some(found) => found.as_array().map(Vec::as_slice).ok_or_else(|| format!("`{name}` is not an array")),
    }
}

fn source(value: &Value) -> Decoded<ItemSource> {
    Ok(ItemSource {
        in_point_ticks: number(value, "inPointTicks")?,
        available_start_ticks: number(value, "availableStartTicks")?,
        available_end_ticks: number(value, "availableEndTicks")?,
    })
}

fn item(value: &Value) -> Decoded<Item> {
    Ok(Item {
        id: text(value, "id")?,
        row_id: optional_text(value, "rowId")?,
        start_ticks: number(value, "startTicks")?,
        duration_ticks: number(value, "durationTicks")?,
        kind: text(value, "kind")?,
        source: field(value, "source").map(source).transpose()?,
        group_id: optional_text(value, "groupId")?,
        linked_to: list(value, "linkedTo")?.iter().map(|id| id.as_str().map(str::to_owned).ok_or("`linkedTo` holds a non-string")).collect::<Result<_, _>>()?,
    })
}

fn row(value: &Value) -> Decoded<Row> {
    let placement = match text(value, "placement")?.as_str() {
        "magnetic" => PlacementPolicy::Magnetic,
        "free" => PlacementPolicy::Free,
        other => return Err(format!("unknown placement {other:?}")),
    };
    let overlap = match text(value, "overlap")?.as_str() {
        "reject" => OverlapStrategy::Reject,
        "insert" => OverlapStrategy::Insert,
        "overwrite" => OverlapStrategy::Overwrite,
        "permit" => OverlapStrategy::Permit,
        other => return Err(format!("unknown overlap {other:?}")),
    };
    Ok(Row { id: text(value, "id")?, placement, overlap })
}

fn cross_axis(value: &Value) -> Decoded<CrossAxis> {
    let rows = list(value, "rows")?
        .iter()
        .map(|metric| {
            let accepts = field(metric, "accepts")
                .map(|kinds| {
                    kinds
                        .as_array()
                        .ok_or("`accepts` is not an array")
                        .and_then(|kinds| kinds.iter().map(|kind| kind.as_str().map(str::to_owned).ok_or("`accepts` holds a non-string")).collect())
                })
                .transpose()?;
            Ok(RowMetric { id: text(metric, "id")?, height_px: number(metric, "heightPx")?, accepts })
        })
        .collect::<Decoded<Vec<_>>>()?;
    let refusal = match optional_text(value, "refusal")?.as_deref() {
        None | Some("decline") => Refusal::Decline,
        Some("reroute") => Refusal::Reroute,
        Some(other) => return Err(format!("unknown refusal {other:?}")),
    };
    let reroutes = field(value, "reroutes")
        .map(|table| {
            let kinds = table.as_object().ok_or("`reroutes` is not an object")?;
            kinds
                .iter()
                .map(|(kind, rows)| {
                    let rows = rows.as_object().ok_or("a reroute entry is not an object")?;
                    let targets = rows.iter().map(|(refused, target)| (refused.clone(), target.as_str().map(str::to_owned))).collect::<BTreeMap<_, _>>();
                    Ok((kind.clone(), targets))
                })
                .collect::<Decoded<BTreeMap<_, _>>>()
        })
        .transpose()?;
    Ok(CrossAxis { rows, refusal, reroutes })
}

/// `{"rows": […], "items": […], "crossAxis"?: {…}}`.
pub fn state(value: &Value) -> Decoded<(Vec<Row>, Vec<Item>, Option<CrossAxis>)> {
    let rows = list(value, "rows")?.iter().map(row).collect::<Decoded<Vec<_>>>()?;
    let items = list(value, "items")?.iter().map(item).collect::<Decoded<Vec<_>>>()?;
    let axis = field(value, "crossAxis").map(cross_axis).transpose()?;
    Ok((rows, items, axis))
}

pub fn candidates(value: &Value) -> Decoded<Vec<SnapCandidate>> {
    list(value, "candidates")?
        .iter()
        .map(|candidate| Ok(SnapCandidate { ticks: number(candidate, "ticks")?, kind: text(candidate, "kind")?, item_id: optional_text(candidate, "itemId")? }))
        .collect()
}

/// One pointer sample (`MoveUpdate` / `TrimUpdate`).
pub fn update(value: &Value) -> Decoded<Update> {
    let snap = field(value, "snap")
        .map(|settings| {
            Ok::<_, String>(SnapSettings {
                threshold_px: number(settings, "thresholdPx")?,
                scale: number(settings, "scale")?,
                bypass: flag(settings, "bypass"),
            })
        })
        .transpose()?;
    Ok(Update { delta_ticks: number(value, "deltaTicks")?, y_px: optional_number(value, "yPx")?, snap, deliberate: flag(value, "deliberate") })
}
