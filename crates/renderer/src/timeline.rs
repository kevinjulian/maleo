//! Which storyboard elements a frame shows, and where each one is in its own
//! time. This is the Remotion `Sequence` rule as `StoryboardReel.tsx` applies
//! it: an element starting at `s` seconds with duration `d` covers frames
//! `floor(s * fps) .. floor(s * fps) + max(1, floor(d * fps))`, end excluded.
//!
//! The walk reads only the input. Drawing and coverage both consume it, so an
//! element the drawing code forgets is still visible to coverage (D4).

use crate::storyboard::{Scene, Storyboard};

/// `RENDER_FPS` in `@maleo/shared`: every render and preview.
pub const FPS: f64 = 30.0;

/// Remotion transitions without an authored duration run 12 frames.
const DEFAULT_TRANSITION_FRAMES: i64 = 12;

/// A frame's time in seconds.
pub fn seconds(frame: i64, fps: f64) -> f64 {
    frame as f64 / fps
}

/// Frames a duration in seconds spans as a `Sequence`: at least one.
pub fn frames(duration_sec: f64, fps: f64) -> i64 {
    ((duration_sec * fps).floor() as i64).max(1)
}

/// A `Sequence` placement in composition frames.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub from: i64,
    pub frames: i64,
}

impl Span {
    pub fn at(start_sec: f64, duration_frames: i64, fps: f64) -> Self {
        Self { from: (start_sec * fps).floor() as i64, frames: duration_frames }
    }

    /// The sequence-local frame, if `frame` falls inside.
    pub fn local(&self, frame: i64) -> Option<i64> {
        (frame >= self.from && frame < self.from + self.frames).then(|| frame - self.from)
    }
}

/// The transition frames for an authored type and duration, or 0 for a cut.
pub(crate) fn transition_frames(kind: Option<&str>, duration_sec: Option<f64>, fps: f64) -> i64 {
    match kind {
        None | Some("cut") => 0,
        Some(_) => match duration_sec {
            Some(d) if d != 0.0 => (d * fps).round() as i64,
            _ => DEFAULT_TRANSITION_FRAMES,
        },
    }
}

/// A base visual, video overlay or scene placed on the composition timeline,
/// with the transition windows that touch it.
#[derive(Debug, Clone, PartialEq)]
pub struct Placed {
    pub index: usize,
    /// Visible frames, the hold under the next element's entrance included.
    pub span: Span,
    /// The element's own frames, without the hold.
    pub frames: i64,
    pub hold: i64,
    /// `(type, frames)` of the entrance, played over the first frames.
    pub entrance: Option<(String, i64)>,
    /// `(type, from local frame, frames)` of the exit under the next element.
    pub exit: Option<(String, i64, i64)>,
}

impl Placed {
    /// Active entrance and exit, including simultaneous windows.
    pub fn transitions_at(&self, local: i64) -> impl Iterator<Item = &str> {
        self.entrance
            .as_ref()
            .filter(move |(_, frames)| local < *frames)
            .map(|(kind, _)| kind.as_str())
            .into_iter()
            .chain(self.exit.as_ref().filter(move |(_, from, _)| local >= *from).map(|(kind, _, _)| kind.as_str()))
    }

    /// First active transition, retained for placement callers.
    pub fn transition_at(&self, local: i64) -> Option<String> {
        self.transitions_at(local).next().map(str::to_owned)
    }
}

/// Clips with an incoming transition and a start: the visual timeline and
/// video overlays share one boundary rule.
struct Edge<'a> {
    start: f64,
    duration: f64,
    transition: Option<&'a str>,
    transition_dur: Option<f64>,
}

