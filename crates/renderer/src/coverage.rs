//! What a frame shows that the renderer does not draw yet (D4).
//!
//! The walk reads the decoded storyboard, not the drawing code: it takes every
//! element visible at the frame (`timeline::visible`) and checks its kind and
//! options against [`SUPPORTED`]. An element the drawing code skips by mistake
//! still shows here. A frame whose report is empty is complete.

use serde::Serialize;
use serde_json::{Map, Value};

use crate::paint::{parse_color, parse_paint};
use crate::storyboard::{Layout, Storyboard};
use crate::timeline::{self, Visible};

/// The element kinds this renderer draws. The corpus check (D6) requires a
/// golden case for each one.
pub const SUPPORTED: &[&str] = &["background", "scene-image", "timeline-image", "image-overlay", "text-plain", "caption"];

/// One element the renderer cannot draw, or draws without one of its options.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Entry {
    pub kind: String,
    pub path: String,
    pub reason: String,
}

/// An element visible at the frame, with what keeps it from drawing exactly.
#[derive(Debug, Clone, PartialEq)]
pub struct Inspected {
    pub kind: &'static str,
    pub path: String,
    pub problems: Vec<String>,
}

/// Movements whose keyframes do not move: `static` holds a 1.02 scale.
const STATIC_MOVEMENTS: [&str; 2] = ["Static", "static"];

/// Layout keys that do not change how a still image draws.
const INERT_LAYOUT_KEYS: [&str; 7] = ["playbackRate", "reverse", "preservePitch", "aspectLocked", "sourceAudioExtraction", "reverseMedia", "volume"];

/// Every element visible at `frame` with its problems. `has_media` says
/// whether the host supplied an image URL.
pub fn inspect(storyboard: &Storyboard, frame: i64, fps: f64, has_media: &dyn Fn(&str) -> bool) -> Vec<Inspected> {
    let mut out = Vec::new();
    for visible in timeline::visible(storyboard, frame, fps) {
        let path = visible.path();
        match &visible {
            Visible::Scene { placed, local } => inspect_scene(storyboard, placed, *local, fps, has_media, &mut out),
            Visible::TimelineVisual { placed, local } => {
                let clip = &storyboard.visual_timeline.as_deref().unwrap_or_default()[placed.index];
                let mut problems = layout_problems(clip.layout.as_ref());
                problems.extend(camera_problems(clip.movement.as_deref(), clip.motion.as_ref()));
                problems.extend(clip.reveal.as_ref().map(|_| "reveal".to_owned()));
                problems.extend(placed.transition_at(*local).map(|t| format!("`{t}` transition")));
                problems.extend((!has_media(&clip.url)).then(|| "missing media".to_owned()));
                out.push(visual(&clip.kind, "timeline-image", "timeline-video", path, problems));
            }
            Visible::VideoOverlay { placed, local } => {
                let overlay = &storyboard.video_overlays[placed.index];
                let mut problems = layout_problems(overlay.layout.as_ref());
                problems.extend(overlay.reveal.as_ref().map(|_| "reveal".to_owned()));
                problems.extend(placed.transition_at(*local).map(|t| format!("`{t}` transition")));
                problems.extend((!has_media(&overlay.url)).then(|| "missing media".to_owned()));
                out.push(visual(&overlay.kind, "image-overlay", "video-overlay", path, problems));
            }
            Visible::TextOverlay { index, .. } => out.push(inspect_text(storyboard, *index, path)),
            Visible::Caption { index, .. } => out.push(Inspected { kind: "caption", path, problems: caption_problems(storyboard, *index) }),
            Visible::Effect { index } => {
                out.push(Inspected { kind: "effect", path, problems: vec![format!("`{}` effect", storyboard.effects[*index].effect)] })
            }
            Visible::ChapterPills => out.push(Inspected { kind: "chapter-pills", path, problems: vec!["chapter pills".into()] }),
            Visible::ProgressBar => out.push(Inspected { kind: "progress-bar", path, problems: vec!["progress bar".into()] }),
        }
    }
    out
}

