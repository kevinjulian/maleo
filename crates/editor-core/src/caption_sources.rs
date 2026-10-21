//! Source-instance consequences for canonical captions. All times map through original media seconds.
use crate::error::{EngineError, EngineResult};
use crate::schema::{Clip, ClipType, EditScope};
use crate::source::editable_rate;
use serde_json::Value;
use std::sync::Arc;

fn invalid(message: &str) -> EngineError {
    EngineError::InvalidInput(format!("Captions: {message}"))
}
fn num(value: Option<&Value>, default: f64) -> f64 {
    value.and_then(Value::as_f64).unwrap_or(default)
}
fn flag(scope: &EditScope, track: f64, name: &str) -> bool {
    scope
        .doc
        .extra
        .get("trackFlags")
        .and_then(|flags| crate::json::js_number_string(track).and_then(|key| flags.get(key)))
        .and_then(|flags| flags.get(name))
        .and_then(Value::as_bool)
        == Some(true)
}
struct Window<'a> {
    clip: &'a Clip,
    start: f64,
    duration: f64,
    media: f64,
    rate: f64,
    reverse: bool,
    identity: Vec<Option<&'a Value>>,
    sound: Vec<Option<&'a Value>>,
    audible: bool,
}
impl Window<'_> {
    fn end(&self) -> f64 {
        self.media + self.duration * self.rate
    }
    fn timeline(&self, source: f64) -> f64 {
        self.start + if self.reverse { (self.end() - source) / self.rate } else { (source - self.media) / self.rate }
    }
    fn source(&self, timeline: f64) -> f64 {
        if self.reverse { self.end() - (timeline - self.start) * self.rate } else { self.media + (timeline - self.start) * self.rate }
    }
    fn unchanged_media(&self, other: &Self) -> bool {
        self.identity == other.identity && self.reverse == other.reverse && self.sound == other.sound && self.audible == other.audible
    }
}
fn window<'a>(scope: &'a EditScope, clip: &'a Clip, binding: &Value) -> Option<Window<'a>> {
    let visual_id = binding.get("visualId").and_then(Value::as_str);
    let visual = visual_id.and_then(|id| {
        clip.payload("vis").and_then(|vis| vis.get("vclip")).filter(|v| v.get("id").and_then(Value::as_str) == Some(id)).or_else(|| {
            clip.payload("scene")
                .and_then(|scene| scene.get("visualClips"))
                .and_then(Value::as_array)
                .and_then(|items| items.iter().find(|v| v.get("id").and_then(Value::as_str) == Some(id)))
        })
    });
    let payload = if visual_id.is_some() { visual?.as_object()? } else { clip.payload("audio").or_else(|| clip.payload("video"))? };
    let scene_layout = clip.payload("scene").and_then(|scene| scene.get("layout"));
    let layout = payload.get("layout");
    let prop = |key: &str| payload.get(key).or_else(|| layout.and_then(|layout| layout.get(key))).or_else(|| scene_layout.and_then(|layout| layout.get(key)));
    let local = if visual_id.is_some() && clip.payload("vis").is_none() { num(payload.get("startSec"), 0.0) } else { 0.0 };
    let duration =
        if visual_id.is_some() { num(payload.get("durationSec"), clip.duration_sec - local).min(clip.duration_sec - local) } else { clip.duration_sec };
    let audio_track = if clip.payload("scene").is_some() || clip.payload("vis").is_some() { -1.0 } else { clip.track };
    Some(Window {
        clip,
        start: clip.start_sec + local,
        duration,
        media: num(payload.get("mediaStartSec"), 0.0),
        rate: editable_rate(prop("playbackRate")),
        reverse: prop("reverse").and_then(Value::as_bool) == Some(true),
        identity: vec![payload.get("mediaAssetId"), payload.get("url"), payload.get("sourceRevision")],
        sound: ["volume", "fadeIn", "fadeOut", "sourceAudioExtraction", "duckUnderVoice"]
            .iter()
            .map(|key| prop(key))
            .chain(std::iter::once(prop("animation").and_then(|animation| animation.get("tracks")).and_then(|tracks| tracks.get("volume"))))
            .collect(),
        audible: !flag(scope, audio_track, "hidden") && !flag(scope, audio_track, "muted"),
    })
}

