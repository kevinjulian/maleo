//! The command a canvas or inspector change makes (D4): a port of
//! `canvasClipLayout`, `normalizeLayout`, `patchCanvasLayout`,
//! `sampledCanvasLayout` and `canvasEditCommand`.
//!
//! The TS rebuilt the whole document (`rebuildDocWith`) and replaced every
//! clip; this replaces only the clip the change touches, which is the same
//! effect on a canonical document. A scene's visual is written normalized, as
//! `normalizeSceneClips` writes it.

use maleo_editor_core::json::js_number_string;
use maleo_editor_core::keyframes::{evaluate_value_track, js_max, js_min, js_round, js_trim, num as read_num, sample_clip_transform};
use maleo_editor_core::keys::{COLOR, NUMERIC, key_target_info, track_is_valid};
use maleo_editor_core::schema::{Clip, EditScope};
use maleo_editor_core::source::js_truthy;
use maleo_editor_core::window::scene_visual_source_duration;
use serde_json::{Map, Value};

use super::{Source, Target, clamp, num, object, order};

pub type Layout = Map<String, Value>;

/// The layout a target edits and the clip time it is keyed in (`canvasClipLayout`).
#[derive(Clone, Debug, PartialEq)]
pub struct Resolved {
    /// The id of the clip that holds the layout (`clipIdForTarget`).
    pub clip_id: String,
    pub layout: Option<Layout>,
    /// Timeline seconds at which the layout's key time 0 sits.
    pub start: f64,
    pub duration: f64,
    /// The scene visual whose layout is edited, normalized; `None` for the element's own layout.
    pub visual: Option<Layout>,
    pub track: f64,
    /// `normalizeLayout`'s kind: `scene`, `image`, `video` or `text`.
    pub kind: &'static str,
}

impl Resolved {
    pub fn animated(&self) -> bool {
        js_truthy(self.layout.as_ref().and_then(|layout| layout.get("animation")))
    }
}

fn id_text(id: f64) -> String {
    js_number_string(id).unwrap_or_default()
}

fn payload_key(source: Source) -> &'static str {
    match source {
        Source::Scene => "scene",
        Source::Video => "video",
        Source::Text => "text",
    }
}

/// The clip whose payload is the target (`views[key].find(item => item.id === id)`).
pub fn find_clip<'a>(scope: &'a EditScope, target: &Target) -> Option<&'a Clip> {
    let key = payload_key(target.source);
    scope.doc.clips.iter().map(AsRef::as_ref).find(|clip| clip.payload(key).and_then(|payload| payload.get("id")).and_then(Value::as_f64) == Some(target.id))
}

/// `doc.trackFlags?.[track]?.[flag]`.
pub fn track_flag(scope: &EditScope, track: f64, flag: &str) -> bool {
    let flags = scope.doc.extra.get("trackFlags").and_then(Value::as_object);
    js_truthy(flags.and_then(|flags| flags.get(&id_text(track))).and_then(|entry| entry.get(flag)))
}

/// `Number(x) || fallback`.
fn number_or(value: Option<&Value>, fallback: f64) -> f64 {
    let read = read_num(value);
    if read == 0.0 || read.is_nan() { fallback } else { read }
}

fn text_of(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str)
}

/// The scene's visual clips as `docScenes` merges them: the scene's own, then
/// each `vis` clip re-based to the scene, sorted by start, the primary re-elected.
fn merged_visuals(scope: &EditScope, scene_clip: &Clip, scene: &Layout) -> Option<Vec<Value>> {
    let scene_id = scene.get("id")?;
    let extras: Vec<&Clip> =
        scope.doc.clips.iter().map(AsRef::as_ref).filter(|clip| clip.payload("vis").and_then(|vis| vis.get("sceneId")) == Some(scene_id)).collect();
    if extras.is_empty() {
        return None;
    }
    let mut base: Vec<Value> = match scene.get("visualClips").and_then(Value::as_array).filter(|visuals| !visuals.is_empty()) {
        Some(visuals) => visuals.clone(),
        None if js_truthy(scene.get("src")) => {
            let label = scene.get("name").filter(|name| js_truthy(Some(name))).cloned().unwrap_or_else(|| Value::from("Media"));
            vec![object(vec![
                ("id", Value::String(format!("scene-{}-visual-primary", template(Some(scene_id))))),
                ("kind", Value::from("image")),
                ("label", label),
                ("url", scene.get("src").cloned().unwrap_or(Value::Null)),
                ("startSec", num(0.0)),
                ("durationSec", num(scene_clip.duration_sec)),
                ("primary", Value::Bool(true)),
            ])]
        }
        None => Vec::new(),
    };
    for extra in extras {
        let mut vclip = extra.payload("vis").and_then(|vis| vis.get("vclip")).and_then(Value::as_object).cloned().unwrap_or_default();
        vclip.insert("startSec".to_owned(), num(js_max(0.0, js_round((extra.start_sec - scene_clip.start_sec) * 100.0) / 100.0)));
        vclip.insert("durationSec".to_owned(), num(extra.duration_sec));
        base.push(Value::Object(vclip));
    }
    let starts: Vec<f64> = base.iter().map(read_start).collect();
    let base: Vec<Value> = order(&starts).into_iter().map(|i| base[i].clone()).collect();
    let primary = base.iter().position(|v| js_truthy(v.get("primary"))).unwrap_or(0);
    Some(
        base.into_iter()
            .enumerate()
            .map(|(i, mut v)| {
                if let Some(object) = v.as_object_mut() {
                    object.insert("primary".to_owned(), Value::Bool(i == primary));
                }
                v
            })
            .collect(),
    )
}

