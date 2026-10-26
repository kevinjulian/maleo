//! `sampleTextAnimation` and the two `TemplateFrame` branches in
//! `packages/video/src/lib/text-animation.ts` and `compositions/reel-text.tsx`.
//! Ordinary tracks use seconds; legacy tracks use normalized clip progress.

use maleo_editor_core::keyframes::{evaluate_color_track, sample_clip_property};
use serde_json::Value;
use vello::kurbo::{Affine, Rect};

use crate::storyboard::TextOverlay;

pub struct Sample {
    pub overlay: TextOverlay,
    pub box_scale: f64,
    pub content_scale: f64,
    pub blur: f64,
    legacy: bool,
    translation: (f64, f64),
    rotation: f64,
    scale: f64,
    opacity: f64,
}

impl Sample {
    /// Legacy blur wraps the scaled body; keyed blur precedes content scale.
    pub fn before_blur(&self, rect: Rect) -> Affine {
        if self.legacy { super::image::outer_transform(rect, 0.0, self.content_scale) } else { Affine::IDENTITY }
    }

    pub fn after_blur(&self, rect: Rect) -> Affine {
        if self.legacy {
            Affine::translate((rect.width() * self.translation.0 / 100.0, rect.height() * self.translation.1 / 100.0))
                * super::image::outer_transform(rect, self.rotation, self.scale)
        } else {
            super::image::outer_transform(rect, 0.0, self.content_scale)
        }
    }

    pub fn content_opacity(&self) -> f64 {
        self.opacity
    }
}