pub fn retime_bindings(scope: &EditScope, cue: &mut Value, start: f64, duration: f64) -> EngineResult<()> {
    for binding in cue["sources"].as_array_mut().ok_or_else(|| invalid("invalid source bindings"))? {
        let source = bound_window(scope, binding).ok_or_else(|| invalid("source changed; unlink caption before editing timing"))?;
        changed(scope, source.clip)?;
        let a = source.source(start);
        let b = source.source(start + duration);
        if a.min(b) < source.media - 1e-8 || a.max(b) > source.end() + 1e-8 {
            return Err(invalid("timing leaves source interval; unlink caption before editing timing"));
        }
        binding["sourceStartSec"] = Value::from(a.min(b).max(source.media));
        binding["sourceEndSec"] = Value::from(a.max(b).min(source.end()));
    }
    Ok(())
}
fn bound_window<'a>(scope: &'a EditScope, binding: &Value) -> Option<Window<'a>> {
    let id = binding.get("clipId")?.as_str()?;
    window(scope, scope.doc.clips.iter().find(|clip| clip.id == id)?, binding)
}
fn changed(scope: &EditScope, clip: &Clip) -> EngineResult<()> {
    if flag(scope, clip.track, "locked") { Err(invalid("affected caption or source track is locked")) } else { Ok(()) }
}
fn stale(clip: &Clip) -> Clip {
    let mut output = clip.clone();
    output.extra.get_mut("caption").expect("admitted cue")["status"] = Value::from("needs-refresh");
    output
}
fn mapped(clip: &Clip, binding: &Value, old: &Window<'_>, new: &Window<'_>, partition: bool) -> EngineResult<Option<Clip>> {
    let start = num(binding.get("sourceStartSec"), old.source(clip.start_sec));
    let end = num(binding.get("sourceEndSec"), old.source(clip.start_sec + clip.duration_sec));
    let left = start.max(new.media);
    let right = end.min(new.end());
    if right <= left {
        return Ok(None);
    }
    let cue = &clip.extra["caption"];
    let partial = left > start + 1e-8 || right < end - 1e-8;
    if partial && (cue["protection"]["text"].as_bool() == Some(true) || cue["words"].as_array().is_none_or(Vec::is_empty)) {
        return Ok(Some(stale(clip)));
    }
    let next_start = new.timeline(if new.reverse { right } else { left });
    let next_end = new.timeline(if new.reverse { left } else { right });
    let authored = cue["text"].as_str().ok_or_else(|| invalid("invalid authored text"))?;
    let mut words = Vec::new();
    let mut cursor = 0;
    let mut first = None;
    let mut last = 0;
    for word in cue["words"].as_array().ok_or_else(|| invalid("invalid words"))? {
        let text = word["text"].as_str().ok_or_else(|| invalid("invalid word"))?;
        let text_start = authored[cursor..].find(text).ok_or_else(|| invalid("word missing from text"))? + cursor;
        cursor = text_start + text.len();
        let a = old.source(clip.start_sec + num(word.get("startSec"), 0.0));
        let b = old.source(clip.start_sec + num(word.get("endSec"), 0.0));
        let word_start = a.min(b);
        let word_end = a.max(b);
        let midpoint = (word_start + word_end) / 2.0;
        if word_end <= left || word_start >= right || (partition && (midpoint < new.media || midpoint >= new.end())) {
            continue;
        }
        let a = new.timeline(word_start.max(left));
        let b = new.timeline(word_end.min(right));
        words.push(serde_json::json!({"text":text,"startSec":(a.min(b)-next_start).max(0.0),"endSec":(a.max(b)-next_start).min(next_end-next_start)}));
        first.get_or_insert(text_start);
        last = cursor;
    }
    if partial && words.is_empty() {
        return Ok(None);
    }
    let mut output = clip.clone();
    output.start_sec = next_start.max(0.0);
    output.duration_sec = next_end - next_start;
    let data = output.extra.get_mut("caption").expect("admitted cue");
    if partial {
        data["text"] = Value::from(&authored[first.unwrap_or(0)..last]);
    }
    data["words"] = Value::Array(words);
    data["sources"] = Value::Array(vec![binding.clone()]);
    data["sources"][0]["clipId"] = Value::from(new.clip.id.clone());
    data["sources"][0]["sourceStartSec"] = Value::from(left);
    data["sources"][0]["sourceEndSec"] = Value::from(right);
    if new.clip.id != old.clip.id {
        output.id = format!("{}:source:{}", clip.id, new.clip.id);
    }
    Ok(Some(output))
}

