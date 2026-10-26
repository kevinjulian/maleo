//! `CompositionOverlay` in `packages/video/src/compositions/reel-text.tsx`.
//! Packed layers share primitive painters and existing normalized/seconds samplers.
use super::{Canvas, Treatments, shape, text, text_motion};
use crate::fonts::Fonts;
use crate::storyboard::{Layout, Storyboard, TextOverlay};
use parley::LayoutContext;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Definition {
    #[serde(default = "version")]
    schema_version: u32,
    span_sec: f64,
    overlays: Vec<Value>,
}
fn version() -> u32 {
    1
}

pub struct Layer {
    pub start: f64,
    pub duration: f64,
    pub overlay: TextOverlay,
}
pub struct Config {
    pub span: f64,
    pub layers: Vec<Layer>,
}
impl Config {
    pub fn parse(params: Option<&Value>) -> Result<Self, String> {
        let definition: Definition = serde_json::from_value(params.ok_or("params: missing composition")?.clone()).map_err(|e| format!("params: {e}"))?;
        if definition.schema_version != 1 {
            return Err("params.schemaVersion: unsupported composition version".into());
        }
        if !definition.span_sec.is_finite() || definition.span_sec <= 0.0 || definition.overlays.is_empty() {
            return Err("params: positive spanSec and nonempty overlays required".into());
        }
        let mut layers = Vec::new();
        for (i, value) in definition.overlays.into_iter().enumerate() {
            let path = format!("params.overlays[{i}]");
            let mut layer = value.as_object().cloned().ok_or_else(|| format!("{path}: expected layer object"))?;
            let mut number =
                |key: &str| layer.remove(key).and_then(|v| v.as_f64()).filter(|n| n.is_finite()).ok_or_else(|| format!("{path}.{key}: expected finite number"));
            let start = number("relStart")?;
            let duration = number("dur")?;
            if start < 0.0 || duration <= 0.0 || start + duration > definition.span_sec + 1e-6 {
                return Err(format!("{path}: layer timing exceeds composition span"));
            }
            let overlay: TextOverlay = serde_json::from_value(Value::Object(layer)).map_err(|e| format!("{path}: {e}"))?;
            if !overlay.track.is_none_or(|n| n.is_finite() && n >= 0.0 && n.fract() == 0.0) {
                return Err(format!("{path}.track: expected nonnegative integer"));
            }
            if overlay.anim.is_some() && overlay.layout.as_ref().and_then(|l| l.animation.as_ref()).is_some() {
                return Err(format!("{path}: two animation sources"));
            }
            layers.push(Layer { start, duration, overlay });
        }
        Ok(Self { span: definition.span_sec, layers })
    }
}

impl Layer {
    pub fn timing(&self, span: f64, frames: i64, fps: f64) -> (i64, i64) {
        let scale = frames as f64 / fps / span;
        ((self.start * scale * fps).floor().max(0.0) as i64, (self.duration * scale * fps).floor().max(1.0) as i64)
    }
    pub fn retimed(&self, scale: f64) -> TextOverlay {
        let mut overlay = self.overlay.clone();
        let layout = overlay.layout.get_or_insert_with(Layout::default);
        if let Some(animation) = &mut layout.animation {
            for group in ["tracks", "colorTracks"] {
                if let Some(tracks) = animation.get_mut(group).and_then(Value::as_object_mut) {
                    for keys in tracks.values_mut().filter_map(Value::as_array_mut) {
                        for key in keys {
                            if let Some(t) = key.get("t").and_then(Value::as_f64) {
                                key["t"] = (t * scale).into();
                            }
                        }
                    }
                }
            }
        }
        overlay
    }
}

pub fn draw(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    fonts: &mut Fonts,
    layouts: &mut LayoutContext<text::WordBrush>,
    storyboard: &Storyboard,
    overlay: &TextOverlay,
    timing: (i64, i64, f64),
) -> Result<(), String> {
    let (local, frames, fps) = timing;
    let config = Config::parse(overlay.rest.get("params"))?;
    let mut source = overlay.clone();
    source.layout.get_or_insert_with(Layout::default);
    let sampled = text_motion::sample(&source, local as f64 / fps, frames as f64 / fps)?;
    // CSS z-index uses layer track, with input order breaking ties.
    let mut layers: Vec<_> = config.layers.iter().collect();
    layers.sort_by(|a, b| a.overlay.track.unwrap_or(0.0).total_cmp(&b.overlay.track.unwrap_or(0.0)));
    let style = sampled.overlay.style.as_ref();
    let fg = style.and_then(|s| s.fill.as_deref()).unwrap_or(&storyboard.fg_color);
    let accent = style.and_then(|s| s.rest.get("accent")).and_then(Value::as_str).unwrap_or(&storyboard.accent_color);
    text_motion::draw_frame(canvas, treatments, &sampled, |canvas, treatments| {
        for layer in layers {
            let (from, duration) = layer.timing(config.span, frames, fps);
            if local < from || local >= from + duration {
                continue;
            }
            let overlay = layer.retimed(frames as f64 / fps / config.span);
            let time = ((local - from) as f64 / fps, duration as f64 / fps);
            match overlay.preset.as_deref() {
                Some("plain") => text::draw_overlay(canvas, treatments, fonts, layouts, fg, &overlay, time)?,
                Some(id) if shape::IDS.contains(&id) => shape::draw(canvas, treatments, &overlay, accent, time)?,
                _ => {} // Coverage reports unsupported layer presets independently.
            }
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn timing_preserves_span_and_retimes_local_keys() {
        let value = json!({"spanSec":4,"overlays":[{"preset":"plain","content":"","relStart":1,"dur":2,"layout":{"animation":{"tracks":{"opacity":[{"t":1,"v":0.5}]}}}}]});
        let config = Config::parse(Some(&value)).unwrap();
        assert_eq!(config.layers[0].timing(config.span, 240, 30.0), (60, 120));
        assert_eq!(config.layers[0].retimed(2.0).layout.unwrap().animation.unwrap()["tracks"]["opacity"][0]["t"], 2.0);
        for value in [
            json!({"schemaVersion":2,"spanSec":4,"overlays":[]}),
            json!({"spanSec":0,"overlays":[]}),
            json!({"spanSec":4,"overlays":[{"relStart":3,"dur":2,"content":""}]}),
        ] {
            assert!(Config::parse(Some(&value)).is_err());
        }
    }
}
