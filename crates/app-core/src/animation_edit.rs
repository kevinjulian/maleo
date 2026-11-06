//! The inspector's animation edits (`p1-envelope-inspector` task 3.4): what a
//! clip or overlay can key, the key edits, moments and their easing, pasted
//! keys, edge presets and a row's keying at the playhead. Ports of
//! `clip-animation-edit.ts` and `edge-animation.ts`, held to
//! `clip-animation-edit.reference.json`. Each edit answers a command or the
//! refusal a controller shows.

use maleo_editor_core::EditScope;
use maleo_editor_core::keyframes::{evaluate_value_track, js_max, js_min, js_round, num};
use maleo_editor_core::keys::{COLOR, NUMERIC, is_color, key_error, key_target_view, numeric};
use maleo_editor_core::source::js_truthy;
use serde_json::{Map, Value, json};

use crate::canvas::edit::{id_text, merged_visuals, normalized_visuals, scene_parts, spread, template, text_of};
use crate::keys::{KEY_SNAP_SEC, near_key_index, upsert_key};

/// One frame at 30 fps: key times within half of it are one moment.
const MOMENT_SEC: f64 = 1.0 / 30.0;
const NEAR: f64 = 1e-6;

/// A refusal message, as the TS edits threw it.
pub type Refused = String;
type Edit = Result<Value, Refused>;

/// `ClipAnimationTarget`: `{source, id, visualId?}`.
#[derive(Clone, Debug, PartialEq)]
pub struct Target {
    pub source: String,
    pub id: f64,
    pub visual_id: Option<String>,
}

impl Target {
    pub fn from_value(value: &Value) -> Result<Self, String> {
        let source = value.get("source").and_then(Value::as_str).ok_or("target.source is a string")?.to_owned();
        let id = value.get("id").and_then(Value::as_f64).ok_or("target.id is a number")?;
        let visual_id = value.get("visualId").and_then(Value::as_str).map(str::to_owned);
        Ok(Self { source, id, visual_id })
    }

    pub fn to_value(&self) -> Value {
        let mut out = Map::new();
        out.insert("source".into(), Value::from(self.source.as_str()));
        out.insert("id".into(), json!(self.id));
        if let Some(visual) = &self.visual_id {
            out.insert("visualId".into(), Value::from(visual.as_str()));
        }
        Value::Object(out)
    }
}

/// What the inspector reads of a target (`clipAnimationInfo`).
#[derive(Clone, Debug)]
pub struct Info {
    pub id: String,
    pub kind: Option<String>,
    pub start: f64,
    pub duration: f64,
    pub animation: Option<Value>,
    pub values: Map<String, Value>,
    pub properties: Vec<&'static str>,
    pub locked: bool,
}

impl Info {
    fn audio(&self) -> bool {
        self.kind.as_deref() == Some("audio")
    }

    fn has_volume(&self) -> bool {
        self.properties.contains(&"volume")
    }

    fn track(&self, property: &str) -> Vec<Value> {
        track_of(self.animation.as_ref(), property)
    }

    pub fn to_value(&self) -> Value {
        let mut out = Map::new();
        out.insert("id".into(), Value::from(self.id.as_str()));
        if let Some(kind) = &self.kind {
            out.insert("kind".into(), Value::from(kind.as_str()));
        }
        out.insert("start".into(), json!(self.start));
        out.insert("duration".into(), json!(self.duration));
        if let Some(animation) = &self.animation {
            out.insert("animation".into(), animation.clone());
        }
        out.insert("values".into(), Value::Object(self.values.clone()));
        out.insert("properties".into(), json!(self.properties));
        out.insert("locked".into(), Value::Bool(self.locked));
        out.insert("audio".into(), Value::Bool(self.audio()));
        out.insert("hasVolume".into(), Value::Bool(self.has_volume()));
        Value::Object(out)
    }
}

/// `animation?.tracks[p]` or `animation?.colorTracks?.[p]`, empty when absent.
fn track_of(animation: Option<&Value>, property: &str) -> Vec<Value> {
    let group = if is_color(property) { "colorTracks" } else { "tracks" };
    animation.and_then(|a| a.get(group)).and_then(|t| t.get(property)).and_then(Value::as_array).cloned().unwrap_or_default()
}