/// Reconcile after a whole command/batch, so uniform mixed-source moves stay unambiguous.
pub fn synchronize(before: &EditScope, mut after: EditScope) -> EngineResult<EditScope> {
    let mut output = Vec::with_capacity(after.doc.clips.len());
    let mut any = false;
    for clip in &after.doc.clips {
        let Some(cue) = clip.extra.get("caption") else {
            output.push(clip.clone());
            continue;
        };
        let Some(sources) = cue.get("sources").and_then(Value::as_array).filter(|sources| !sources.is_empty()) else {
            output.push(clip.clone());
            continue;
        };
        if cue["status"].as_str() == Some("needs-refresh") || !before.doc.clips.iter().any(|old| old.id == clip.id && old.extra.get("caption") == Some(cue)) {
            output.push(clip.clone());
            continue;
        }
        let old = sources.iter().map(|binding| bound_window(before, binding)).collect::<Option<Vec<_>>>();
        let current = sources.iter().map(|binding| bound_window(&after, binding)).collect::<Option<Vec<_>>>();
        let Some(old) = old else {
            output.push(clip.clone());
            continue;
        };
        let same = current.as_ref().is_some_and(|current| {
            old.iter()
                .zip(current)
                .all(|(a, b)| a.unchanged_media(b) && a.start == b.start && a.media == b.media && a.duration == b.duration && a.rate == b.rate)
        });
        // New instances with the same admitted media are split halves or duplicates.
        let copies: Vec<_> = if sources.len() == 1 {
            after
                .doc
                .clips
                .iter()
                .filter(|candidate| {
                    candidate.kind == old[0].clip.kind && candidate.id != old[0].clip.id && !before.doc.clips.iter().any(|prior| prior.id == candidate.id)
                })
                .filter_map(|candidate| window(&after, candidate, &sources[0]))
                .filter(|candidate| old[0].unchanged_media(candidate))
                .collect()
        } else {
            vec![]
        };
        if same && copies.is_empty() {
            output.push(clip.clone());
            continue;
        }
        changed(before, clip)?;
        for source in &old {
            changed(before, source.clip)?;
        }
        if let Some(current) = &current {
            for source in current {
                changed(&after, source.clip)?;
            }
        }
        any = true;
        if sources.len() > 1 {
            let uniform = current.as_ref().filter(|current| {
                old.iter().zip(current.iter()).all(|(a, b)| a.unchanged_media(b) && a.media == b.media && a.duration == b.duration && a.rate == b.rate)
            });
            if let Some(current) = uniform {
                let shift = current[0].start - old[0].start;
                if old.iter().zip(current).all(|(a, b)| ((b.start - a.start) - shift).abs() < 1e-8) {
                    let mut moved = clip.as_ref().clone();
                    moved.start_sec += shift;
                    if moved.start_sec < 0.0 {
                        return Err(invalid("source move puts caption before timeline"));
                    }
                    output.push(Arc::new(moved));
                    continue;
                }
            }
            output.push(Arc::new(stale(clip)));
            continue;
        }
        let current = current.as_ref().map(|items| &items[0]);
        if current.is_some_and(|current| !old[0].unchanged_media(current)) {
            output.push(Arc::new(stale(clip)));
            continue;
        }
        let split =
            current.is_some_and(|current| copies.iter().any(|copy| (copy.media - current.end()).abs() < 1e-8 || (current.media - copy.end()).abs() < 1e-8));
        if split
            && cue["protection"]["text"].as_bool() == Some(true)
            && current
                .is_some_and(|current| num(sources[0].get("sourceStartSec"), 0.0) < current.end() && num(sources[0].get("sourceEndSec"), 0.0) > current.end())
        {
            output.push(Arc::new(stale(clip)));
            continue;
        }
        if let Some(current) = current {
            if same {
                output.push(clip.clone());
            } else if let Some(mapped) = mapped(clip, &sources[0], &old[0], current, split)? {
                output.push(Arc::new(mapped));
            }
        }
        for copy in copies {
            changed(&after, copy.clip)?;
            if let Some(mapped) = mapped(clip, &sources[0], &old[0], &copy, split)? {
                if after.doc.clips.iter().any(|clip| clip.id == mapped.id) || output.iter().any(|clip| clip.id == mapped.id) {
                    return Err(invalid("duplicate caption identity"));
                }
                output.push(Arc::new(mapped));
            }
        }
    }
    let cue_changes = any && output != after.doc.clips;
    if cue_changes {
        for clip in &mut output {
            if clip.kind == ClipType::Caption && before.doc.clips.iter().find(|old| old.id == clip.id).is_none_or(|old| old.as_ref() != clip.as_ref()) {
                crate::captions::bump(Arc::make_mut(clip).extra.get_mut("caption").expect("admitted cue"))?;
            }
        }
        after.doc.clips = output;
    }
    let deletion_changes = synchronize_deletions(before, &mut after)?;
    if (cue_changes || deletion_changes)
        && let Some(set) = Arc::make_mut(&mut after.doc.extra).get_mut("captionSet")
    {
        crate::captions::bump(set)?;
    }
    Ok(after)
}