fn read_start(v: &Value) -> f64 {
    v.get("startSec").and_then(Value::as_f64).unwrap_or(0.0)
}

/// JavaScript's `${value}` for an id.
fn template(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(n)) => n.as_f64().map(id_text).unwrap_or_default(),
        Some(other) => other.to_string(),
        None => "undefined".to_owned(),
    }
}

/// `normalizeSceneClips(scene).visualClips` (scene offset 0).
fn normalized_visuals(scene: &Layout, visuals: Option<&[Value]>) -> Vec<Layout> {
    let dur = js_max(1.0 / 30.0, number_or(scene.get("dur"), 1.0));
    let scene_id = template(scene.get("id"));
    let seeded;
    let raw: &[Value] = match visuals.filter(|v| !v.is_empty()) {
        Some(visuals) => visuals,
        None if js_truthy(scene.get("src")) => {
            let label = scene.get("name").filter(|n| js_truthy(Some(n))).cloned().unwrap_or_else(|| Value::from("Visual"));
            let mut seed = object(vec![
                ("id", Value::String(format!("scene-{scene_id}-visual-1"))),
                ("kind", Value::from("image")),
                ("label", label),
                ("url", scene.get("src").cloned().unwrap_or(Value::Null)),
            ]);
            if let (Some(asset), Some(object)) = (scene.get("mediaAssetId").filter(|a| js_truthy(Some(a))), seed.as_object_mut()) {
                object.insert("mediaAssetId".to_owned(), asset.clone());
            }
            if let Some(object) = seed.as_object_mut() {
                object.insert("startSec".to_owned(), num(0.0));
                object.insert("durationSec".to_owned(), num(dur));
                object.insert("primary".to_owned(), Value::Bool(true));
            }
            seeded = [seed];
            &seeded
        }
        None => return Vec::new(),
    };
    let explicit = raw.iter().any(|clip| clip.get("primary") == Some(&Value::Bool(true)));
    raw.iter()
        .filter(|clip| text_of(clip.get("url")).is_some_and(|url| !js_trim(url).is_empty()))
        .enumerate()
        .map(|(index, clip)| {
            let mut next = clip.as_object().cloned().unwrap_or_default();
            if !js_truthy(clip.get("id")) {
                next.insert("id".to_owned(), Value::String(format!("scene-{scene_id}-visual-{}", index + 1)));
            }
            if !js_truthy(clip.get("label")) {
                let noun = if text_of(clip.get("kind")) == Some("video") { "Video" } else { "Image" };
                next.insert("label".to_owned(), Value::String(format!("{noun} {}", index + 1)));
            }
            next.insert("url".to_owned(), Value::from(js_trim(text_of(clip.get("url")).unwrap_or_default())));
            next.insert("startSec".to_owned(), num(js_max(0.0, number_or(clip.get("startSec"), 0.0))));
            next.insert("durationSec".to_owned(), num(js_max(1.0 / 30.0, number_or(clip.get("durationSec"), dur))));
            next.insert("primary".to_owned(), Value::Bool(if explicit { clip.get("primary") == Some(&Value::Bool(true)) } else { index == 0 }));
            let motion = clip.get("motion").filter(|m| !m.is_null()).cloned().unwrap_or(Value::Null);
            next.insert("motion".to_owned(), motion);
            next
        })
        .collect()
}

