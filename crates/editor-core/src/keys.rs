//! `clip.setKeys`: replace one property track of one clip. A port of
//! `packages/shared/src/editor/clip-keys.ts` (`keyTarget`, `clipKeyError`,
//! `withTrack`, `setClipKeys`), the animation property registry in
//! `animation-properties.ts`, `animationSchemaFor` in `clip-animation.ts`, and
//! the visual half of `normalizeSceneClips` in `scene-timing.ts`.
//!
//! A refused or unchanged edit returns the document as it was, exactly as the
//! TS does; only input the TS would throw on is an error here.

use serde_json::{Map, Number, Value};

use crate::error::{EngineError, EngineResult};
use crate::json::{js_number_string, to_js_string};
use crate::keyframes::{js_max, js_trim, num};
use crate::schema::{Clip, EditScope, Passthrough};
use crate::source::js_truthy;
use crate::window::scene_visual_source_duration;

const BOX: &[&str] = &["image", "video", "text"];
const TEXT: &[&str] = &["text"];

/// One numeric entry of `NUMERIC_ANIMATION_PROPERTIES`.
pub struct NumericProperty {
    pub name: &'static str,
    pub min: f64,
    pub max: f64,
    pub kinds: &'static [&'static str],
}

/// `NUMERIC_ANIMATION_PROPERTIES`, in registry order.
pub const NUMERIC: [NumericProperty; 13] = [
    NumericProperty { name: "xPct", min: -50.0, max: 150.0, kinds: BOX },
    NumericProperty { name: "yPct", min: -50.0, max: 150.0, kinds: BOX },
    NumericProperty { name: "scale", min: 0.01, max: 10.0, kinds: BOX },
    NumericProperty { name: "rotationDeg", min: -360.0, max: 360.0, kinds: BOX },
    NumericProperty { name: "opacity", min: 0.0, max: 1.0, kinds: BOX },
    NumericProperty { name: "volume", min: 0.0, max: 1.0, kinds: &["video", "audio"] },
    NumericProperty { name: "widthPct", min: 0.0, max: 400.0, kinds: TEXT },
    NumericProperty { name: "heightPct", min: 0.0, max: 400.0, kinds: TEXT },
    NumericProperty { name: "blur", min: 0.0, max: 200.0, kinds: TEXT },
    NumericProperty { name: "bgOpacity", min: 0.0, max: 1.0, kinds: TEXT },
    NumericProperty { name: "fontSize", min: 1.0, max: 1000.0, kinds: TEXT },
    NumericProperty { name: "letterSpacing", min: -100.0, max: 100.0, kinds: TEXT },
    NumericProperty { name: "lineHeight", min: 0.1, max: 10.0, kinds: TEXT },
];

/// `COLOR_ANIMATION_PROPERTIES`, in registry order; every one is text-only.
pub const COLOR: [&str; 4] = ["fill", "bodyFill", "accent", "background"];

const EASINGS: [&str; 6] = ["linear", "in", "out", "in-out", "bezier", "hold"];

/// Where a clip keeps its animation, and how long its key timeline is (`KeyTarget`).
struct KeyTarget {
    kind: Option<String>,
    animation: Option<Value>,
    duration: f64,
    locked: bool,
    write: Writer,
}

/// How `KeyTarget.write` rebuilds the clip around a new animation.
enum Writer {
    /// The scene's normalized primary visual, alone, with the animation on its layout.
    Scene {
        visual: Passthrough,
        layout: Passthrough,
    },
    Vis {
        vclip: Passthrough,
        layout: Passthrough,
    },
    Audio,
    Payload {
        key: &'static str,
        layout: Passthrough,
    },
}

fn number(value: f64) -> EngineResult<Value> {
    Number::from_f64(value).map(Value::Number).ok_or_else(|| EngineError::InvalidInput(format!("non-finite number {value}")))
}

