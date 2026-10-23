//! Apply and invert, ported from `packages/shared/src/editor/commands.ts`.
//!
//! Pure: every function takes the scope by reference and returns a new one, so
//! an input can never be changed by executing against it. A command that
//! changes nothing returns a scope equal to its input.
//!
//! Every command type in the vocabulary executes here.

use std::sync::Arc;

use serde_json::{Number, Value};

use crate::command::EditorCommand;
use crate::error::{EngineError, EngineResult};
use crate::json::js_number_string;
use crate::keyframes::js_trim;
use crate::keys::set_clip_keys;
use crate::schema::{Clip, EditScope, Passthrough};
use crate::source::js_truthy;
use crate::window::{can_retain_clip_window, clip_source_range, resize_timing, retain_clip_window};

/// A command executed against a scope: the new scope and the command that undoes it.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Executed {
    pub scope: EditScope,
    pub inverse: EditorCommand,
}

/// Invert against the prior scope, then apply: the pair the editor records.
pub fn execute(scope: &EditScope, command: &EditorCommand) -> EngineResult<Executed> {
    let inverse = invert_command(scope, command)?;
    let next = apply_command(scope, command)?;
    crate::captions::validate_captions(&next)?;
    Ok(Executed { scope: next, inverse })
}

pub fn apply_command(scope: &EditScope, command: &EditorCommand) -> EngineResult<EditScope> {
    let next = apply_raw(scope, command)?;
    if matches!(command, EditorCommand::CaptionEdit { .. } | EditorCommand::ScopeReplace { .. } | EditorCommand::Noop) {
        return Ok(next);
    }
    crate::caption_sources::synchronize(scope, next)
}

