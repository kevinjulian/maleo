//! A clip's retained window: a port of `clipSourceRange`,
//! `canRetainClipWindow`, `retainClipWindow`, `sceneVisualSourceDuration` and
//! the resize half of `trimMediaTiming` in
//! `packages/shared/src/source-interval.ts`.
//!
//! Payloads stay JSON (design decision 3), so each read reproduces the
//! JavaScript it replaces: `??` treats only absent and `null` as missing, `?.`
//! reads through anything, a condition is JavaScript truthiness, and an object
//! spread keeps an existing key in its place.

use serde_json::{Map, Number, Value};

use crate::error::{EngineError, EngineResult};
use crate::execute::with_mirrored_timing;
use crate::keyframes::{js_max, js_min, num, retain_animation};
use crate::schema::{Clip, Passthrough};
use crate::source::{editable_rate, js_truthy, slice_source_interval};

/// Where a clip reads its source (`clipSourceRange`).
pub struct SourceRange {
    pub start: f64,
    pub rate: f64,
    pub reverse: bool,
    pub asset_id: Option<Value>,
}

fn number(value: f64) -> EngineResult<Value> {
    Number::from_f64(value).map(Value::Number).ok_or_else(|| EngineError::InvalidInput(format!("non-finite number {value}")))
}

/// `x ?? 0` for a media start: absent or `null` is 0, a number is itself, and
/// anything else is not a finite number, which every reader refuses.
fn media_start(value: Option<&Value>) -> f64 {
    match value {
        None | Some(Value::Null) => 0.0,
        Some(Value::Number(number)) => number.as_f64().unwrap_or(f64::NAN),
        Some(_) => f64::NAN,
    }
}

/// `x ?? fallback`.
fn or<'a>(value: Option<&'a Value>, fallback: Option<&'a Value>) -> Option<&'a Value> {
    match value {
        None | Some(Value::Null) => fallback,
        present => present,
    }
}

/// `{ ...a, ...b }` for two optional layouts.
fn merged(a: Option<&Value>, b: Option<&Value>) -> Passthrough {
    let mut layout = a.and_then(Value::as_object).cloned().unwrap_or_default();
    if let Some(b) = b.and_then(Value::as_object) {
        layout.extend(b.iter().map(|(key, value)| (key.clone(), value.clone())));
    }
    layout
}

fn is_video(value: &Value) -> bool {
    value.get("kind").and_then(Value::as_str) == Some("video")
}

/// The scene's one visual clip that starts at the scene start, when it has exactly one.
fn single_visual(clip: &Clip) -> Option<&Value> {
    let visuals = clip.payload("scene")?.get("visualClips")?.as_array()?;
    (visuals.len() == 1 && !js_truthy(visuals[0].get("startSec"))).then(|| &visuals[0])
}

fn scene_layout(clip: &Clip) -> Option<&Value> {
    clip.payload("scene").and_then(|scene| scene.get("layout"))
}

/// `sceneVisualSourceDuration(selected, scene, layout)`.
pub fn scene_visual_source_duration(selected: f64, scene: f64, layout: &Passthrough) -> f64 {
    let preserves = layout.contains_key("preservePitch") || layout.get("reverseMedia").is_some_and(|value| !value.is_null());
    if preserves { js_min(selected, scene) } else { scene }
}

/// `clipSourceRange(clip)`.
pub fn clip_source_range(clip: &Clip) -> Option<SourceRange> {
    if let Some(video) = clip.payload("video").filter(|video| video.get("kind").and_then(Value::as_str) == Some("video")) {
        let layout = video.get("layout");
        return Some(SourceRange {
            start: media_start(video.get("mediaStartSec")),
            rate: editable_rate(layout.and_then(|layout| layout.get("playbackRate"))),
            reverse: js_truthy(layout.and_then(|layout| layout.get("reverse"))),
            asset_id: video.get("mediaAssetId").cloned(),
        });
    }
    if let Some(audio) = clip.payload("audio").filter(|audio| js_truthy(audio.get("url"))) {
        return Some(SourceRange {
            start: media_start(audio.get("mediaStartSec")),
            rate: editable_rate(audio.get("playbackRate")),
            reverse: js_truthy(audio.get("reverse")),
            asset_id: audio.get("mediaAssetId").cloned(),
        });
    }
    let vclip = clip.payload("vis").and_then(|vis| vis.get("vclip"));
    let visual = or(vclip, single_visual(clip))?;
    if !is_video(visual) {
        return None;
    }
    let layout = merged(scene_layout(clip), visual.get("layout"));
    Some(SourceRange {
        start: media_start(visual.get("mediaStartSec")),
        rate: editable_rate(layout.get("playbackRate")),
        reverse: js_truthy(layout.get("reverse")),
        asset_id: visual.get("mediaAssetId").cloned(),
    })
}

