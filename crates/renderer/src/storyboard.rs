//! The render storyboard: the value `buildRenderStoryboardFromDoc` builds and
//! `packages/video/src/schema.ts` validates (D1).
//!
//! The types decode the fields the renderer draws or must inspect for
//! coverage. Every other field of an element stays as raw JSON in `rest`, so
//! the coverage walk sees elements and options the renderer does not draw.
//! Defaults follow the zod schema the export parses with: top-level fields
//! carry their `.default()`, while `.partial()` objects (layout, text style,
//! caption config) stay optional and the drawing code applies the component
//! fallbacks, as the compositions do.

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

pub type Raw = Map<String, Value>;

/// A storyboard that failed to decode. The message names the failing field.
#[derive(Debug, Clone, PartialEq)]
pub struct DecodeError(pub String);

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for DecodeError {}

#[derive(Debug, Clone, Default)]
pub struct Storyboard {
    pub scenes: Vec<Scene>,
    pub accent_color: String,
    pub bg_color: String,
    pub fg_color: String,
    pub show_labels: bool,
    pub hide_base: bool,
    pub text_overlays: Vec<TextOverlay>,
    pub video_overlays: Vec<VideoOverlay>,
    pub effects: Vec<Effect>,
    pub visual_timeline: Option<Vec<TimelineVisual>>,
    pub caption_cues: Vec<CaptionClip>,
    /// The project caption config; each cue's own style overrides it.
    pub captions: Option<Raw>,
    pub pacing_devices: Option<PacingDevices>,
    /// Audio, music, voiceover and other fields that do not draw.
    pub rest: Raw,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub image: String,
    #[serde(default)]
    pub layout: Option<Layout>,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub visual: String,
    #[serde(default)]
    pub chapter: Option<String>,
    #[serde(default = "default_movement")]
    pub movement: String,
    #[serde(default, deserialize_with = "decode_motion")]
    pub motion: Option<Value>,
    #[serde(default)]
    pub focal_point: Option<FocalPoint>,
    #[serde(default = "default_transition")]
    pub transition: String,
    #[serde(default)]
    pub transition_dur_sec: Option<f64>,
    #[serde(default = "default_scene_duration")]
    pub duration_sec: f64,
    #[serde(default)]
    pub start_sec: Option<f64>,
    #[serde(default)]
    pub visual_clips: Option<Vec<SceneVisual>>,
    #[serde(default)]
    pub vignette: bool,
    #[serde(default)]
    pub grain: bool,
    #[serde(flatten)]
    pub rest: Raw,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneVisual {
    pub url: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub layout: Option<Layout>,
    #[serde(default)]
    pub start_sec: Option<f64>,
    #[serde(default)]
    pub duration_sec: Option<f64>,
    #[serde(default, deserialize_with = "decode_motion")]
    pub motion: Option<Value>,
    #[serde(default)]
    pub transition: Option<String>,
    #[serde(default)]
    pub transition_dur_sec: Option<f64>,
    #[serde(default, deserialize_with = "decode_reveal")]
    pub reveal: Option<Reveal>,
    #[serde(flatten)]
    pub rest: Raw,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineVisual {
    pub url: String,
    #[serde(default = "default_image_kind")]
    pub kind: String,
    #[serde(default)]
    pub start_sec: f64,
    #[serde(default = "default_timeline_duration")]
    pub duration_sec: f64,
    #[serde(default)]
    pub movement: Option<String>,
    #[serde(default, deserialize_with = "decode_motion")]
    pub motion: Option<Value>,
    #[serde(default)]
    pub focal_point: Option<FocalPoint>,
    #[serde(default)]
    pub layout: Option<Layout>,
    #[serde(default)]
    pub transition: Option<String>,
    #[serde(default)]
    pub transition_dur_sec: Option<f64>,
    #[serde(default, deserialize_with = "decode_reveal")]
    pub reveal: Option<Reveal>,
    #[serde(flatten)]
    pub rest: Raw,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoOverlay {
    pub url: String,
    #[serde(default = "default_image_kind")]
    pub kind: String,
    #[serde(default)]
    pub track: f64,
    #[serde(default)]
    pub start_sec: f64,
    #[serde(default = "default_overlay_duration")]
    pub duration_sec: f64,
    #[serde(default)]
    pub layout: Option<Layout>,
    #[serde(default)]
    pub transition: Option<String>,
    #[serde(default)]
    pub transition_dur_sec: Option<f64>,
    #[serde(default, deserialize_with = "decode_reveal")]
    pub reveal: Option<Reveal>,
    #[serde(flatten)]
    pub rest: Raw,
}

/// Clip placement in percent of the canvas (`clipLayoutShape`, all optional).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    #[serde(default)]
    pub x_pct: Option<f64>,
    #[serde(default)]
    pub y_pct: Option<f64>,
    #[serde(default)]
    pub width_pct: Option<f64>,
    #[serde(default)]
    pub height_pct: Option<f64>,
    #[serde(default)]
    pub fit: Option<String>,
    #[serde(default)]
    pub rotation_deg: Option<f64>,
    #[serde(default)]
    pub opacity: Option<f64>,
    #[serde(default)]
    pub crop: Option<Crop>,
    #[serde(default)]
    pub flip_x: Option<bool>,
    #[serde(default)]
    pub flip_y: Option<bool>,
    #[serde(default, deserialize_with = "decode_animation")]
    pub animation: Option<Value>,
    #[serde(default, deserialize_with = "decode_color")]
    pub color: Option<ClipColor>,
    #[serde(default, deserialize_with = "decode_mask")]
    pub mask: Option<Value>,
    #[serde(default, deserialize_with = "decode_blend")]
    pub blend_mode: Option<String>,
    /// Playback and audio fields.
    #[serde(flatten)]
    pub rest: Raw,
}

impl Layout {
    /// `{ ...base, ...over }` as the compositions merge a scene and a clip
    /// layout: a key present in `over` wins, even when its value is null.
    pub fn merged(base: Option<&Layout>, over: Option<&Layout>) -> Option<Layout> {
        match (base, over) {
            (None, None) => None,
            (Some(only), None) | (None, Some(only)) => Some(only.clone()),
            (Some(base), Some(over)) => {
                let mut raw = base.to_raw();
                raw.extend(over.to_raw());
                serde_json::from_value(Value::Object(raw)).ok()
            }
        }
    }

    fn to_raw(&self) -> Raw {
        let mut raw = self.rest.clone();
        let mut put = |key: &str, value: Option<Value>| {
            if let Some(value) = value {
                raw.insert(key.into(), value);
            }
        };
        put("xPct", self.x_pct.map(Value::from));
        put("yPct", self.y_pct.map(Value::from));
        put("widthPct", self.width_pct.map(Value::from));
        put("heightPct", self.height_pct.map(Value::from));
        put("fit", self.fit.clone().map(Value::from));
        put("rotationDeg", self.rotation_deg.map(Value::from));
        put("opacity", self.opacity.map(Value::from));
        put("crop", self.crop.map(|c| serde_json::json!({ "xPct": c.x_pct, "yPct": c.y_pct, "widthPct": c.width_pct, "heightPct": c.height_pct })));
        put("flipX", self.flip_x.map(Value::from));
        put("flipY", self.flip_y.map(Value::from));
        put("animation", self.animation.clone());
        put("mask", self.mask.clone());
        put("blendMode", self.blend_mode.clone().map(Value::from));
        put("color", self.color.map(|c| serde_json::json!({"brightness":c.brightness,"contrast":c.contrast,"saturation":c.saturation})));
        raw
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reveal {
    #[serde(rename = "type")]
    pub kind: String,
    pub direction: Option<String>,
    pub black_direction: Option<String>,
    pub phase: Option<String>,
    pub texture: Option<String>,
    pub color_build: Option<String>,
    pub duration_sec: Option<f64>,
    pub delay_sec: Option<f64>,
    pub intensity: Option<f64>,
}

fn decode_reveal<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Reveal>, D::Error> {
    let value = Value::deserialize(deserializer)?;
    for (name, allowed) in [
        ("type", &["fade", "wipe", "spotlight", "sketch_draw"][..]),
        ("direction", &["left", "right", "top", "bottom", "top_left_to_bottom_right", "draw_top_left_to_bottom_right", "center"][..]),
        ("blackDirection", &["none", "left", "right", "top", "bottom"][..]),
        ("phase", &["direct", "dark_pixels_first", "black_then_color"][..]),
        ("texture", &["clean", "paper", "ink", "dust", "glitch"][..]),
        ("colorBuild", &["none", "muted_to_full"][..]),
    ] {
        if value.get(name).is_some_and(|v| v.as_str().is_none_or(|s| !allowed.contains(&s))) || (name == "type" && value.get(name).is_none()) {
            return Err(serde::de::Error::custom(format!("reveal.{name}: expected a supported option")));
        }
    }
    for (name, min, max) in [("durationSec", 0.0, f64::MAX), ("delaySec", 0.0, f64::MAX), ("intensity", 0.0, 1.0)] {
        if value.get(name).is_some_and(|v| v.as_f64().is_none_or(|n| !n.is_finite() || !(min..=max).contains(&n) || (name == "durationSec" && n == 0.0))) {
            return Err(serde::de::Error::custom(format!("reveal.{name}: outside allowed range")));
        }
    }
    serde_json::from_value(value).map(Some).map_err(|e| serde::de::Error::custom(format!("reveal: {e}")))
}

fn decode_blend<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    let value = String::deserialize(deserializer).map_err(|e| serde::de::Error::custom(format!("blendMode: {e}")))?;
    if !["normal", "multiply", "screen"].contains(&value.as_str()) {
        return Err(serde::de::Error::custom("blendMode: unknown mode"));
    }
    Ok(Some(value))
}

/// Raw null remains present so a clip can remove its scene's inherited mask.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipMask {
    pub shape: MaskShape,
    pub x_pct: f64,
    pub y_pct: f64,
    pub width_pct: f64,
    pub height_pct: f64,
    pub rotation_deg: f64,
    pub feather_pct: f64,
    pub inverted: bool,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MaskShape {
    Rectangle,
    Ellipse,
}

impl Layout {
    pub fn local_mask(&self) -> Option<ClipMask> {
        self.mask.as_ref().filter(|m| !m.is_null()).map(|m| serde_json::from_value(m.clone()).expect("validated mask"))
    }
}

fn decode_mask<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    let value = Value::deserialize(deserializer)?;
    if !value.is_null() {
        let mask: ClipMask = serde_json::from_value(value.clone()).map_err(|e| serde::de::Error::custom(format!("mask: {e}")))?;
        for (name, value, min, max) in [
            ("xPct", mask.x_pct, 0.0, 100.0),
            ("yPct", mask.y_pct, 0.0, 100.0),
            ("widthPct", mask.width_pct, 0.0, 100.0),
            ("heightPct", mask.height_pct, 0.0, 100.0),
            ("rotationDeg", mask.rotation_deg, -180.0, 180.0),
            ("featherPct", mask.feather_pct, 0.0, 50.0),
        ] {
            if !value.is_finite() || !(min..=max).contains(&value) || (["widthPct", "heightPct"].contains(&name) && value == 0.0) {
                return Err(serde::de::Error::custom(format!("mask.{name}: outside allowed range")));
            }
        }
        if mask.x_pct + mask.width_pct > 100.0 || mask.y_pct + mask.height_pct > 100.0 {
            return Err(serde::de::Error::custom("mask: must fit the local clip box before rotation"));
        }
    }
    Ok(Some(value))
}

/// CSS correction on straight sRGB channels, in authored filter order.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClipColor {
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
}

impl ClipColor {
    pub fn neutral(self) -> bool {
        self.brightness == 1.0 && self.contrast == 1.0 && self.saturation == 1.0
    }
}

fn decode_color<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<ClipColor>, D::Error> {
    let value = Value::deserialize(deserializer)?;
    let color: ClipColor = serde_json::from_value(value).map_err(|e| serde::de::Error::custom(format!("color: {e}")))?;
    for (name, value, max) in [("brightness", color.brightness, 2.0), ("contrast", color.contrast, 2.0), ("saturation", color.saturation, 3.0)] {
        if !value.is_finite() || !(0.0..=max).contains(&value) {
            return Err(serde::de::Error::custom(format!("color.{name}: expected a finite number in 0..{max}")));
        }
    }
    Ok(Some(color))
}

/// A source crop in percent of the source image.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Crop {
    pub x_pct: f64,
    pub y_pct: f64,
    pub width_pct: f64,
    pub height_pct: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocalPoint {
    pub x_pct: f64,
    pub y_pct: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextOverlay {
    pub content: String,
    #[serde(default)]
    pub start_sec: f64,
    #[serde(default = "default_text_duration")]
    pub duration_sec: f64,
    #[serde(default)]
    pub preset: Option<String>,
    #[serde(default)]
    pub track: Option<f64>,
    #[serde(default)]
    pub layout: Option<Layout>,
    #[serde(default)]
    pub style: Option<TextStyle>,
    #[serde(default, deserialize_with = "decode_legacy_animation")]
    pub anim: Option<Value>,
    #[serde(flatten)]
    pub rest: Raw,
}

/// `clipTextStyleSchema`, all optional.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default)]
    pub font_size: Option<f64>,
    #[serde(default)]
    pub weight: Option<f64>,
    #[serde(default)]
    pub fill: Option<String>,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub bg_opacity: Option<f64>,
    #[serde(default)]
    pub scale: Option<f64>,
    #[serde(default)]
    pub align: Option<String>,
    #[serde(default)]
    pub casing: Option<String>,
    #[serde(default)]
    pub line_height: Option<f64>,
    #[serde(default)]
    pub letter_spacing: Option<f64>,
    #[serde(flatten)]
    pub rest: Raw,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    pub effect: String,
    #[serde(default)]
    pub start_sec: f64,
    #[serde(default = "default_effect_duration")]
    pub duration_sec: f64,
    #[serde(default)]
    pub intensity: Option<f64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PacingDevices {
    #[serde(default)]
    pub chapter_pills: Option<bool>,
    #[serde(default)]
    pub progress_bar: Option<bool>,
    #[serde(flatten)]
    pub rest: Raw,
}

/// A caption cue (`CaptionClipSchema`): times in seconds, words cue-local.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionClip {
    pub id: String,
    pub start_sec: f64,
    pub duration_sec: f64,
    pub caption: Caption,
    #[serde(flatten)]
    pub rest: Raw,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Caption {
    pub text: String,
    #[serde(default)]
    pub words: Vec<CaptionWord>,
    #[serde(default)]
    pub style: Option<Raw>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(flatten)]
    pub rest: Raw,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionWord {
    pub text: String,
    pub start_sec: f64,
    pub end_sec: f64,
}

fn default_movement() -> String {
    "Slow Zoom In".into()
}
fn default_transition() -> String {
    "fade".into()
}
fn default_image_kind() -> String {
    "image".into()
}
fn default_scene_duration() -> f64 {
    4.0
}
fn default_timeline_duration() -> f64 {
    2.0
}
fn default_overlay_duration() -> f64 {
    3.0
}
fn default_text_duration() -> f64 {
    2.0
}
fn default_effect_duration() -> f64 {
    1.0
}

fn decode_motion<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    let Some(value) = Option::<Value>::deserialize(deserializer)? else { return Ok(None) };
    let validate = || -> Result<(), String> {
        let keys = value.get("keyframes").and_then(Value::as_array).filter(|keys| keys.len() >= 2).ok_or("motion.keyframes: expected at least two keys")?;
        for (index, key) in keys.iter().enumerate() {
            for property in ["t", "scale", "x", "y"] {
                let number = key
                    .get(property)
                    .and_then(Value::as_f64)
                    .filter(|n| n.is_finite())
                    .ok_or_else(|| format!("motion.keyframes[{index}].{property}: expected a finite number"))?;
                if property == "t" && !(0.0..=1.0).contains(&number) {
                    return Err(format!("motion.keyframes[{index}].t: expected normalized progress"));
                }
            }
            if key.get("rotate").is_some_and(|v| v.as_f64().is_none_or(|n| !n.is_finite())) {
                return Err(format!("motion.keyframes[{index}].rotate: expected a finite number"));
            }
            if key.get("easing").is_some_and(|v| v.as_str().is_none_or(|easing| !["linear", "in", "out", "in-out", "bezier"].contains(&easing))) {
                return Err(format!("motion.keyframes[{index}].easing: unknown camera easing"));
            }
        }
        Ok(())
    };
    validate().map_err(serde::de::Error::custom)?;
    Ok(Some(value))
}

/// Validate tracks without dropping their raw fields. Ordinary animation uses
/// the editor registry; legacy text keeps its normalized, unbounded values.
fn animation_error(value: &Value, legacy: bool) -> Result<(), String> {
    let name = if legacy { "anim" } else { "animation" };
    let fields = value.as_object().ok_or_else(|| format!("{name}: expected an object"))?;
    let tracks = fields.get("tracks").and_then(Value::as_object).ok_or_else(|| format!("{name}.tracks: expected an object"))?;
    let colors = fields.get("colorTracks").map(|value| value.as_object().ok_or_else(|| format!("{name}.colorTracks: expected an object"))).transpose()?;
    for (group, tracks) in [("tracks", Some(tracks)), ("colorTracks", colors)] {
        let Some(tracks) = tracks else { continue };
        for (property, value) in tracks {
            let path = format!("{name}.{group}.{property}");
            let keys = value.as_array().ok_or_else(|| format!("{path}: expected a key array"))?;
            let color = group == "colorTracks";
            let valid = if legacy {
                let allowed = if color {
                    maleo_editor_core::keys::COLOR.contains(&property.as_str())
                } else {
                    ["x", "y", "width", "height", "scale", "rotate", "opacity", "blur", "bgOpacity", "fontSize", "letterSpacing", "lineHeight"]
                        .contains(&property.as_str())
                };
                allowed
                    && keys.iter().all(|key| {
                        key.get("t").and_then(Value::as_f64).is_some_and(|time| (0.0..=1.0).contains(&time))
                            && key.get("v").is_some_and(|value| if color { value.is_string() } else { value.is_number() })
                            && key
                                .get("easing")
                                .is_none_or(|value| value.as_str().is_some_and(|easing| ["linear", "in", "out", "in-out", "bezier", "hold"].contains(&easing)))
                    })
            } else {
                let kind = if color {
                    Some("text")
                } else {
                    maleo_editor_core::keys::NUMERIC.iter().find(|spec| spec.name == property).and_then(|spec| spec.kinds.first().copied())
                };
                (color == maleo_editor_core::keys::COLOR.contains(&property.as_str())) && maleo_editor_core::keys::track_is_valid(kind, property, keys)
            };
            if !valid {
                return Err(format!("{path}: invalid property, key value, time, easing or retained range"));
            }
        }
    }
    Ok(())
}

fn decode_animation<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    let value = Value::deserialize(deserializer)?;
    animation_error(&value, false).map_err(serde::de::Error::custom)?;
    Ok(Some(value))
}