fn neutral(property: &str) -> f64 {
    numeric(property).map_or(0.0, |spec| spec.neutral)
}

fn properties_for(kind: Option<&str>) -> Vec<&'static str> {
    NUMERIC.iter().filter(|spec| kind.is_some_and(|kind| spec.kinds.contains(&kind))).map(|spec| spec.name).collect()
}

fn set_keys(id: &str, property: &str, keys: Vec<Value>) -> Value {
    json!({ "type": "clip.setKeys", "id": id, "property": property, "keys": keys })
}

fn batch(commands: Vec<Value>, label: &str) -> Value {
    json!({ "type": "batch", "commands": commands, "label": label })
}

/// One command alone, or several as one labelled batch.
fn together(mut commands: Vec<Value>, label: &str) -> Value {
    if commands.len() == 1 { commands.remove(0) } else { batch(commands, label) }
}

/// Keys sorted by time, stable, as `Array.prototype.sort` orders them.
fn by_time(mut keys: Vec<Value>) -> Vec<Value> {
    keys.sort_by(|a, b| num(a.get("t")).partial_cmp(&num(b.get("t"))).unwrap_or(std::cmp::Ordering::Equal));
    keys
}

fn with_field(key: &Value, field: &str, value: Value) -> Value {
    let mut key = key.clone();
    if let Some(fields) = key.as_object_mut() {
        fields.insert(field.to_owned(), value);
    }
    key
}

/// `clipIdForTarget`: the clip that holds a target's animation.
pub fn clip_id_for_target(scope: &EditScope, target: &Target) -> String {
    let id = id_text(target.id);
    if target.source != "scene" {
        return format!("{}:{id}", target.source);
    }
    match target.visual_id.as_deref().filter(|visual| !visual.is_empty()) {
        Some(visual) => {
            let vis = format!("vis:{id}:{visual}");
            if scope.doc.clips.iter().any(|clip| clip.id == vis) { vis } else { format!("scene:{id}") }
        }
        None => format!("scene:{id}"),
    }
}

/// `animationTargetForId`: the target a clip id keys.
pub fn target_for_id(scope: &EditScope, id: &str) -> Option<Target> {
    let clip = scope.doc.clips.iter().find(|clip| clip.id == id)?;
    let make = |source: &str, id: Option<&Value>, visual: Option<String>| Some(Target { source: source.to_owned(), id: num(id), visual_id: visual });
    if let Some(scene) = clip.payload("scene") {
        let visuals = normalized_visuals(scene, scene.get("visualClips").and_then(Value::as_array).map(Vec::as_slice));
        let visual = visuals.iter().find(|v| js_truthy(v.get("primary"))).or(visuals.first())?;
        return make("scene", scene.get("id"), Some(template(visual.get("id"))));
    }
    if let Some(vis) = clip.payload("vis") {
        return make("scene", vis.get("sceneId"), Some(template(vis.get("vclip").and_then(|v| v.get("id")))));
    }
    for source in ["video", "audio", "text"] {
        if let Some(payload) = clip.payload(source) {
            return make(source, payload.get("id"), None);
        }
    }
    None
}

/// A scene as `fromTimelineDoc` lists it: its view, its merged visual list
/// (raw) and its normalized visuals.
type SceneView = (Map<String, Value>, Option<Vec<Value>>, Vec<Map<String, Value>>);

/// The scene the projected view lists under `id`.
fn scene_view(scope: &EditScope, id: f64) -> Option<SceneView> {
    scope.doc.clips.iter().find_map(|clip| {
        let payload = clip.payload("scene")?;
        if payload.get("id").and_then(Value::as_f64) != Some(id) {
            return None;
        }
        let (scene, visuals) = scene_parts(scope, clip);
        let raw = merged_visuals(scope, clip, &scene).or_else(|| scene.get("visualClips").and_then(Value::as_array).cloned());
        Some((scene, raw, visuals))
    })
}