/// `{ ...a, ...b }` over two optional layouts.
fn spread(a: Option<&Value>, b: Option<&Value>) -> Layout {
    let mut out = a.and_then(Value::as_object).cloned().unwrap_or_default();
    if let Some(b) = b.and_then(Value::as_object) {
        out.extend(b.iter().map(|(k, v)| (k.clone(), v.clone())));
    }
    out
}

/// `hasClipCompositing(layout)`.
fn has_compositing(layout: &Layout) -> bool {
    let blend = layout.get("blendMode").filter(|b| js_truthy(Some(b))).is_some_and(|b| b.as_str() != Some("normal"));
    let color = layout.get("color").filter(|c| js_truthy(Some(c))).and_then(Value::as_object).is_some_and(|c| c.values().any(|v| v.as_f64() != Some(1.0)));
    js_truthy(layout.get("mask")) || blend || color
}

/// A scene's view and its visual lists, as `fromTimelineDoc` and `normalizeSceneClips` give them.
fn scene_parts(scope: &EditScope, clip: &Clip) -> (Layout, Vec<Layout>) {
    let mut scene = clip.payload("scene").cloned().unwrap_or_default();
    scene.insert("start".to_owned(), num(clip.start_sec));
    scene.insert("track".to_owned(), num(clip.track));
    scene.insert("dur".to_owned(), num(clip.duration_sec));
    let merged = merged_visuals(scope, clip, &scene);
    let own = scene.get("visualClips").and_then(Value::as_array).cloned();
    let visuals = normalized_visuals(&scene, merged.as_deref().or(own.as_deref()));
    (scene, visuals)
}

/// `canvasClipLayout(doc, target)` with the edited clip's id; `None` when the target is missing.
pub fn resolve(scope: &EditScope, target: &Target) -> Option<Resolved> {
    let clip = find_clip(scope, target)?;
    let payload = clip.payload(payload_key(target.source))?;
    if target.source != Source::Scene {
        let kind = if target.source == Source::Text {
            "text"
        } else if text_of(payload.get("kind")) == Some("video") {
            "video"
        } else {
            "image"
        };
        return Some(Resolved {
            clip_id: clip.id.clone(),
            layout: payload.get("layout").and_then(Value::as_object).cloned(),
            start: clip.start_sec,
            duration: clip.duration_sec,
            visual: None,
            track: clip.track,
            kind,
        });
    }
    let (scene, visuals) = scene_parts(scope, clip);
    let visual = visuals.iter().find(|v| target.visual_id.as_deref().is_some_and(|id| text_of(v.get("id")) == Some(id))).or_else(|| visuals.first());
    let inherited = visual.map(|v| spread(scene.get("layout"), v.get("layout")));
    let keyed_tracks = |layout: &Layout| {
        let tracks = layout.get("animation").filter(|a| js_truthy(Some(a))).and_then(|a| a.get("tracks")).and_then(Value::as_object);
        tracks.is_some_and(|tracks| tracks.iter().any(|(p, keys)| p != "volume" && keys.as_array().is_some_and(|keys| !keys.is_empty())))
    };
    let animated = match (visual, &inherited) {
        (Some(v), Some(inherited)) => {
            target.visual_id.as_deref().is_some_and(|id| !id.is_empty())
                || v.get("layout").and_then(|l| l.get("widthPct")).is_some()
                || has_compositing(inherited)
                || keyed_tracks(inherited)
        }
        _ => false,
    };
    let scene_dur = read_num(scene.get("dur"));
    if let (true, Some(v), Some(inherited)) = (animated, visual, inherited) {
        let local = read_start(&Value::Object(v.clone()));
        let duration = if visuals.len() == 1 && !js_truthy(v.get("startSec")) {
            if text_of(v.get("kind")) == Some("video") {
                scene_visual_source_duration(read_num(v.get("durationSec")), scene_dur, &inherited)
            } else {
                scene_dur
            }
        } else {
            read_num(v.get("durationSec"))
        };
        let vis_id = format!("vis:{}:{}", id_text(target.id), template(v.get("id")));
        let holder = if target.visual_id.is_some() && scope.doc.clips.iter().any(|c| c.id == vis_id) { vis_id } else { clip.id.clone() };
        return Some(Resolved {
            clip_id: holder,
            layout: Some(inherited),
            start: clip.start_sec + local,
            duration,
            visual: Some(v.clone()),
            track: clip.track,
            kind: "scene",
        });
    }
    Some(Resolved {
        clip_id: clip.id.clone(),
        layout: scene.get("layout").and_then(Value::as_object).cloned(),
        start: clip.start_sec,
        duration: scene_dur,
        visual: None,
        track: clip.track,
        kind: "scene",
    })
}

