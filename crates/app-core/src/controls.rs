//! What a control's position means: the audio fader and the focal-point picker
//! (`p1-envelope-inspector` I1). Ports of `audio-fader.ts` and `focal-point.ts`,
//! held to `inspector-rules.reference.json`.

use maleo_editor_core::keyframes::{js_max, js_min, js_round};

/// How far below unity the bottom of the fader sits, in decibels.
pub const FADER_RANGE_DB: f64 = 48.0;
/// How far one arrow press moves the focal point, in percent of the frame.
pub const FOCAL_STEP_PCT: f64 = 5.0;

/// The amplitude a fader position (0..100) produces. 100 is unity, 0 is silence,
/// and each step is the same number of decibels.
pub fn gain_from_fader(pct: f64) -> f64 {
    let clamped = js_max(0.0, js_min(100.0, pct));
    if clamped <= 0.0 {
        return 0.0;
    }
    let db = (clamped - 100.0) * (FADER_RANGE_DB / 100.0);
    libm::pow(10.0, db / 20.0)
}

/// The amplitude a dB value on the gain key row produces: the fader position
/// that many decibels below unity.
pub fn gain_from_db(db: f64) -> f64 {
    gain_from_fader(100.0 + (db * 100.0) / FADER_RANGE_DB)
}

/// Where a stored amplitude sits on the fader; the inverse of `gain_from_fader`.
pub fn fader_from_gain(gain: f64) -> f64 {
    // NaN counts as silent, as `!(gain > 0)` does in the TS.
    if gain.is_nan() || gain <= 0.0 {
        return 0.0;
    }
    let db = 20.0 * libm::log10(js_min(1.0, gain));
    js_max(0.0, js_min(100.0, 100.0 + db * (100.0 / FADER_RANGE_DB)))
}

/// An amplitude as decibels relative to unity; `-inf` when silent.
pub fn db_from_gain(gain: f64) -> f64 {
    if gain > 0.0 { 20.0 * libm::log10(gain) } else { f64::NEG_INFINITY }
}

/// How an amplitude reads beside the fader: "-6.0 dB", or "muted".
pub fn format_gain_db(gain: f64) -> String {
    // NaN counts as silent, as `!(gain > 0)` does in the TS.
    if gain.is_nan() || gain <= 0.0 {
        return "muted".to_owned();
    }
    let db = db_from_gain(gain);
    if db > -0.05 { "0.0 dB".to_owned() } else { format!("{} dB", to_fixed_1(db)) }
}

/// `Number.prototype.toFixed(1)`: JavaScript rounds the exact binary value half
/// away from zero, where Rust's formatter rounds half to even.
fn to_fixed_1(x: f64) -> String {
    let scaled = x * 10.0;
    let rounded = if (scaled - scaled.trunc()).abs() == 0.5 { scaled.trunc() + scaled.signum() } else { scaled.round() };
    let text = format!("{:.1}", rounded / 10.0);
    if text == "-0.0" { "0.0".to_owned() } else { text }
}

fn clamp_pct(value: f64) -> f64 {
    js_max(0.0, js_min(100.0, js_round(value)))
}

/// The focal point under a click inside the picker's box, in percent.
pub fn focal_point_at(client_x: f64, client_y: f64, left: f64, top: f64, width: f64, height: f64) -> (f64, f64) {
    (clamp_pct((client_x - left) / width * 100.0), clamp_pct((client_y - top) / height * 100.0))
}

/// The focal point after an arrow key, from the centre when none is set; `None`
/// for any other key, which is not a focal edit.
pub fn nudge_focal_point(point: Option<(f64, f64)>, key: &str) -> Option<(f64, f64)> {
    let (x, y) = point.unwrap_or((50.0, 50.0));
    match key {
        "ArrowLeft" => Some((clamp_pct(x - FOCAL_STEP_PCT), y)),
        "ArrowRight" => Some((clamp_pct(x + FOCAL_STEP_PCT), y)),
        "ArrowUp" => Some((x, clamp_pct(y - FOCAL_STEP_PCT))),
        "ArrowDown" => Some((x, clamp_pct(y + FOCAL_STEP_PCT))),
        _ => None,
    }
}
