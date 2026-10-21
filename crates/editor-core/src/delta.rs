//! What an edit changed, for a host that keeps its own copy of the scope.
//!
//! The web editor renders from JavaScript objects and memoizes by identity, so
//! it cannot take a freshly parsed scope per edit: every clip would be a new
//! object and every row would repaint. Execution already shares every part an
//! edit does not change (`Shared<T>`), so the delta names only the parts that
//! are new, by pointer identity, and the host rebuilds its copy reusing the
//! rest (`packages/shared/src/editor/engine-executor.ts`).
//!
//! Shape, every key optional and absent when unchanged:
//! `{"mediaAssets", "slides", "posts": whole values, "extra": {"set", "remove"},
//!   "doc": {"schemaVersion", "markers", "extra", "clips"}}`, where `clips` is a
//! list of runs: `[start, count]` keeps that many of the prior clips from
//! `start`, and an object is a new clip. An unchanged scope is `{}`.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Map;

use crate::json::to_js_string;
use crate::schema::{Clip, EditScope, Passthrough, Shared};

type Written = Result<Option<String>, String>;

/* Written straight to text with the formatter every other output uses, rather
 * than built as a `serde_json::Value` first: a `Value` serializer per type cost
 * the module ~7 KB gzip. Keys are fixed ASCII, so they need no escaping. */
fn object(fields: Vec<(&str, String)>) -> String {
    let body: Vec<String> = fields.into_iter().map(|(key, value)| format!("\"{key}\":{value}")).collect();
    format!("{{{}}}", body.join(","))
}

fn whole<T: Serialize>(before: &Shared<T>, after: &Shared<T>) -> Written {
    if Arc::ptr_eq(before, after) { Ok(None) } else { to_js_string(after.as_ref()).map(Some) }
}

/// Keys whose value changed or appeared, in `after`'s order, and keys that went away.
fn passthrough(before: &Shared<Passthrough>, after: &Shared<Passthrough>) -> Written {
    if Arc::ptr_eq(before, after) {
        return Ok(None);
    }
    let set: Map<String, serde_json::Value> =
        after.iter().filter(|(key, value)| before.get(*key) != Some(*value)).map(|(key, value)| (key.clone(), value.clone())).collect();
    let remove: Vec<&String> = before.keys().filter(|key| !after.contains_key(*key)).collect();
    if set.is_empty() && remove.is_empty() {
        return Ok(None);
    }
    Ok(Some(object(vec![("set", to_js_string(&set)?), ("remove", to_js_string(&remove)?)])))
}

fn clips(before: &[Shared<Clip>], after: &[Shared<Clip>]) -> Written {
    let unchanged = before.len() == after.len() && before.iter().zip(after).all(|(a, b)| Arc::ptr_eq(a, b));
    if unchanged {
        return Ok(None);
    }
    let index: HashMap<*const Clip, usize> = before.iter().enumerate().map(|(position, clip)| (Arc::as_ptr(clip), position)).collect();
    let mut runs: Vec<String> = Vec::new();
    let mut open: Option<(usize, usize)> = None;
    let close = |runs: &mut Vec<String>, open: &mut Option<(usize, usize)>| {
        if let Some((start, count)) = open.take() {
            runs.push(format!("[{start},{count}]"));
        }
    };
    for clip in after {
        match index.get(&Arc::as_ptr(clip)) {
            Some(&position) => match open {
                Some((start, count)) if start + count == position => open = Some((start, count + 1)),
                _ => {
                    close(&mut runs, &mut open);
                    open = Some((position, 1));
                }
            },
            None => {
                close(&mut runs, &mut open);
                runs.push(to_js_string(clip.as_ref())?);
            }
        }
    }
    close(&mut runs, &mut open);
    Ok(Some(format!("[{}]", runs.join(","))))
}

/// The parts of `after` that are not shared with `before`, as JSON text.
pub fn delta(before: &EditScope, after: &EditScope) -> Result<String, String> {
    let mut doc: Vec<(&str, String)> = Vec::new();
    if before.doc.schema_version != after.doc.schema_version {
        doc.push(("schemaVersion", to_js_string(&after.doc.schema_version)?));
    }
    for (key, value) in [
        ("markers", whole(&before.doc.markers, &after.doc.markers)?),
        ("extra", passthrough(&before.doc.extra, &after.doc.extra)?),
        ("clips", clips(&before.doc.clips, &after.doc.clips)?),
    ] {
        if let Some(value) = value {
            doc.push((key, value));
        }
    }
    let mut out: Vec<(&str, String)> = Vec::new();
    for (key, value) in [
        ("mediaAssets", whole(&before.media_assets, &after.media_assets)?),
        ("slides", whole(&before.slides, &after.slides)?),
        ("posts", whole(&before.posts, &after.posts)?),
        ("extra", passthrough(&before.extra, &after.extra)?),
    ] {
        if let Some(value) = value {
            out.push((key, value));
        }
    }
    if !doc.is_empty() {
        out.push(("doc", object(doc)));
    }
    Ok(object(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{admit_command, admit_scope, execute};
    use serde_json::{Value, json};

    const SCOPE: &str = r#"{"mediaAssets":[],"slides":[],"posts":[],"doc":{"schemaVersion":2,"markers":[],"clips":[
        {"id":"a","type":"text","startSec":0,"durationSec":1,"track":0},
        {"id":"b","type":"text","startSec":1,"durationSec":1,"track":0},
        {"id":"c","type":"text","startSec":2,"durationSec":1,"track":0}],"captions":{"on":true}}}"#;

    fn run(command: &str) -> Value {
        let scope = admit_scope(SCOPE).expect("admits");
        let executed = execute(&scope, &admit_command(command).expect("command")).expect("executes");
        serde_json::from_str(&delta(&scope, &executed.scope).expect("writes")).expect("is JSON")
    }

    #[test]
    fn a_move_sends_one_clip_and_keeps_the_rest_by_reference() {
        let out = run(r#"{"type":"clip.move","id":"b","patch":{"startSec":5}}"#);
        let clips = out["doc"]["clips"].as_array().expect("clips");
        assert_eq!(clips[0], json!([0, 1]));
        assert_eq!(clips[1]["id"], "b");
        assert_eq!(clips[2], json!([2, 1]));
        assert_eq!(out.as_object().map(Map::len), Some(1));
    }

    #[test]
    fn an_insert_and_a_remove_shift_runs() {
        let inserted = run(r#"{"type":"clip.insert","clip":{"id":"d","type":"text","startSec":3,"durationSec":1,"track":0},"index":1}"#);
        let text = crate::json::to_js_string(&inserted["doc"]["clips"]).expect("serializes");
        assert_eq!(text, r#"[[0,1],{"id":"d","type":"text","startSec":3,"durationSec":1,"track":0},[1,2]]"#);
        assert_eq!(run(r#"{"type":"clip.remove","id":"a"}"#)["doc"]["clips"], json!([[1, 2]]));
    }

    #[test]
    fn document_fields_report_set_and_removed_keys() {
        assert_eq!(run(r#"{"type":"doc.setCaptions"}"#)["doc"]["extra"], json!({"set": {}, "remove": ["captions"]}));
        assert_eq!(run(r#"{"type":"noop"}"#), json!({}));
    }
}