fn finite(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|n| n.is_finite())
}

fn in_range(value: Option<&Value>, lo: f64, hi: f64) -> Option<f64> {
    finite(value).filter(|n| *n >= lo && *n <= hi)
}

/// `clipMaskSchema.safeParse(mask)`: the parsed mask in schema order, or `None`.
pub fn valid_mask(mask: &Value) -> Option<Value> {
    let fields = mask.as_object()?;
    const KEYS: [&str; 8] = ["shape", "xPct", "yPct", "widthPct", "heightPct", "rotationDeg", "featherPct", "inverted"];
    if fields.keys().any(|key| !KEYS.contains(&key.as_str())) {
        return None;
    }
    let shape = text_of(fields.get("shape")).filter(|s| matches!(*s, "rectangle" | "ellipse"))?;
    let x = in_range(fields.get("xPct"), 0.0, 100.0)?;
    let y = in_range(fields.get("yPct"), 0.0, 100.0)?;
    let w = in_range(fields.get("widthPct"), f64::MIN_POSITIVE, 100.0).filter(|w| *w > 0.0)?;
    let h = in_range(fields.get("heightPct"), f64::MIN_POSITIVE, 100.0).filter(|h| *h > 0.0)?;
    let rotation = in_range(fields.get("rotationDeg"), -180.0, 180.0)?;
    let feather = in_range(fields.get("featherPct"), 0.0, 50.0)?;
    let inverted = fields.get("inverted").and_then(Value::as_bool)?;
    (x + w <= 100.0 && y + h <= 100.0).then(|| {
        object(vec![
            ("shape", Value::from(shape)),
            ("xPct", num(x)),
            ("yPct", num(y)),
            ("widthPct", num(w)),
            ("heightPct", num(h)),
            ("rotationDeg", num(rotation)),
            ("featherPct", num(feather)),
            ("inverted", Value::Bool(inverted)),
        ])
    })
}

/// `clipColorSchema.safeParse(color)`.
fn valid_color(color: &Value) -> Option<Value> {
    let fields = color.as_object()?;
    if fields.keys().any(|key| !matches!(key.as_str(), "brightness" | "contrast" | "saturation")) {
        return None;
    }
    let b = in_range(fields.get("brightness"), 0.0, 2.0)?;
    let c = in_range(fields.get("contrast"), 0.0, 2.0)?;
    let s = in_range(fields.get("saturation"), 0.0, 3.0)?;
    Some(object(vec![("brightness", num(b)), ("contrast", num(c)), ("saturation", num(s))]))
}

fn valid_blend(blend: &Value) -> bool {
    matches!(blend.as_str(), Some("normal" | "multiply" | "screen"))
}

/// `sourceCropSchema.safeParse(crop).success`.
fn valid_crop(crop: &Value) -> bool {
    let read = |key: &str, lo: f64, hi: f64| in_range(crop.get(key), lo, hi);
    match (read("xPct", 0.0, 99.0), read("yPct", 0.0, 99.0), read("widthPct", 1.0, 100.0), read("heightPct", 1.0, 100.0)) {
        (Some(x), Some(y), Some(w), Some(h)) => crop.is_object() && x + w <= 100.0 && y + h <= 100.0,
        _ => false,
    }
}

/// One key in schema order: `t`, `v` (a colour trimmed), `easing`, `easingRange`.
fn key_in_order(key: &Value, colour: bool) -> Value {
    let mut out = Map::new();
    for name in ["t", "v", "easing", "easingRange"] {
        if let Some(value) = key.get(name) {
            let value = match (name, colour, value.as_str()) {
                ("v", true, Some(text)) => Value::from(js_trim(text)),
                _ => value.clone(),
            };
            out.insert(name.to_owned(), value);
        }
    }
    Value::Object(out)
}