fn apply_raw(scope: &EditScope, command: &EditorCommand) -> EngineResult<EditScope> {
    match command {
        EditorCommand::CaptionEdit { edit } => crate::captions::edit_captions(scope, edit),
        EditorCommand::MediaUpdate { media_assets } => {
            let mut next = scope.clone();
            next.media_assets = Arc::new(media_assets.clone());
            Ok(next)
        }
        EditorCommand::MediaAdmit { asset } => Ok(admitted(scope, asset)),
        EditorCommand::ClipReplace { id, clip } => Ok(with_clip(scope, id, |_| Ok(clip.clone()))?),
        // `withMirroredTiming({ ...c, ...cmd.patch })`
        EditorCommand::ClipMove { id, patch } | EditorCommand::ClipUpdate { id, patch } => {
            with_clip(scope, id, |clip| with_mirrored_timing(patched(clip, patch)?))
        }
        EditorCommand::ClipTrimBefore { id, at } => trimmed(scope, id, *at, Side::Before),
        EditorCommand::ClipTrimAfter { id, at } => trimmed(scope, id, *at, Side::After),
        EditorCommand::ClipResize { id, duration_sec, start_sec } => resized(scope, id, *duration_sec, *start_sec),
        EditorCommand::ClipSetKeys { id, property, keys } => set_clip_keys(scope, id, property, keys),
        EditorCommand::ClipInsert { clip, index } => {
            let mut next = scope.clone();
            let at = splice_index(*index, next.doc.clips.len());
            next.doc.clips.insert(at, Arc::new(clip.clone()));
            Ok(next)
        }
        EditorCommand::ClipRemove { id } => {
            let mut next = scope.clone();
            next.doc.clips.retain(|clip| clip.id != *id);
            Ok(next)
        }
        EditorCommand::MarkerUpsert { marker, index } => {
            let markers = &scope.doc.markers;
            let key = marker.get("id");
            let next = if markers.iter().any(|m| js_strict_eq(m.get("id"), key)) {
                markers.iter().map(|m| if js_strict_eq(m.get("id"), key) { marker.clone() } else { m.clone() }).collect()
            } else {
                spliced(markers, marker.clone(), *index)
            };
            Ok(with_markers(scope, next))
        }
        EditorCommand::MarkerRemove { id } => Ok(with_markers(scope, scope.doc.markers.iter().filter(|m| !id_is(m, *id)).cloned().collect())),
        EditorCommand::MarkerUpdate { id, patch } => {
            let next = scope.doc.markers.iter().map(|m| if id_is(m, *id) { spread(m, patch) } else { Ok(m.clone()) }).collect::<EngineResult<_>>()?;
            Ok(with_markers(scope, next))
        }
        EditorCommand::BookmarkSet { bookmarks } => Ok(with_doc_field(scope, "bookmarks", bookmarks.clone())),
        EditorCommand::BookmarkUpsert { bookmark } => {
            // An invalid bookmark changes nothing, as `bookmarkSchema.safeParse` failing does.
            let Some(parsed) = parsed_bookmark(bookmark) else {
                return Ok(scope.clone());
            };
            let current = scope.doc.extra.get("bookmarks").and_then(Value::as_array).cloned().unwrap_or_default();
            let key = bookmark.get("id");
            let next = if current.iter().any(|b| js_strict_eq(b.get("id"), key)) {
                current.iter().map(|b| if js_strict_eq(b.get("id"), key) { parsed.clone() } else { b.clone() }).collect()
            } else {
                current.into_iter().chain(std::iter::once(parsed)).collect()
            };
            Ok(with_doc_field(scope, "bookmarks", Some(Value::Array(next))))
        }
        EditorCommand::BookmarkRemove { id } => {
            let Some(current) = scope.doc.extra.get("bookmarks").and_then(Value::as_array) else {
                return Ok(scope.clone());
            };
            let key = Value::String(id.clone());
            if !current.iter().any(|b| js_strict_eq(b.get("id"), Some(&key))) {
                return Ok(scope.clone());
            }
            let kept = current.iter().filter(|b| !js_strict_eq(b.get("id"), Some(&key))).cloned().collect();
            Ok(with_doc_field(scope, "bookmarks", Some(Value::Array(kept))))
        }
        EditorCommand::DocSetCaptions { captions } => Ok(with_doc_field(scope, "captions", captions.clone())),
        EditorCommand::DocSetProjectReferences { project_references } => Ok(with_doc_field(scope, "projectReferences", project_references.clone())),
        EditorCommand::DocSetMaterials { materials } => Ok(with_doc_field(scope, "materials", materials.clone())),
        EditorCommand::DocSetTrackFlags { track_flags } => Ok(with_doc_field(scope, "trackFlags", track_flags.clone())),
        EditorCommand::SlideInsert { slide, index } => Ok(with_slides(scope, spliced(&scope.slides, slide.clone(), *index))),
        EditorCommand::SlideRemove { id } => Ok(with_slides(scope, scope.slides.iter().filter(|x| !id_is(x, *id)).cloned().collect())),
        EditorCommand::SlideUpdate { id, patch } => {
            let next = scope.slides.iter().map(|x| if id_is(x, *id) { spread(x, patch) } else { Ok(x.clone()) }).collect::<EngineResult<_>>()?;
            Ok(with_slides(scope, next))
        }
        EditorCommand::PostInsert { post, index } => Ok(with_posts(scope, spliced(&scope.posts, post.clone(), *index))),
        EditorCommand::PostRemove { id } => Ok(with_posts(scope, scope.posts.iter().filter(|x| !id_is(x, *id)).cloned().collect())),
        EditorCommand::PostUpdate { id, patch } => {
            let next = scope.posts.iter().map(|x| if id_is(x, *id) { spread(x, patch) } else { Ok(x.clone()) }).collect::<EngineResult<_>>()?;
            Ok(with_posts(scope, next))
        }
        EditorCommand::Batch { commands, .. } => commands.iter().try_fold(scope.clone(), |state, step| apply_raw(&state, step)),
        EditorCommand::ScopeReplace { scope: replacement, .. } => Ok(replacement.clone()),
        EditorCommand::Noop => Ok(scope.clone()),
    }
}