pub fn inverse(before: &EditScope, after: &EditScope, command: crate::command::EditorCommand) -> EngineResult<crate::command::EditorCommand> {
    let mut ids = Vec::new();
    for clip in before.doc.clips.iter().chain(&after.doc.clips).filter(|clip| clip.kind == ClipType::Caption) {
        let a = before.doc.clips.iter().find(|item| item.id == clip.id);
        let b = after.doc.clips.iter().find(|item| item.id == clip.id);
        if a != b && !ids.contains(&Value::from(clip.id.clone())) {
            ids.push(Value::from(clip.id.clone()));
        }
    }
    if ids.is_empty() && before.doc.extra.get("captionSet") == after.doc.extra.get("captionSet") {
        return Ok(command);
    }
    let edit = serde_json::json!({"action":"restore","ids":ids,"entries":[]});
    let restore = crate::captions::caption_inverse(before, &edit)?;
    Ok(crate::command::EditorCommand::Batch { commands: vec![command, restore], label: None })
}

pub fn verify_result_sources(scope: &EditScope, edit: &Value) -> EngineResult<()> {
    let snapshot = edit.get("snapshot").ok_or_else(|| invalid("missing source snapshot"))?;
    let mut captured = scope.clone();
    captured.doc.clips = snapshot
        .get("sourceClips")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("invalid source snapshot"))?
        .iter()
        .map(|value| serde_json::from_value::<Clip>(value.clone()).map(Arc::new).map_err(|_| invalid("invalid source snapshot clip")))
        .collect::<EngineResult<_>>()?;
    let fields = Arc::make_mut(&mut captured.doc.extra);
    if let Some(flags) = snapshot.get("trackFlags") {
        fields.insert("trackFlags".into(), flags.clone());
    } else {
        fields.remove("trackFlags");
    }
    for binding in edit.get("sources").and_then(Value::as_array).ok_or_else(|| invalid("invalid result sources"))? {
        let old = bound_window(&captured, binding).ok_or_else(|| invalid("source snapshot is unavailable"))?;
        let current = bound_window(scope, binding).ok_or_else(|| invalid("source changed during processing; regenerate captions"))?;
        changed(scope, current.clip)?;
        if !old.unchanged_media(&current)
            || old.start != current.start
            || old.duration != current.duration
            || old.media != current.media
            || old.rate != current.rate
        {
            return Err(invalid("source changed during processing; regenerate captions"));
        }
    }
    Ok(())
}

