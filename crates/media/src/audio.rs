//! Production audio timing/gain from shared audio-gain.ts and keyframe-evaluation.ts.
//! Hosts project authored render inputs and decode PCM; this module has no IO.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Voiceover,
    Music,
    Sfx,
    Ambient,
    AccentHit,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GainMode {
    Overlay,
    Native,
    LegacyMusic,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Easing {
    Linear,
    In,
    Out,
    InOut,
    Bezier,
    Hold,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Key {
    pub t: f64,
    pub v: f64,
    pub easing: Option<Easing>,
    pub easing_range: Option<[f64; 2]>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Range {
    pub start_sec: f64,
    pub end_sec: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub path: String,
    pub url: String,
    pub start_frame: i64,
    pub frames: i64,
    pub media_start_sec: f64,
    pub playback_rate: f64,
    pub loop_source: bool,
    pub embedded: bool,
    pub kind: Kind,
    pub gain_mode: GainMode,
    pub volume: f64,
    pub volume_keys: Vec<Key>,
    pub fade_in_sec: f64,
    pub fade_out_sec: f64,
    pub duck_under_voice: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mix {
    pub fps: f64,
    pub frames: i64,
    pub sources: Vec<Source>,
    pub voiceover_ranges: Vec<Range>,
    pub legacy_voiceover: Option<Range>,
}

fn ease(id: Option<Easing>, p: f64) -> f64 {
    let p = p.clamp(0.0, 1.0);
    match id {
        Some(Easing::In) => p * p,
        Some(Easing::Out) => 1.0 - (1.0 - p) * (1.0 - p),
        Some(Easing::InOut) => {
            if p < 0.5 {
                2.0 * p * p
            } else {
                let x = -2.0 * p + 2.0;
                1.0 - x * x / 2.0
            }
        }
        Some(Easing::Hold) => {
            if p >= 1.0 {
                1.0
            } else {
                0.0
            }
        }
        Some(Easing::Bezier) if p > 0.0 && p < 1.0 => {
            let axis = |t: f64, a: f64, b: f64| {
                let u = 1.0 - t;
                3.0 * u * u * t * a + 3.0 * u * t * t * b + t * t * t
            };
            let (mut lo, mut hi, mut t) = (0.0, 1.0, p);
            for _ in 0..24 {
                let x = axis(t, 0.16, 0.3);
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
            axis(t, 1.0, 1.0)
        }
        _ => p,
    }
}

fn volume(keys: &[Key], time: f64, fallback: f64) -> f64 {
    let (Some(first), Some(last)) = (keys.first(), keys.last()) else { return fallback };
    if time <= first.t {
        return first.v;
    }
    if time >= last.t {
        return last.v;
    }
    for pair in keys.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        if time > b.t {
            continue;
        }
        if b.easing == Some(Easing::Hold) {
            return if time < b.t { a.v } else { b.v };
        }
        let progress = if b.t > a.t { (time - a.t) / (b.t - a.t) } else { 1.0 };
        let [from, to] = b.easing_range.unwrap_or([0.0, 1.0]);
        let (low, high) = (ease(b.easing, from), ease(b.easing, to));
        let progress = if high > low { (ease(b.easing, from + (to - from) * progress) - low) / (high - low) } else { progress };
        return a.v + (b.v - a.v) * progress;
    }
    last.v
}

impl Mix {
    pub fn validate(&self) -> Result<(), String> {
        if !self.fps.is_finite() || self.fps <= 0.0 || self.frames <= 0 {
            return Err("Invalid audio mix timing".into());
        }
        for range in self.voiceover_ranges.iter().chain(self.legacy_voiceover.iter()) {
            if !range.start_sec.is_finite() || !range.end_sec.is_finite() || range.end_sec <= range.start_sec {
                return Err("Invalid voiceover range".into());
            }
        }
        let mut paths = std::collections::BTreeSet::new();
        for source in &self.sources {
            if source.path.is_empty()
                || !paths.insert(&source.path)
                || source.url.is_empty()
                || source.start_frame < 0
                || source.frames <= 0
                || source.start_frame.checked_add(source.frames).is_none()
                || ![source.media_start_sec, source.playback_rate, source.volume, source.fade_in_sec, source.fade_out_sec].iter().all(|value| value.is_finite())
                || source.media_start_sec < 0.0
                || !(0.25..=4.0).contains(&source.playback_rate)
                || !(0.0..=1.0).contains(&source.volume)
                || source.fade_in_sec < 0.0
                || source.fade_out_sec < 0.0
                || source.duck_under_voice.is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
            {
                return Err(format!("Invalid audio source {}", source.path));
            }
            for (index, key) in source.volume_keys.iter().enumerate() {
                if !key.t.is_finite()
                    || key.t < 0.0
                    || !key.v.is_finite()
                    || key.v < 0.0
                    || key.v > 1.0
                    || (index > 0 && key.t <= source.volume_keys[index - 1].t)
                    || key
                        .easing_range
                        .is_some_and(|range| !range.iter().all(|value| value.is_finite()) || range[0] < 0.0 || range[1] > 1.0 || range[1] <= range[0])
                {
                    return Err(format!("Invalid audio gain keys {}", source.path));
                }
            }
        }
        Ok(())
    }

    /// Gain at an integer composition frame. Silence never changes timeline position.
    pub fn gain(&self, source: &Source, frame: i64) -> f64 {
        if frame < source.start_frame {
            return 0.0;
        }
        let local = frame - source.start_frame;
        if local >= source.frames {
            return 0.0;
        }
        let scalar = volume(&source.volume_keys, local as f64 / self.fps, source.volume);
        if source.gain_mode == GainMode::LegacyMusic {
            let sec = frame as f64 / self.fps;
            let fade = 8.0 / self.fps;
            return self.legacy_voiceover.as_ref().filter(|range| sec >= range.start_sec - fade && sec <= range.end_sec + fade).map_or(0.6, |range| {
                let depth = ((sec - (range.start_sec - fade)) / fade).min((range.end_sec + fade - sec) / fade).min(1.0);
                0.6 + (0.18 - 0.6) * depth
            });
        }
        if source.gain_mode != GainMode::Overlay {
            return scalar;
        }
        let fade_in = (source.fade_in_sec * self.fps).floor();
        let fade_out = (source.fade_out_sec * self.fps).floor();
        let edge = (if fade_in > 0.0 { (local as f64 / fade_in).min(1.0) } else { 1.0 })
            .min(if fade_out > 0.0 { ((source.frames - local) as f64 / fade_out).min(1.0) } else { 1.0 })
            .max(0.0);
        let ducked = source.duck_under_voice.unwrap_or(match source.kind {
            Kind::Voiceover => 1.0,
            Kind::Music => 0.35,
            Kind::Ambient => 0.45,
            _ => 0.62,
        });
        let mut depth: f64 = 0.0;
        if source.kind != Kind::Voiceover && ducked < 1.0 {
            let sec = frame as f64 / self.fps;
            let fade = 8.0 / self.fps;
            for range in &self.voiceover_ranges {
                if sec >= range.start_sec - fade && sec <= range.end_sec + fade {
                    depth = depth.max(((sec - (range.start_sec - fade)) / fade).min((range.end_sec + fade - sec) / fade).clamp(0.0, 1.0));
                }
            }
        }
        scalar * (if source.kind == Kind::Ambient { 0.32 } else { 1.0 }) * (1.0 + (ducked - 1.0) * depth) * edge
    }

    pub fn source_time(&self, source: &Source, frame: i64) -> f64 {
        source.media_start_sec + (frame as f64 - source.start_frame as f64) * source.playback_rate / self.fps
    }
}
