//! Keyframe evaluation and window retention: a port of
//! `packages/shared/src/keyframe-evaluation.ts` and `retainClipAnimation` in
//! `clip-animation.ts`.
//!
//! Arithmetic follows the TS line for line so results are bit-identical
//! (design decision 4). JavaScript's `Math.round`, `Math.min` and `Math.max`
//! differ from Rust's on halves and `NaN`, so they are reproduced here rather
//! than borrowed from `f64`.

use serde_json::{Map, Value};

use crate::error::{EngineError, EngineResult};
use crate::json::js_number_string;
use crate::keys::{COLOR, NUMERIC};
use crate::source::js_truthy;

/// A JSON read as JavaScript's `ToNumber` would see it in arithmetic. A string
/// is `NaN` here; no field this engine computes with is stored as one.
pub fn num(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(flag)) => f64::from(u8::from(*flag)),
        Some(Value::Number(number)) => number.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(_) | Value::Array(_) | Value::Object(_)) => f64::NAN,
    }
}

/// `Math.round`: halves go toward +∞, unlike `f64::round`.
pub fn js_round(x: f64) -> f64 {
    let floor = x.floor();
    if x - floor >= 0.5 { floor + 1.0 } else { floor }
}

/// `Math.min(a, b)`: `NaN` wins, unlike `f64::min`.
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else {
        b
    }
}

/// `Math.max(a, b)`: `NaN` wins, unlike `f64::max`.
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else {
        b
    }
}

fn clamp01(n: f64) -> f64 {
    // `f64::clamp` keeps `NaN` and `-0`, as the TS ternary does.
    n.clamp(0.0, 1.0)
}

const BEZIER_P1X: f64 = 0.16;
const BEZIER_P1Y: f64 = 1.0;
const BEZIER_P2X: f64 = 0.3;
const BEZIER_P2Y: f64 = 1.0;

fn cubic_bezier_axis(t: f64, a1: f64, a2: f64) -> f64 {
    let u = 1.0 - t;
    3.0 * u * u * t * a1 + 3.0 * u * t * t * a2 + t * t * t
}

fn bezier_ease(p: f64) -> f64 {
    if p <= 0.0 {
        return 0.0;
    }
    if p >= 1.0 {
        return 1.0;
    }
    let (mut lo, mut hi, mut t) = (0.0, 1.0, p);
    for _ in 0..24 {
        let x = cubic_bezier_axis(t, BEZIER_P1X, BEZIER_P2X);
        if (x - p).abs() < 1e-5 {
            break;
        }
        if x < p {
            lo = t;
        } else {
            hi = t;
        }
        t = (lo + hi) / 2.0;
    }
    cubic_bezier_axis(t, BEZIER_P1Y, BEZIER_P2Y)
}

/// `applyKeyframeEasing`: an unknown or absent easing is linear.
pub fn apply_easing(id: Option<&Value>, p: f64) -> f64 {
    let p = clamp01(p);
    match id.and_then(Value::as_str) {
        Some("in") => p * p,
        Some("out") => 1.0 - (1.0 - p) * (1.0 - p),
        // `Math.pow(x, 2)` is correctly rounded, so it equals `x * x`.
        Some("in-out") => {
            if p < 0.5 {
                2.0 * p * p
            } else {
                let x = -2.0 * p + 2.0;
                1.0 - x * x / 2.0
            }
        }
        Some("bezier") => bezier_ease(p),
        Some("hold") => {
            if p >= 1.0 {
                1.0
            } else {
                0.0
            }
        }
        _ => p,
    }
}

fn t_of(key: &Value) -> f64 {
    num(key.get("t"))
}

fn is_hold(key: &Value) -> bool {
    key.get("easing").and_then(Value::as_str) == Some("hold")
}

/// `b.easingRange ?? [0, 1]`.
fn easing_range(key: &Value) -> (f64, f64) {
    match key.get("easingRange") {
        None | Some(Value::Null) => (0.0, 1.0),
        Some(range) => (num(range.get(0)), num(range.get(1))),
    }
}

/// `segmentProgress(a, b, time)`.
fn segment_progress(a: &Value, b: &Value, time: f64) -> f64 {
    let (at, bt) = (t_of(a), t_of(b));
    if is_hold(b) {
        return if time < bt { 0.0 } else { 1.0 };
    }
    let progress = if bt > at { (time - at) / (bt - at) } else { 1.0 };
    let (from, to) = easing_range(b);
    let easing = b.get("easing");
    let (low, high) = (apply_easing(easing, from), apply_easing(easing, to));
    if high > low { (apply_easing(easing, from + (to - from) * progress) - low) / (high - low) } else { progress }
}