/// `(kind === "text" ? textAnimationSchema : clipAnimationSchema).safeParse(animation)`.
fn valid_animation(animation: &Value, text: bool) -> Option<Value> {
    let object = animation.as_object()?;
    if object.keys().any(|key| key != "tracks" && key != "colorTracks") {
        return None;
    }
    let kind = Some(if text { "text" } else { "video" });
    let group = |name: &str, names: &mut dyn Iterator<Item = &'static str>, colour: bool| -> Option<Option<Map<String, Value>>> {
        let Some(source) = object.get(name) else { return Some(None) };
        let source = source.as_object()?;
        let names: Vec<&str> = names.collect();
        if source.keys().any(|key| !names.contains(&key.as_str())) {
            return None;
        }
        let mut out = Map::new();
        for property in names {
            if let Some(keys) = source.get(property) {
                let keys = keys.as_array()?;
                if !track_is_valid(kind, property, keys) {
                    return None;
                }
                out.insert(property.to_owned(), Value::Array(keys.iter().map(|key| key_in_order(key, colour)).collect()));
            }
        }
        Some(Some(out))
    };
    let tracks = group("tracks", &mut NUMERIC.iter().map(|spec| spec.name), false)??;
    let colours = group("colorTracks", &mut COLOR.into_iter(), true)?;
    let mut out = Map::new();
    out.insert("tracks".to_owned(), Value::Object(tracks));
    if let Some(colours) = colours {
        out.insert("colorTracks".to_owned(), Value::Object(colours));
    }
    Some(Value::Object(out))
}

/// `defaultClipLayout(kind)`.
fn default_layout(kind: &str) -> [f64; 4] {
    if kind == "text" { [8.0, 64.0, 84.0, 22.0] } else { [0.0, 0.0, 100.0, 100.0] }
}

/// `l.key ?? fallback` for a number.
fn or_number(layout: &Layout, key: &str, fallback: f64) -> f64 {
    match layout.get(key) {
        None | Some(Value::Null) => fallback,
        value => read_num(value),
    }
}

/// `normalizeLayout(l, kind)`, keys in the TS object's order.
pub fn normalize_layout(layout: Option<&Layout>, kind: &str) -> Layout {
    let [bx, by, bw, bh] = default_layout(kind);
    let base_fit = match kind {
        "scene" => "cover",
        _ => "contain",
    };
    let mut out = Map::new();
    let Some(l) = layout else {
        for (key, value) in [("xPct", bx), ("yPct", by), ("widthPct", bw), ("heightPct", bh)] {
            out.insert(key.to_owned(), num(value));
        }
        out.insert("fit".to_owned(), Value::from(base_fit));
        out.insert("opacity".to_owned(), num(1.0));
        return out;
    };
    match l.get("mask") {
        None => {}
        Some(Value::Null) => {
            out.insert("mask".to_owned(), Value::Null);
        }
        Some(mask) => {
            if let Some(mask) = valid_mask(mask) {
                out.insert("mask".to_owned(), mask);
            }
        }
    }
    if let Some(color) = l.get("color").filter(|c| js_truthy(Some(c))).and_then(valid_color) {
        out.insert("color".to_owned(), color);
    }
    if let Some(blend) = l.get("blendMode").filter(|b| js_truthy(Some(b)) && valid_blend(b)) {
        out.insert("blendMode".to_owned(), blend.clone());
    }
    if let Some(animation) = l.get("animation").filter(|a| js_truthy(Some(a))).and_then(|a| valid_animation(a, kind == "text")) {
        out.insert("animation".to_owned(), animation);
    }
    out.insert("xPct".to_owned(), num(clamp(or_number(l, "xPct", bx), -50.0, 150.0)));
    out.insert("yPct".to_owned(), num(clamp(or_number(l, "yPct", by), -50.0, 150.0)));
    out.insert("widthPct".to_owned(), num(js_max(2.0, js_min(200.0, or_number(l, "widthPct", bw)))));
    let height = match l.get("heightPct") {
        None | Some(Value::Null) => bh,
        value => js_max(2.0, js_min(200.0, read_num(value))),
    };
    out.insert("heightPct".to_owned(), num(height));
    out.insert("fit".to_owned(), l.get("fit").filter(|f| !f.is_null()).cloned().unwrap_or_else(|| Value::from(base_fit)));
    out.insert("rotationDeg".to_owned(), l.get("rotationDeg").filter(|r| !r.is_null()).cloned().unwrap_or_else(|| num(0.0)));
    out.insert("aspectLocked".to_owned(), Value::Bool(js_truthy(l.get("aspectLocked"))));
    let opacity = match l.get("opacity") {
        None | Some(Value::Null) => 1.0,
        value => js_max(0.0, js_min(1.0, read_num(value))),
    };
    out.insert("opacity".to_owned(), num(opacity));
    if let Some(crop) = l.get("crop") {
        out.insert("crop".to_owned(), crop.clone());
    }
    out.insert("flipX".to_owned(), Value::Bool(js_truthy(l.get("flipX"))));
    out.insert("flipY".to_owned(), Value::Bool(js_truthy(l.get("flipY"))));
    let rate = match l.get("playbackRate") {
        None | Some(Value::Null) => 1.0,
        value => js_max(0.25, js_min(4.0, read_num(value))),
    };
    out.insert("playbackRate".to_owned(), num(rate));
    out.insert("reverse".to_owned(), Value::Bool(js_truthy(l.get("reverse"))));
    for key in ["reverseMedia", "preservePitch", "audioMedia", "sourceAudioExtraction"] {
        if let Some(value) = l.get(key) {
            out.insert(key.to_owned(), value.clone());
        }
    }
    out
}

