//! Editing on the preview canvas (OpenSpec `p2-preview-editing`): the screen
//! mapping, element boxes at a time, hit testing, gestures with snapping, the
//! group and mask boxes, and the command a change makes.
//!
//! Ported from the web's former TypeScript rules (`canvas-transform.ts`,
//! `clip-mask-canvas.ts`, `canvas-hit-clips.ts` and the gesture math of
//! `clip-box.tsx`, deleted once this port matched them); `tests/fixtures/canvas.json`
//! records what they computed. Arithmetic follows the TS line for line, with
//! JavaScript's `Math.min`/`Math.max`/`Math.round` from
//! `maleo_editor_core::keyframes`.

pub mod edit;
pub mod geometry;
pub mod gesture;
pub mod group;
pub mod hit;
pub mod mask;
pub mod session;
pub mod view;

use maleo_editor_core::keyframes::{js_max, js_min};
use serde_json::{Map, Value};

/// `Math.max(lo, Math.min(hi, v))`.
pub fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    js_max(lo, js_min(hi, v))
}

/// The element families the canvas edits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Scene,
    Video,
    Text,
}

impl Source {
    pub fn name(self) -> &'static str {
        match self {
            Self::Scene => "scene",
            Self::Video => "video",
            Self::Text => "text",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "scene" => Some(Self::Scene),
            "video" => Some(Self::Video),
            "text" => Some(Self::Text),
            _ => None,
        }
    }
}

/// `CanvasTarget`: an element, and for a scene the visual clip whose layout is edited.
#[derive(Clone, Debug, PartialEq)]
pub struct Target {
    pub source: Source,
    pub id: f64,
    pub visual_id: Option<String>,
}

impl Target {
    pub fn new(source: Source, id: f64) -> Self {
        Self { source, id, visual_id: None }
    }

    /// `{"source", "id", "visualId"?}`.
    pub fn from_value(value: &Value) -> Result<Self, String> {
        let source = value.get("source").and_then(Value::as_str).and_then(Source::parse).ok_or("a target needs a `source` of scene, video or text")?;
        let id = value.get("id").and_then(Value::as_f64).ok_or("a target needs a numeric `id`")?;
        let visual_id = value.get("visualId").and_then(Value::as_str).map(str::to_owned);
        Ok(Self { source, id, visual_id })
    }

    pub fn to_value(&self) -> Value {
        let mut out = Map::new();
        out.insert("source".to_owned(), Value::from(self.source.name()));
        out.insert("id".to_owned(), num(self.id));
        if let Some(visual) = &self.visual_id {
            out.insert("visualId".to_owned(), Value::from(visual.as_str()));
        }
        Value::Object(out)
    }
}

/// A JSON object from its fields in order; one builder rather than a `json!`
/// expansion per call site, which keeps the WASM module small.
pub fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(fields.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
}

/// Indices that put `keys` in ascending order, stably; one sort instantiation
/// for every list the canvas orders.
pub fn order(keys: &[f64]) -> Vec<usize> {
    let mut indices: Vec<usize> = (0..keys.len()).collect();
    indices.sort_by(|a, b| keys[*a].total_cmp(&keys[*b]));
    indices
}

/// A number as JSON; a non-finite one (which JSON cannot carry) becomes null.
pub fn num(value: f64) -> Value {
    serde_json::Number::from_f64(value).map_or(Value::Null, Value::Number)
}

/// A point or a size on the canvas, in pixels or percent as named.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// The canvas size in screen pixels: the frame every pixel-space rule uses.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Size {
    pub w: f64,
    pub h: f64,
}

/// The values of a box a gesture edits, in canvas percent and degrees
/// (`ClipLayout`'s `xPct`, `yPct`, `widthPct`, `heightPct`, `rotationDeg`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    /// `heightPct ?? 100`.
    pub h: f64,
    pub rotation: f64,
    pub aspect_locked: bool,
}

impl Frame {
    /// The frame a layout object describes.
    pub fn of(layout: &Map<String, Value>) -> Self {
        let read = |key: &str, fallback: f64| layout.get(key).and_then(Value::as_f64).unwrap_or(fallback);
        Self {
            x: read("xPct", 0.0),
            y: read("yPct", 0.0),
            w: read("widthPct", 100.0),
            h: read("heightPct", 100.0),
            rotation: read("rotationDeg", 0.0),
            aspect_locked: layout.get("aspectLocked").and_then(Value::as_bool).unwrap_or(false),
        }
    }

    /// The frame with a patch's values applied (`{ ...frame, ...patch }`).
    pub fn with(self, patch: &Patch) -> Self {
        Self {
            x: patch.x.unwrap_or(self.x),
            y: patch.y.unwrap_or(self.y),
            w: patch.w.unwrap_or(self.w),
            h: patch.h.unwrap_or(self.h),
            rotation: patch.rotation.unwrap_or(self.rotation),
            aspect_locked: self.aspect_locked,
        }
    }

    pub fn center(self) -> Point {
        Point { x: self.x + self.w / 2.0, y: self.y + self.h / 2.0 }
    }
}

/// The part of a layout a gesture changes; an unset value is unchanged.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Patch {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub rotation: Option<f64>,
}

impl Patch {
    /// The layout patch object, in `ClipLayout` field names.
    pub fn to_map(self) -> Map<String, Value> {
        let mut out = Map::new();
        for (key, value) in [("xPct", self.x), ("yPct", self.y), ("widthPct", self.w), ("heightPct", self.h), ("rotationDeg", self.rotation)] {
            if let Some(value) = value {
                out.insert(key.to_owned(), num(value));
            }
        }
        out
    }

    /// Whether any value differs from `frame` (`clip-box.tsx` `up`).
    pub fn changes(self, frame: Frame) -> bool {
        [(self.x, frame.x), (self.y, frame.y), (self.w, frame.w), (self.h, frame.h), (self.rotation, frame.rotation)]
            .into_iter()
            .any(|(patch, current)| patch.is_some_and(|value| value != current))
    }
}

/// The snap guides a gesture shows, in canvas percent.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Guides {
    pub x: Option<f64>,
    pub y: Option<f64>,
}

impl Guides {
    pub fn to_value(self) -> Value {
        let mut out = Map::new();
        out.insert("x".to_owned(), self.x.map_or(Value::Null, num));
        out.insert("y".to_owned(), self.y.map_or(Value::Null, num));
        Value::Object(out)
    }
}

/// `((((deg + 180) % 360) + 360) % 360) - 180`: an angle in `[-180, 180)`.
pub fn wrap_degrees(deg: f64) -> f64 {
    (((deg + 180.0) % 360.0) + 360.0) % 360.0 - 180.0
}

/// Rotate `p` by `deg` degrees about the origin.
pub fn rotate(p: Point, deg: f64) -> Point {
    let (sin, cos) = (deg * std::f64::consts::PI / 180.0).sin_cos();
    Point { x: cos * p.x - sin * p.y, y: sin * p.x + cos * p.y }
}