/// `canRetainClipWindow(clip, from, to)`: a narration hold cannot become a new
/// temporal source after its footage ends.
pub fn can_retain_clip_window(clip: &Clip, from: f64, to: f64) -> bool {
    if !from.is_finite() || !to.is_finite() || to <= from {
        return false;
    }
    match single_visual(clip) {
        Some(visual) if is_video(visual) => {
            from < scene_visual_source_duration(num(visual.get("durationSec")), clip.duration_sec, &merged(scene_layout(clip), visual.get("layout")))
        }
        _ => true,
    }
}

/// `{ ...holder, layout: { ...layout, animation: retained } }`.
fn with_retained_layout(holder: &Passthrough, layout: &Passthrough, from: f64, to: f64) -> EngineResult<Passthrough> {
    let mut next_layout = layout.clone();
    let animation = layout.get("animation").cloned().unwrap_or(Value::Null);
    next_layout.insert("animation".to_owned(), retain_animation(&animation, from, to)?);
    let mut next = holder.clone();
    next.insert("layout".to_owned(), Value::Object(next_layout));
    Ok(next)
}

fn layout_of(holder: &Passthrough) -> Option<&Passthrough> {
    holder.get("layout").and_then(Value::as_object)
}

fn animated(layout: Option<&Passthrough>) -> bool {
    js_truthy(layout.and_then(|layout| layout.get("animation")))
}

/// `retainClipWindow(clip, from, to)`: the clip cut to `[from, to]` of its own
/// timeline, with source offsets, scene-local visual windows and keyframes cut
/// to match. Moving the clip is separate.
pub fn retain_clip_window(clip: &Clip, from: f64, to: f64) -> EngineResult<Clip> {
    if !can_retain_clip_window(clip, from, to) {
        return Err(EngineError::InvalidSourceInterval("Retained window contains no selected source".to_owned()));
    }
    let source = clip_source_range(clip).map(|range| slice_source_interval(range.start, clip.duration_sec, range.rate, range.reverse, from, to)).transpose()?;
    let mut next = clip.clone();
    next.start_sec = clip.start_sec + from;
    next.duration_sec = to - from;

    let video = clip.payload("video");
    let audio = clip.payload("audio");
    let mut next_video = None;
    let mut next_audio = None;
    if let (Some(source), Some(video)) = (source, video) {
        let mut retimed = video.clone();
        retimed.insert("mediaStartSec".to_owned(), number(source.start)?);
        next_video = Some(retimed);
    }
    if let (Some(source), Some(audio)) = (source, audio) {
        let mut retimed = audio.clone();
        retimed.insert("mediaStartSec".to_owned(), number(source.start)?);
        next_audio = Some(retimed);
    }
    if let Some(audio) = audio.filter(|audio| js_truthy(audio.get("animation"))) {
        let mut keyed = next_audio.unwrap_or_else(|| audio.clone());
        keyed.insert("animation".to_owned(), retain_animation(&audio["animation"], from, to)?);
        next_audio = Some(keyed);
    }
    if let Some(video) = video.filter(|video| animated(layout_of(video))) {
        let base = next_video.unwrap_or_else(|| video.clone());
        next_video = Some(with_retained_layout(&base, layout_of(video).unwrap_or(&Map::new()), from, to)?);
    }
    for (key, payload) in [("video", next_video), ("audio", next_audio)] {
        if let Some(payload) = payload {
            next.extra.insert(key.to_owned(), Value::Object(payload));
        }
    }

    if let Some(vis) = clip.payload("vis") {
        let vclip = vis.get("vclip").and_then(Value::as_object);
        let mut next_vis = None;
        if let Some(source) = source {
            let mut cut = vclip.cloned().unwrap_or_default();
            cut.insert("mediaStartSec".to_owned(), number(source.start)?);
            cut.insert("durationSec".to_owned(), number(to - from)?);
            let mut held = vis.clone();
            held.insert("vclip".to_owned(), Value::Object(cut));
            next_vis = Some(held);
        }
        if let Some(layout) = vclip.and_then(layout_of).filter(|layout| animated(Some(layout))) {
            let base = next_vis.unwrap_or_else(|| vis.clone());
            let base_vclip = base.get("vclip").and_then(Value::as_object).cloned().unwrap_or_default();
            let mut held = base.clone();
            held.insert("vclip".to_owned(), Value::Object(with_retained_layout(&base_vclip, layout, from, to)?));
            next_vis = Some(held);
        }
        if let Some(vis) = next_vis {
            next.extra.insert("vis".to_owned(), Value::Object(vis));
        }
    }

    if let Some(scene) = clip.payload("scene") {
        let visuals = scene.get("visualClips");
        let mut next_scene = None;
        // A scene drawn from its own image carries keys on the scene layout itself.
        let has_visuals = visuals.and_then(Value::as_array).is_some_and(|visuals| !visuals.is_empty());
        if let Some(layout) = layout_of(scene).filter(|layout| animated(Some(layout)) && !has_visuals) {
            next_scene = Some(with_retained_layout(scene, layout, from, to)?);
        }
        if js_truthy(visuals) {
            let visuals = visuals.and_then(Value::as_array).ok_or_else(|| EngineError::InvalidInput("scene visualClips is not an array".to_owned()))?;
            let cut = retained_visuals(clip, visuals, from, to)?;
            let mut held = next_scene.unwrap_or_else(|| scene.clone());
            held.insert("visualClips".to_owned(), Value::Array(cut));
            next_scene = Some(held);
        }
        if let Some(scene) = next_scene {
            next.extra.insert("scene".to_owned(), Value::Object(scene));
        }
    }
    with_mirrored_timing(next)
}