/// `sampledCanvasLayout(layout, kind, time)`: the normalized layout with its
/// animated box values at `time`, and the sampled scale.
pub fn sampled_layout(layout: Option<&Layout>, kind: &str, time: f64) -> (Layout, f64) {
    let mut base = normalize_layout(layout, kind);
    let [x, y, scale, rotation, opacity] = sample_clip_transform(Some(&Value::Object(base.clone())), time);
    let tracks = base.get("animation").and_then(|a| a.get("tracks"));
    let track = |name: &str| tracks.and_then(|t| t.get(name)).and_then(Value::as_array).filter(|keys| !keys.is_empty());
    let base_w = read_num(base.get("widthPct"));
    let width = track("widthPct").map_or(base_w, |keys| evaluate_value_track(keys, time, base_w));
    let height = match track("heightPct") {
        Some(keys) => Some(evaluate_value_track(keys, time, base.get("heightPct").and_then(Value::as_f64).unwrap_or(100.0))),
        None => base.get("heightPct").and_then(Value::as_f64),
    };
    for (key, value) in
        [("xPct", Some(x)), ("yPct", Some(y)), ("widthPct", Some(width)), ("heightPct", height), ("rotationDeg", Some(rotation)), ("opacity", Some(opacity))]
    {
        if let Some(value) = value {
            base.insert(key.to_owned(), num(value));
        }
    }
    (base, scale)
}

/// The refusals `patchCanvasLayout` makes before writing: an invalid crop,
/// mask, colour or blend mode in the patch.
fn patch_refused(patch: &Layout) -> bool {
    let crop = patch.get("crop").is_some_and(|crop| !valid_crop(crop));
    let mask = patch.get("mask").is_some_and(|mask| !mask.is_null() && valid_mask(mask).is_none());
    let color = patch.get("color").is_some_and(|color| valid_color(color).is_none());
    let blend = patch.get("blendMode").is_some_and(|blend| !valid_blend(blend));
    crop || mask || color || blend
}

/// A layout patch and the fields it clears (TS `undefined`, which JSON cannot carry).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LayoutPatch {
    pub set: Layout,
    pub unset: Vec<String>,
}

impl LayoutPatch {
    pub fn set(set: Layout) -> Self {
        Self { set, unset: Vec::new() }
    }

    pub fn is_empty(&self) -> bool {
        self.set.is_empty() && self.unset.is_empty()
    }

    /// `{"patch": {...}, "unset"?: [names]}`.
    pub fn from_value(value: &Value) -> Result<Self, String> {
        let set = match value.get("patch") {
            None => Map::new(),
            Some(patch) => patch.as_object().cloned().ok_or("`patch` is not an object")?,
        };
        let unset = match value.get("unset") {
            None => Vec::new(),
            Some(names) => names
                .as_array()
                .ok_or("`unset` is not an array")?
                .iter()
                .map(|n| n.as_str().map(str::to_owned).ok_or("`unset` holds a non-string"))
                .collect::<Result<_, _>>()?,
        };
        Ok(Self { set, unset })
    }
}