pub fn invert_command(before: &EditScope, command: &EditorCommand) -> EngineResult<EditorCommand> {
    let inverse = invert_raw(before, command)?;
    if !matches!(command, EditorCommand::CaptionEdit { .. } | EditorCommand::ScopeReplace { .. } | EditorCommand::Noop)
        && (before
            .doc
            .clips
            .iter()
            .any(|clip| clip.extra.get("caption").and_then(|cue| cue.get("sources")).and_then(Value::as_array).is_some_and(|sources| !sources.is_empty()))
            || before.doc.extra.get("captionSet").and_then(|set| set.get("deletedRanges")).and_then(Value::as_array).is_some_and(|ranges| !ranges.is_empty()))
    {
        return crate::caption_sources::inverse(before, &apply_command(before, command)?, inverse);
    }
    Ok(inverse)
}

fn invert_raw(before: &EditScope, command: &EditorCommand) -> EngineResult<EditorCommand> {
    let prior = |id: &str| before.doc.clips.iter().find(|clip| clip.id == id).map(|clip| Clip::clone(clip));
    let require = |id: &str| prior(id).ok_or_else(|| EngineError::ClipNotFound(id.to_owned()));
    let field = |key: &str| before.doc.extra.get(key).cloned();
    match command {
        EditorCommand::CaptionEdit { edit } => crate::captions::caption_inverse(before, edit),
        EditorCommand::MediaUpdate { .. } | EditorCommand::MediaAdmit { .. } => {
            Ok(EditorCommand::MediaUpdate { media_assets: before.media_assets.as_ref().clone() })
        }
        // The whole prior clip, so an edit that added a field is undone exactly.
        EditorCommand::ClipReplace { id, .. }
        | EditorCommand::ClipMove { id, .. }
        | EditorCommand::ClipUpdate { id, .. }
        | EditorCommand::ClipResize { id, .. } => Ok(EditorCommand::ClipReplace { id: id.clone(), clip: require(id)? }),
        // The whole prior clip, not the prior keys: writing a track can materialize a
        // scene's primary visual or layout defaults, which only a replace undoes.
        EditorCommand::ClipTrimBefore { id, .. } | EditorCommand::ClipTrimAfter { id, .. } | EditorCommand::ClipSetKeys { id, .. } => {
            Ok(prior(id).map_or(EditorCommand::Noop, |clip| EditorCommand::ClipReplace { id: id.clone(), clip }))
        }
        EditorCommand::ClipInsert { clip, .. } => Ok(EditorCommand::ClipRemove { id: clip.id.clone() }),
        EditorCommand::ClipRemove { id } => {
            let clip = require(id)?;
            let index = before.doc.clips.iter().position(|clip| clip.id == *id).map(|index| index as f64);
            Ok(EditorCommand::ClipInsert { clip, index })
        }
        EditorCommand::MarkerUpsert { marker, .. } => {
            let key = marker.get("id");
            match before.doc.markers.iter().find(|m| js_strict_eq(m.get("id"), key)) {
                Some(prev) => Ok(EditorCommand::MarkerUpsert { marker: prev.clone(), index: None }),
                None => Ok(EditorCommand::MarkerRemove { id: numeric_id(key, "marker")? }),
            }
        }
        EditorCommand::MarkerRemove { id } => Ok(match before.doc.markers.iter().position(|m| id_is(m, *id)) {
            Some(index) => EditorCommand::MarkerUpsert { marker: before.doc.markers[index].clone(), index: Some(index as f64) },
            None => EditorCommand::Noop,
        }),
        EditorCommand::MarkerUpdate { id, .. } => Ok(match before.doc.markers.iter().find(|m| id_is(m, *id)) {
            Some(prev) => EditorCommand::MarkerUpsert { marker: prev.clone(), index: None },
            None => EditorCommand::Noop,
        }),
        EditorCommand::BookmarkSet { .. } | EditorCommand::BookmarkUpsert { .. } | EditorCommand::BookmarkRemove { .. } => {
            Ok(EditorCommand::BookmarkSet { bookmarks: field("bookmarks") })
        }
        EditorCommand::DocSetCaptions { .. } => Ok(EditorCommand::DocSetCaptions { captions: field("captions") }),
        EditorCommand::DocSetProjectReferences { .. } => Ok(EditorCommand::DocSetProjectReferences { project_references: field("projectReferences") }),
        EditorCommand::DocSetMaterials { .. } => Ok(EditorCommand::DocSetMaterials { materials: field("materials") }),
        EditorCommand::DocSetTrackFlags { .. } => Ok(EditorCommand::DocSetTrackFlags { track_flags: field("trackFlags") }),
        EditorCommand::SlideInsert { slide, .. } => Ok(EditorCommand::SlideRemove { id: numeric_id(slide.get("id"), "slide")? }),
        EditorCommand::SlideRemove { id } => Ok(match before.slides.iter().position(|x| id_is(x, *id)) {
            Some(index) => EditorCommand::SlideInsert { slide: before.slides[index].clone(), index: Some(index as f64) },
            None => EditorCommand::Noop,
        }),
        // Restore the whole prior entity, not a merge patch of it: a patch cannot
        // remove a field the edit added.
        EditorCommand::SlideUpdate { id, .. } => Ok(match before.slides.iter().position(|x| id_is(x, *id)) {
            Some(index) => EditorCommand::Batch {
                commands: vec![
                    EditorCommand::SlideRemove { id: *id },
                    EditorCommand::SlideInsert { slide: before.slides[index].clone(), index: Some(index as f64) },
                ],
                label: None,
            },
            None => EditorCommand::Noop,
        }),
        EditorCommand::PostInsert { post, .. } => Ok(EditorCommand::PostRemove { id: numeric_id(post.get("id"), "post")? }),
        EditorCommand::PostRemove { id } => Ok(match before.posts.iter().position(|x| id_is(x, *id)) {
            Some(index) => EditorCommand::PostInsert { post: before.posts[index].clone(), index: Some(index as f64) },
            None => EditorCommand::Noop,
        }),
        EditorCommand::PostUpdate { id, .. } => Ok(match before.posts.iter().position(|x| id_is(x, *id)) {
            Some(index) => EditorCommand::Batch {
                commands: vec![
                    EditorCommand::PostRemove { id: *id },
                    EditorCommand::PostInsert { post: before.posts[index].clone(), index: Some(index as f64) },
                ],
                label: None,
            },
            None => EditorCommand::Noop,
        }),
        EditorCommand::Batch { commands, label } => {
            // Each step's inverse is taken against the state right before that
            // step, then the inverses replay in reverse order.
            let mut state = before.clone();
            let mut inverses = Vec::with_capacity(commands.len());
            for step in commands {
                inverses.push(invert_raw(&state, step)?);
                state = apply_raw(&state, step)?;
            }
            inverses.reverse();
            Ok(EditorCommand::Batch { commands: inverses, label: label.clone() })
        }
        EditorCommand::ScopeReplace { label, .. } => Ok(EditorCommand::ScopeReplace { scope: before.clone(), label: label.clone() }),
        EditorCommand::Noop => Ok(EditorCommand::Noop),
    }
}