/// `evaluateValueTrack(keys, time, fallback)`.
pub fn evaluate_value_track(keys: &[Value], time: f64, fallback: f64) -> f64 {
    let (Some(first), Some(last)) = (keys.first(), keys.last()) else {
        return fallback;
    };
    if time <= t_of(first) {
        return num(first.get("v"));
    }
    if time >= t_of(last) {
        return num(last.get("v"));
    }
    for pair in keys.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        if time <= t_of(b) {
            if is_hold(b) {
                return if time < t_of(b) { num(a.get("v")) } else { num(b.get("v")) };
            }
            let (av, bv) = (num(a.get("v")), num(b.get("v")));
            return av + (bv - av) * segment_progress(a, b, time);
        }
    }
    num(last.get("v"))
}

pub(crate) fn js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{A}' | '\u{B}' | '\u{C}' | '\u{D}' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

/// `String.prototype.trim`, and `\s` in a JavaScript regular expression.
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(js_space)
}

fn hex_pair(text: &str) -> Option<f64> {
    u8::from_str_radix(text, 16).ok().map(f64::from)
}

/// `parseColor`: `#rgb`, `rgb(r, g, b)` with up to three digits each, or `#rrggbb`.
fn parse_color(input: &str) -> Option<(f64, f64, f64)> {
    let raw = js_trim(input);
    let hex = |text: &str| text.chars().all(|c| c.is_ascii_hexdigit());
    if let Some(digits) = raw.strip_prefix('#') {
        if digits.len() == 3 && hex(digits) {
            let pair = |i: usize| hex_pair(&digits[i..=i].repeat(2));
            return Some((pair(0)?, pair(1)?, pair(2)?));
        }
        if digits.len() == 6 && hex(digits) {
            return Some((hex_pair(&digits[0..2])?, hex_pair(&digits[2..4])?, hex_pair(&digits[4..6])?));
        }
        return None;
    }
    let body = raw.get(..4).filter(|head| head.eq_ignore_ascii_case("rgb(")).and_then(|_| raw[4..].strip_suffix(')'))?;
    let parts: Vec<&str> = body.split(',').map(js_trim).collect();
    let channel = |part: &str| {
        (!part.is_empty() && part.len() <= 3 && part.chars().all(|c| c.is_ascii_digit())).then(|| part.parse::<u16>().ok().map(f64::from)).flatten()
    };
    match parts.as_slice() {
        [r, g, b] => Some((channel(r)?, channel(g)?, channel(b)?)),
        _ => None,
    }
}

fn lerp(a: f64, b: f64, p: f64) -> f64 {
    a + (b - a) * p
}

fn js_text(x: f64) -> String {
    js_number_string(x).unwrap_or_else(|| {
        if x.is_nan() {
            "NaN".to_owned()
        } else if x > 0.0 {
            "Infinity".to_owned()
        } else {
            "-Infinity".to_owned()
        }
    })
}

/// `colorMix(a, b, p)`.
fn color_mix(a: &str, b: &str, p: f64) -> String {
    match (parse_color(a), parse_color(b)) {
        (Some(ca), Some(cb)) => {
            format!("rgb({}, {}, {})", js_text(js_round(lerp(ca.0, cb.0, p))), js_text(js_round(lerp(ca.1, cb.1, p))), js_text(js_round(lerp(ca.2, cb.2, p))))
        }
        _ if p < 1.0 => format!("color-mix(in srgb, {b} {}%, {a})", js_text(js_round(p * 100.0))),
        _ => b.to_owned(),
    }
}

fn colour(key: &Value) -> EngineResult<&str> {
    key.get("v").and_then(Value::as_str).ok_or_else(|| EngineError::InvalidInput("a colour keyframe value is not a string".to_owned()))
}

/// `evaluateColorTrack(keys, time, fallback)` for a non-empty track.
pub fn evaluate_color_track(keys: &[Value], time: f64) -> EngineResult<Value> {
    let (Some(first), Some(last)) = (keys.first(), keys.last()) else {
        return Err(EngineError::InvalidInput("an empty colour track has no value".to_owned()));
    };
    if keys.len() == 1 || time <= t_of(first) {
        return Ok(first.get("v").cloned().unwrap_or(Value::Null));
    }
    if time >= t_of(last) {
        return Ok(last.get("v").cloned().unwrap_or(Value::Null));
    }
    for pair in keys.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        if time <= t_of(b) {
            if is_hold(b) {
                let held = if time < t_of(b) { a } else { b };
                return Ok(held.get("v").cloned().unwrap_or(Value::Null));
            }
            return Ok(Value::String(color_mix(colour(a)?, colour(b)?, segment_progress(a, b, time))));
        }
    }
    Ok(last.get("v").cloned().unwrap_or(Value::Null))
}