/// `patchCanvasLayout(doc, target, patch)` as the clips it replaces: `None`
/// when the edit is refused, an empty list when it changes nothing.
pub fn patch_clips(scope: &EditScope, target: &Target, patch: &LayoutPatch) -> Option<Vec<Clip>> {
    if patch_refused(&patch.set) {
        return None;
    }
    let clip = find_clip(scope, target)?;
    if track_flag(scope, if target.source == Source::Scene { -1.0 } else { clip.track }, "locked") {
        return None;
    }
    let resolved = resolve(scope, target)?;
    let key = payload_key(target.source);
    let base =
        if resolved.visual.is_some() { resolved.layout.clone() } else { clip.payload(key).and_then(|p| p.get("layout")).and_then(Value::as_object).cloned() };
    let mut merged = normalize_layout(base.as_ref(), resolved.kind);
    merged.extend(patch.set.iter().map(|(k, v)| (k.clone(), v.clone())));
    for name in &patch.unset {
        merged.shift_remove(name);
    }
    let layout = Value::Object(normalize_layout(Some(&merged), resolved.kind));
    let next = match &resolved.visual {
        Some(visual) => {
            let mut visual = visual.clone();
            visual.insert("layout".to_owned(), layout);
            if resolved.clip_id == clip.id {
                let mut next = clip.clone();
                let mut scene = clip.payload("scene").cloned().unwrap_or_default();
                scene.insert("visualClips".to_owned(), Value::Array(vec![Value::Object(visual)]));
                next.extra.insert("scene".to_owned(), Value::Object(scene));
                next
            } else {
                let holder = scope.doc.clips.iter().find(|c| c.id == resolved.clip_id)?;
                let mut next = Clip::clone(holder);
                let mut vis = holder.payload("vis").cloned().unwrap_or_default();
                vis.insert("vclip".to_owned(), Value::Object(visual));
                next.extra.insert("vis".to_owned(), Value::Object(vis));
                next
            }
        }
        None => {
            let mut next = clip.clone();
            let mut payload = clip.payload(key).cloned().unwrap_or_default();
            payload.insert("layout".to_owned(), layout);
            next.extra.insert(key.to_owned(), Value::Object(payload));
            next
        }
    };
    let prior = scope.doc.clips.iter().find(|c| c.id == next.id)?;
    Some(if **prior == next { Vec::new() } else { vec![next] })
}

/// `upsertKey(keys, time, value)` with the default snap.
fn upsert_key(keys: &[Value], time: f64, value: f64) -> Vec<Value> {
    let mut best: Option<usize> = None;
    for (i, key) in keys.iter().enumerate() {
        let distance = (read_num(key.get("t")) - time).abs();
        if distance <= 0.1 + 1e-9 && best.is_none_or(|b| distance < (read_num(keys[b].get("t")) - time).abs()) {
            best = Some(i);
        }
    }
    if let Some(near) = best {
        return keys
            .iter()
            .enumerate()
            .map(|(i, key)| {
                let mut key = key.clone();
                if let (true, Some(object)) = (i == near, key.as_object_mut()) {
                    object.insert("v".to_owned(), num(value));
                }
                key
            })
            .collect();
    }
    let mut next = keys.to_vec();
    next.push(object(vec![("t", num(time)), ("v", num(value)), ("easing", Value::from("linear"))]));
    let times: Vec<f64> = next.iter().map(|k| read_num(k.get("t"))).collect();
    order(&times).into_iter().map(|i| next[i].clone()).collect()
}

const PATCH_KEYABLE: [&str; 6] = ["xPct", "yPct", "rotationDeg", "opacity", "widthPct", "heightPct"];

/// The canvas transform batch label.
pub const LABEL: &str = "canvas transform";

pub fn noop() -> Value {
    object(vec![("type", Value::from("noop"))])
}

/// `[]` → noop, one command as itself, else a labelled batch (`batch(commands, label)`).
pub fn combine(commands: Vec<Value>) -> Value {
    let mut steps: Vec<Value> = Vec::new();
    for command in commands {
        match command.get("type").and_then(Value::as_str) {
            Some("noop") => {}
            Some("batch") => steps.extend(command.get("commands").and_then(Value::as_array).cloned().unwrap_or_default()),
            _ => steps.push(command),
        }
    }
    match steps.len() {
        0 => noop(),
        1 => steps.remove(0),
        _ => object(vec![("type", Value::from("batch")), ("commands", Value::Array(steps)), ("label", Value::from(LABEL))]),
    }
}

