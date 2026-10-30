//! Audio inputs from StoryboardReel.tsx/StoryboardScene.tsx, after production document projection.
//! Placement reuses the renderer timeline; portable gain and PCM ownership live in maleo-media.
use maleo_media::audio::{GainMode, Key, Kind, Mix, Range, Source};
use serde_json::Value;

use crate::storyboard::{Layout, Raw, Storyboard};
use crate::timeline::{self, BaseMode};

fn number(raw: &Raw, key: &str, fallback: f64) -> Result<f64, String> {
    match raw.get(key) {
        None | Some(Value::Null) => Ok(fallback),
        Some(value) => value.as_f64().filter(|n| n.is_finite()).ok_or_else(|| format!("Invalid audio {key}")),
    }
}
fn rows<'a>(raw: &'a Raw, key: &str) -> Result<&'a [Value], String> {
    match raw.get(key) {
        None | Some(Value::Null) => Ok(&[]),
        Some(Value::Array(values)) => Ok(values),
        _ => Err(format!("Invalid audio {key}")),
    }
}
fn object(value: &Value) -> Result<&Raw, String> {
    value.as_object().ok_or_else(|| "Invalid audio input".into())
}
fn url<'a>(raw: &'a Raw, key: &str) -> Option<&'a str> {
    raw.get(key).and_then(Value::as_str).filter(|value| !value.is_empty())
}
fn flag(raw: &Raw, key: &str, fallback: bool) -> Result<bool, String> {
    match raw.get(key) {
        None | Some(Value::Null) => Ok(fallback),
        Some(Value::Bool(value)) => Ok(*value),
        _ => Err(format!("Invalid audio {key}")),
    }
}
fn keys(animation: Option<&Value>) -> Result<Vec<Key>, String> {
    let Some(animation) = animation.filter(|value| !value.is_null()) else { return Ok(Vec::new()) };
    let tracks = object(animation)?.get("tracks").ok_or("Audio animation tracks are missing")?;
    object(tracks)?.get("volume").map_or(Ok(Vec::new()), |value| serde_json::from_value(value.clone()).map_err(|e| format!("Invalid audio volume keys: {e}")))
}
fn source(path: String, url: &str, from: i64, frames: i64) -> Source {
    Source {
        path,
        url: url.into(),
        start_frame: from,
        frames,
        media_start_sec: 0.0,
        playback_rate: 1.0,
        loop_source: false,
        embedded: false,
        kind: Kind::Sfx,
        gain_mode: GainMode::Native,
        volume: 1.0,
        volume_keys: Vec::new(),
        fade_in_sec: 0.0,
        fade_out_sec: 0.0,
        duck_under_voice: None,
    }
}

fn native(mut input: Source, raw: &Raw, layout: Option<&Layout>, fps: f64, hold: bool) -> Result<Option<Source>, String> {
    let empty = Raw::new();
    let settings = layout.map_or(&empty, |layout| &layout.rest);
    if settings.get("sourceAudioExtraction").is_some_and(|value| !value.is_null()) {
        object(&settings["sourceAudioExtraction"])?;
        return Ok(None);
    }
    input.embedded = true;
    input.volume = number(raw, "volume", input.volume)?;
    input.volume_keys = keys(layout.and_then(|layout| layout.animation.as_ref()))?;
    if flag(settings, "reverse", false)? {
        return Err(format!("{}: reverse audio source is unresolved", input.path));
    }
    input.playback_rate = number(settings, "playbackRate", 1.0)?;
    input.media_start_sec = (number(raw, "mediaStartSec", 0.0)? * fps).round() / fps;
    if hold && raw.contains_key("sourceDurationSec") {
        let (last, _) = maleo_media::timing::held_frame(number(raw, "sourceDurationSec", 0.0)?, input.playback_rate, fps, f64::MAX)?;
        input.frames = input.frames.min(last as i64 + 1);
    }
    Ok(Some(input))
}