/// Places clips whose neighbour within one second holds under its entrance
/// (`visualTimeline` and `videoOverlays` in `StoryboardReel.tsx`).
fn place_edges(edges: &[Edge<'_>], neighbours: impl Fn(usize, usize) -> bool, fps: f64) -> Vec<Placed> {
    let mut placed = Vec::with_capacity(edges.len());
    for (i, edge) in edges.iter().enumerate() {
        let frames = frames(edge.duration, fps);
        let end = edge.start + edge.duration;
        let next = (0..edges.len())
            .filter(|&j| j != i && neighbours(i, j) && edges[j].start >= end - 1.0 / fps && edges[j].start - end <= 1.0)
            .min_by(|&a, &b| edges[a].start.total_cmp(&edges[b].start));
        let entrance_frames = transition_frames(edge.transition, edge.transition_dur, fps);
        let next_frames = next.map_or(0, |j| transition_frames(edges[j].transition, edges[j].transition_dur, fps));
        let hold = match next {
            Some(j) if next_frames > 0 => (((edges[j].start - end) * fps).round() as i64).max(0) + next_frames,
            _ => 0,
        };
        placed.push(Placed {
            index: i,
            span: Span::at(edge.start, frames + hold, fps),
            frames,
            hold,
            entrance: (entrance_frames > 0).then(|| (edge.transition.unwrap_or_default().to_owned(), entrance_frames)),
            exit: (hold > 0).then(|| (next.and_then(|j| edges[j].transition).unwrap_or_default().to_owned(), frames, hold)),
        });
    }
    placed
}

/// How the base scene reel is laid out (`StoryboardReel.tsx`, three branches).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BaseMode {
    /// `visualTimeline` present: every base visual is a top-level clip over black.
    Timeline,
    /// Some scene has `startSec`: scenes at absolute starts over black.
    Absolute,
    /// Packed scenes in a `TransitionSeries`.
    Series,
}

pub fn base_mode(storyboard: &Storyboard) -> BaseMode {
    if storyboard.visual_timeline.as_ref().is_some_and(|v| !v.is_empty()) {
        BaseMode::Timeline
    } else if storyboard.scenes.iter().any(|s| s.start_sec.is_some()) {
        BaseMode::Absolute
    } else {
        BaseMode::Series
    }
}

/// Visual timeline clips in stacking (start) order.
pub fn place_timeline(storyboard: &Storyboard, fps: f64) -> Vec<Placed> {
    let clips = storyboard.visual_timeline.as_deref().unwrap_or_default();
    let mut order: Vec<usize> = (0..clips.len()).collect();
    order.sort_by(|&a, &b| clips[a].start_sec.total_cmp(&clips[b].start_sec));
    let edges: Vec<Edge<'_>> = order
        .iter()
        .map(|&i| Edge {
            start: clips[i].start_sec,
            duration: clips[i].duration_sec,
            transition: clips[i].transition.as_deref(),
            transition_dur: clips[i].transition_dur_sec,
        })
        .collect();
    place_edges(&edges, |_, _| true, fps).into_iter().map(|p| Placed { index: order[p.index], ..p }).collect()
}

/// Video overlays in array order; the boundary neighbour shares the track.
pub fn place_video_overlays(storyboard: &Storyboard, fps: f64) -> Vec<Placed> {
    let overlays = &storyboard.video_overlays;
    let edges: Vec<Edge<'_>> = overlays
        .iter()
        .map(|o| Edge { start: o.start_sec, duration: o.duration_sec, transition: o.transition.as_deref(), transition_dur: o.transition_dur_sec })
        .collect();
    place_edges(&edges, |i, j| overlays[i].track == overlays[j].track, fps)
}

/// Scenes in stacking order, for the absolute and series modes.
pub fn place_scenes(storyboard: &Storyboard, fps: f64) -> Vec<Placed> {
    let scenes = &storyboard.scenes;
    let durations: Vec<i64> = scenes.iter().map(|s| frames(s.duration_sec, fps)).collect();
    match base_mode(storyboard) {
        BaseMode::Absolute => place_absolute(scenes, &durations, fps),
        _ => place_series(scenes, &durations, fps),
    }
}

/// Scene starts: an authored start, else packed after the previous scene.
pub(crate) fn scene_starts(scenes: &[Scene]) -> Vec<f64> {
    let mut cursor = 0.0;
    scenes
        .iter()
        .map(|s| {
            let start = s.start_sec.unwrap_or(cursor);
            cursor = start + s.duration_sec;
            start
        })
        .collect()
}

/// Root.tsx storyboardSeconds: nominal scene ends, then trailing clip ends.
/// Series overlap does not shorten the composition's metadata duration.
pub fn composition_frames(storyboard: &Storyboard, fps: f64) -> i64 {
    let mut end: f64 = 0.0;
    for (scene, start) in storyboard.scenes.iter().zip(scene_starts(&storyboard.scenes)) {
        end = end.max(start + scene.duration_sec);
    }
    for clip in &storyboard.video_overlays {
        end = end.max(clip.start_sec + clip.duration_sec);
    }
    for clip in &storyboard.text_overlays {
        end = end.max(clip.start_sec + clip.duration_sec);
    }
    for clip in storyboard.visual_timeline.as_deref().unwrap_or_default() {
        end = end.max(clip.start_sec + clip.duration_sec);
    }
    for clip in storyboard.rest.get("audioOverlays").and_then(|v| v.as_array()).into_iter().flatten() {
        if let (Some(start), Some(duration)) = (clip.get("startSec").and_then(|v| v.as_f64()), clip.get("durationSec").and_then(|v| v.as_f64())) {
            end = end.max(start + duration);
        }
    }
    (end * fps).ceil().max(1.0) as i64
}

