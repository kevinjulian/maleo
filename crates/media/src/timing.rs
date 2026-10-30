//! Source timing shared by editor commands and preview media. Arithmetic follows TypeScript.

/// Seconds in original source, independent of playback direction.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SourceInterval {
    pub start: f64,
    pub end: f64,
}

/// `sourceInterval(start, duration, rate)`.
pub fn source_interval(start: f64, duration: f64, rate: f64) -> Result<SourceInterval, String> {
    if ![start, duration, rate].iter().all(|value| value.is_finite()) || start < 0.0 || duration <= 0.0 || !(0.25..=4.0).contains(&rate) {
        return Err(format!("start {start}, duration {duration}, rate {rate}"));
    }
    Ok(SourceInterval { start, end: start + duration * rate })
}

/// `sliceSourceInterval(start, duration, rate, reverse, from, to)`: the
/// retained timeline window `from..to`, as original-source seconds even when
/// the clip plays reversed.
pub fn slice_source_interval(start: f64, duration: f64, rate: f64, reverse: bool, from: f64, to: f64) -> Result<SourceInterval, String> {
    source_interval(start, duration, rate)?;
    if !from.is_finite() || !to.is_finite() || to <= from {
        return Err(format!("retained window {from}..{to}"));
    }
    let next_start = start + (if reverse { duration - to } else { from }) * rate;
    if next_start < -0.000001 {
        return Err(format!("window starts before the source ({next_start})"));
    }
    source_interval(next_start.max(0.0), to - from, rate)
}

/// `assertSourceInterval(start, duration, rate, sourceDuration)`: the selected
/// range fits inside media of `source_duration` seconds.
pub fn assert_source_interval(start: f64, duration: f64, rate: f64, source_duration: f64) -> Result<(), String> {
    let interval = source_interval(start, duration, rate)?;
    if !source_duration.is_finite() || source_duration <= 0.0 || interval.end > source_duration + 0.000001 {
        return Err("Replacement source is too short for selected clip range".to_owned());
    }
    Ok(())
}

/// `sourceTime(start, duration, rate, reverse, elapsed)`: the source second
/// shown `elapsed` timeline seconds in; reverse reads from the far boundary.
pub fn source_time(start: f64, duration: f64, rate: f64, reverse: bool, elapsed: f64) -> Result<f64, String> {
    let interval = source_interval(start, duration, rate)?;
    let offset = js_min(duration, js_max(0.0, elapsed)) * rate;
    Ok(if reverse { interval.end - offset } else { interval.start + offset })
}

/// `retimeSourceDuration(start, duration, previousRate, nextRate)`: a rate edit
/// keeps the source endpoints and changes the timeline duration.
pub fn retime_source_duration(start: f64, duration: f64, previous_rate: f64, next_rate: f64) -> Result<f64, String> {
    let selected = source_interval(start, duration, previous_rate)?;
    source_interval(start, duration, next_rate)?;
    Ok((selected.end - selected.start) / next_rate)
}

fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else {
        b
    }
}
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else {
        b
    }
}

pub fn scene_visual_source_duration(selected: f64, scene: f64, preserve_source_window: bool) -> f64 {
    if preserve_source_window { js_min(selected, scene) } else { scene }
}

/// Production SourceVideo leaves one decoded frame inside the selected exclusive endpoint.
pub fn held_frame(duration: f64, rate: f64, fps: f64, frame: f64) -> Result<(f64, bool), String> {
    source_interval(0.0, duration, rate)?;
    if !fps.is_finite() || fps <= 0.0 || !frame.is_finite() {
        return Err("Invalid playback frame".into());
    }
    let end = js_max(0.0, (duration * fps - js_max(1.0, 1.0 / rate)).floor());
    Ok((js_min(frame, end), frame > end))
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReverseMedia {
    pub url: String,
    pub source_url: String,
    pub source_revision: String,
    pub start_sec: f64,
    pub duration_sec: f64,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSource {
    pub url: String,
    pub media_start_sec: f64,
}

fn managed_url(url: &str) -> bool {
    url.strip_prefix("/api/media/")
        .is_some_and(|id| id.len() == 36 && id.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) || byte == b'-'))
}

pub fn reverse_playback_source(
    url: &str,
    start: f64,
    duration: f64,
    rate: f64,
    reverse: bool,
    derivative: Option<&ReverseMedia>,
    revision: Option<&str>,
) -> Result<PlaybackSource, String> {
    if !reverse {
        return Ok(PlaybackSource { url: url.into(), media_start_sec: start });
    }
    let stale = || "Reverse source is unavailable or changed. Process this source range again.".to_owned();
    let derivative = derivative.ok_or_else(stale)?;
    if !managed_url(&derivative.url)
        || !managed_url(&derivative.source_url)
        || derivative.source_url != url
        || derivative.source_revision.is_empty()
        || derivative.source_revision.encode_utf16().count() > 160
        || revision.is_some_and(|revision| revision != derivative.source_revision)
        || !derivative.start_sec.is_finite()
        || derivative.start_sec < 0.0
        || !derivative.duration_sec.is_finite()
        || derivative.duration_sec <= 0.0
        || derivative.duration_sec > 1800.0
    {
        return Err(stale());
    }
    let interval = source_interval(start, duration, rate)?;
    let end = derivative.start_sec + derivative.duration_sec;
    if interval.start < derivative.start_sec - 0.000001 || interval.end > end + 0.000001 {
        return Err(stale());
    }
    Ok(PlaybackSource { url: derivative.url.clone(), media_start_sec: js_max(0.0, end - interval.end) })
}