/// `admitAsset`: the key is the URL; an asset whose URL is already admitted is
/// not added again. Newest first.
fn admitted(scope: &EditScope, asset: &Value) -> EditScope {
    if scope.media_assets.iter().any(|existing| js_strict_eq(existing.get("url"), asset.get("url"))) {
        return scope.clone();
    }
    let mut next = scope.clone();
    next.media_assets = Arc::new(std::iter::once(asset.clone()).chain(scope.media_assets.iter().cloned()).collect());
    next
}

/// `bookmarkSchema.safeParse(bookmark).data` (`timeline-bookmarks.ts`): a strict
/// object of `id` (1–160 UTF-16 units), `timeSec` (a number ≥ 0) and `label`
/// (trimmed, then 1–160 units), rebuilt in schema key order. `None` when Zod
/// would refuse it.
fn parsed_bookmark(bookmark: &Value) -> Option<Value> {
    let fields = bookmark.as_object()?;
    if fields.keys().any(|key| !matches!(key.as_str(), "id" | "timeSec" | "label")) {
        return None;
    }
    let id = fields.get("id")?.as_str()?;
    let time_sec = fields.get("timeSec")?;
    let label = js_trim(fields.get("label")?.as_str()?);
    let units = |text: &str| text.encode_utf16().count();
    if !(1..=160).contains(&units(id)) || !(1..=160).contains(&units(label)) || !time_sec.as_f64().is_some_and(|time| time >= 0.0) {
        return None;
    }
    let mut parsed = Passthrough::new();
    parsed.insert("id".to_owned(), Value::String(id.to_owned()));
    parsed.insert("timeSec".to_owned(), time_sec.clone());
    parsed.insert("label".to_owned(), Value::String(label.to_owned()));
    Some(Value::Object(parsed))
}

