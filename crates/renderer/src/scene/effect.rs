//! StoryboardReel.tsx effectsBlackOpacity/WhiteOpacity/Scale/WhipPct.
//! Color layers sit at z-index 60/61; ZoomWrap transforms only base visuals.

use vello::kurbo::Affine;
use vello::peniko::Fill;

use super::Canvas;
use crate::paint::Rgba;
use crate::storyboard::Effect;

pub fn supported(kind: &str) -> bool {
    matches!(kind, "fade_in" | "fade_out" | "zoom_out_from_black" | "flash" | "zoom_punch" | "whip_pan")
}

#[derive(Debug, Clone, Copy)]
pub struct Sample {
    pub black: f64,
    pub white: f64,
    pub scale: f64,
    pub x_pct: f64,
}

pub fn sample(effects: &[Effect], t: f64) -> Sample {
    let mut out = Sample { black: 0.0, white: 0.0, scale: 1.0, x_pct: 0.0 };
    for e in effects.iter().filter(|e| active(e, t)) {
        let p = if e.duration_sec > 0.0 { ((t - e.start_sec) / e.duration_sec).clamp(0.0, 1.0) } else { 1.0 };
        let k = e.intensity.unwrap_or(1.0).clamp(0.0, 1.0);
        match e.effect.as_str() {
            "fade_in" => out.black = out.black.max((1.0 - p) * k),
            "fade_out" => out.black = out.black.max(p * k),
            "zoom_out_from_black" => {
                out.black = out.black.max((1.0 - p * 1.6).clamp(0.0, 1.0) * k);
                out.scale *= 1.0 + (1.0 - p) * 0.6 * k;
            }
            "flash" => out.white = out.white.max((if p < 0.3 { p / 0.3 } else { 1.0 - (p - 0.3) / 0.7 }) * k),
            "zoom_punch" => out.scale *= 1.0 + (if p < 0.25 { p / 0.25 } else { 1.0 - (p - 0.25) / 0.75 }) * 0.16 * k,
            "whip_pan" => out.x_pct += (p * std::f64::consts::TAU).sin() * 10.0 * k,
            _ => {}
        }
    }
    out
}

fn active(e: &Effect, t: f64) -> bool {
    t >= e.start_sec && t < e.start_sec + e.duration_sec
}

impl Sample {
    pub fn transform(self, width: f64, height: f64) -> Affine {
        Affine::translate((self.x_pct * width / 100.0 + width / 2.0, height / 2.0))
            * Affine::scale(self.scale)
            * Affine::translate((-width / 2.0, -height / 2.0))
    }
}

/// Aggregate matching envelopes once, even when several effects overlap.
pub fn draw(canvas: &mut Canvas<'_>, effects: &[Effect], index: usize, t: f64) {
    let kind = effects[index].effect.as_str();
    let white = kind == "flash";
    let color_layer = |e: &Effect| if white { e.effect == "flash" } else { matches!(e.effect.as_str(), "fade_in" | "fade_out" | "zoom_out_from_black") };
    if !color_layer(&effects[index]) || effects[..index].iter().any(|e| color_layer(e) && active(e, t)) {
        return;
    }
    let s = sample(effects, t);
    let alpha = if white { s.white } else { s.black };
    if alpha <= 0.001 {
        return;
    }
    let byte = if white { 255 } else { 0 };
    let color = Rgba { r: byte, g: byte, b: byte, a: 1.0 };
    // EffectsLayer's solid CSS compositor plates use Skia byte opacity.
    canvas.byte_group(alpha, |canvas| canvas.scene.fill(Fill::NonZero, Affine::IDENTITY, color.color(), None, &canvas.frame()));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn envelopes_match_source_including_overlaps_and_intensity_clamps() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../tests/fixtures/effect-timing.json")).unwrap();
        for case in fixture.as_array().unwrap() {
            let effects: Vec<Effect> = serde_json::from_value(case["effects"].clone()).unwrap();
            for s in case["samples"].as_array().unwrap() {
                let actual = sample(&effects, s["t"].as_f64().unwrap());
                for (key, value) in [("black", actual.black), ("white", actual.white), ("scale", actual.scale), ("xPct", actual.x_pct)] {
                    assert!((value - s[key].as_f64().unwrap()).abs() < 1e-12, "{key}: {s}");
                }
            }
        }
    }
}