/// The coverage report for a frame.
pub fn report(storyboard: &Storyboard, frame: i64, fps: f64, has_media: &dyn Fn(&str) -> bool) -> Vec<Entry> {
    inspect(storyboard, frame, fps, has_media)
        .into_iter()
        .flat_map(|element| {
            let Inspected { kind, path, problems } = element;
            problems.into_iter().map(move |reason| Entry { kind: kind.to_owned(), path: path.clone(), reason })
        })
        .collect()
}

fn visual(kind: &str, image: &'static str, video: &'static str, path: String, mut problems: Vec<String>) -> Inspected {
    if kind == "image" {
        Inspected { kind: image, path, problems }
    } else {
        problems.insert(0, format!("`{kind}` media"));
        Inspected { kind: video, path, problems }
    }
}

fn inspect_scene(storyboard: &Storyboard, placed: &timeline::Placed, local: i64, fps: f64, has_media: &dyn Fn(&str) -> bool, out: &mut Vec<Inspected>) {
    let scene = &storyboard.scenes[placed.index];
    let path = format!("scenes[{}]", placed.index);
    let background = match parse_paint(&storyboard.bg_color) {
        Some(_) => Vec::new(),
        None => vec![format!("background `{}` does not parse", storyboard.bg_color)],
    };
    out.push(Inspected { kind: "background", path: path.clone(), problems: background });
    if let Some(transition) = placed.transition_at(local) {
        out.push(Inspected { kind: "transition", path: path.clone(), problems: vec![format!("`{transition}` transition")] });
    }
    for (flag, kind) in [(storyboard.show_labels && !scene.label.is_empty(), "scene-label"), (scene.vignette, "vignette"), (scene.grain, "grain")] {
        if flag {
            out.push(Inspected { kind, path: path.clone(), problems: vec![kind.replace('-', " ")] });
        }
    }
    for at in timeline::scene_visuals(scene, local, placed.frames, placed.hold, fps) {
        let clip = at.index.map(|i| &scene.visual_clips.as_deref().unwrap_or_default()[i]);
        let (url, kind) = match clip {
            Some(clip) => (clip.url.as_str(), clip.kind.as_deref().unwrap_or("image")),
            None => (scene.image.as_str(), "image"),
        };
        let layout = Layout::merged(scene.layout.as_ref(), clip.and_then(|c| c.layout.as_ref()));
        let mut problems = layout_problems(layout.as_ref());
        problems.extend(camera_problems(Some(&scene.movement), clip.and_then(|c| c.motion.as_ref()).or(scene.motion.as_ref())));
        problems.extend(clip.and_then(|c| c.reveal.as_ref()).map(|_| "reveal".to_owned()));
        problems.extend(at.transition.map(|t| format!("`{t}` transition")));
        problems.extend((!has_media(url)).then(|| "missing media".to_owned()));
        let item = match at.index {
            Some(i) => format!("{path}.visualClips[{i}]"),
            None => format!("{path}.image"),
        };
        out.push(visual(kind, "scene-image", "scene-video", item, problems));
    }
}

fn is_null_or_absent(value: Option<&Value>) -> bool {
    value.is_none_or(Value::is_null)
}

/// Keyframe tracks other than `volume` that hold at least one key.
fn has_keys(animation: Option<&Value>) -> bool {
    let tracks = |name: &str| animation.and_then(|a| a.get(name)).and_then(Value::as_object).cloned().unwrap_or_default();
    tracks("tracks").iter().chain(tracks("colorTracks").iter()).any(|(property, keys)| property != "volume" && keys.as_array().is_some_and(|k| !k.is_empty()))
}