fn incoming(scene: &Scene) -> Option<&str> {
    (scene.transition != "cut").then_some(scene.transition.as_str())
}

/// StoryboardReel.sceneBoundaryHold; neighbor selection remains the caller's rule.
pub fn boundary_hold(start: f64, end: f64, next: Option<f64>, transition_frames: i64, fps: f64) -> (i64, i64) {
    let Some(next) = next.filter(|_| transition_frames > 0) else { return (0, 0) };
    let start_frame = (start * fps).floor() as i64;
    let end_frame = start_frame + (((end - start) * fps).round() as i64).max(1);
    let next_frame = (next * fps).floor() as i64;
    ((next_frame - start_frame).max(0), (next_frame - end_frame).max(0) + transition_frames)
}

fn place_absolute(scenes: &[Scene], durations: &[i64], fps: f64) -> Vec<Placed> {
    let starts = scene_starts(scenes);
    let mut order: Vec<usize> = (0..scenes.len()).collect();
    order.sort_by(|&a, &b| starts[a].total_cmp(&starts[b]));
    order
        .iter()
        .map(|&i| {
            let (start, end) = (starts[i], starts[i] + scenes[i].duration_sec);
            let next = (0..scenes.len())
                .filter(|&j| j != i && starts[j] >= end - 1.0 / fps && starts[j] - end <= 1.0)
                .min_by(|&a, &b| starts[a].total_cmp(&starts[b]));
            let entrance = transition_frames(incoming(&scenes[i]), scenes[i].transition_dur_sec, fps);
            let next_frames = next.map_or(0, |j| transition_frames(incoming(&scenes[j]), scenes[j].transition_dur_sec, fps));
            let (exit_from, hold) = boundary_hold(start, end, next.map(|j| starts[j]), next_frames, fps);
            Placed {
                index: i,
                span: Span::at(start, durations[i] + hold, fps),
                frames: durations[i],
                hold,
                entrance: (entrance > 0).then(|| (scenes[i].transition.clone(), entrance)),
                exit: (hold > 0).then(|| (next.map(|j| scenes[j].transition.clone()).unwrap_or_default(), exit_from, next_frames)),
            }
        })
        .collect()
}

/// `TransitionSeries`: each transition overlaps the scenes it joins by its
/// duration. A cut is a one-frame `none()` transition, so even cuts overlap
/// by one frame, with the entering scene drawn on top.
fn place_series(scenes: &[Scene], durations: &[i64], fps: f64) -> Vec<Placed> {
    let joins: Vec<(String, i64)> = scenes
        .iter()
        .map(|s| {
            let authored = s.transition_dur_sec.filter(|d| *d != 0.0).map(|d| (d * fps).round() as i64).filter(|f| *f > 0);
            match s.transition.as_str() {
                "cut" => ("cut".to_owned(), 1),
                kind => (kind.to_owned(), authored.unwrap_or(DEFAULT_TRANSITION_FRAMES)),
            }
        })
        .collect();
    let (mut start, mut offsets) = (0i64, 0i64);
    (0..scenes.len())
        .map(|i| {
            let prev = (i > 0).then(|| &joins[i - 1]);
            let next = (i + 1 < scenes.len()).then(|| &joins[i]);
            if let Some((_, frames)) = prev {
                offsets -= frames;
            }
            let from = (start + offsets).max(0);
            start += durations[i];
            let visible = |join: Option<&(String, i64)>| join.filter(|(kind, _)| kind != "cut").cloned();
            Placed {
                index: i,
                span: Span { from, frames: durations[i] },
                frames: durations[i],
                hold: 0,
                entrance: visible(prev),
                exit: visible(next).map(|(kind, frames)| (kind, durations[i] - frames, frames)),
            }
        })
        .collect()
}