fn number(value: f64) -> EngineResult<Value> {
    serde_json::Number::from_f64(value).map(Value::Number).ok_or_else(|| EngineError::InvalidInput(format!("non-finite keyframe value {value}")))
}

/// `retainTrack(keys, from, to, sample)`: keys inside `[from, to]` re-based to
/// `from`, with boundary keys sampled; a cut segment keeps its easing subcurve.
fn retain_track(keys: &[Value], from: f64, to: f64, sample: impl Fn(f64) -> EngineResult<Value>) -> EngineResult<Vec<Value>> {
    let times: Vec<f64> = std::iter::once(from).chain(keys.iter().map(t_of).filter(|t| *t > from && *t < to)).chain(std::iter::once(to)).collect();
    let mut retained = Vec::with_capacity(times.len());
    for (i, &time) in times.iter().enumerate() {
        let mut point = Map::new();
        point.insert("t".to_owned(), number(time - from)?);
        point.insert("v".to_owned(), sample(time)?);
        let end = keys.iter().position(|key| t_of(key) >= time);
        let b = end.and_then(|end| keys.get(end));
        let a = end.and_then(|end| end.checked_sub(1)).and_then(|start| keys.get(start));
        if let (true, Some(a), Some(b)) = (i > 0, a, b) {
            if is_hold(b) {
                point.insert("easing".to_owned(), Value::String("hold".to_owned()));
            } else {
                let (low, high) = easing_range(b);
                let span = t_of(b) - t_of(a);
                let left = js_max(0.0, js_min(1.0, (times[i - 1] - t_of(a)) / span));
                let right = js_max(0.0, js_min(1.0, (time - t_of(a)) / span));
                // `easing: b.easing`: an absent easing stays absent.
                if let Some(easing) = b.get("easing") {
                    point.insert("easing".to_owned(), easing.clone());
                }
                if !(left == 0.0 && right == 1.0) {
                    point.insert("easingRange".to_owned(), Value::Array(vec![number(low + (high - low) * left)?, number(low + (high - low) * right)?]));
                }
            }
        }
        retained.push(Value::Object(point));
    }
    Ok(retained)
}

/// `retainClipAnimation(animation, from, to)` for a present animation.
pub fn retain_animation(animation: &Value, from: f64, to: f64) -> EngineResult<Value> {
    if !from.is_finite() || !to.is_finite() || to <= from {
        return Err(EngineError::InvalidInput("Invalid animation window".to_owned()));
    }
    let fields = animation.as_object().ok_or_else(|| EngineError::InvalidInput("an animation is an object".to_owned()))?;
    let source_tracks = fields.get("tracks").and_then(Value::as_object).ok_or_else(|| EngineError::InvalidInput("an animation has tracks".to_owned()))?;
    let mut tracks = Map::new();
    // Registry order (`keys::NUMERIC`): a track under any other name is dropped.
    for property in NUMERIC.iter().map(|spec| spec.name) {
        if let Some(keys) = source_tracks.get(property).and_then(Value::as_array).filter(|keys| !keys.is_empty()) {
            let fallback = num(keys[0].get("v"));
            tracks.insert(property.to_owned(), Value::Array(retain_track(keys, from, to, |time| number(evaluate_value_track(keys, time, fallback)))?));
        }
    }
    let mut next = fields.clone();
    next.insert("tracks".to_owned(), Value::Object(tracks));
    if js_truthy(fields.get("colorTracks")) {
        let source_colors = fields.get("colorTracks").and_then(Value::as_object);
        let mut colors = Map::new();
        for property in COLOR {
            if let Some(keys) = source_colors.and_then(|tracks| tracks.get(property)).and_then(Value::as_array).filter(|keys| !keys.is_empty()) {
                colors.insert(property.to_owned(), Value::Array(retain_track(keys, from, to, |time| evaluate_color_track(keys, time))?));
            }
        }
        next.insert("colorTracks".to_owned(), Value::Object(colors));
    }
    Ok(Value::Object(next))
}