/// `canvasEditCommand(scope, target, patch, atSec)`: keys at the playhead for
/// what is already keyed, one static replace for the rest, as a command value.
pub fn edit_command(scope: &EditScope, target: &Target, patch: &LayoutPatch, at: Option<f64>) -> Value {
    let Some(resolved) = resolve(scope, target) else { return noop() };
    let animation = resolved.layout.as_ref().and_then(|l| l.get("animation")).filter(|a| js_truthy(Some(a))).cloned();
    let keyed = match (at, &animation) {
        (Some(_), Some(_)) => key_target_info(scope, &resolved.clip_id).ok().flatten(),
        _ => None,
    };
    let time = at.map_or(0.0, |at| js_round((at - resolved.start) * 1e6) / 1e6);
    if let Some((_, duration, locked)) = &keyed
        && (*locked || time < 0.0 || time > duration + 1e-6)
    {
        return noop();
    }
    let mut set = patch.set.clone();
    let mut keys: Vec<(&'static str, f64)> = Vec::new();
    let tracks = animation.as_ref().and_then(|a| a.get("tracks"));
    if let Some((kind, _, _)) = &keyed {
        let (base, scale) = sampled_layout(resolved.layout.as_ref(), if target.source == Source::Text { "text" } else { "image" }, time);
        let allowed = |property: &str| NUMERIC.iter().any(|spec| spec.name == property && kind.as_deref().is_some_and(|kind| spec.kinds.contains(&kind)));
        let keyable = |property: &str| allowed(property) && tracks.and_then(|t| t.get(property)).and_then(Value::as_array).is_some_and(|k| !k.is_empty());
        let (bw, bh) = (read_num(base.get("widthPct")), base.get("heightPct").and_then(Value::as_f64).unwrap_or(100.0));
        let (pw, ph) = (set.get("widthPct").and_then(Value::as_f64), set.get("heightPct").and_then(Value::as_f64));
        if let (Some(pw), Some(ph)) = (pw, ph)
            && (pw / ph - bw / bh).abs() < 1e-6
            && keyable("scale")
            && !keyable("widthPct")
        {
            keys.push(("scale", scale * (pw / bw)));
            // The resize moved the box corner-anchored; keep that centre with the unscaled size.
            let px = set.get("xPct").and_then(Value::as_f64).unwrap_or_else(|| read_num(base.get("xPct")));
            let py = set.get("yPct").and_then(Value::as_f64).unwrap_or_else(|| read_num(base.get("yPct")));
            set.insert("xPct".to_owned(), num(px + (pw - bw) / 2.0));
            set.insert("yPct".to_owned(), num(py + (ph - bh) / 2.0));
            set.shift_remove("widthPct");
            set.shift_remove("heightPct");
        }
        for property in PATCH_KEYABLE {
            let Some(value) = set.get(property).filter(|v| !v.is_null()).and_then(Value::as_f64) else { continue };
            if !keyable(property) {
                continue;
            }
            keys.push((property, value));
            set.shift_remove(property);
        }
    }
    let mut commands = Vec::new();
    let rest = LayoutPatch { set, unset: patch.unset.clone() };
    if !rest.is_empty() {
        for clip in patch_clips(scope, target, &rest).unwrap_or_default() {
            commands.push(object(vec![
                ("type", Value::from("clip.replace")),
                ("id", Value::from(clip.id.clone())),
                ("clip", serde_json::to_value(&clip).unwrap_or(Value::Null)),
            ]));
        }
    }
    for (property, raw) in keys {
        let spec = NUMERIC.iter().find(|spec| spec.name == property);
        let value = spec.map_or(raw, |spec| js_max(spec.min, js_min(spec.max, raw)));
        let current = tracks.and_then(|t| t.get(property)).and_then(Value::as_array).cloned().unwrap_or_default();
        commands.push(object(vec![
            ("type", Value::from("clip.setKeys")),
            ("id", Value::from(resolved.clip_id.clone())),
            ("property", Value::from(property)),
            ("keys", Value::Array(upsert_key(&current, time, value))),
        ]));
    }
    combine(commands)
}

/// `resizeLayoutValue(layout, axis, value)`: an aspect-locked size field scales both sides.
pub fn resize_value(layout: &Layout, height_axis: bool, value: f64) -> Layout {
    let axis = if height_axis { "heightPct" } else { "widthPct" };
    let mut out = Map::new();
    if !js_truthy(layout.get("aspectLocked")) {
        out.insert(axis.to_owned(), num(value));
        return out;
    }
    let width = read_num(layout.get("widthPct"));
    let height = layout.get("heightPct").and_then(Value::as_f64).unwrap_or(100.0);
    let scale = clamp(value / if height_axis { height } else { width }, js_max(2.0 / width, 2.0 / height), js_min(200.0 / width, 200.0 / height));
    out.insert("widthPct".to_owned(), num(width * scale));
    out.insert("heightPct".to_owned(), num(height * scale));
    out
}