fn decode_legacy_animation<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    let value = Value::deserialize(deserializer)?;
    if value.is_null() {
        return Ok(None);
    }
    animation_error(&value, true).map_err(serde::de::Error::custom)?;
    Ok(Some(value))
}

/// Takes one field out of the top-level object and decodes it, naming the
/// field when it does not decode.
fn take<T: DeserializeOwned>(object: &mut Raw, key: &str) -> Result<Option<T>, DecodeError> {
    match object.remove(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::from_value(value).map(Some).map_err(|e| DecodeError(format!("`{key}`: {e}"))),
    }
}

impl Storyboard {
    pub fn parse(json: &str) -> Result<Self, DecodeError> {
        let value: Value = serde_json::from_str(json).map_err(|e| DecodeError(format!("storyboard is not JSON: {e}")))?;
        Self::from_value(value)
    }

    pub fn from_value(value: Value) -> Result<Self, DecodeError> {
        let Value::Object(mut object) = value else {
            return Err(DecodeError("storyboard is not an object".into()));
        };
        let scenes = take(&mut object, "scenes")?.ok_or_else(|| DecodeError("`scenes`: missing".into()))?;
        let text_overlays: Vec<TextOverlay> = take(&mut object, "textOverlays")?.unwrap_or_default();
        for (i, overlay) in text_overlays.iter().enumerate() {
            if overlay.preset.as_deref() == Some("motion-comp") {
                crate::scene::composition::Config::parse(overlay.rest.get("params")).map_err(|e| DecodeError(format!("textOverlays[{i}].{e}")))?;
            }
        }
        Ok(Self {
            scenes,
            accent_color: take(&mut object, "accentColor")?.unwrap_or_else(|| "#FF3E6C".into()),
            bg_color: take(&mut object, "bgColor")?.unwrap_or_else(|| "#0B0B0F".into()),
            fg_color: take(&mut object, "fgColor")?.unwrap_or_else(|| "#FFFFFF".into()),
            show_labels: take(&mut object, "showLabels")?.unwrap_or(false),
            hide_base: take(&mut object, "hideBase")?.unwrap_or(false),
            text_overlays,
            video_overlays: take(&mut object, "videoOverlays")?.unwrap_or_default(),
            effects: take(&mut object, "effects")?.unwrap_or_default(),
            visual_timeline: take(&mut object, "visualTimeline")?,
            caption_cues: take(&mut object, "captionCues")?.unwrap_or_default(),
            captions: take(&mut object, "captions")?,
            pacing_devices: take(&mut object, "pacingDevices")?,
            rest: object,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_reveal_fields_are_named() {
        for (name, bad) in [
            ("type", serde_json::json!("other")),
            ("direction", serde_json::json!(1)),
            ("durationSec", serde_json::json!(0)),
            ("delaySec", serde_json::json!(-1)),
            ("intensity", serde_json::json!(2)),
            ("phase", serde_json::json!("other")),
        ] {
            let mut reveal = serde_json::json!({"type":"fade"});
            reveal[name] = bad;
            let error = Storyboard::from_value(serde_json::json!({"scenes":[],"videoOverlays":[{"url":"a","reveal":reveal}]})).unwrap_err();
            assert!(error.0.contains(&format!("reveal.{name}")), "{error}");
        }
    }

    #[test]
    fn blend_modes_validate_and_inherit() {
        assert!(serde_json::from_value::<Layout>(serde_json::json!({"blendMode":"overlay"})).unwrap_err().to_string().contains("blendMode"));
        let base: Layout = serde_json::from_value(serde_json::json!({"blendMode":"multiply"})).unwrap();
        let absent = Layout::default();
        assert_eq!(Layout::merged(Some(&base), Some(&absent)).unwrap().blend_mode.as_deref(), Some("multiply"));
        let normal: Layout = serde_json::from_value(serde_json::json!({"blendMode":"normal"})).unwrap();
        assert_eq!(Layout::merged(Some(&base), Some(&normal)).unwrap().blend_mode.as_deref(), Some("normal"));
    }

    #[test]
    fn masks_validate_and_explicit_null_removes_inheritance() {
        let mask = serde_json::json!({"shape":"ellipse","xPct":10,"yPct":20,"widthPct":60,"heightPct":50,"rotationDeg":30,"featherPct":0,"inverted":true});
        let base: Layout = serde_json::from_value(serde_json::json!({"mask":mask})).unwrap();
        let absent: Layout = serde_json::from_value(serde_json::json!({"xPct":12})).unwrap();
        assert!(Layout::merged(Some(&base), Some(&absent)).unwrap().local_mask().is_some());
        let removed: Layout = serde_json::from_value(serde_json::json!({"mask":null})).unwrap();
        assert!(Layout::merged(Some(&base), Some(&removed)).unwrap().local_mask().is_none());
        for (property, value) in [
            ("shape", serde_json::json!("circle")),
            ("widthPct", serde_json::json!(0)),
            ("xPct", serde_json::json!(90)),
            ("featherPct", serde_json::json!(51)),
            ("inverted", serde_json::json!(0)),
        ] {
            let mut bad = mask.clone();
            bad[property] = value;
            let error = serde_json::from_value::<Layout>(serde_json::json!({"mask":bad})).unwrap_err();
            assert!(error.to_string().contains("mask"), "{error}");
        }
    }

    #[test]
    fn malformed_correction_fields_are_refused_by_name() {
        for (color, field) in [
            (serde_json::json!({"brightness":3,"contrast":1,"saturation":1}), "color.brightness"),
            (serde_json::json!({"brightness":1,"contrast":-1,"saturation":1}), "color.contrast"),
            (serde_json::json!({"brightness":1,"contrast":1,"saturation":4}), "color.saturation"),
            (serde_json::json!({"brightness":1,"contrast":1}), "saturation"),
            (serde_json::json!({"brightness":1,"contrast":1,"saturation":1,"other":true}), "other"),
            (Value::Null, "color"),
        ] {
            let error = Storyboard::from_value(serde_json::json!({"scenes":[{"image":"a","layout":{"color":color}}]})).unwrap_err();
            assert!(error.0.contains(field), "{error}");
        }
        let near: ClipColor = serde_json::from_value(serde_json::json!({"brightness":1.000000001,"contrast":1,"saturation":1})).unwrap();
        assert!(!near.neutral(), "authored nonneutral values still select the full-height wrapper");
        let base: Layout = serde_json::from_value(serde_json::json!({"color":{"brightness":2,"contrast":1,"saturation":1}})).unwrap();
        let over: Layout = serde_json::from_value(serde_json::json!({"xPct":12})).unwrap();
        assert_eq!(Layout::merged(Some(&base), Some(&over)).unwrap().color, base.color);
    }

    #[test]
    fn malformed_camera_fields_are_refused_and_raw_options_survive() {
        let motion = serde_json::json!({"keyframes":[{"t":0,"scale":1,"x":0,"y":0},{"t":1,"scale":1.2,"x":10,"y":20}],"futureOption":true});
        let good = serde_json::json!({"scenes":[{"image":"a","motion":motion}]});
        assert_eq!(Storyboard::from_value(good.clone()).unwrap().scenes[0].motion.as_ref().unwrap(), &motion);
        for (property, bad) in [("x", serde_json::json!("bad")), ("t", serde_json::json!(2)), ("rotate", Value::Null), ("easing", serde_json::json!("hold"))] {
            let mut value = good.clone();
            value["scenes"][0]["motion"]["keyframes"][1][property] = bad;
            let error = Storyboard::from_value(value).unwrap_err();
            assert!(error.0.contains(&format!("motion.keyframes[1].{property}")), "{error}");
        }
        assert!(Storyboard::parse(r#"{"scenes":[{"image":"a","motion":null}]}"#).unwrap().scenes[0].motion.is_none());
    }

    #[test]
    fn a_storyboard_from_the_shared_builder_decodes() {
        let storyboard = Storyboard::parse(include_str!("../tests/fixtures/built-storyboard.json")).expect("decodes");
        assert!(!storyboard.scenes.is_empty());
        assert!(!storyboard.text_overlays.is_empty());
        // Audio does not draw; it stays raw.
        assert!(storyboard.rest.contains_key("audioOverlays"));
    }

    #[test]
    fn a_non_array_scenes_field_is_refused_by_name() {
        let error = Storyboard::parse(r#"{"scenes": {"image": "a.png"}}"#).expect_err("refused");
        assert!(error.0.contains("`scenes`"), "{error}");
    }

    #[test]
    fn unknown_element_fields_stay_raw() {
        let storyboard = Storyboard::parse(r#"{"scenes":[{"image":"a.png","layout":{"futureLayoutOption":{"shape":"circle"}},"futureField":1}]}"#).unwrap();
        let scene = &storyboard.scenes[0];
        assert!(scene.rest.contains_key("futureField"));
        assert!(scene.layout.as_ref().unwrap().rest.contains_key("futureLayoutOption"));
        assert_eq!(scene.transition, "fade", "zod default");
        assert_eq!(scene.movement, "Slow Zoom In", "zod default");
    }

    #[test]
    fn a_clip_layout_key_overrides_the_scene_layout() {
        let scene: Layout = serde_json::from_str(r#"{"xPct":10,"widthPct":50,"opacity":0.5}"#).unwrap();
        let clip: Layout = serde_json::from_str(r#"{"xPct":20,"heightPct":null}"#).unwrap();
        let merged = Layout::merged(Some(&scene), Some(&clip)).unwrap();
        assert_eq!((merged.x_pct, merged.width_pct, merged.opacity, merged.height_pct), (Some(20.0), Some(50.0), Some(0.5), None));
    }

    #[test]
    fn malformed_animation_fields_are_refused_by_name() {
        for (animation, field) in [
            (serde_json::json!({}), "animation.tracks"),
            (serde_json::json!({"tracks":{"opacity":5}}), "animation.tracks.opacity"),
            (serde_json::json!({"tracks":{"opacity":[{"t":0,"v":"bad"}]}}), "animation.tracks.opacity"),
            (serde_json::json!({"tracks":{"opacity":[{"t":0,"v":0},{"t":0,"v":1}]}}), "animation.tracks.opacity"),
            (serde_json::json!({"tracks":{"opacity":[{"t":0,"v":0,"easingRange":[0.8,0.2]}]}}), "animation.tracks.opacity"),
            (serde_json::json!({"tracks":{},"colorTracks":[]}), "animation.colorTracks"),
            (serde_json::json!({"tracks":{},"colorTracks":{"fill":[{"t":0,"v":5}]}}), "animation.colorTracks.fill"),
        ] {
            let value = serde_json::json!({"scenes":[{"image":"a","layout":{"animation":animation}}]});
            let error = Storyboard::from_value(value).expect_err("malformed animation");
            assert!(error.0.contains(field), "{error}");
        }
        let error = Storyboard::parse(r#"{"scenes":[],"textOverlays":[{"content":"x","anim":{"tracks":{"x":[{"t":2,"v":1}]}}}]}"#).expect_err("legacy time");
        assert!(error.0.contains("anim.tracks.x"), "{error}");
        assert!(Storyboard::parse(r#"{"scenes":[],"textOverlays":[{"content":"x","anim":null}]}"#).unwrap().text_overlays[0].anim.is_none());
    }

    #[test]
    fn animation_retains_raw_fields_and_inherits_as_one_value() {
        let raw = serde_json::json!({"tracks":{"opacity":[{"t":0,"v":1}]},"futureOption":{"x":1}});
        let base: Layout = serde_json::from_value(serde_json::json!({"animation":raw})).unwrap();
        assert_eq!(base.animation.as_ref(), Some(&raw));
        let over: Layout = serde_json::from_value(serde_json::json!({"xPct":20})).unwrap();
        assert_eq!(Layout::merged(Some(&base), Some(&over)).unwrap().animation.as_ref(), Some(&raw));
        let over: Layout = serde_json::from_value(serde_json::json!({"animation":{"tracks":{}}})).unwrap();
        assert_eq!(Layout::merged(Some(&base), Some(&over)).unwrap().animation, over.animation);
    }

    #[test]
    fn source_derived_tracks_match_the_shared_editor_samplers() {
        use maleo_editor_core::keyframes::{evaluate_color_track, evaluate_value_track};
        let fixture: Value = serde_json::from_str(include_str!("../tests/fixtures/keyframe-timing.json")).unwrap();
        for case in fixture["numeric"].as_array().unwrap() {
            for sample in case["samples"].as_array().unwrap() {
                let value = evaluate_value_track(case["keys"].as_array().unwrap(), sample["seconds"].as_f64().unwrap(), case["fallback"].as_f64().unwrap());
                assert!((value - sample["value"].as_f64().unwrap()).abs() < 1e-12, "{} at {}: {value}", case["name"], sample["frame"]);
            }
        }
        for case in fixture["colors"].as_array().unwrap() {
            let keys = case["keys"].as_array().unwrap();
            for sample in case["samples"].as_array().unwrap() {
                let value = if keys.is_empty() { case["fallback"].clone() } else { evaluate_color_track(keys, sample["seconds"].as_f64().unwrap()).unwrap() };
                assert_eq!(value, sample["value"], "{} at {}", case["name"], sample["frame"]);
            }
        }
    }
}