/// JavaScript `a === b` for two property reads, where `None` is `undefined`.
/// Objects and arrays are distinct references, so never equal.
fn js_strict_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (None, None) | (Some(Value::Null), Some(Value::Null)) => true,
        (Some(Value::Bool(x)), Some(Value::Bool(y))) => x == y,
        (Some(Value::Number(x)), Some(Value::Number(y))) => x.as_f64() == y.as_f64(),
        (Some(Value::String(x)), Some(Value::String(y))) => x == y,
        _ => false,
    }
}

/// `item.id === id` for a numeric command id.
fn id_is(item: &Value, id: f64) -> bool {
    item.get("id").and_then(Value::as_f64).is_some_and(|found| found == id)
}

/// An entity id the vocabulary types as a number.
fn numeric_id(value: Option<&Value>, what: &str) -> EngineResult<f64> {
    value.and_then(Value::as_f64).ok_or_else(|| EngineError::InvalidInput(format!("{what} id is not a number")))
}

/// The position `Array.prototype.splice(index ?? length, 0, item)` inserts at.
fn splice_index(index: Option<f64>, len: usize) -> usize {
    let Some(index) = index else { return len };
    let whole = if index.is_nan() { 0.0 } else { index.trunc() };
    let length = len as f64;
    (if whole < 0.0 { (length + whole).max(0.0) } else { whole.min(length) }) as usize
}

fn spliced(items: &[Value], item: Value, index: Option<f64>) -> Vec<Value> {
    let mut next = items.to_vec();
    next.insert(splice_index(index, next.len()), item);
    next
}

/// `{ ...item, ...patch }`. Spreading `null`, a number or a boolean contributes
/// no keys; spreading a string or array would contribute index keys, which no
/// entity in the scope is, so that is refused.
fn spread(item: &Value, patch: &Passthrough) -> EngineResult<Value> {
    let mut fields = match item {
        Value::Object(fields) => fields.clone(),
        Value::Null | Value::Bool(_) | Value::Number(_) => Passthrough::new(),
        Value::String(_) | Value::Array(_) => return Err(EngineError::InvalidInput("cannot patch a string or array entity".to_owned())),
    };
    fields.extend(patch.iter().map(|(key, value)| (key.clone(), value.clone())));
    Ok(Value::Object(fields))
}

/// `{ ...doc, [key]: value }`: an existing key keeps its place, a new one goes
/// last, and `undefined` drops it from the serialized document.
fn with_doc_field(scope: &EditScope, key: &str, value: Option<Value>) -> EditScope {
    let mut next = scope.clone();
    let extra = Arc::make_mut(&mut next.doc.extra);
    match value {
        Some(value) => {
            extra.insert(key.to_owned(), value);
        }
        None => {
            extra.shift_remove(key);
        }
    }
    next
}

fn with_markers(scope: &EditScope, markers: Vec<Value>) -> EditScope {
    let mut next = scope.clone();
    next.doc.markers = Arc::new(markers);
    next
}

fn with_slides(scope: &EditScope, slides: Vec<Value>) -> EditScope {
    let mut next = scope.clone();
    next.slides = Arc::new(slides);
    next
}

fn with_posts(scope: &EditScope, posts: Vec<Value>) -> EditScope {
    let mut next = scope.clone();
    next.posts = Arc::new(posts);
    next
}