fn synchronize_deletions(before: &EditScope, after: &mut EditScope) -> EngineResult<bool> {
    let Some(ranges) = after.doc.extra.get("captionSet").and_then(|set| set.get("deletedRanges")).and_then(Value::as_array) else { return Ok(false) };
    let mut output = Vec::new();
    for range in ranges {
        let Some(bindings) = range.get("sources").and_then(Value::as_array).filter(|bindings| !bindings.is_empty()) else {
            output.push(range.clone());
            continue;
        };
        let binding = &bindings[0];
        let Some(old) = bound_window(before, binding) else {
            output.push(range.clone());
            continue;
        };
        let current = bound_window(after, binding);
        let mut original = range.clone();
        if let Some(current) = current.filter(|current| bindings.len() == 1 && old.unchanged_media(current))
            && (old.start != current.start || old.media != current.media || old.duration != current.duration || old.rate != current.rate)
        {
            changed(before, old.clip)?;
            changed(after, current.clip)?;
            let a = current.timeline(num(binding.get("sourceStartSec"), 0.0));
            let b = current.timeline(num(binding.get("sourceEndSec"), 0.0));
            if a.min(b) >= 0.0 {
                original["startSec"] = Value::from(a.min(b));
                original["endSec"] = Value::from(a.max(b));
            }
        }
        output.push(original);
        for (index, binding) in bindings.iter().enumerate() {
            let Some(old) = bound_window(before, binding) else { continue };
            for candidate in
                after.doc.clips.iter().filter(|candidate| candidate.kind == old.clip.kind && !before.doc.clips.iter().any(|prior| prior.id == candidate.id))
            {
                let Some(copy) = window(after, candidate, binding).filter(|copy| old.unchanged_media(copy)) else { continue };
                let left = num(binding.get("sourceStartSec"), 0.0).max(copy.media);
                let right = num(binding.get("sourceEndSec"), 0.0).min(copy.end());
                if right <= left {
                    continue;
                }
                changed(after, copy.clip)?;
                let mut copied = range.clone();
                copied["id"] = Value::from(format!("{}:source:{}:{}", range["id"].as_str().unwrap_or("deleted"), old.clip.id, candidate.id));
                let a = copy.timeline(left);
                let b = copy.timeline(right);
                copied["startSec"] = Value::from(a.min(b));
                copied["endSec"] = Value::from(a.max(b));
                copied["sources"][index]["clipId"] = Value::from(candidate.id.clone());
                copied["sources"][index]["sourceStartSec"] = Value::from(left);
                copied["sources"][index]["sourceEndSec"] = Value::from(right);
                if output.iter().any(|range| range["id"] == copied["id"]) {
                    return Err(invalid("duplicate deletion identity"));
                }
                output.push(copied);
            }
        }
    }
    if crate::caption_results::same(&Value::Array(output.clone()), &Value::Array(ranges.clone())) {
        return Ok(false);
    }
    Arc::make_mut(&mut after.doc.extra).get_mut("captionSet").ok_or_else(|| invalid("caption set is missing"))?["deletedRanges"] = Value::Array(output);
    Ok(true)
}