/// JavaScript's `${value}` for a template literal over a JSON read.
fn template(value: Option<&Value>) -> String {
    match value {
        None => "undefined".to_owned(),
        Some(Value::Null) => "null".to_owned(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => number.as_f64().and_then(js_number_string).unwrap_or_default(),
        Some(Value::Bool(flag)) => flag.to_string(),
        Some(other) => other.to_string(),
    }
}

/// `{ xPct: 0, yPct: 0, widthPct: 100, fit }` (`VISUAL_DEFAULT`, with `fit` set).
fn visual_default(fit: &str) -> EngineResult<Passthrough> {
    let mut layout = Map::new();
    for (key, value) in [("xPct", 0.0), ("yPct", 0.0), ("widthPct", 100.0)] {
        layout.insert(key.to_owned(), number(value)?);
    }
    layout.insert("fit".to_owned(), Value::String(fit.to_owned()));
    Ok(layout)
}

fn spread_into(target: &mut Passthrough, source: Option<&Value>) {
    if let Some(source) = source.and_then(Value::as_object) {
        target.extend(source.iter().map(|(key, value)| (key.clone(), value.clone())));
    }
}

/// `Number(x) || fallback`, for the scene and clip durations normalization reads.
fn number_or(value: Option<&Value>, fallback: f64) -> f64 {
    let read = num(value);
    if read == 0.0 || read.is_nan() { fallback } else { read }
}

fn url_of(clip: &Value) -> EngineResult<&str> {
    clip.get("url").and_then(Value::as_str).ok_or_else(|| EngineError::InvalidInput("a scene visual clip has no string url".to_owned()))
}

/// The first visual clip of `normalizeSceneClips(scene)`, at scene offset 0.
fn normalized_primary_visual(scene: &Passthrough) -> EngineResult<Option<Passthrough>> {
    let dur = js_max(1.0 / 30.0, number_or(scene.get("dur"), 1.0));
    let scene_id = template(scene.get("id"));
    let explicit = scene.get("visualClips").and_then(Value::as_array).filter(|visuals| !visuals.is_empty());
    let seeded;
    let raw: &[Value] = match explicit {
        Some(visuals) => visuals,
        None if js_truthy(scene.get("src")) => {
            let mut seed = Map::new();
            seed.insert("id".to_owned(), Value::String(format!("scene-{scene_id}-visual-1")));
            seed.insert("kind".to_owned(), Value::String("image".to_owned()));
            let label = scene.get("name").filter(|name| js_truthy(Some(name))).cloned().unwrap_or_else(|| Value::String("Visual".to_owned()));
            seed.insert("label".to_owned(), label);
            seed.insert("url".to_owned(), scene.get("src").cloned().unwrap_or(Value::Null));
            if let Some(asset) = scene.get("mediaAssetId").filter(|asset| js_truthy(Some(asset))) {
                seed.insert("mediaAssetId".to_owned(), asset.clone());
            }
            seed.insert("startSec".to_owned(), number(0.0)?);
            seed.insert("durationSec".to_owned(), number(dur)?);
            seed.insert("primary".to_owned(), Value::Bool(true));
            seeded = [Value::Object(seed)];
            &seeded
        }
        None => return Ok(None),
    };
    let explicit_primary = raw.iter().any(|clip| clip.get("primary") == Some(&Value::Bool(true)));
    let mut kept = Vec::new();
    for clip in raw {
        if !js_trim(url_of(clip)?).is_empty() {
            kept.push(clip);
        }
    }
    let Some(clip) = kept.first() else { return Ok(None) };
    // Index 0 of the filtered list, which is what `.filter().map((clip, index) => …)` sees.
    let mut next = clip.as_object().cloned().unwrap_or_default();
    if !js_truthy(clip.get("id")) {
        next.insert("id".to_owned(), Value::String(format!("scene-{scene_id}-visual-1")));
    }
    if let Some(kind) = clip.get("kind") {
        next.insert("kind".to_owned(), kind.clone());
    }
    if !js_truthy(clip.get("label")) {
        let noun = if clip.get("kind").and_then(Value::as_str) == Some("video") { "Video" } else { "Image" };
        next.insert("label".to_owned(), Value::String(format!("{noun} 1")));
    }
    next.insert("url".to_owned(), Value::String(js_trim(url_of(clip)?).to_owned()));
    next.insert("startSec".to_owned(), number(js_max(0.0, number_or(clip.get("startSec"), 0.0)))?);
    next.insert("durationSec".to_owned(), number(js_max(1.0 / 30.0, number_or(clip.get("durationSec"), dur)))?);
    let primary = if explicit_primary { clip.get("primary") == Some(&Value::Bool(true)) } else { true };
    next.insert("primary".to_owned(), Value::Bool(primary));
    let motion = match clip.get("motion") {
        None | Some(Value::Null) => Value::Null,
        Some(motion) => motion.clone(),
    };
    next.insert("motion".to_owned(), motion);
    Ok(Some(next))
}

/// `trackFlags?.[track]?.locked`.
fn locked(scope: &EditScope, track: f64) -> bool {
    let flags = scope.doc.extra.get("trackFlags").and_then(Value::as_object);
    let key = js_number_string(track);
    js_truthy(flags.zip(key).and_then(|(flags, key)| flags.get(&key)).and_then(|flag| flag.get("locked")))
}

/// `keyTarget(doc, id)`.
fn key_target(scope: &EditScope, clip: &Clip) -> EngineResult<Option<KeyTarget>> {
    if let Some(scene) = clip.payload("scene") {
        let Some(visual) = normalized_primary_visual(scene)? else { return Ok(None) };
        let scene_id = scene.get("id");
        let extra = scope.doc.clips.iter().any(|other| other.payload("vis").is_some_and(|vis| strict_eq(vis.get("sceneId"), scene_id)));
        let mut layout = visual_default("cover")?;
        spread_into(&mut layout, scene.get("layout"));
        spread_into(&mut layout, visual.get("layout"));
        let video = visual.get("kind").and_then(Value::as_str) == Some("video");
        let duration = if !extra && !js_truthy(visual.get("startSec")) {
            if video { scene_visual_source_duration(num(visual.get("durationSec")), num(scene.get("dur")), &layout) } else { num(scene.get("dur")) }
        } else {
            num(visual.get("durationSec"))
        };
        return Ok(Some(KeyTarget {
            kind: visual.get("kind").and_then(Value::as_str).map(str::to_owned),
            animation: layout.get("animation").cloned(),
            duration,
            locked: locked(scope, -1.0),
            write: Writer::Scene { visual, layout },
        }));
    }
    if let Some(vis) = clip.payload("vis") {
        let vclip = vis.get("vclip").and_then(Value::as_object).ok_or_else(|| EngineError::InvalidInput("a vis clip has no vclip".to_owned()))?;
        let mut layout = visual_default("cover")?;
        spread_into(&mut layout, vclip.get("layout"));
        let duration = match vclip.get("durationSec") {
            None | Some(Value::Null) => clip.duration_sec,
            value => num(value),
        };
        return Ok(Some(KeyTarget {
            kind: vclip.get("kind").and_then(Value::as_str).map(str::to_owned),
            animation: vclip.get("layout").and_then(|layout| layout.get("animation")).cloned(),
            duration,
            locked: locked(scope, -1.0),
            write: Writer::Vis { vclip: vclip.clone(), layout },
        }));
    }
    if let Some(audio) = clip.payload("audio") {
        return Ok(Some(KeyTarget {
            kind: Some("audio".to_owned()),
            animation: audio.get("animation").cloned(),
            duration: clip.duration_sec,
            locked: locked(scope, clip.track),
            write: Writer::Audio,
        }));
    }
    let key = ["video", "text"].into_iter().find(|key| js_truthy(clip.extra.get(*key)));
    let Some(key) = key else { return Ok(None) };
    let payload = clip.payload(key).ok_or_else(|| EngineError::InvalidInput(format!("clip {} has a non-object {key} payload", clip.id)))?;
    let kind = match key {
        "video" => payload.get("kind").and_then(Value::as_str).map(str::to_owned),
        other => Some(other.to_owned()),
    };
    let mut layout = visual_default("contain")?;
    spread_into(&mut layout, payload.get("layout"));
    Ok(Some(KeyTarget {
        kind,
        animation: payload.get("layout").and_then(|layout| layout.get("animation")).cloned(),
        duration: clip.duration_sec,
        locked: locked(scope, clip.track),
        write: Writer::Payload { key, layout },
    }))
}

fn strict_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (None, None) | (Some(Value::Null), Some(Value::Null)) => true,
        (Some(Value::Number(x)), Some(Value::Number(y))) => x.as_f64() == y.as_f64(),
        (Some(Value::String(x)), Some(Value::String(y))) => x == y,
        (Some(Value::Bool(x)), Some(Value::Bool(y))) => x == y,
        _ => false,
    }
}

