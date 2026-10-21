//! Scoped caption result fencing and protected regeneration. No host state or IO.
use crate::error::{EngineError, EngineResult};
use crate::schema::{Clip, ClipType, EditScope};
use serde_json::Value;

fn invalid(message: &str) -> EngineError {
    EngineError::InvalidInput(format!("Captions: {message}"))
}
fn list<'a>(value: &'a Value, key: &str) -> EngineResult<&'a Vec<Value>> {
    value.get(key).and_then(Value::as_array).ok_or_else(|| invalid("invalid result snapshot"))
}
fn num(value: &Value, key: &str) -> EngineResult<f64> {
    value.get(key).and_then(Value::as_f64).filter(|number| number.is_finite()).ok_or_else(|| invalid("invalid result interval"))
}
/// JSON number representations do not constitute an edit.
pub fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b)),
        (Value::Object(a), Value::Object(b)) => a.len() == b.len() && a.iter().all(|(key, a)| b.get(key).is_some_and(|b| same(a, b))),
        _ => a == b,
    }
}
fn overlaps(a: f64, b: f64, c: f64, d: f64) -> bool {
    a < d && c < b
}
fn source_overlap(a: &Value, b: &Value) -> bool {
    ["clipId", "visualId", "mediaId", "mediaRevision"].iter().all(|key| a.get(key) == b.get(key))
        && overlaps(
            a["sourceStartSec"].as_f64().unwrap_or(0.0),
            a["sourceEndSec"].as_f64().unwrap_or(0.0),
            b["sourceStartSec"].as_f64().unwrap_or(0.0),
            b["sourceEndSec"].as_f64().unwrap_or(0.0),
        )
}
fn source_contains(selected: &Value, binding: &Value) -> bool {
    ["clipId", "visualId", "mediaId", "mediaRevision"].iter().all(|key| selected.get(key) == binding.get(key))
        && binding["sourceStartSec"].as_f64().unwrap_or(-1.0) >= selected["sourceStartSec"].as_f64().unwrap_or(0.0) - 1e-8
        && binding["sourceEndSec"].as_f64().unwrap_or(f64::INFINITY) <= selected["sourceEndSec"].as_f64().unwrap_or(0.0) + 1e-8
}
fn in_scope(start: f64, end: f64, sources: &[Value], edit: &Value) -> bool {
    let selected = edit["sources"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    if !sources.is_empty() && !selected.is_empty() {
        return sources.iter().any(|source| selected.iter().any(|selected| source_overlap(source, selected)));
    }
    overlaps(start, end, edit["startSec"].as_f64().unwrap_or(0.0), edit["endSec"].as_f64().unwrap_or(0.0))
}
fn cue_in_scope(clip: &Clip, edit: &Value) -> bool {
    clip.kind == ClipType::Caption
        && in_scope(clip.start_sec, clip.start_sec + clip.duration_sec, clip.extra["caption"]["sources"].as_array().map(Vec::as_slice).unwrap_or(&[]), edit)
}
fn range_in_scope(range: &Value, edit: &Value) -> bool {
    in_scope(
        range["startSec"].as_f64().unwrap_or(0.0),
        range["endSec"].as_f64().unwrap_or(0.0),
        range["sources"].as_array().map(Vec::as_slice).unwrap_or(&[]),
        edit,
    )
}
fn protected(clip: &Clip) -> bool {
    ["text", "timing", "segmentation"].iter().any(|key| clip.extra["caption"]["protection"][key].as_bool() == Some(true))
}
fn blocked(candidate: &Clip, sources: &[Value], start: f64, end: f64) -> bool {
    let bindings = candidate.extra["caption"]["sources"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    overlaps(candidate.start_sec, candidate.start_sec + candidate.duration_sec, start, end)
        || bindings.iter().any(|binding| sources.iter().any(|source| source_overlap(binding, source)))
}

pub fn merge(scope: &EditScope, edit: &Value, set: &mut Value) -> EngineResult<(Vec<String>, Vec<Clip>)> {
    let start = num(edit, "startSec")?;
    let end = num(edit, "endSec")?;
    if start < 0.0 || end <= start {
        return Err(invalid("invalid regeneration range"));
    }
    let snapshot = edit.get("snapshot").ok_or_else(|| invalid("missing result snapshot"))?;
    let expected = list(snapshot, "cues")?;
    let current: Vec<_> = scope.doc.clips.iter().filter(|clip| cue_in_scope(clip, edit)).collect();
    let matches = current.len() == expected.len()
        && current.iter().zip(expected).all(|(actual, value)| {
            serde_json::from_value::<Clip>(value.clone()).is_ok_and(|expected| {
                actual.id == expected.id
                    && actual.kind == expected.kind
                    && actual.start_sec == expected.start_sec
                    && actual.duration_sec == expected.duration_sec
                    && actual.track == expected.track
                    && actual.extra.len() == expected.extra.len()
                    && actual.extra.iter().all(|(key, value)| expected.extra.get(key).is_some_and(|expected| same(value, expected)))
            })
        });
    if !matches {
        return Err(invalid("affected captions changed during processing; regenerate captions"));
    }
    let deleted: Vec<Value> =
        set["deletedRanges"].as_array().ok_or_else(|| invalid("invalid deleted ranges"))?.iter().filter(|range| range_in_scope(range, edit)).cloned().collect();
    if !same(&Value::Array(deleted.clone()), &Value::Array(list(snapshot, "deletedRanges")?.clone()))
        || snapshot.get("language") != scope.doc.extra.get("captionSet").and_then(|set| set.get("language"))
        || snapshot.get("detectedLanguage") != scope.doc.extra.get("captionSet").and_then(|set| set.get("detectedLanguage"))
    {
        return Err(invalid("caption scope changed during processing; regenerate captions"));
    }
    crate::caption_sources::verify_result_sources(scope, edit)?;
    let ids: Vec<String> = current.iter().map(|clip| clip.id.clone()).collect();
    let submitted = list(edit, "ids")?;
    if submitted.len() != ids.len() || !ids.iter().all(|id| submitted.iter().any(|value| value.as_str() == Some(id.as_str()))) {
        return Err(invalid("result targets do not match scope"));
    }
    let replace = edit["replaceEdited"].as_bool().ok_or_else(|| invalid("invalid replace-edits choice"))?;
    let language = edit["language"].as_str().filter(|language| !language.is_empty()).ok_or_else(|| invalid("invalid caption language"))?;
    if (set["language"].as_str().is_some_and(|prior| prior != language)
        || set.get("detectedLanguage").zip(edit.get("detectedLanguage")).is_some_and(|(prior, next)| prior != next))
        && scope.doc.clips.iter().any(|clip| clip.kind == ClipType::Caption && !ids.contains(&clip.id))
    {
        return Err(invalid("language changed; regenerate the complete caption set"));
    }
    let mut replacements: Vec<Clip> = if replace {
        vec![]
    } else {
        current
            .iter()
            .filter(|clip| protected(clip) || clip.start_sec < start || clip.start_sec + clip.duration_sec > end)
            .map(|clip| clip.as_ref().clone())
            .collect()
    };
    if replace && current.iter().any(|clip| clip.start_sec < start || clip.start_sec + clip.duration_sec > end + 1e-8) {
        return Err(invalid("caption crosses regeneration range; select a larger range"));
    }
    let held = replacements.clone();
    for value in list(edit, "candidates")? {
        let mut clip: Clip = serde_json::from_value(value.clone()).map_err(|_| invalid("invalid caption candidate"))?;
        crate::captions::validate_caption_clip(&clip)?;
        let selected = list(edit, "sources")?;
        let bindings = list(&clip.extra["caption"], "sources")?;
        if !selected.is_empty() && (bindings.is_empty() || bindings.iter().any(|binding| !selected.iter().any(|source| source_contains(source, binding)))) {
            return Err(invalid("candidate source leaves regeneration scope"));
        }
        if clip.kind != ClipType::Caption
            || clip.start_sec < start
            || clip.start_sec + clip.duration_sec > end + 1e-8
            || scope.doc.clips.iter().any(|item| item.id == clip.id && !ids.contains(&item.id))
        {
            return Err(invalid("candidate leaves regeneration scope or id is unavailable"));
        }

        if !replace
            && (held.iter().any(|held| {
                blocked(
                    &clip,
                    held.extra["caption"]["sources"].as_array().map(Vec::as_slice).unwrap_or(&[]),
                    held.start_sec,
                    held.start_sec + held.duration_sec,
                )
            }) || deleted.iter().any(|range| {
                blocked(
                    &clip,
                    range["sources"].as_array().map(Vec::as_slice).unwrap_or(&[]),
                    range["startSec"].as_f64().unwrap_or(0.0),
                    range["endSec"].as_f64().unwrap_or(0.0),
                )
            }))
        {
            continue;
        }
        // Other source groups remain authored and cannot be covered by selected-source output.
        if scope
            .doc
            .clips
            .iter()
            .filter(|item| item.kind == ClipType::Caption && !ids.contains(&item.id))
            .any(|item| overlaps(clip.start_sec, clip.start_sec + clip.duration_sec, item.start_sec, item.start_sec + item.duration_sec))
        {
            continue;
        }
        if !replace
            && let Some(styled) = current.iter().find(|item| {
                item.extra["caption"]["protection"]["style"].as_bool() == Some(true)
                    && overlaps(clip.start_sec, clip.start_sec + clip.duration_sec, item.start_sec, item.start_sec + item.duration_sec)
            })
        {
            let cue = clip.extra.get_mut("caption").ok_or_else(|| invalid("missing cue"))?;
            if let Some(style) = styled.extra["caption"].get("style") {
                cue["style"] = style.clone();
            }
            cue["protection"]["style"] = Value::Bool(true);
        }
        if replacements.iter().any(|item| item.id == clip.id) {
            return Err(invalid("duplicate caption candidate"));
        }
        replacements.push(clip);
    }
    if replace {
        set["deletedRanges"].as_array_mut().ok_or_else(|| invalid("invalid deletion protection"))?.retain(|range| !range_in_scope(range, edit));
    }
    Ok((ids, replacements))
}