/// `selectedClipAnimationTarget`: the target a selection keys.
pub fn selected_target(scope: &EditScope, selection: &Value, choice: Option<&Value>) -> Option<Target> {
    let id = |key: &str| selection.get(key).and_then(Value::as_f64);
    for (key, source) in [("videoOverlayId", "video"), ("audioId", "audio"), ("overlayId", "text")] {
        if let Some(id) = id(key) {
            return Some(Target { source: source.to_owned(), id, visual_id: None });
        }
    }
    let scene_id = id("sceneId")?;
    let (_, _, visuals) = scene_view(scope, scene_id)?;
    let chosen = choice.filter(|c| c.get("sceneId").and_then(Value::as_f64) == Some(scene_id)).and_then(|c| c.get("visualId")).and_then(Value::as_str);
    let visual = visuals.iter().find(|v| chosen.is_some_and(|chosen| text_of(v.get("id")) == Some(chosen))).or(visuals.first())?;
    Some(Target { source: "scene".to_owned(), id: scene_id, visual_id: Some(template(visual.get("id"))) })
}

/// `staticValue`: a property's unanimated value for a target.
fn static_value(scope: &EditScope, target: &Target, property: &str) -> Value {
    let payload_of = |source: &str| {
        scope.doc.clips.iter().find_map(|clip| clip.payload(source).filter(|payload| payload.get("id").and_then(Value::as_f64) == Some(target.id)))
    };
    if target.source == "audio" {
        let volume = payload_of("audio").and_then(|audio| audio.get("volume")).filter(|v| !v.is_null()).cloned();
        return if property == "volume" { volume.unwrap_or_else(|| json!(1)) } else { json!(neutral(property)) };
    }
    let scene = (target.source == "scene").then(|| scene_view(scope, target.id)).flatten();
    let visual = scene.as_ref().and_then(|(_, _, visuals)| {
        visuals.iter().find(|v| target.visual_id.as_deref().is_some_and(|id| text_of(v.get("id")) == Some(id))).or(visuals.first()).cloned()
    });
    let overlay = match target.source.as_str() {
        "video" | "text" => payload_of(&target.source),
        _ => None,
    };
    let layout: Option<Map<String, Value>> = match &scene {
        Some((scene, _, _)) => Some(spread(scene.get("layout"), visual.as_ref().and_then(|v| v.get("layout")))),
        None => overlay.and_then(|o| o.get("layout")).and_then(Value::as_object).cloned(),
    };
    let style = (target.source == "text").then(|| overlay.and_then(|o| o.get("style"))).flatten();
    let volume = if target.source == "video" {
        overlay.and_then(|o| o.get("volume")).cloned()
    } else {
        let one = scene.as_ref().and_then(|(_, raw, _)| raw.as_ref()).is_some_and(|raw| raw.len() == 1);
        visual.as_ref().and_then(|v| v.get("volume")).filter(|v| !v.is_null()).cloned().or_else(|| Some(json!(if one { 1 } else { 0 })))
    };
    let from_layout = |key: &str| layout.as_ref().and_then(|l| l.get(key)).cloned();
    let value = match property {
        "xPct" | "yPct" | "rotationDeg" | "opacity" | "widthPct" | "heightPct" => from_layout(property),
        "volume" => volume,
        "bgOpacity" | "fontSize" | "letterSpacing" | "lineHeight" => style.and_then(|s| s.get(property)).cloned(),
        _ => None,
    };
    value.filter(|v| !v.is_null()).unwrap_or_else(|| json!(neutral(property)))
}

/// `clipAnimationInfo(doc, target)`.
pub fn info(scope: &EditScope, target: &Target) -> Option<Info> {
    let id = clip_id_for_target(scope, target);
    let keyed = key_target_view(scope, &id).ok().flatten()?;
    let clip = scope.doc.clips.iter().find(|clip| clip.id == id)?;
    let start = match clip.payload("scene") {
        Some(scene) => {
            let visuals = normalized_visuals(scene, scene.get("visualClips").and_then(Value::as_array).map(Vec::as_slice));
            clip.start_sec + visuals.first().and_then(|v| v.get("startSec")).and_then(Value::as_f64).unwrap_or(0.0)
        }
        None => clip.start_sec,
    };
    let properties = properties_for(keyed.kind.as_deref());
    let values = properties.iter().map(|p| ((*p).to_owned(), static_value(scope, target, p))).collect();
    Some(Info { id, kind: keyed.kind, start, duration: keyed.duration, animation: keyed.animation, values, properties, locked: keyed.locked })
}