/// One visual of a scene at a scene-local frame (`StoryboardScene.tsx`).
#[derive(Debug, Clone, PartialEq)]
pub struct SceneVisualAt {
    /// Index into `visualClips`, or `None` for the `image` fallback.
    pub index: Option<usize>,
    pub local: i64,
    /// Frames the camera motion runs over (the hold excluded).
    pub motion_frames: i64,
    /// The inner transition this frame is inside, if any.
    pub transition: Option<String>,
}

/// The visuals of `scene` visible at `local`. A scene without visuals and
/// without an image shows its background only.
pub fn scene_visuals(scene: &Scene, local: i64, frames: i64, hold: i64, fps: f64) -> Vec<SceneVisualAt> {
    let clips = scene.visual_clips.as_deref().unwrap_or_default();
    if clips.is_empty() {
        return if scene.image.is_empty() {
            Vec::new()
        } else {
            // A single visual at the scene start holds through the hold.
            vec![SceneVisualAt { index: None, local, motion_frames: frames.max(1), transition: None }]
        };
    }
    clips
        .iter()
        .enumerate()
        .filter_map(|(i, clip)| {
            let start = clip.start_sec.unwrap_or(0.0);
            // visualClipDurationFrames()
            let clip_frames = if clips.len() == 1 && start <= 0.0 {
                (frames + hold).max(1)
            } else {
                ((clip.duration_sec.unwrap_or(frames as f64 / fps) * fps).floor() as i64).max(1)
            };
            let from = ((start * fps).floor() as i64).max(0);
            let at = Span { from, frames: clip_frames }.local(local)?;
            let inner = if i > 0 { transition_frames(clip.transition.as_deref(), clip.transition_dur_sec, fps) } else { 0 };
            Some(SceneVisualAt {
                index: Some(i),
                local: at,
                motion_frames: (clip_frames - hold).max(1),
                transition: (at < inner).then(|| clip.transition.clone().unwrap_or_default()),
            })
        })
        .collect()
}

/// One element a frame shows.
#[derive(Debug, Clone, PartialEq)]
pub enum Visible {
    /// A scene of the absolute or series reel, at its local frame.
    Scene {
        placed: Placed,
        local: i64,
    },
    /// A `visualTimeline` clip.
    TimelineVisual {
        placed: Placed,
        local: i64,
    },
    VideoOverlay {
        placed: Placed,
        local: i64,
    },
    TextOverlay {
        index: usize,
        local: i64,
        frames: i64,
    },
    /// The cue `captionAt` picks, at its cue-local time in seconds.
    Caption {
        index: usize,
        local_sec: f64,
    },
    Effect {
        index: usize,
    },
    ChapterPills,
    ProgressBar,
}

impl Visible {
    /// The storyboard path of the element.
    pub fn path(&self) -> String {
        match self {
            Self::Scene { placed, .. } => format!("scenes[{}]", placed.index),
            Self::TimelineVisual { placed, .. } => format!("visualTimeline[{}]", placed.index),
            Self::VideoOverlay { placed, .. } => format!("videoOverlays[{}]", placed.index),
            Self::TextOverlay { index, .. } => format!("textOverlays[{index}]"),
            Self::Caption { index, .. } => format!("captionCues[{index}]"),
            Self::Effect { index } => format!("effects[{index}]"),
            Self::ChapterPills => "pacingDevices.chapterPills".into(),
            Self::ProgressBar => "pacingDevices.progressBar".into(),
        }
    }
}

/// The stacking key Remotion resolves inside the isolated root: `zIndex`
/// first (auto counts as 0), then document order.
fn z_index(storyboard: &Storyboard, visible: &Visible) -> f64 {
    match visible {
        Visible::Scene { .. } | Visible::TimelineVisual { .. } => 0.0,
        Visible::VideoOverlay { placed, .. } => 10.0 + storyboard.video_overlays[placed.index].track,
        Visible::TextOverlay { index, .. } => storyboard.text_overlays[*index].track.map_or(40.0, |t| 10.0 + t),
        Visible::Effect { index } => {
            if storyboard.effects[*index].effect == "flash" {
                61.0
            } else {
                60.0
            }
        }
        Visible::ChapterPills | Visible::ProgressBar => 900.0,
        Visible::Caption { .. } => 920.0,
    }
}