/// The scope with clip `id` rebuilt by `edit`; unchanged when no clip has that id.
fn with_clip(scope: &EditScope, id: &str, edit: impl Fn(&Clip) -> EngineResult<Clip>) -> EngineResult<EditScope> {
    // Every other clip is shared with the input, not copied.
    let clips =
        scope.doc.clips.iter().map(|clip| if clip.id == id { edit(clip).map(Arc::new) } else { Ok(Arc::clone(clip)) }).collect::<EngineResult<Vec<_>>>()?;
    let mut next = scope.clone();
    next.doc.clips = clips;
    Ok(next)
}

/// `{ ...clip, ...patch }`: existing keys keep their place, new keys follow.
fn patched(clip: &Clip, patch: &Passthrough) -> EngineResult<Clip> {
    let Value::Object(mut fields) = serde_json::to_value(clip).map_err(|error| EngineError::InvalidInput(error.to_string()))? else {
        return Err(EngineError::InvalidInput("a clip serializes to an object".to_owned()));
    };
    fields.extend(patch.iter().map(|(key, value)| (key.clone(), value.clone())));
    serde_json::from_value(Value::Object(fields)).map_err(|error| EngineError::InvalidInput(format!("patched clip: {error}")))
}

fn number(value: f64) -> EngineResult<Value> {
    Number::from_f64(value).map(Value::Number).ok_or_else(|| EngineError::InvalidInput(format!("non-finite number {value}")))
}

/// `withMirroredTiming`: copy clip timing onto the payload's own timing keys,
/// refreshing only keys the payload already has. A transition takes only its
/// duration; a scene-local `vis` payload takes nothing.
pub fn with_mirrored_timing(clip: Clip) -> EngineResult<Clip> {
    const PAYLOADS: [&str; 6] = ["scene", "video", "text", "audio", "effect", "transition"];
    let Some(key) = PAYLOADS.into_iter().find(|key| js_truthy(clip.extra.get(*key))) else {
        return Ok(clip);
    };
    let timing = if key == "transition" {
        vec![("dur", number(clip.duration_sec)?)]
    } else {
        vec![("start", number(clip.start_sec)?), ("dur", number(clip.duration_sec)?), ("track", number(clip.track)?)]
    };
    let Some(payload) = clip.payload(key) else {
        return Err(EngineError::InvalidInput(format!("clip {} has a non-object {key} payload", clip.id)));
    };
    let mut mirrored = payload.clone();
    for (field, value) in timing {
        if mirrored.contains_key(field) {
            mirrored.insert(field.to_owned(), value);
        }
    }
    let mut next = clip;
    next.extra.insert(key.to_owned(), Value::Object(mirrored));
    Ok(next)
}

#[derive(Clone, Copy)]
enum Side {
    Before,
    After,
}

/// `scope.doc.trackFlags?.[clip.track]?.locked`, keyed as JavaScript keys a number.
fn track_locked(scope: &EditScope, clip: &Clip) -> bool {
    let flags = scope.doc.extra.get("trackFlags").and_then(Value::as_object);
    let key = js_number_string(clip.track);
    js_truthy(flags.zip(key).and_then(|(flags, key)| flags.get(&key)).and_then(|flag| flag.get("locked")))
}

fn trimmed(scope: &EditScope, id: &str, at: f64, side: Side) -> EngineResult<EditScope> {
    let Some(clip) = scope.doc.clips.iter().find(|clip| clip.id == id) else {
        return Ok(scope.clone());
    };
    if !at.is_finite() || track_locked(scope, clip) || at <= clip.start_sec + 1.0 / 30.0 || at >= clip.start_sec + clip.duration_sec - 1.0 / 30.0 {
        return Ok(scope.clone());
    }
    let from = match side {
        Side::Before => at - clip.start_sec,
        Side::After => 0.0,
    };
    let to = match side {
        Side::After => at - clip.start_sec,
        Side::Before => clip.duration_sec,
    };
    if !can_retain_clip_window(clip, from, to) {
        return Ok(scope.clone());
    }
    let next = retain_clip_window(clip, from, to)?;
    apply_raw(scope, &EditorCommand::ClipReplace { id: id.to_owned(), clip: next })
}