fn base_value(info: &Info, property: &str) -> f64 {
    info.values.get(property).and_then(Value::as_f64).unwrap_or_else(|| neutral(property))
}

/// `clipKeyError` as a thrown refusal, else the command.
fn checked(scope: &EditScope, id: &str, property: &str, keys: Vec<Value>) -> Edit {
    match key_error(scope, id, property, &keys).map_err(|error| error.to_string())? {
        Some(message) => Err(message),
        None => Ok(set_keys(id, property, keys)),
    }
}

/// `trackCommand`: the command setting `keys` on one track, or its refusal.
fn track_command(scope: &EditScope, target: &Target, property: &str, keys: Vec<Value>) -> Edit {
    let info = info(scope, target).ok_or("Selected clip is locked or unavailable")?;
    if info.locked {
        return Err("Selected clip is on a locked track".into());
    }
    if property == "volume" && !info.has_volume() {
        let image = info.kind.as_deref() == Some("image");
        return Err(if image { "Images have no source volume" } else { "This clip has no source volume" }.into());
    }
    checked(scope, &info.id, property, keys)
}

/// `editClipKey`: write a value at `time`, updating a key within the snap.
pub fn edit_key(scope: &EditScope, target: &Target, property: &str, time: f64, value: Option<f64>, easing: Option<&str>) -> Edit {
    let info = info(scope, target).filter(|info| time.is_finite() && time >= 0.0 && time <= info.duration).ok_or("Keyframe is outside selected clip")?;
    let keys = info.track(property);
    let v = value.unwrap_or_else(|| evaluate_value_track(&keys, time, base_value(&info, property)));
    track_command(scope, target, property, upsert_key(&keys, time, json!(v), easing, KEY_SNAP_SEC))
}

/// `removeClipKey`.
pub fn remove_key(scope: &EditScope, target: &Target, property: &str, index: usize) -> Edit {
    let keys = info(scope, target).map(|info| info.track(property)).unwrap_or_default();
    if index >= keys.len() {
        return Err("Selected keyframe is unavailable".into());
    }
    track_command(scope, target, property, keys.into_iter().enumerate().filter(|(i, _)| *i != index).map(|(_, k)| k).collect())
}

/// `moveClipKey`.
pub fn move_key(scope: &EditScope, target: &Target, property: &str, index: usize, time: f64) -> Edit {
    let info = info(scope, target);
    let keys = info.as_ref().map(|info| info.track(property)).unwrap_or_default();
    let duration = info.as_ref().map_or(0.0, |info| info.duration);
    if index >= keys.len() || !time.is_finite() || time < 0.0 || time > duration {
        return Err("Selected keyframe or new time is unavailable".into());
    }
    let moved = keys.iter().enumerate().map(|(i, k)| if i == index { with_field(k, "t", json!(time)) } else { k.clone() }).collect();
    track_command(scope, target, property, by_time(moved))
}

/// Every keyed property in registry order (numeric, then colour) with its keys.
fn tracks_in_order(animation: Option<&Value>) -> Vec<(&'static str, Vec<Value>)> {
    NUMERIC.iter().map(|spec| spec.name).chain(COLOR).map(|p| (p, track_of(animation, p))).collect()
}

