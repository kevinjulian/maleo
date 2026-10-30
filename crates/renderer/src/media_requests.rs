//! Video source positions from StoryboardScene.tsx, StoryboardReel.tsx and SourceVideo.tsx.
//! Placement and transition overlap use the same walk as drawing and coverage.

use serde::{Deserialize, Serialize};

use crate::storyboard::{Layout, Raw, Storyboard};
use crate::timeline::{self, Visible};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoRequest {
    pub path: String,
    pub url: String,
    /// Unresolved reverse mappings and invalid timing remain placeholders.
    pub time: Option<f64>,
    pub blocker: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImageRequest {
    pub path: String,
    pub url: String,
}

/// Only currently visible images need decoded buffers; complete source bytes remain session-owned.
pub fn image_requests(storyboard: &Storyboard, frame: i64, fps: f64) -> Vec<ImageRequest> {
    let mut out = Vec::new();
    for visible in timeline::visible(storyboard, frame, fps) {
        let path = visible.path();
        match visible {
            Visible::Scene { placed, local } => {
                let scene = &storyboard.scenes[placed.index];
                for at in timeline::scene_visuals(scene, local, placed.frames, placed.hold, fps) {
                    let (path, url, kind) = match at.index {
                        Some(index) => {
                            let clip = &scene.visual_clips.as_deref().unwrap_or_default()[index];
                            (format!("{path}.visualClips[{index}]"), &clip.url, clip.kind.as_deref().unwrap_or("image"))
                        }
                        None => (format!("{path}.image"), &scene.image, "image"),
                    };
                    if kind == "image" && !url.is_empty() {
                        out.push(ImageRequest { path, url: url.clone() });
                    }
                }
            }
            Visible::TimelineVisual { placed, .. } => {
                let clip = &storyboard.visual_timeline.as_deref().unwrap_or_default()[placed.index];
                if clip.kind == "image" && !clip.url.is_empty() {
                    out.push(ImageRequest { path, url: clip.url.clone() });
                }
            }
            Visible::VideoOverlay { placed, .. } => {
                let clip = &storyboard.video_overlays[placed.index];
                if clip.kind == "image" && !clip.url.is_empty() {
                    out.push(ImageRequest { path, url: clip.url.clone() });
                }
            }
            _ => {}
        }
    }
    out
}

/// Source in-points round once at composition fps, before applying source rate.
pub fn source_position(raw: &Raw, layout: Option<&Layout>, local: i64, fps: f64, hold: bool) -> Result<f64, String> {
    let layout_value = |key: &str| layout.and_then(|layout| layout.rest.get(key));
    if layout_value("reverse").and_then(|value| value.as_bool()) == Some(true) {
        return Err("Reverse source requires a validated forward-playing derivative".into());
    }
    let number = |key: &str, fallback: f64| -> Result<f64, String> {
        raw.get(key).map_or(Ok(fallback), |value| value.as_f64().ok_or_else(|| format!("Invalid video {key}")))
    };
    let start = number("mediaStartSec", 0.0)?;
    let rate = layout_value("playbackRate").map_or(Ok(1.0), |value| value.as_f64().ok_or("Invalid video playbackRate"))?;
    if !fps.is_finite() || fps <= 0.0 || !start.is_finite() || start < 0.0 || !(0.25..=4.0).contains(&rate) {
        return Err("Invalid video source timing".into());
    }
    let frame = if hold && raw.contains_key("sourceDurationSec") {
        maleo_media::timing::held_frame(number("sourceDurationSec", 0.0)?, rate, fps, local as f64)?.0
    } else {
        local as f64
    };
    Ok((start * fps).round() / fps + frame * rate / fps)
}

fn request(path: String, url: &str, raw: &Raw, layout: Option<&Layout>, local: i64, fps: f64, hold: bool) -> VideoRequest {
    let position = source_position(raw, layout, local, fps, hold);
    VideoRequest { path, url: url.into(), time: position.as_ref().ok().copied(), blocker: position.err() }
}

pub fn video_requests(storyboard: &Storyboard, frame: i64, fps: f64) -> Vec<VideoRequest> {
    let mut out = Vec::new();
    for visible in timeline::visible(storyboard, frame, fps) {
        let path = visible.path();
        match visible {
            Visible::Scene { placed, local } => {
                let scene = &storyboard.scenes[placed.index];
                for at in timeline::scene_visuals(scene, local, placed.frames, placed.hold, fps) {
                    let Some(index) = at.index else { continue };
                    let clip = &scene.visual_clips.as_deref().unwrap_or_default()[index];
                    if clip.kind.as_deref() != Some("video") {
                        continue;
                    }
                    let layout = Layout::merged(scene.layout.as_ref(), clip.layout.as_ref());
                    out.push(request(format!("{path}.visualClips[{index}]"), &clip.url, &clip.rest, layout.as_ref(), at.local, fps, true));
                }
            }
            Visible::TimelineVisual { placed, local } => {
                let clip = &storyboard.visual_timeline.as_deref().unwrap_or_default()[placed.index];
                if clip.kind == "video" {
                    out.push(request(path, &clip.url, &clip.rest, clip.layout.as_ref(), local, fps, true));
                }
            }
            Visible::VideoOverlay { placed, local } => {
                let clip = &storyboard.video_overlays[placed.index];
                if clip.kind == "video" {
                    // Overlays use OffthreadVideo directly, without SourceVideo's selected-end hold.
                    out.push(request(path, &clip.url, &clip.rest, clip.layout.as_ref(), local, fps, false));
                }
            }
            _ => {}
        }
    }
    out
}

/// Keep the next frame hot; during image/gap spans warm the first video within two seconds.
pub fn prefetch_video_requests(storyboard: &Storyboard, frame: i64, fps: f64) -> Vec<VideoRequest> {
    if !fps.is_finite() || fps <= 0.0 {
        return Vec::new();
    }
    let next = video_requests(storyboard, frame.saturating_add(1), fps);
    if !next.is_empty() {
        return next;
    }
    let mut starts = Vec::new();
    for placed in timeline::place_timeline(storyboard, fps).into_iter().chain(timeline::place_video_overlays(storyboard, fps)) {
        starts.push(placed.span.from);
    }
    for placed in timeline::place_scenes(storyboard, fps) {
        starts.push(placed.span.from);
        for clip in storyboard.scenes[placed.index].visual_clips.as_deref().unwrap_or_default() {
            let offset = ((clip.start_sec.unwrap_or(0.0) * fps).floor() as i64).max(0);
            starts.push(placed.span.from.saturating_add(offset));
        }
    }
    starts.sort_unstable();
    starts.dedup();
    let limit = frame.saturating_add((fps * 2.0).ceil() as i64);
    for start in starts.into_iter().filter(|start| *start > frame && *start <= limit) {
        let requests = video_requests(storyboard, start, fps);
        if !requests.is_empty() {
            return requests;
        }
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefetch_warms_later_video_without_changing_visible_requests() {
        let storyboard =
            Storyboard::parse(r#"{"scenes":[],"videoOverlays":[{"url":"later","kind":"video","startSec":3,"durationSec":2,"mediaStartSec":1.2}]}"#).unwrap();
        assert!(prefetch_video_requests(&storyboard, 29, 30.0).is_empty());
        let warm = prefetch_video_requests(&storyboard, 30, 30.0);
        assert_eq!(warm.len(), 1);
        assert_eq!(warm[0].time, Some(1.2));
        assert!(video_requests(&storyboard, 30, 30.0).is_empty());
        assert_eq!(prefetch_video_requests(&storyboard, 90, 30.0), video_requests(&storyboard, 91, 30.0));
        assert!(prefetch_video_requests(&storyboard, 150, 30.0).is_empty());
    }

    #[test]
    fn prefetch_observes_scene_local_video_start() {
        let storyboard = Storyboard::parse(r#"{"scenes":[{"image":"","startSec":4,"durationSec":3,"visualClips":[{"url":"inner","kind":"video","startSec":1,"durationSec":1,"mediaStartSec":2}]}]}"#).unwrap();
        let warm = prefetch_video_requests(&storyboard, 90, 30.0);
        assert_eq!(warm[0].path, "scenes[0].visualClips[0]");
        assert_eq!(warm[0].time, Some(2.0));
        assert!(video_requests(&storyboard, 90, 30.0).is_empty());
    }

    #[test]
    fn images_follow_visible_placement_windows_and_exclude_video_sources() {
        let storyboard = Storyboard::parse(r#"{"scenes":[{"image":"base","durationSec":2}],"videoOverlays":[{"url":"image","startSec":1,"durationSec":1},{"url":"video","kind":"video","durationSec":2}]}"#).unwrap();
        let first = image_requests(&storyboard, 0, 30.0);
        assert_eq!(first, [ImageRequest { path: "scenes[0].image".into(), url: "base".into() }]);
        let later = image_requests(&storyboard, 30, 30.0);
        assert_eq!(later.len(), 2);
        assert_eq!(later[1].path, "videoOverlays[0]");
        assert_eq!(later[1].url, "image");
    }

    #[test]
    fn one_source_can_have_simultaneous_scene_and_overlay_positions() {
        let storyboard = Storyboard::parse(r#"{"scenes":[{"image":"","durationSec":2,"layout":{"playbackRate":2},"visualClips":[{"url":"same","kind":"video","mediaStartSec":0.12,"sourceDurationSec":1}]}],"videoOverlays":[{"url":"same","kind":"video","durationSec":2,"mediaStartSec":3,"layout":{"playbackRate":0.5}}]}"#).unwrap();
        let at = video_requests(&storyboard, 15, 30.0);
        assert_eq!(at.iter().map(|request| request.path.as_str()).collect::<Vec<_>>(), ["scenes[0].visualClips[0]", "videoOverlays[0]"]);
        assert_eq!(at[0].time, Some(4.0 / 30.0 + 1.0));
        assert_eq!(at[1].time, Some(3.25));
        let held = video_requests(&storyboard, 45, 30.0);
        assert_eq!(held[0].time, Some(4.0 / 30.0 + 29.0 * 2.0 / 30.0));
        assert_eq!(held[1].time, Some(3.75));
    }

    #[test]
    fn absolute_timeline_transition_requests_both_sources_and_holds_selected_end() {
        let storyboard = Storyboard::parse(r#"{"scenes":[],"visualTimeline":[{"url":"same","kind":"video","startSec":0,"durationSec":1,"sourceDurationSec":1},{"url":"same","kind":"video","startSec":1,"durationSec":1,"mediaStartSec":3,"transition":"fade"}]}"#).unwrap();
        let at = video_requests(&storyboard, 33, 30.0);
        assert_eq!(at.len(), 2);
        assert_eq!(at[0].path, "visualTimeline[0]");
        assert_eq!(at[0].time, Some(29.0 / 30.0));
        assert_eq!(at[1].path, "visualTimeline[1]");
        assert_eq!(at[1].time, Some(3.1));
    }

    #[test]
    fn invalid_or_unresolved_reverse_media_keeps_exact_blocker_path() {
        let storyboard = Storyboard::parse(r#"{"scenes":[],"videoOverlays":[{"url":"v","kind":"video","durationSec":2,"layout":{"reverse":true}},{"url":"v","kind":"video","durationSec":2,"mediaStartSec":-1}]}"#).unwrap();
        let at = video_requests(&storyboard, 0, 30.0);
        assert!(at.iter().all(|request| request.time.is_none() && request.blocker.is_some()));
        assert_eq!(at[1].path, "videoOverlays[1]");
    }
}