/// Full production render inputs, including embedded video sound and legacy audio branches.
pub fn project(storyboard: &Storyboard, fps: f64, frames: i64) -> Result<Mix, String> {
    if !fps.is_finite() || fps <= 0.0 || frames <= 0 {
        return Err("Invalid audio mix timing".into());
    }
    let mut mix = Mix { fps, frames, sources: Vec::new(), voiceover_ranges: Vec::new(), legacy_voiceover: None };
    let muted_base = flag(&storyboard.rest, "muteBase", false)?;
    for (index, value) in rows(&storyboard.rest, "audioOverlays")?.iter().enumerate() {
        let row = object(value)?;
        let kind: Kind = serde_json::from_value(row.get("kind").cloned().ok_or("Audio kind is missing")?).map_err(|e| format!("Invalid audio kind: {e}"))?;
        let start = number(row, "startSec", 0.0)?;
        let duration = number(row, "durationSec", 0.0)?;
        if kind == Kind::Voiceover {
            mix.voiceover_ranges.push(Range { start_sec: start, end_sec: start + duration });
        }
        let Some(url) = url(row, "url") else {
            return Err(format!("audioOverlays[{index}]: audio source is unavailable or changed"));
        };
        let mut input = source(format!("audioOverlays[{index}]"), url, (start * fps).floor() as i64, (duration * fps).floor().max(1.0) as i64);
        input.kind = kind;
        input.gain_mode = GainMode::Overlay;
        input.volume = number(row, "volume", 1.0)?;
        input.volume_keys = keys(row.get("animation"))?;
        input.fade_in_sec = number(row, "fadeInSec", 0.0)?;
        input.fade_out_sec = number(row, "fadeOutSec", 0.0)?;
        input.duck_under_voice = row.get("duckUnderVoice").filter(|v| !v.is_null()).map(|_| number(row, "duckUnderVoice", 1.0)).transpose()?;
        input.media_start_sec = (number(row, "mediaStartSec", 0.0)? * fps).round() / fps;
        input.loop_source = kind == Kind::Music && flag(row, "loopSource", true)?;
        mix.sources.push(input);
    }
    mix.voiceover_ranges.sort_by(|a, b| a.start_sec.total_cmp(&b.start_sec));
    if let Some(value) = storyboard.rest.get("voiceover").filter(|value| !value.is_null()) {
        let row = object(value)?;
        let start = number(row, "startSec", 0.0)?;
        mix.legacy_voiceover = Some(Range { start_sec: start, end_sec: number(row, "endSec", start + 6.0)? });
        if !muted_base && let Some(url) = url(row, "audioUrl") {
            let from = (start * fps).floor() as i64;
            if from < frames {
                let mut input = source("voiceover".into(), url, from, frames - from);
                input.kind = Kind::Voiceover;
                mix.sources.push(input);
            }
        }
    }
    if !muted_base && let Some(url) = url(&storyboard.rest, "musicUrl") {
        let mut input = source("musicUrl".into(), url, 0, frames);
        input.kind = Kind::Music;
        input.gain_mode = GainMode::LegacyMusic;
        mix.sources.push(input);
    }
    // Global scene audio uses storyboardSceneTimings, independently of visual transition overlap.
    let explicit = storyboard.scenes.iter().any(|scene| scene.start_sec.is_some());
    let mut cursor = 0.0;
    for (index, scene) in storyboard.scenes.iter().enumerate() {
        let start = if explicit { scene.start_sec.unwrap_or(cursor) } else { cursor };
        cursor = start + scene.duration_sec;
        if muted_base {
            continue;
        }
        for (clip_index, value) in rows(&scene.rest, "audioClips")?.iter().enumerate() {
            let row = object(value)?;
            if row.get("kind").and_then(Value::as_str) == Some("voiceover") {
                continue;
            }
            if let Some(url) = url(row, "url") {
                let from = ((start + number(row, "startSec", 0.0)?) * fps).floor() as i64;
                let duration = (number(row, "durationSec", scene.duration_sec)? * fps).floor().max(1.0) as i64;
                let mut input = source(format!("scenes[{index}].audioClips[{clip_index}].global"), url, from, duration);
                input.kind = serde_json::from_value(row.get("kind").cloned().ok_or("Scene audio kind is missing")?)
                    .map_err(|e| format!("Invalid scene audio kind: {e}"))?;
                input.volume = if row.get("kind").and_then(Value::as_str) == Some("music") { 0.45 } else { 0.8 };
                mix.sources.push(input);
            }
        }
    }
    if timeline::base_mode(storyboard) == BaseMode::Timeline {
        for placed in timeline::place_timeline(storyboard, fps) {
            let clip = &storyboard.visual_timeline.as_deref().unwrap_or_default()[placed.index];
            if clip.kind != "video" {
                continue;
            }
            let mut input = source(format!("visualTimeline[{}]", placed.index), &clip.url, placed.span.from, placed.span.frames);
            input.volume = 0.0;
            if let Some(input) = native(input, &clip.rest, clip.layout.as_ref(), fps, true)? {
                mix.sources.push(input);
            }
        }
    } else {
        for placed in timeline::place_scenes(storyboard, fps) {
            let scene = &storyboard.scenes[placed.index];
            let path = format!("scenes[{}]", placed.index);
            if let Some(url) = url(&scene.rest, "sfxUrl") {
                let mut input = source(format!("{path}.sfxUrl"), url, placed.span.from, placed.span.frames);
                input.volume = 0.8;
                mix.sources.push(input);
            }
            for (index, value) in rows(&scene.rest, "audioClips")?.iter().enumerate() {
                let row = object(value)?;
                if row.get("kind").and_then(Value::as_str) == Some("sfx")
                    && let Some(url) = url(row, "url")
                {
                    let mut input = source(format!("{path}.audioClips[{index}].local"), url, placed.span.from, placed.span.frames);
                    input.volume = 0.8;
                    mix.sources.push(input);
                }
            }
            let clips = scene.visual_clips.as_deref().unwrap_or_default();
            for (index, clip) in clips.iter().enumerate() {
                if clip.kind.as_deref() != Some("video") {
                    continue;
                }
                let start = clip.start_sec.unwrap_or(0.0);
                let from = (start * fps).floor().max(0.0) as i64;
                let duration = if clips.len() == 1 && start <= 0.0 {
                    placed.span.frames
                } else {
                    (clip.duration_sec.unwrap_or(placed.frames as f64 / fps) * fps).floor().max(1.0) as i64
                };
                let duration = duration.min(placed.span.frames - from);
                if duration <= 0 {
                    continue;
                }
                let layout = Layout::merged(scene.layout.as_ref(), clip.layout.as_ref());
                let input = source(format!("{path}.visualClips[{index}]"), &clip.url, placed.span.from + from, duration);
                if let Some(input) = native(input, &clip.rest, layout.as_ref(), fps, true)? {
                    mix.sources.push(input);
                }
            }
        }
    }
    for placed in timeline::place_video_overlays(storyboard, fps) {
        let clip = &storyboard.video_overlays[placed.index];
        if clip.kind != "video" {
            continue;
        }
        let mut input = source(format!("videoOverlays[{}]", placed.index), &clip.url, placed.span.from, placed.span.frames);
        input.volume = 0.0;
        if let Some(input) = native(input, &clip.rest, clip.layout.as_ref(), fps, false)? {
            mix.sources.push(input);
        }
    }
    mix.validate()?;
    mix.sources.retain(|source| source.volume > 0.0 || source.volume_keys.iter().any(|key| key.v > 0.0));
    Ok(mix)
}