/// `resized(scope, id, durationSec, startSec)`: a resize keeps a window of the
/// clip bounded by its measured source, then cuts the clip to it.
fn resized(scope: &EditScope, id: &str, duration_sec: f64, start_sec: Option<f64>) -> EngineResult<EditScope> {
    let Some(clip) = scope.doc.clips.iter().find(|clip| clip.id == id) else {
        return Ok(scope.clone());
    };
    if track_locked(scope, clip) || !duration_sec.is_finite() || duration_sec < 1.0 / 30.0 {
        return Ok(scope.clone());
    }
    let timing = match clip_source_range(clip) {
        Some(range) => {
            // `mediaAssets.find((asset) => asset.id === range.assetId)?.metadata?.duration`
            let asset = scope.media_assets.iter().find(|asset| js_strict_eq(asset.get("id"), range.asset_id.as_ref()));
            let extent = asset
                .and_then(|asset| asset.get("metadata"))
                .and_then(|metadata| metadata.get("duration"))
                .or_else(|| clip.extra.get("video").and_then(|video| video.get("sourceDurationSec")));
            match resize_timing(clip, &range, start_sec, duration_sec, extent)? {
                Some(timing) => timing,
                None => return Ok(scope.clone()),
            }
        }
        None => (start_sec.unwrap_or(clip.start_sec), duration_sec),
    };
    let from = timing.0 - clip.start_sec;
    if !can_retain_clip_window(clip, from, from + timing.1) {
        return Ok(scope.clone());
    }
    let next = retain_clip_window(clip, from, from + timing.1)?;
    apply_raw(scope, &EditorCommand::ClipReplace { id: id.to_owned(), clip: next })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn generated_video_resize_uses_measured_source_duration() {
        let scope: EditScope = serde_json::from_value(json!({
            "doc": { "schemaVersion": 2, "clips": [{
                "id": "video:1", "type": "video", "track": 0, "startSec": 0, "durationSec": 2,
                "video": { "id": 1, "kind": "video", "url": "generated.mp4", "start": 0, "dur": 2, "sourceDurationSec": 4 }
            }], "markers": [] }, "mediaAssets": [], "slides": [], "posts": []
        }))
        .unwrap();
        let extended = resized(&scope, "video:1", 7.0, None).unwrap();
        assert_eq!(extended.doc.clips[0].duration_sec, 4.0);
        assert_eq!(extended.doc.clips[0].extra["video"]["dur"], json!(4.0));
        let trimmed = resized(&extended, "video:1", 2.0, None).unwrap();
        assert_eq!(trimmed.doc.clips[0].duration_sec, 2.0);
    }

    #[test]
    fn trims_as_javascript_does() {
        assert_eq!(js_trim("\u{FEFF} x \u{3000}"), "x");
        assert_eq!(js_trim("\u{85}x\u{85}"), "\u{85}x\u{85}");
        assert_eq!(js_trim("\u{180E}x\u{200B}"), "\u{180E}x\u{200B}");
    }

    #[test]
    fn parses_bookmarks_as_the_schema_does() {
        assert_eq!(parsed_bookmark(&json!({ "label": "  Hook  ", "timeSec": 1, "id": "a" })), Some(json!({ "id": "a", "timeSec": 1, "label": "Hook" })));
        assert_eq!(parsed_bookmark(&json!({ "id": "a", "timeSec": 1, "label": "   " })), None);
        assert_eq!(parsed_bookmark(&json!({ "id": "a", "timeSec": 1, "label": "x", "extra": 1 })), None);
        assert_eq!(parsed_bookmark(&json!({ "id": "a", "timeSec": -1, "label": "x" })), None);
        assert_eq!(parsed_bookmark(&json!({ "id": "a", "timeSec": "1", "label": "x" })), None);
        assert!(parsed_bookmark(&json!({ "id": "😀".repeat(80), "timeSec": 0, "label": "x" })).is_some());
        assert_eq!(parsed_bookmark(&json!({ "id": "😀".repeat(81), "timeSec": 0, "label": "x" })), None);
    }
}