/// `retimeClipAnimation(animation, ratio)` for a present animation: a constant
/// retime scales every key time; values and easing stay as authored.
pub fn retime_animation(animation: &Value, ratio: f64) -> EngineResult<Value> {
    if !ratio.is_finite() || ratio <= 0.0 {
        return Err(EngineError::InvalidInput("Invalid animation rate".to_owned()));
    }
    let fields = animation.as_object().ok_or_else(|| EngineError::InvalidInput("an animation is an object".to_owned()))?;
    let scale = |keys: &Value| -> EngineResult<Value> {
        let keys = keys.as_array().ok_or_else(|| EngineError::InvalidInput("a track is an array".to_owned()))?;
        keys.iter()
            .map(|key| {
                let mut next = key.as_object().cloned().unwrap_or_default();
                next.insert("t".to_owned(), number(num(key.get("t")) * ratio)?);
                Ok(Value::Object(next))
            })
            .collect::<EngineResult<Vec<_>>>()
            .map(Value::Array)
    };
    let source_tracks = fields.get("tracks").and_then(Value::as_object).ok_or_else(|| EngineError::InvalidInput("an animation has tracks".to_owned()))?;
    let mut tracks = Map::new();
    for property in NUMERIC.iter().map(|spec| spec.name) {
        // `if (keys)`: an empty track is kept, scaled to empty.
        if let Some(keys) = source_tracks.get(property).filter(|keys| js_truthy(Some(keys))) {
            tracks.insert(property.to_owned(), scale(keys)?);
        }
    }
    let mut next = fields.clone();
    next.insert("tracks".to_owned(), Value::Object(tracks));
    if js_truthy(fields.get("colorTracks")) {
        let source_colors = fields.get("colorTracks").and_then(Value::as_object);
        let mut colors = Map::new();
        for property in COLOR {
            if let Some(keys) = source_colors.and_then(|tracks| tracks.get(property)).filter(|keys| js_truthy(Some(keys))) {
                colors.insert(property.to_owned(), scale(keys)?);
            }
        }
        next.insert("colorTracks".to_owned(), Value::Object(colors));
    }
    Ok(Value::Object(next))
}

/// `sampleClipProperty(animation, property, seconds, fallback)`.
pub fn sample_clip_property(animation: Option<&Value>, property: &str, seconds: f64, fallback: f64) -> f64 {
    let keys = animation.and_then(|animation| animation.get("tracks")).and_then(|tracks| tracks.get(property)).and_then(Value::as_array);
    keys.map_or(fallback, |keys| evaluate_value_track(keys, seconds, fallback))
}

/// `sampleClipTransform(layout, seconds)`: the keyed box at `seconds`, each
/// property falling back to the layout's static value.
pub fn sample_clip_transform(layout: Option<&Value>, seconds: f64) -> [f64; 5] {
    let animation = layout.and_then(|layout| layout.get("animation"));
    let static_or = |name: &str, fallback: f64| match layout.and_then(|layout| layout.get(name)) {
        None | Some(Value::Null) => fallback,
        value => num(value),
    };
    [
        sample_clip_property(animation, "xPct", seconds, static_or("xPct", 0.0)),
        sample_clip_property(animation, "yPct", seconds, static_or("yPct", 0.0)),
        sample_clip_property(animation, "scale", seconds, 1.0),
        sample_clip_property(animation, "rotationDeg", seconds, static_or("rotationDeg", 0.0)),
        sample_clip_property(animation, "opacity", seconds, static_or("opacity", 1.0)),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn javascript_numerics() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(0.49999999999999994), 0.0);
        assert!(js_min(1.0, f64::NAN).is_nan());
        assert!(js_max(f64::NAN, 0.0).is_nan());
    }

    #[test]
    fn mixes_colours_as_the_ts_does() {
        assert_eq!(color_mix("#000", "#ffffff", 0.5), "rgb(128, 128, 128)");
        assert_eq!(color_mix(" RGB( 0 ,0, 10 ) ", "#00000a", 0.25), "rgb(0, 0, 10)");
        assert_eq!(color_mix("red", "#fff", 0.333), "color-mix(in srgb, #fff 33%, red)");
        assert_eq!(color_mix("red", "#fff", 1.0), "#fff");
        assert_eq!(parse_color("rgb(1000,0,0)"), None);
    }

    #[test]
    fn retains_a_cut_segment_with_its_subcurve() {
        let animation = json!({ "tracks": { "opacity": [{ "t": 0, "v": 0 }, { "t": 2, "v": 1, "easing": "in" }], "unknown": [{ "t": 0, "v": 5 }] } });
        let retained = retain_animation(&animation, 1.0, 2.0).expect("retains");
        let text = crate::json::to_js_string(&retained).expect("serializes");
        assert_eq!(text, r#"{"tracks":{"opacity":[{"t":0,"v":0.25},{"t":1,"v":1,"easing":"in","easingRange":[0.5,1]}]}}"#);
    }
}