/// `keyMoments`: key times within a frame of each other, across every track.
pub fn moments(animation: Option<&Value>) -> Vec<(f64, Vec<&'static str>)> {
    let mut entries: Vec<(f64, &'static str)> =
        tracks_in_order(animation).into_iter().flat_map(|(p, keys)| keys.iter().map(move |k| (num(k.get("t")), p)).collect::<Vec<_>>()).collect();
    entries.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut out: Vec<(f64, Vec<&'static str>)> = Vec::new();
    for (t, property) in entries {
        match out.last_mut() {
            Some((time, properties)) if t - *time <= MOMENT_SEC / 2.0 + 1e-9 => {
                if !properties.contains(&property) {
                    properties.push(property);
                }
            }
            _ => out.push((t, vec![property])),
        }
    }
    out
}

fn at_moment(times: &[f64], t: f64) -> Option<f64> {
    times.iter().copied().find(|m| (t - m).abs() <= MOMENT_SEC / 2.0 + 1e-9)
}

/// `moveMoments`: every key at the moments shifted by `delta`, or removed when absent.
pub fn move_moments(scope: &EditScope, target: &Target, times: &[f64], delta: Option<f64>) -> Edit {
    let info = info(scope, target).ok_or("Selected clip is unavailable")?;
    if info.locked {
        return Err("Selected clip is on a locked track".into());
    }
    if times.is_empty() {
        return Err("No keys selected".into());
    }
    let low = times.iter().copied().fold(f64::INFINITY, js_min);
    let high = times.iter().copied().fold(f64::NEG_INFINITY, js_max);
    let shift = delta.map_or(0.0, |delta| js_max(-low, js_min(info.duration - high, delta)));
    let mut commands = Vec::new();
    for (property, keys) in tracks_in_order(info.animation.as_ref()) {
        if !keys.iter().any(|k| at_moment(times, num(k.get("t"))).is_some()) {
            continue;
        }
        let moved = match delta {
            None => keys.into_iter().filter(|k| at_moment(times, num(k.get("t"))).is_none()).collect(),
            Some(_) => by_time(
                keys.iter()
                    .map(|k| match at_moment(times, num(k.get("t"))) {
                        None => k.clone(),
                        Some(m) => with_field(k, "t", json!(js_round((m + shift) * 1e6) / 1e6)),
                    })
                    .collect(),
            ),
        };
        commands.push(checked(scope, &info.id, property, moved)?);
    }
    if commands.is_empty() {
        return Err("No keys at that moment".into());
    }
    Ok(together(commands, if delta.is_none() { "remove keyframes" } else { "move keyframes" }))
}

/// `moveMoment`: every key at `from` moved to `to`, or removed when absent.
pub fn move_moment(scope: &EditScope, target: &Target, from: f64, to: Option<f64>) -> Edit {
    if let (Some(to), Some(info)) = (to, info(scope, target))
        && (!to.is_finite() || to < 0.0 || to > info.duration)
    {
        return Err("Keyframe is outside selected clip".into());
    }
    move_moments(scope, target, &[from], to.map(|to| to - from))
}

/// `setMomentsEasing`: the easing of every key at the moments, on one property or all.
pub fn set_moments_easing(scope: &EditScope, target: &Target, times: &[f64], easing: &str, property: Option<&str>) -> Edit {
    let info = info(scope, target).ok_or("Selected clip is unavailable")?;
    let at = |k: &Value| times.iter().any(|m| (num(k.get("t")) - m).abs() <= MOMENT_SEC / 2.0 + 1e-9);
    let mut commands = Vec::new();
    for (p, keys) in tracks_in_order(info.animation.as_ref()) {
        if property.is_some_and(|only| only != p) || !keys.iter().any(at) {
            continue;
        }
        let eased = keys.iter().map(|k| if at(k) { with_field(k, "easing", Value::from(easing)) } else { k.clone() }).collect();
        commands.push(checked(scope, &info.id, p, eased)?);
    }
    if commands.is_empty() {
        return Err("No keys at that moment".into());
    }
    Ok(together(commands, "keyframe easing"))
}

/// `momentKeyEasings`: the easing of every key at a moment, in the animation's own track order.
pub fn moment_easings(animation: Option<&Value>, time: f64) -> Vec<Value> {
    let groups = ["tracks", "colorTracks"].into_iter().filter_map(|group| animation.and_then(|a| a.get(group)).and_then(Value::as_object));
    groups
        .flat_map(|tracks| tracks.values().filter_map(Value::as_array).flatten())
        .filter(|k| (num(k.get("t")) - time).abs() <= MOMENT_SEC / 2.0 + 1e-9)
        .map(|k| k.get("easing").filter(|e| !e.is_null()).cloned().unwrap_or_else(|| Value::from("linear")))
        .collect()
}

/// `pasteClipKeys`: copied tracks replace the clip's tracks for those properties.
pub fn paste_keys(scope: &EditScope, target: &Target, clipboard: &Value) -> Edit {
    let info = info(scope, target).ok_or("Selected clip is unavailable")?;
    if info.locked {
        return Err("Selected clip is on a locked track".into());
    }
    let mut commands = Vec::new();
    for (property, keys) in tracks_in_order(Some(clipboard)) {
        let applies = if is_color(property) { info.kind.as_deref() == Some("text") } else { info.properties.contains(&property) };
        if !keys.is_empty() && applies {
            commands.push(checked(scope, &info.id, property, keys)?);
        }
    }
    if commands.is_empty() {
        return Err("Nothing copied applies to this clip".into());
    }
    Ok(together(commands, "paste keyframes"))
}

/* ── Edge presets (`edge-animation.ts`) ── */

const EDGE_PROPERTIES: [&str; 4] = ["opacity", "volume", "xPct", "scale"];

fn near(a: f64, b: f64) -> bool {
    (a - b).abs() < NEAR
}

fn hidden_value(property: &str, base: f64) -> f64 {
    match property {
        "xPct" => js_max(numeric("xPct").map_or(-50.0, |s| s.min), base - 50.0),
        "scale" => js_max(numeric("scale").map_or(0.01, |s| s.min), base * 0.8),
        _ => 0.0,
    }
}

/// A recognized edge ramp: its preset, property, and the indexes of its two keys.
struct Ramp {
    preset: &'static str,
    property: &'static str,
    pair: [usize; 2],
}

fn edge_ramp(animation: Option<&Value>, edge: &str, duration: f64, values: &Map<String, Value>, audio: bool) -> Option<Ramp> {
    for property in EDGE_PROPERTIES {
        if if audio { property != "volume" } else { property == "volume" } {
            continue;
        }
        let keys = track_of(animation, property);
        if keys.len() < 2 {
            continue;
        }
        let pair = if edge == "in" { [0, 1] } else { [keys.len() - 2, keys.len() - 1] };
        let (a, b) = (&keys[pair[0]], &keys[pair[1]]);
        let base = values.get(property).and_then(Value::as_f64).unwrap_or_else(|| neutral(property));
        let hidden = hidden_value(property, base);
        if near(base, hidden) {
            continue;
        }
        let (at, bt, av, bv) = (num(a.get("t")), num(b.get("t")), num(a.get("v")), num(b.get("v")));
        let mismatch = if edge == "in" {
            !near(at, 0.0) || bt > duration / 2.0 + 1e-6 || !near(av, hidden) || !near(bv, base)
        } else {
            !near(bt, duration) || at < duration / 2.0 - 1e-6 || !near(av, base) || !near(bv, hidden)
        };
        if mismatch || b.get("easing").and_then(Value::as_str) != Some("in-out") || bt <= at {
            continue;
        }
        let preset = match property {
            "xPct" => "slide",
            "scale" => "zoom",
            _ => "fade",
        };
        return Some(Ramp { preset, property, pair });
    }
    None
}

/// `edgeAnimationState`: the preset an edge shows, `custom` for unrecognized keys on it.
pub fn edge_state(animation: Option<&Value>, edge: &str, duration: f64, values: &Map<String, Value>, audio: bool) -> &'static str {
    if let Some(ramp) = edge_ramp(animation, edge, duration, values, audio) {
        return ramp.preset;
    }
    let opposite = edge_ramp(animation, if edge == "in" { "out" } else { "in" }, duration, values, audio);
    let on_edge = |t: f64| if edge == "in" { t <= duration / 2.0 } else { t >= duration / 2.0 };
    let tracks = animation.and_then(|a| a.get("tracks")).and_then(Value::as_object);
    let numeric_custom = tracks.into_iter().flatten().any(|(property, keys)| {
        keys.as_array().into_iter().flatten().enumerate().any(|(index, key)| {
            let in_ramp = opposite.as_ref().is_some_and(|o| o.property == property && o.pair.contains(&index));
            on_edge(num(key.get("t"))) && !in_ramp
        })
    });
    let colors = animation.and_then(|a| a.get("colorTracks")).and_then(Value::as_object);
    let color_custom = colors.into_iter().flatten().any(|(_, keys)| keys.as_array().into_iter().flatten().any(|key| on_edge(num(key.get("t")))));
    if numeric_custom || color_custom { "custom" } else { "none" }
}

/// `edgeAnimationTracks`: the track patches for one edge, in the order they were made.
fn edge_tracks(
    animation: Option<&Value>,
    edge: &str,
    preset: &str,
    seconds: f64,
    duration: f64,
    values: &Map<String, Value>,
    audio: bool,
) -> Result<Vec<(&'static str, Vec<Value>)>, Refused> {
    if !seconds.is_finite() || seconds <= 0.0 || !duration.is_finite() || duration <= 0.0 {
        return Err("Animation duration must be positive".into());
    }
    if audio && preset != "none" && preset != "fade" {
        return Err("Audio supports Fade only".into());
    }
    let previous = edge_ramp(animation, edge, duration, values, audio);
    let opposite = edge_ramp(animation, if edge == "in" { "out" } else { "in" }, duration, values, audio);
    let mut tracks: Vec<(&'static str, Vec<Value>)> = Vec::new();
    if let Some(previous) = &previous {
        let keep =
            |index: usize| !previous.pair.contains(&index) || opposite.as_ref().is_some_and(|o| o.property == previous.property && o.pair.contains(&index));
        let kept = track_of(animation, previous.property).into_iter().enumerate().filter(|(i, _)| keep(*i)).map(|(_, k)| k).collect();
        tracks.push((previous.property, kept));
    }
    if preset == "none" {
        return Ok(tracks);
    }
    let property: &'static str = match preset {
        "fade" if audio => "volume",
        "fade" => "opacity",
        "slide" => "xPct",
        _ => "scale",
    };
    let span = js_min(seconds, duration / 2.0);
    let (start, end) = if edge == "in" { (0.0, span) } else { (duration - span, duration) };
    let base = values.get(property).and_then(Value::as_f64).unwrap_or_else(|| neutral(property));
    let hidden = hidden_value(property, base);
    let current = track_of(animation, property);
    let start_easing = current.iter().find(|k| near(num(k.get("t")), start)).and_then(|k| k.get("easing")).filter(|e| js_truthy(Some(e))).cloned();
    let source = tracks.iter().find(|(p, _)| *p == property).map(|(_, keys)| keys.clone()).unwrap_or(current);
    let mut next: Vec<Value> = source.into_iter().filter(|k| num(k.get("t")) < start - 1e-6 || num(k.get("t")) > end + 1e-6).collect();
    let mut first = json!({ "t": start, "v": if edge == "in" { hidden } else { base } });
    if let (Some(easing), Some(fields)) = (start_easing, first.as_object_mut()) {
        fields.insert("easing".into(), easing);
    }
    next.push(first);
    next.push(json!({ "t": end, "v": if edge == "in" { base } else { hidden }, "easing": "in-out" }));
    let next = by_time(next);
    match tracks.iter_mut().find(|(p, _)| *p == property) {
        Some(entry) => entry.1 = next,
        None => tracks.push((property, next)),
    }
    Ok(tracks)
}

/// `edgeAnimation`: the recognized ramp on an edge, with its preset, property,
/// length and its two keys; `None` when the edge holds no preset ramp.
pub fn edge_ramp_value(animation: Option<&Value>, edge: &str, duration: f64, values: &Map<String, Value>, audio: bool) -> Option<Value> {
    let ramp = edge_ramp(animation, edge, duration, values, audio)?;
    let keys = track_of(animation, ramp.property);
    let (a, b) = (&keys[ramp.pair[0]], &keys[ramp.pair[1]]);
    Some(json!({ "preset": ramp.preset, "property": ramp.property, "duration": num(b.get("t")) - num(a.get("t")), "pair": [a, b] }))
}

/// `edgeAnimationTracks` as a JSON object of track patches, in the order they were made.
pub fn edge_tracks_value(
    animation: Option<&Value>,
    edge: &str,
    preset: &str,
    seconds: f64,
    duration: f64,
    values: &Map<String, Value>,
    audio: bool,
) -> Result<Value, Refused> {
    let tracks = edge_tracks(animation, edge, preset, seconds, duration, values, audio)?;
    Ok(Value::Object(tracks.into_iter().map(|(property, keys)| (property.to_owned(), Value::Array(keys))).collect()))
}

/// `applyEdgePreset`: one batch of track commands for an entrance or exit.
pub fn apply_edge(scope: &EditScope, target: &Target, edge: &str, preset: &str, seconds: f64) -> Edit {
    let info = info(scope, target).ok_or("Selected clip is unavailable")?;
    if info.locked {
        return Err("Selected clip is on a locked track".into());
    }
    let tracks = edge_tracks(info.animation.as_ref(), edge, preset, seconds, info.duration, &info.values, info.audio())?;
    let commands = tracks.into_iter().map(|(property, keys)| track_command(scope, target, property, keys)).collect::<Result<Vec<_>, _>>()?;
    Ok(batch(commands, if edge == "in" { "entrance animation" } else { "exit animation" }))
}

/// `edgeAnimationState` for a target, as the inspector shows it.
pub fn target_edge_state(scope: &EditScope, target: &Target, edge: &str) -> Option<&'static str> {
    let info = info(scope, target)?;
    Some(edge_state(info.animation.as_ref(), edge, info.duration, &info.values, info.audio()))
}