/// `withAnimation(holder, animation)`: the holder without `animation`, then
/// `animation` last when there is one.
fn with_animation(holder: &Passthrough, animation: Option<Value>) -> Passthrough {
    let mut next = holder.clone();
    next.shift_remove("animation");
    if let Some(animation) = animation {
        next.insert("animation".to_owned(), animation);
    }
    next
}

impl KeyTarget {
    /// `KeyTarget.write(animation)`: the clip with the animation written in place.
    fn write(&self, clip: &Clip, animation: Option<Value>) -> Clip {
        let mut next = clip.clone();
        match &self.write {
            Writer::Scene { visual, layout } => {
                let mut visual = visual.clone();
                visual.insert("layout".to_owned(), Value::Object(with_animation(layout, animation)));
                let mut scene = clip.payload("scene").cloned().unwrap_or_default();
                scene.insert("visualClips".to_owned(), Value::Array(vec![Value::Object(visual)]));
                next.extra.insert("scene".to_owned(), Value::Object(scene));
            }
            Writer::Vis { vclip, layout } => {
                let mut vclip = vclip.clone();
                vclip.insert("layout".to_owned(), Value::Object(with_animation(layout, animation)));
                let mut vis = clip.payload("vis").cloned().unwrap_or_default();
                vis.insert("vclip".to_owned(), Value::Object(vclip));
                next.extra.insert("vis".to_owned(), Value::Object(vis));
            }
            Writer::Audio => {
                let audio = clip.payload("audio").cloned().unwrap_or_default();
                next.extra.insert("audio".to_owned(), Value::Object(with_animation(&audio, animation)));
            }
            Writer::Payload { key, layout } => {
                let mut payload = clip.payload(key).cloned().unwrap_or_default();
                payload.insert("layout".to_owned(), Value::Object(with_animation(layout, animation)));
                next.extra.insert((*key).to_owned(), Value::Object(payload));
            }
        }
        next
    }
}

