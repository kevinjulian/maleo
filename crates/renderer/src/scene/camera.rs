//! Camera paths from `packages/video/src/lib/motion-presets.ts` and
//! `motion-keyframes.ts`; glitch offsets from `components/CameraMotion.tsx`.
//! Progress is normalized; translation remains source-local pixels.

use maleo_editor_core::keyframes::apply_easing;
use serde_json::{Value, json};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    pub scale: f64,
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
    pub opacity: f64,
}

pub fn preset(movement: Option<&str>) -> ([f64; 3], [f64; 3]) {
    match movement.unwrap_or("") {
        "static" | "Static" => ([1.02, 0.0, 0.0], [1.02, 0.0, 0.0]),
        "slow-zoom-in" | "Slow Zoom In" | "Slow Motion" => ([1.0, 0.0, 0.0], [1.15, 0.0, 0.0]),
        "slow-zoom-out" | "Slow Zoom Out" | "Time Lapse" => ([1.15, 0.0, 0.0], [1.0, 0.0, 0.0]),
        "slow-pan-left" | "Slow Pan" | "Slow Pan Left" => ([1.08, 30.0, 0.0], [1.08, -30.0, 0.0]),
        "slow-pan-right" | "Slow Pan Right" => ([1.08, -30.0, 0.0], [1.08, 30.0, 0.0]),
        "slight-push-in" | "Slight Push In" => ([1.0, 0.0, 0.0], [1.08, 0.0, -10.0]),
        "slight-pull-out" | "Slight Pull Out" => ([1.08, 0.0, -10.0], [1.0, 0.0, 0.0]),
        "tilt-up" | "Tilt Up" => ([1.06, 0.0, 20.0], [1.06, 0.0, -20.0]),
        "tilt-down" | "Tilt Down" => ([1.06, 0.0, -20.0], [1.06, 0.0, 20.0]),
        "follow-tracking" | "Follow / Tracking" => ([1.0, -25.0, 0.0], [1.06, 25.0, -8.0]),
        "orbit" | "Orbit" => ([1.05, -20.0, 10.0], [1.05, 20.0, -10.0]),
        "handheld" | "Handheld" => ([1.03, -4.0, -3.0], [1.03, 4.0, 3.0]),
        "glitch" | "Glitch" | "Glitch / Flicker" => ([1.02, -6.0, 3.0], [1.02, 6.0, -3.0]),
        _ => ([1.0, 0.0, 0.0], [1.18, -30.0, -20.0]),
    }
}

fn key_sample(key: &Value) -> Sample {
    Sample {
        scale: key["scale"].as_f64().unwrap_or(1.0),
        x: key["x"].as_f64().unwrap_or(0.0),
        y: key["y"].as_f64().unwrap_or(0.0),
        rotation: key["rotate"].as_f64().unwrap_or(0.0),
        opacity: 1.0,
    }
}

pub fn sample(movement: Option<&str>, motion: Option<&Value>, frame: i64, duration: i64, fps: f64) -> Sample {
    let (from, to) = preset(movement);
    let preset = json!({"keyframes":[{"t":0,"scale":from[0],"x":from[1],"y":from[2]}, {"t":1,"scale":to[0],"x":to[1],"y":to[2]}]});
    let motion = motion.filter(|m| !m.is_null()).unwrap_or(&preset);
    let keys = motion["keyframes"].as_array().map(Vec::as_slice).unwrap_or_default();
    let p = if duration > 0 { frame as f64 / duration as f64 } else { 1.0 }.clamp(0.0, 1.0);
    let mut value = match (keys.first(), keys.last()) {
        (None, _) => Sample { scale: 1.0, x: 0.0, y: 0.0, rotation: 0.0, opacity: 1.0 },
        (Some(first), Some(_)) if keys.len() == 1 || p <= first["t"].as_f64().unwrap_or(0.0) => key_sample(first),
        (_, Some(last)) if p >= last["t"].as_f64().unwrap_or(1.0) => key_sample(last),
        (Some(_), Some(_)) => {
            let pair =
                keys.windows(2).find(|pair| p >= pair[0]["t"].as_f64().unwrap_or(0.0) && p <= pair[1]["t"].as_f64().unwrap_or(1.0)).unwrap_or(&keys[..2]);
            let (a, b) = (key_sample(&pair[0]), key_sample(&pair[1]));
            let span = pair[1]["t"].as_f64().unwrap_or(1.0) - pair[0]["t"].as_f64().unwrap_or(0.0);
            let local = if span > 0.0 { (p - pair[0]["t"].as_f64().unwrap_or(0.0)) / span } else { 1.0 };
            let eased = apply_easing(pair[1].get("easing"), local);
            let lerp = |a, b| a + (b - a) * eased;
            Sample { scale: lerp(a.scale, b.scale), x: lerp(a.x, b.x), y: lerp(a.y, b.y), rotation: lerp(a.rotation, b.rotation), opacity: 1.0 }
        }
        _ => unreachable!("a key array has both endpoints or neither"),
    };
    if matches!(movement, Some("Glitch" | "Glitch / Flicker" | "glitch")) && ((frame as f64 / fps) * 47.0).sin() > 0.85 {
        let seed = (frame as f64 * 7.3).floor();
        value.x += (seed * 13.0) % 17.0 - 8.0;
        value.y += (seed * 7.0) % 11.0 - 5.0;
        value.opacity = if (seed * 3.0) % 5.0 > 1.0 { 0.7 } else { 1.0 };
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camera_samples_match_typescript_presets_defaults_and_custom_paths() {
        let fixture: Value = serde_json::from_str(include_str!("../../tests/fixtures/camera-timing.json")).unwrap();
        for case in fixture["cases"].as_array().unwrap() {
            for expected in case["samples"].as_array().unwrap() {
                let actual = sample(
                    case["movement"].as_str(),
                    case.get("motion"),
                    expected["frame"].as_i64().unwrap(),
                    case["durationFrames"].as_i64().unwrap(),
                    fixture["fps"].as_f64().unwrap(),
                );
                for (actual, name) in [(actual.scale, "scale"), (actual.x, "x"), (actual.y, "y"), (actual.rotation, "rotate"), (actual.opacity, "opacity")] {
                    assert!(
                        (actual - expected[name].as_f64().unwrap()).abs() < 1e-12,
                        "{} frame {} {name}: {actual} != {}",
                        case["name"],
                        expected["frame"],
                        expected[name]
                    );
                }
            }
        }
    }
}