/// The options of a clip layout the renderer does not draw.
fn layout_problems(layout: Option<&Layout>) -> Vec<String> {
    let Some(layout) = layout else { return Vec::new() };
    let mut problems = Vec::new();
    if has_keys(layout.rest.get("animation")) {
        problems.push("keyframes".into());
    }
    if !is_null_or_absent(layout.rest.get("mask")) {
        problems.push("mask".into());
    }
    let color = layout.rest.get("color").and_then(Value::as_object);
    if color.is_some_and(|c| c.values().any(|v| v.as_f64() != Some(1.0))) {
        problems.push("color adjustment".into());
    }
    match layout.rest.get("blendMode").and_then(Value::as_str) {
        None | Some("normal") => {}
        Some(mode) => problems.push(format!("`{mode}` blend mode")),
    }
    if layout.rotation_deg.is_some_and(|r| r != 0.0) {
        problems.push("rotation".into());
    }
    if layout.flip_x == Some(true) || layout.flip_y == Some(true) {
        problems.push("flip".into());
    }
    for key in layout.rest.keys() {
        if !["animation", "mask", "color", "blendMode"].contains(&key.as_str()) && !INERT_LAYOUT_KEYS.contains(&key.as_str()) {
            problems.push(format!("layout option `{key}`"));
        }
    }
    problems
}

/// Camera motion: a custom keyframe motion, or a movement that moves.
/// `resolveMotion` reads a missing movement as Ken Burns.
fn camera_problems(movement: Option<&str>, motion: Option<&Value>) -> Option<String> {
    if !is_null_or_absent(motion) {
        return Some("camera motion".into());
    }
    match movement {
        Some(m) if STATIC_MOVEMENTS.contains(&m) => None,
        Some(m) => Some(format!("`{m}` camera motion")),
        None => Some("Ken Burns camera motion".into()),
    }
}

fn inspect_text(storyboard: &Storyboard, index: usize, path: String) -> Inspected {
    let text = &storyboard.text_overlays[index];
    if text.preset.as_deref() != Some("plain") {
        let preset = text.preset.as_deref().map_or("no preset".to_owned(), |p| format!("`{p}` preset"));
        return Inspected { kind: "text", path, problems: vec![preset] };
    }
    let mut problems = layout_problems(text.layout.as_ref());
    if text.anim.as_ref().is_some_and(|a| has_keys(Some(a))) {
        problems.push("keyframes".into());
    }
    match &text.style {
        None => problems.push("no text style (browser default font)".into()),
        Some(style) => {
            match style.font_family.as_deref() {
                Some("Inter") => {}
                Some(family) => problems.push(format!("font `{family}`")),
                None => problems.push("no font family (browser default font)".into()),
            }
            if style.font_size.is_none() {
                problems.push("no font size (browser default size)".into());
            }
            if style.scale.is_some_and(|s| s != 1.0) {
                problems.push("content scale".into());
            }
            for (name, value) in [("fill", style.fill.as_deref()), ("background", style.background.as_deref())] {
                if value.is_some_and(|v| parse_color(v).is_none()) {
                    problems.push(format!("{name} `{}` does not parse", value.unwrap_or_default()));
                }
            }
        }
    }
    Inspected { kind: "text-plain", path, problems }
}

/// The cue's style merged over the project config, as `Captions.tsx` does.
pub fn caption_style(storyboard: &Storyboard, index: usize) -> Map<String, Value> {
    let mut style = storyboard.captions.clone().unwrap_or_default();
    if let Some(own) = &storyboard.caption_cues[index].caption.style {
        style.extend(own.clone());
    }
    style
}