/// Every element visible at `frame`, back to front.
pub fn visible(storyboard: &Storyboard, frame: i64, fps: f64) -> Vec<Visible> {
    let mut out = Vec::new();
    if !storyboard.hide_base {
        if base_mode(storyboard) == BaseMode::Timeline {
            for placed in place_timeline(storyboard, fps) {
                if let Some(local) = placed.span.local(frame) {
                    out.push(Visible::TimelineVisual { placed, local });
                }
            }
        } else {
            for placed in place_scenes(storyboard, fps) {
                if let Some(local) = placed.span.local(frame) {
                    out.push(Visible::Scene { placed, local });
                }
            }
        }
    }
    let pacing = storyboard.pacing_devices.as_ref();
    if pacing.and_then(|p| p.chapter_pills).unwrap_or(false) {
        out.push(Visible::ChapterPills);
    }
    if pacing.and_then(|p| p.progress_bar).unwrap_or(false) {
        out.push(Visible::ProgressBar);
    }
    let sec = seconds(frame, fps);
    if let Some(index) = caption_at(storyboard, sec) {
        out.push(Visible::Caption { index, local_sec: sec - storyboard.caption_cues[index].start_sec });
    }
    for placed in place_video_overlays(storyboard, fps) {
        if let Some(local) = placed.span.local(frame) {
            out.push(Visible::VideoOverlay { placed, local });
        }
    }
    for (index, text) in storyboard.text_overlays.iter().enumerate() {
        let frames = frames(text.duration_sec, fps);
        if let Some(local) = Span::at(text.start_sec, frames, fps).local(frame) {
            out.push(Visible::TextOverlay { index, local, frames });
        }
    }
    for (index, effect) in storyboard.effects.iter().enumerate() {
        if sec >= effect.start_sec && sec < effect.start_sec + effect.duration_sec {
            out.push(Visible::Effect { index });
        }
    }
    // A stable sort keeps document order inside one z-index.
    out.sort_by(|a, b| z_index(storyboard, a).total_cmp(&z_index(storyboard, b)));
    out
}