/// The scene's visual clips that overlap `[from, to]`, each cut to it.
fn retained_visuals(clip: &Clip, visuals: &[Value], from: f64, to: f64) -> EngineResult<Vec<Value>> {
    let single = visuals.len() == 1 && !js_truthy(visuals[0].get("startSec"));
    let mut cut = Vec::new();
    for visual in visuals {
        let layout = merged(scene_layout(clip), visual.get("layout"));
        let video = is_video(visual);
        let start = if single { 0.0 } else { num(visual.get("startSec")) };
        let duration = match (single, video) {
            (true, true) => scene_visual_source_duration(num(visual.get("durationSec")), clip.duration_sec, &layout),
            (true, false) => clip.duration_sec,
            (false, _) => num(visual.get("durationSec")),
        };
        let left = js_max(from, start);
        let right = js_min(to, start + duration);
        if right <= left {
            continue;
        }
        let interval = if video {
            Some(slice_source_interval(
                media_start(visual.get("mediaStartSec")),
                duration,
                editable_rate(layout.get("playbackRate")),
                js_truthy(layout.get("reverse")),
                left - start,
                right - start,
            )?)
        } else {
            None
        };
        let mut next = visual.as_object().cloned().unwrap_or_default();
        next.insert("startSec".to_owned(), number(left - from)?);
        next.insert("durationSec".to_owned(), number(right - left)?);
        if let Some(interval) = interval {
            next.insert("mediaStartSec".to_owned(), number(interval.start)?);
        }
        if animated(Some(&layout)) {
            let mut full = Map::new();
            for (key, value) in [("xPct", 0.0), ("yPct", 0.0), ("widthPct", 100.0), ("heightPct", 100.0)] {
                full.insert(key.to_owned(), number(value)?);
            }
            full.insert("fit".to_owned(), Value::String("cover".to_owned()));
            full.extend(layout.iter().map(|(key, value)| (key.clone(), value.clone())));
            full.insert("animation".to_owned(), retain_animation(&layout["animation"], left - start, right - start)?);
            next.insert("layout".to_owned(), Value::Object(full));
        }
        cut.push(Value::Object(next));
    }
    Ok(cut)
}

/// The resize half of `trimMediaTiming`: the timeline window a resize keeps,
/// bounded by the source on both sides, or `None` when it would leave less than
/// a frame or the inputs are not finite.
pub fn resize_timing(clip: &Clip, range: &SourceRange, start_sec: Option<f64>, duration_sec: f64, extent: Option<&Value>) -> EngineResult<Option<(f64, f64)>> {
    let (start, dur, source_start, rate, reverse) = (clip.start_sec, clip.duration_sec, range.start, range.rate, range.reverse);
    let next_start = start_sec.unwrap_or(start);
    if ![start, dur, source_start, rate, next_start, duration_sec].iter().all(|value| value.is_finite()) {
        return Ok(None);
    }
    let bound = match extent {
        None | Some(Value::Null) => f64::INFINITY,
        Some(value) => match value.as_f64() {
            Some(duration) if duration.is_finite() && duration > 0.0 => duration,
            _ => return Ok(None),
        },
    };
    let mut from = next_start - start;
    let mut to = from + duration_sec;
    from = js_max(js_max(from, if reverse { dur - (bound - source_start) / rate } else { -source_start / rate }), -start);
    to = js_min(to, if reverse { dur + source_start / rate } else { (bound - source_start) / rate });
    if to - from < 1.0 / 30.0 {
        return Ok(None);
    }
    slice_source_interval(source_start, dur, rate, reverse, from, to)?;
    Ok(Some((start + from, to - from)))
}