fn caption_problems(storyboard: &Storyboard, index: usize) -> Vec<String> {
    let style = caption_style(storyboard, index);
    let text = |key: &str| style.get(key).and_then(Value::as_str);
    let mut problems = Vec::new();
    match text("fontFamily") {
        None | Some("Inter") => {}
        Some(family) => problems.push(format!("font `{family}`")),
    }
    match text("motion") {
        None | Some("None" | "Fade" | "Pop" | "Slide Up") => {}
        Some(motion) => problems.push(format!("`{motion}` motion")),
    }
    for key in ["fill", "activeColor", "background", "stroke", "shadow"] {
        if let Some(value) = text(key)
            && parse_color(value).is_none()
        {
            problems.push(format!("{key} `{value}` does not parse"));
        }
    }
    for color in [&storyboard.fg_color, &storyboard.accent_color] {
        if parse_color(color).is_none() {
            problems.push(format!("palette color `{color}` does not parse"));
        }
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeline::FPS;

    fn report_at(json: &str, frame: i64) -> Vec<Entry> {
        report(&Storyboard::parse(json).expect("storyboard"), frame, FPS, &|_| true)
    }

    #[test]
    fn a_text_overlay_with_an_animation_value_is_one_entry() {
        let entries = report_at(
            r#"{"scenes":[],"textOverlays":[{"content":"t","preset":"plain","durationSec":2,"style":{"fontFamily":"Inter","fontSize":64},
                "layout":{"xPct":0,"animation":{"tracks":{"opacity":[{"t":0,"v":0},{"t":1,"v":1}]}}}}]}"#,
            0,
        );
        assert_eq!(entries, [Entry { kind: "text-plain".into(), path: "textOverlays[0]".into(), reason: "keyframes".into() }]);
    }

    #[test]
    fn every_text_preset_but_plain_is_one_entry() {
        let entries = report_at(r#"{"scenes":[],"textOverlays":[{"content":"t","preset":"lower-third","durationSec":2},{"content":"u","durationSec":2}]}"#, 0);
        assert_eq!(entries.iter().map(|e| (e.kind.as_str(), e.reason.as_str())).collect::<Vec<_>>(), [("text", "`lower-third` preset"), ("text", "no preset")]);
    }

    #[test]
    fn a_scene_with_camera_motion_is_one_entry() {
        let entries = report_at(r#"{"scenes":[{"image":"a.png","durationSec":2,"movement":"Slow Zoom In","transition":"cut"}]}"#, 0);
        assert_eq!(entries, [Entry { kind: "scene-image".into(), path: "scenes[0].image".into(), reason: "`Slow Zoom In` camera motion".into() }]);
    }

    #[test]
    fn an_effect_is_one_entry() {
        let entries = report_at(r#"{"scenes":[],"effects":[{"effect":"flash","startSec":0,"durationSec":1}]}"#, 0);
        assert_eq!(entries, [Entry { kind: "effect".into(), path: "effects[0]".into(), reason: "`flash` effect".into() }]);
    }

    #[test]
    fn a_frame_of_supported_elements_has_an_empty_report() {
        let json = r##"{"scenes":[{"image":"a.png","durationSec":4,"movement":"Static","transition":"cut",
                "visualClips":[{"url":"a.png","layout":{"mask":null,"color":{"brightness":1,"contrast":1,"saturation":1},"xPct":0,"yPct":0,
                "widthPct":100,"heightPct":100,"fit":"cover","rotationDeg":0,"aspectLocked":false,"opacity":1,"flipX":false,"flipY":false,
                "playbackRate":1,"reverse":false}}]}],
            "bgColor":"linear-gradient(135deg, #F97316 0%, #E11D48 100%)",
            "videoOverlays":[{"url":"logo.png","durationSec":4,"layout":{"xPct":76,"yPct":3,"widthPct":20,"fit":"contain","opacity":0.9}}],
            "textOverlays":[{"content":"Hi","preset":"plain","durationSec":4,"style":{"fontFamily":"Inter","fontSize":64,"fill":"#fff"}}],
            "captionCues":[{"id":"c","type":"caption","startSec":0,"durationSec":4,"track":0,"caption":{"text":"Hi","words":[]}}]}"##;
        assert_eq!(report_at(json, 10), []);
        let storyboard = Storyboard::parse(json).unwrap();
        let kinds: Vec<&str> = inspect(&storyboard, 10, FPS, &|_| true).iter().map(|e| e.kind).collect();
        assert_eq!(kinds, ["background", "scene-image", "image-overlay", "text-plain", "caption"]);
    }

    #[test]
    fn missing_media_and_unparsed_backgrounds_are_reported() {
        let storyboard = Storyboard::parse(
            r#"{"scenes":[{"image":"a.png","durationSec":2,"movement":"Static","transition":"cut"}],"bgColor":"conic-gradient(#fff, #000)"}"#,
        )
        .unwrap();
        let reasons: Vec<String> = report(&storyboard, 0, FPS, &|_| false).into_iter().map(|e| e.reason).collect();
        assert_eq!(reasons, ["background `conic-gradient(#fff, #000)` does not parse", "missing media"]);
    }
}
