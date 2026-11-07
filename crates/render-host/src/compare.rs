//! What the render worker's production comparison measures (OpenSpec p2-export E7).
//!
//! `plan` lists the frames to sample from the prepared storyboard (each base
//! visual start, each transition midpoint, each whole second) and the start of
//! each audio clip, from the renderer's own timeline. `compare_dirs` scores
//! same-named PNGs with the golden corpus SSIM scorer and writes a difference
//! image for each pair below a threshold.

use std::collections::BTreeMap;
use std::path::Path;

use maleo_renderer::audio_requests;
use maleo_renderer::storyboard::Storyboard;
use maleo_renderer::timeline::{self, BaseMode};
use serde::Serialize;

/// The golden test's scorer, compiled from the same file.
#[allow(dead_code)]
#[path = "../../renderer/tests/golden/compare.rs"]
mod scorer;

pub use scorer::{Image, difference, ssim};

#[derive(Debug, Serialize, PartialEq)]
pub struct Sample {
    pub frame: i64,
    pub time: f64,
    /// Why the frame is sampled: `scene`, `transition` or `second`.
    pub why: &'static str,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Clip {
    pub path: String,
    pub url: String,
    pub start: f64,
}

#[derive(Debug, Serialize)]
pub struct Plan {
    pub samples: Vec<Sample>,
    pub clips: Vec<Clip>,
}

pub fn plan(storyboard: &Storyboard, fps: f64, frames: i64) -> Result<Plan, String> {
    let placed = match timeline::base_mode(storyboard) {
        BaseMode::Timeline => timeline::place_timeline(storyboard, fps),
        _ => timeline::place_scenes(storyboard, fps),
    };
    // One reason per frame; a scene start outranks a transition midpoint and a second.
    let mut picked: BTreeMap<i64, &'static str> = BTreeMap::new();
    for second in 0.. {
        let frame = (f64::from(second) * fps).round() as i64;
        if frame >= frames {
            break;
        }
        picked.insert(frame, "second");
    }
    for p in placed.iter().chain(timeline::place_video_overlays(storyboard, fps).iter()) {
        if let Some((_, length)) = &p.entrance {
            picked.insert(p.span.from + length / 2, "transition");
        }
    }
    for p in &placed {
        picked.insert(p.span.from, "scene");
    }
    let samples = picked
        .into_iter()
        .filter(|(frame, _)| (0..frames).contains(frame))
        .map(|(frame, why)| Sample { frame, time: timeline::seconds(frame, fps), why })
        .collect();
    let mix = audio_requests::project(storyboard, fps, frames)?;
    let clips = mix.sources.into_iter().map(|source| Clip { start: timeline::seconds(source.start_frame, fps), path: source.path, url: source.url }).collect();
    Ok(Plan { samples, clips })
}

#[derive(Debug, Serialize)]
pub struct Score {
    pub name: String,
    pub ssim: f64,
    /// The difference image, written when the score is below the threshold.
    pub difference: Option<String>,
}

fn read(path: &Path) -> Result<Image, String> {
    let decoded = image::open(path).map_err(|e| format!("{}: {e}", path.display()))?.into_rgba8();
    Ok(Image { width: decoded.width() as usize, height: decoded.height() as usize, rgba: decoded.into_raw() })
}

/// Scores every `*.png` in `reference` against the same name in `candidate`.
pub fn compare_dirs(reference: &Path, candidate: &Path, differences: &Path, below: f64) -> Result<Vec<Score>, String> {
    let mut names: Vec<String> = std::fs::read_dir(reference)
        .map_err(|e| format!("{}: {e}", reference.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".png"))
        .collect();
    names.sort();
    names
        .into_iter()
        .map(|name| {
            let (a, b) = (read(&reference.join(&name))?, read(&candidate.join(&name))?);
            if (a.width, a.height) != (b.width, b.height) {
                return Err(format!("{name}: {}x{} against {}x{}", a.width, a.height, b.width, b.height));
            }
            let score = ssim(&a, &b);
            let difference = if score < below {
                std::fs::create_dir_all(differences).map_err(|e| format!("{}: {e}", differences.display()))?;
                let path = differences.join(&name);
                let diff = scorer::difference(&a, &b);
                image::save_buffer(&path, &diff.rgba, diff.width as u32, diff.height as u32, image::ColorType::Rgba8)
                    .map_err(|e| format!("{}: {e}", path.display()))?;
                Some(path.display().to_string())
            } else {
                None
            };
            Ok(Score { name, ssim: score, difference })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_scene_starts_transition_midpoints_and_seconds_with_clip_starts() {
        let storyboard = Storyboard::parse(
            r#"{"scenes":[{"image":"a.png","durationSec":1.5,"transition":"fade","transitionDurSec":0.4},{"image":"b.png","durationSec":1,"transition":"cut"}],
               "audioOverlays":[{"url":"m.wav","kind":"sfx","startSec":0.7,"durationSec":1,"volume":1}]}"#,
        )
        .unwrap();
        let plan = plan(&storyboard, 30.0, 75).unwrap();
        let frames: Vec<(i64, &str)> = plan.samples.iter().map(|s| (s.frame, s.why)).collect();
        let scene_two = frames.iter().find(|(_, why)| *why == "transition").map(|(f, _)| *f).unwrap();
        assert!(frames.contains(&(0, "scene")) && frames.contains(&(30, "second")) && frames.contains(&(60, "second")), "{frames:?}");
        assert!(frames.iter().filter(|(_, why)| *why == "scene").count() == 2, "{frames:?}");
        assert!(scene_two > 30 && scene_two < 75, "{frames:?}");
        assert!(frames.windows(2).all(|w| w[0].0 < w[1].0));
        assert_eq!(plan.clips, [Clip { path: "audioOverlays[0]".into(), url: "m.wav".into(), start: 21.0 / 30.0 }]);
    }
}