/* ── A row's keying at the playhead ── */

struct Probe {
    property: &'static str,
    at: Option<usize>,
    animated: bool,
    value: f64,
}

/// A row of properties at an absolute playhead time: its key state and values.
pub struct Row {
    pub time: f64,
    pub animated: bool,
    pub keyed: bool,
    pub toggle_disabled: bool,
    pub value_disabled: bool,
    pub values: Map<String, Value>,
    probes: Vec<Probe>,
}

impl Row {
    pub fn to_value(&self) -> Value {
        json!({
            "time": self.time,
            "animated": self.animated,
            "keyed": self.keyed,
            "toggleDisabled": self.toggle_disabled,
            "valueDisabled": self.value_disabled,
            "values": self.values,
        })
    }
}

/// `rowKeyingAt`; `None` when the target cannot key every property of the row.
pub fn row(scope: &EditScope, target: &Target, properties: &[&str], absolute: f64, fps: f64) -> Option<Row> {
    let info = info(scope, target)?;
    let time = js_round((absolute - info.start) * fps) / fps;
    let outside = time < 0.0 || time > info.duration;
    let probes: Vec<Probe> = properties
        .iter()
        .filter_map(|p| info.properties.iter().find(|known| *known == p).copied())
        .map(|property| {
            let keys = info.track(property);
            let base = base_value(&info, property);
            let value = if keys.is_empty() { base } else { evaluate_value_track(&keys, js_max(0.0, js_min(info.duration, time)), base) };
            Probe { property, at: near_key_index(&keys, time, KEY_SNAP_SEC), animated: !keys.is_empty(), value }
        })
        .collect();
    if probes.is_empty() || probes.len() != properties.len() {
        return None;
    }
    let animated = probes.iter().any(|p| p.animated);
    let values = probes.iter().map(|p| (p.property.to_owned(), json!(p.value))).collect();
    Some(Row {
        time,
        animated,
        keyed: probes.iter().any(|p| p.at.is_some()),
        toggle_disabled: info.locked || outside,
        value_disabled: info.locked || (outside && animated),
        values,
        probes,
    })
}

impl Row {
    /// Removes the keys at the playhead when keyed, else adds one per property.
    pub fn toggle(&self, scope: &EditScope, target: &Target) -> Edit {
        if self.keyed {
            let removed = self.probes.iter().filter_map(|p| p.at.map(|at| remove_key(scope, target, p.property, at))).collect::<Result<Vec<_>, _>>()?;
            return Ok(together(removed, "remove keyframes"));
        }
        let added = self.probes.iter().map(|p| edit_key(scope, target, p.property, self.time, None, None)).collect::<Result<Vec<_>, _>>()?;
        Ok(together(added, "add keyframes"))
    }

    /// Keys every row property at the playhead, `values` first.
    pub fn set(&self, scope: &EditScope, target: &Target, values: &Map<String, Value>) -> Edit {
        let keyed = self
            .probes
            .iter()
            .map(|p| edit_key(scope, target, p.property, self.time, Some(values.get(p.property).and_then(Value::as_f64).unwrap_or(p.value)), None))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(together(keyed, "keyframe"))
    }
}