/// `Captions.tsx`: the first cue whose half-open interval holds `sec`, unless
/// captions are off for the project or the cue.
fn caption_at(storyboard: &Storyboard, sec: f64) -> Option<usize> {
    let disabled = |raw: Option<&serde_json::Map<String, serde_json::Value>>| raw.and_then(|r| r.get("enabled")).and_then(|v| v.as_bool()) == Some(false);
    if disabled(storyboard.captions.as_ref()) {
        return None;
    }
    let index = storyboard.caption_cues.iter().position(|c| sec >= c.start_sec && sec < c.start_sec + c.duration_sec)?;
    let caption = &storyboard.caption_cues[index].caption;
    (!disabled(caption.style.as_ref()) && caption.status.as_deref() != Some("needs-refresh")).then_some(index)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn storyboard(json: &str) -> Storyboard {
        Storyboard::parse(json).expect("storyboard")
    }

    #[test]
    fn boundary_holds_match_source_rounding_at_multiple_frame_rates() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../tests/fixtures/transition-placement.json")).unwrap();
        for sample in fixture["holds"].as_array().unwrap() {
            let i = &sample["input"];
            let expected = &sample["expected"];
            let actual = boundary_hold(
                i["startSec"].as_f64().unwrap(),
                i["endSec"].as_f64().unwrap(),
                i["nextStartSec"].as_f64(),
                i["transitionFrames"].as_i64().unwrap(),
                i["fps"].as_f64().unwrap(),
            );
            assert_eq!(actual, (expected["exitFromFrame"].as_i64().unwrap(), expected["holdFrames"].as_i64().unwrap()));
        }
    }

    #[test]
    fn frame_30_at_30_fps_is_one_second() {
        assert_eq!(seconds(30, 30.0), 1.0);
    }

    #[test]
    fn an_element_ending_at_one_second_is_not_visible_at_frame_30() {
        let s = storyboard(r#"{"scenes":[],"textOverlays":[{"content":"a","startSec":0,"durationSec":1,"preset":"plain"}]}"#);
        assert_eq!(visible(&s, 29, FPS), vec![Visible::TextOverlay { index: 0, local: 29, frames: 30 }]);
        assert_eq!(visible(&s, 30, FPS), vec![]);
    }

    #[test]
    fn a_sequence_starts_on_the_floored_frame_and_lasts_at_least_one() {
        assert_eq!(Span::at(0.99, frames(0.01, FPS), FPS), Span { from: 29, frames: 1 });
        assert_eq!(Span::at(0.99, 1, FPS).local(29), Some(0));
        assert_eq!(Span::at(0.99, 1, FPS).local(30), None);
    }

    #[test]
    fn captions_use_half_open_intervals_and_skip_stale_cues() {
        let cue = |id: &str, start: f64, status: &str| {
            format!(r#"{{"id":"{id}","type":"caption","startSec":{start},"durationSec":1,"track":0,"caption":{{"text":"x","words":[],"status":"{status}"}}}}"#)
        };
        let s = storyboard(&format!(r#"{{"scenes":[],"captionCues":[{},{}]}}"#, cue("a", 0.0, "current"), cue("b", 1.0, "needs-refresh")));
        assert_eq!(visible(&s, 29, FPS), vec![Visible::Caption { index: 0, local_sec: 29.0 / 30.0 }]);
        assert_eq!(visible(&s, 30, FPS), vec![], "cue b needs refresh");
    }

    #[test]
    fn packed_scenes_overlap_by_their_transition() {
        let s = storyboard(
            r#"{"scenes":[{"image":"a","durationSec":2,"transition":"fade","transitionDurSec":0.5},{"image":"b","durationSec":2,"transition":"cut"},{"image":"c","durationSec":2}]}"#,
        );
        let placed = place_scenes(&s, FPS);
        assert_eq!(placed.iter().map(|p| p.span.from).collect::<Vec<_>>(), vec![0, 45, 104]);
        assert_eq!(placed[0].transition_at(44), None);
        assert_eq!(placed[0].transition_at(45).as_deref(), Some("fade"));
        assert_eq!(placed[1].transition_at(14).as_deref(), Some("fade"));
        assert_eq!(placed[1].transition_at(15), None);
        // The cut overlaps one frame: both scenes are visible, b behind c.
        let at = visible(&s, 104, FPS);
        assert!(matches!(at.as_slice(), [Visible::Scene { placed: a, .. }, Visible::Scene { placed: b, .. }] if a.index == 1 && b.index == 2));
    }

    #[test]
    fn absolute_scenes_hold_under_the_next_entrance() {
        let s = storyboard(
            r#"{"scenes":[{"image":"a","startSec":0,"durationSec":2,"transition":"cut"},{"image":"b","startSec":2.5,"durationSec":2,"transition":"fade"}]}"#,
        );
        let placed = place_scenes(&s, FPS);
        assert_eq!((placed[0].frames, placed[0].hold), (60, 15 + 12));
        assert_eq!(placed[0].transition_at(74), None, "held through the gap");
        assert_eq!(placed[0].transition_at(75).as_deref(), Some("fade"));
        assert_eq!(placed[0].transition_at(10), None);
        assert_eq!(placed[1].transition_at(11).as_deref(), Some("fade"));
    }

    #[test]
    fn a_lone_scene_visual_holds_and_later_visuals_play_their_entrance() {
        let s = storyboard(
            r#"{"scenes":[{"image":"a","durationSec":2,"visualClips":[{"url":"a","startSec":0,"durationSec":1},{"url":"b","startSec":1,"durationSec":1,"transition":"fade"}]}]}"#,
        );
        let at = |local| scene_visuals(&s.scenes[0], local, 60, 0, FPS);
        assert_eq!(at(29).iter().map(|v| v.index).collect::<Vec<_>>(), [Some(0)]);
        assert_eq!(at(30), vec![SceneVisualAt { index: Some(1), local: 0, motion_frames: 30, transition: Some("fade".into()) }]);
        assert_eq!(at(42)[0].transition, None);
        let single = storyboard(r#"{"scenes":[{"image":"a","durationSec":2,"visualClips":[{"url":"a","durationSec":1}]}]}"#);
        assert_eq!(scene_visuals(&single.scenes[0], 70, 60, 15, FPS).len(), 1, "held through the hold");
    }

    #[test]
    fn overlays_stack_by_z_index_then_document_order() {
        let s = storyboard(
            r#"{"scenes":[{"image":"a","durationSec":4}],"videoOverlays":[{"url":"v","track":1,"durationSec":4}],
               "textOverlays":[{"content":"t","durationSec":4}],"captionCues":[{"id":"c","type":"caption","startSec":0,"durationSec":4,"track":0,"caption":{"text":"x","words":[]}}]}"#,
        );
        let paths: Vec<String> = visible(&s, 0, FPS).iter().map(Visible::path).collect();
        assert_eq!(paths, ["scenes[0]", "videoOverlays[0]", "textOverlays[0]", "captionCues[0]"]);
    }
}