pub fn sample(overlay: &TextOverlay, seconds: f64, duration_sec: f64) -> Result<Sample, String> {
    let mut out = Sample {
        overlay: overlay.clone(),
        box_scale: 1.0,
        content_scale: 1.0,
        blur: 0.0,
        legacy: false,
        translation: (0.0, 0.0),
        rotation: 0.0,
        scale: 1.0,
        opacity: 1.0,
    };
    let Some(layout) = &mut out.overlay.layout else { return Ok(out) };
    out.content_scale = overlay.style.as_ref().and_then(|s| s.scale).unwrap_or(1.0);
    let modern = layout.animation.as_ref();
    let animation = modern.or(overlay.anim.as_ref());
    let Some(animation) = animation else { return Ok(out) };
    out.legacy = modern.is_none();
    let time = if out.legacy { (seconds / duration_sec).clamp(0.0, 1.0) } else { seconds };
    let value = |name: &str, base| sample_clip_property(Some(animation), name, time, base);
    if !out.legacy {
        layout.x_pct = Some(value("xPct", layout.x_pct.unwrap_or(0.0)));
        layout.y_pct = Some(value("yPct", layout.y_pct.unwrap_or(0.0)));
        layout.width_pct = Some(value("widthPct", layout.width_pct.unwrap_or(100.0)));
        if layout.height_pct.is_some() || animation["tracks"].get("heightPct").is_some() {
            layout.height_pct = Some(value("heightPct", layout.height_pct.unwrap_or(100.0)));
        }
        layout.rotation_deg = Some(value("rotationDeg", layout.rotation_deg.unwrap_or(0.0)));
        layout.opacity = Some(value("opacity", layout.opacity.unwrap_or(1.0)));
        out.box_scale = value("scale", 1.0);
    } else {
        // Share the evaluator without changing legacy names or value ranges.
        layout.width_pct = Some(value("width", layout.width_pct.unwrap_or(100.0)));
        layout.height_pct = Some(value("height", layout.height_pct.unwrap_or(100.0)));
        out.translation = (value("x", 0.0), value("y", 0.0));
        out.rotation = value("rotate", 0.0);
        out.scale = value("scale", 1.0);
        out.opacity = value("opacity", 1.0);
    }
    out.blur = value("blur", 0.0).max(0.0);
    if let Some(style) = &mut out.overlay.style {
        for (property, target, neutral) in [
            ("fontSize", &mut style.font_size, 64.0),
            ("letterSpacing", &mut style.letter_spacing, 0.0),
            ("lineHeight", &mut style.line_height, 1.1),
            ("bgOpacity", &mut style.bg_opacity, 0.0),
        ] {
            if animation["tracks"].get(property).is_some() {
                *target = Some(value(property, target.unwrap_or(neutral)));
            }
        }
        for (property, target, neutral) in [("fill", &mut style.fill, "#ffffff"), ("background", &mut style.background, "#000000")] {
            if let Some(keys) = animation.get("colorTracks").and_then(|t| t.get(property)).and_then(Value::as_array) {
                if !keys.is_empty() {
                    let sampled = evaluate_color_track(keys, time).map_err(|error| error.to_string())?;
                    *target = Some(sampled.as_str().ok_or("sampled text color is not a string")?.to_owned());
                } else if target.is_none() {
                    *target = Some(neutral.to_owned());
                }
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn animation_without_a_layout_is_inert_as_in_the_plain_text_branch() {
        let overlay: TextOverlay = serde_json::from_value(json!({"content":"x","preset":"plain","anim":{"tracks":{"opacity":[{"t":0,"v":0}]}}})).unwrap();
        let sampled = sample(&overlay, 1.0, 4.0).unwrap();
        assert_eq!(sampled.content_opacity(), 1.0);
        assert_eq!(sampled.blur, 0.0);
        assert!(sampled.overlay.layout.is_none());
    }

    #[test]
    fn modern_and_legacy_text_match_source_derived_samples() {
        let fixture: Value = serde_json::from_str(include_str!("../../tests/fixtures/text-animation.json")).unwrap();
        for legacy in [false, true] {
            let layout = if legacy {
                fixture["layout"].clone()
            } else {
                let mut layout = fixture["layout"].clone();
                layout["animation"] = fixture["animation"].clone();
                layout
            };
            let overlay: TextOverlay =
                serde_json::from_value(json!({"content":"Synthetic text","preset":"plain","layout":layout,"style":fixture["style"],"anim":fixture["legacy"]}))
                    .unwrap();
            for case in fixture[if legacy { "normalized" } else { "modern" }].as_array().unwrap() {
                let sampled = sample(&overlay, case["frame"].as_f64().unwrap() / 30.0, 4.0).unwrap();
                let layout = sampled.overlay.layout.as_ref().unwrap();
                let style = sampled.overlay.style.as_ref().unwrap();
                let expected = &case["expected"];
                let close =
                    |actual: f64, value: &Value| assert!((actual - value.as_f64().unwrap()).abs() < 1e-12, "frame {}: {actual} != {value}", case["frame"]);
                if legacy {
                    for (actual, name) in [
                        (layout.width_pct.unwrap(), "width"),
                        (layout.height_pct.unwrap(), "height"),
                        (sampled.translation.0, "x"),
                        (sampled.translation.1, "y"),
                        (sampled.scale, "scale"),
                        (sampled.rotation, "rotate"),
                        (sampled.opacity, "opacity"),
                        (sampled.blur, "blur"),
                    ] {
                        close(actual, &expected[name]);
                    }
                    assert_eq!(style.fill.as_deref(), case["fill"].as_str());
                } else {
                    for (actual, name) in [
                        (layout.x_pct.unwrap(), "xPct"),
                        (layout.y_pct.unwrap(), "yPct"),
                        (layout.width_pct.unwrap(), "widthPct"),
                        (layout.height_pct.unwrap(), "heightPct"),
                        (layout.rotation_deg.unwrap(), "rotationDeg"),
                        (layout.opacity.unwrap(), "opacity"),
                        (sampled.box_scale, "scale"),
                        (style.bg_opacity.unwrap(), "bgOpacity"),
                    ] {
                        close(actual, &expected["box"][name]);
                    }
                    for (actual, name) in
                        [(style.font_size.unwrap(), "fontSize"), (style.letter_spacing.unwrap(), "letterSpacing"), (style.line_height.unwrap(), "lineHeight")]
                    {
                        close(actual, &expected["style"][name]);
                    }
                    close(sampled.blur, &expected["blur"]);
                    assert_eq!(style.fill.as_deref(), expected["style"]["fill"].as_str());
                    assert_eq!(style.background.as_deref(), expected["style"]["background"].as_str());
                }
            }
        }
    }
}