fn is_color(property: &str) -> bool {
    COLOR.contains(&property)
}

fn numeric(property: &str) -> Option<&'static NumericProperty> {
    NUMERIC.iter().find(|spec| spec.name == property)
}

fn finite_number(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|n| n.is_finite())
}

/// One key against the schema's key object: strict keys, `t` ≥ 0, a valid
/// `v`, an optional easing from the enum and an optional increasing range.
fn key_is_valid(key: &Value, value_ok: &dyn Fn(&Value) -> bool) -> bool {
    let Some(fields) = key.as_object() else { return false };
    if fields.keys().any(|name| !matches!(name.as_str(), "t" | "v" | "easing" | "easingRange")) {
        return false;
    }
    let time_ok = finite_number(fields.get("t")).is_some_and(|t| t >= 0.0);
    let easing_ok = fields.get("easing").is_none_or(|easing| easing.as_str().is_some_and(|name| EASINGS.contains(&name)));
    let range_ok = fields.get("easingRange").is_none_or(|range| {
        let unit = |value: Option<&Value>| finite_number(value).filter(|n| (0.0..=1.0).contains(n));
        match range.as_array().map(Vec::as_slice) {
            Some([a, b]) => unit(Some(a)).zip(unit(Some(b))).is_some_and(|(a, b)| b > a),
            _ => false,
        }
    });
    time_ok && fields.get("v").is_some_and(value_ok) && easing_ok && range_ok
}

/// `animationSchemaFor(kind).safeParse(probe).success` for a probe that holds
/// one track: the property is one the kind may animate, every key is valid,
/// and key times strictly increase.
fn track_is_valid(kind: Option<&str>, property: &str, keys: &[Value]) -> bool {
    let allowed = |kinds: &[&str]| kind.is_some_and(|kind| kinds.contains(&kind));
    let value_ok: Box<dyn Fn(&Value) -> bool> = if is_color(property) {
        if !allowed(TEXT) {
            return false;
        }
        Box::new(|v: &Value| v.as_str().is_some_and(|text| (1..=200).contains(&js_trim(text).encode_utf16().count())))
    } else {
        let Some(spec) = numeric(property) else { return false };
        if !allowed(spec.kinds) {
            return false;
        }
        let (min, max) = (spec.min, spec.max);
        Box::new(move |v: &Value| finite_number(Some(v)).is_some_and(|n| n >= min && n <= max))
    };
    let increasing = keys.windows(2).all(|pair| num(pair[1].get("t")) > num(pair[0].get("t")));
    keys.iter().all(|key| key_is_valid(key, value_ok.as_ref())) && increasing
}

