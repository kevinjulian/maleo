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
    #[serde(default = "default_movement")]
    pub movement: String,
    #[serde(default)]
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
    #[serde(default)]
    pub motion: Option<Value>,
    #[serde(default)]
    pub transition: Option<String>,
    #[serde(default)]
    pub transition_dur_sec: Option<f64>,
    #[serde(default)]
    pub reveal: Option<Value>,
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
    #[serde(default)]
    pub motion: Option<Value>,
    #[serde(default)]
    pub focal_point: Option<FocalPoint>,
    #[serde(default)]
    pub layout: Option<Layout>,
    #[serde(default)]
    pub transition: Option<String>,
    #[serde(default)]
    pub transition_dur_sec: Option<f64>,
    #[serde(default)]
    pub reveal: Option<Value>,
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
    #[serde(default)]
    pub reveal: Option<Value>,
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
    /// Mask, color, blend mode, animation, playback and audio fields.
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
        raw
    }
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
    #[serde(default)]
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
        Ok(Self {
            scenes,
            accent_color: take(&mut object, "accentColor")?.unwrap_or_else(|| "#FF3E6C".into()),
            bg_color: take(&mut object, "bgColor")?.unwrap_or_else(|| "#0B0B0F".into()),
            fg_color: take(&mut object, "fgColor")?.unwrap_or_else(|| "#FFFFFF".into()),
            show_labels: take(&mut object, "showLabels")?.unwrap_or(false),
            hide_base: take(&mut object, "hideBase")?.unwrap_or(false),
            text_overlays: take(&mut object, "textOverlays")?.unwrap_or_default(),
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
        let storyboard = Storyboard::parse(r#"{"scenes":[{"image":"a.png","layout":{"mask":{"shape":"circle"}},"futureField":1}]}"#).unwrap();
        let scene = &storyboard.scenes[0];
        assert!(scene.rest.contains_key("futureField"));
        assert!(scene.layout.as_ref().unwrap().rest.contains_key("mask"));
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
}