/// `clipKeyError(doc, id, property, keys) === null`.
fn edit_allowed(target: &KeyTarget, property: &str, keys: &[Value]) -> bool {
    if target.locked || (numeric(property).is_none() && !is_color(property)) {
        return false;
    }
    let late = keys.iter().any(|key| match key.get("t").and_then(Value::as_f64) {
        Some(t) if t.is_finite() => t < 0.0 || t > target.duration + 1e-6,
        _ => true,
    });
    !late && track_is_valid(target.kind.as_deref(), property, keys)
}

/// `clipTrack(doc, id, property)`: the current keys of one track. A numeric
/// read is `animation?.tracks[property]`, which throws in the TS when an
/// animation is present without a `tracks` object, so that refuses here too.
fn current_track(animation: Option<&Value>, property: &str) -> EngineResult<Value> {
    let animation = animation.filter(|animation| !animation.is_null());
    let tracks = if is_color(property) {
        animation.and_then(|animation| animation.get("colorTracks"))
    } else {
        match animation {
            None => None,
            Some(animation) => Some(
                animation.get("tracks").filter(|tracks| !tracks.is_null()).ok_or_else(|| EngineError::InvalidInput("an animation has no tracks".to_owned()))?,
            ),
        }
    };
    Ok(match tracks.and_then(|tracks| tracks.get(property)) {
        None | Some(Value::Null) => Value::Array(Vec::new()),
        Some(keys) => keys.clone(),
    })
}

/// `withTrack(animation, property, keys)`: the animation with one track
/// replaced, an empty list removing it, and nothing left meaning no animation.
fn with_track(animation: Option<&Value>, property: &str, keys: &[Value]) -> Option<Value> {
    let read = |group: &str| animation.and_then(|animation| animation.get(group)).and_then(Value::as_object).cloned().unwrap_or_default();
    let (mut tracks, mut colors) = (read("tracks"), read("colorTracks"));
    let (group, wants_string) = if is_color(property) { (&mut colors, true) } else { (&mut tracks, false) };
    if keys.is_empty() {
        group.shift_remove(property);
    } else {
        let kept = keys.iter().filter(|key| key.get("v").is_some_and(|v| if wants_string { v.is_string() } else { v.is_number() })).cloned().collect();
        group.insert(property.to_owned(), Value::Array(kept));
    }
    if tracks.is_empty() && colors.is_empty() {
        return None;
    }
    let mut next = Map::new();
    next.insert("tracks".to_owned(), Value::Object(tracks));
    if !colors.is_empty() {
        next.insert("colorTracks".to_owned(), Value::Object(colors));
    }
    Some(Value::Object(next))
}

/// `setClipKeys`: the scope with one track of clip `id` replaced, or the scope
/// as it was when the edit is refused or changes nothing.
pub fn set_clip_keys(scope: &EditScope, id: &str, property: &str, keys: &[Value]) -> EngineResult<EditScope> {
    let Some(clip) = scope.doc.clips.iter().find(|clip| clip.id == id) else { return Ok(scope.clone()) };
    let Some(target) = key_target(scope, clip)? else { return Ok(scope.clone()) };
    if !edit_allowed(&target, property, keys) {
        return Ok(scope.clone());
    }
    let current = to_js_string(&current_track(target.animation.as_ref(), property)?).map_err(EngineError::InvalidInput)?;
    let requested = to_js_string(&keys).map_err(EngineError::InvalidInput)?;
    if current == requested {
        return Ok(scope.clone());
    }
    let next = target.write(clip, with_track(target.animation.as_ref(), property, keys));
    let mut result = scope.clone();
    result.doc.clips =
        scope.doc.clips.iter().map(|other| if other.id == id { std::sync::Arc::new(next.clone()) } else { std::sync::Arc::clone(other) }).collect();
    Ok(result)
}
