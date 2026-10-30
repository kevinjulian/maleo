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
pub const SUPPORTED: &[&str] = &[
    "background",
    "scene-image",
    "timeline-image",
    "image-overlay",
    "scene-video",
    "timeline-video",
    "video-overlay",
    "text-plain",
    "shape-rect",
    "shape-circle",
    "shape-triangle",
    "shape-star",
    "shape-cross",
    "motion-comp",
    "caption",
    "transition",
    "effect",
    "scene-label",
    "vignette",
    "grain",
    "chapter-pills",
    "progress-bar",
];

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

/// Media timing is checked by media_requests; these keys do not alter visual treatments.
const INERT_LAYOUT_KEYS: [&str; 7] = ["playbackRate", "reverse", "preservePitch", "aspectLocked", "sourceAudioExtraction", "reverseMedia", "volume"];

/// Every element visible at `frame` with its problems. `has_media` says
/// whether source media exists. Renderer refines video availability by placement and interval.
pub fn inspect(storyboard: &Storyboard, frame: i64, fps: f64, has_media: &dyn Fn(&str) -> bool) -> Vec<Inspected> {
    let mut out = Vec::new();
    for visible in timeline::visible(storyboard, frame, fps) {
        let path = visible.path();
        match &visible {
            Visible::Scene { placed, local } => inspect_scene(storyboard, placed, *local, fps, has_media, &mut out),
            Visible::TimelineVisual { placed, local } => {
                let clip = &storyboard.visual_timeline.as_deref().unwrap_or_default()[placed.index];
                let mut problems = layout_problems(clip.layout.as_ref(), true);
                problems.extend(placed.transitions_at(*local).filter(|t| !crate::scene::transition::series_supported(t)).map(|t| format!("`{t}` transition")));
                problems.extend((!has_media(&clip.url)).then(|| "missing media".to_owned()));
                out.push(visual(&clip.kind, "timeline-image", "timeline-video", path, problems));
            }
            Visible::VideoOverlay { placed, local } => {
                let overlay = &storyboard.video_overlays[placed.index];
                let mut problems = layout_problems(overlay.layout.as_ref(), true);
                problems.extend(placed.transitions_at(*local).filter(|t| !crate::scene::transition::series_supported(t)).map(|t| format!("`{t}` transition")));
                problems.extend((!has_media(&overlay.url)).then(|| "missing media".to_owned()));
                out.push(visual(&overlay.kind, "image-overlay", "video-overlay", path, problems));
            }
            Visible::TextOverlay { index, local, frames } if storyboard.text_overlays[*index].preset.as_deref() == Some("motion-comp") => {
                let text = &storyboard.text_overlays[*index];
                let mut problems = layout_problems(text.layout.as_ref(), false);
                match crate::scene::composition::Config::parse(text.rest.get("params")) {
                    Err(error) => problems.push(error),
                    Ok(config) => {
                        for (i, layer) in config.layers.iter().enumerate() {
                            let (from, duration) = layer.timing(config.span, *frames, fps);
                            if *local >= from && *local < from + duration {
                                out.push(inspect_overlay(storyboard, &layer.overlay, format!("{path}.params.overlays[{i}]")));
                            }
                        }
                    }
                }
                out.push(Inspected { kind: "motion-comp", path, problems });
            }
            Visible::TextOverlay { index, .. } => out.push(inspect_text(storyboard, *index, path)),
            Visible::Caption { index, .. } => out.push(Inspected { kind: "caption", path, problems: caption_problems(storyboard, *index) }),
            Visible::Effect { index } => {
                let kind = &storyboard.effects[*index].effect;
                out.push(Inspected {
                    kind: "effect",
                    path,
                    problems: if crate::scene::effect::supported(kind) { Vec::new() } else { vec![format!("`{kind}` effect")] },
                })
            }
            Visible::ChapterPills => out.push(Inspected { kind: "chapter-pills", path, problems: Vec::new() }),
            Visible::ProgressBar => out.push(Inspected { kind: "progress-bar", path, problems: Vec::new() }),
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
        if kind != "video" {
            problems.insert(0, format!("`{kind}` media"));
        }
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
    for transition in placed.transitions_at(local) {
        let supported = crate::scene::transition::series_supported(transition);
        out.push(Inspected {
            kind: "transition",
            path: path.clone(),
            problems: if supported { Vec::new() } else { vec![format!("`{transition}` transition")] },
        });
    }
    for (flag, kind) in [(storyboard.show_labels && !scene.label.is_empty(), "scene-label"), (scene.vignette, "vignette"), (scene.grain, "grain")] {
        if flag {
            out.push(Inspected { kind, path: path.clone(), problems: Vec::new() });
        }
    }
    for at in timeline::scene_visuals(scene, local, placed.frames, placed.hold, fps) {
        let clip = at.index.map(|i| &scene.visual_clips.as_deref().unwrap_or_default()[i]);
        let (url, kind) = match clip {
            Some(clip) => (clip.url.as_str(), clip.kind.as_deref().unwrap_or("image")),
            None => (scene.image.as_str(), "image"),
        };
        let layout = Layout::merged(scene.layout.as_ref(), clip.and_then(|c| c.layout.as_ref()));
        let mut problems = layout_problems(layout.as_ref(), true);
        problems.extend(at.transition.filter(|t| !crate::scene::transition::series_supported(t)).map(|t| format!("`{t}` transition")));
        problems.extend((!has_media(url)).then(|| "missing media".to_owned()));
        let item = match at.index {
            Some(i) => format!("{path}.visualClips[{i}]"),
            None => format!("{path}.image"),
        };
        out.push(visual(kind, "scene-image", "scene-video", item, problems));
    }
}

/// Keyframe tracks other than `volume` that hold at least one key.
fn has_keys(animation: Option<&Value>) -> bool {
    let tracks = |name: &str| animation.and_then(|a| a.get(name)).and_then(Value::as_object).cloned().unwrap_or_default();
    tracks("tracks").iter().chain(tracks("colorTracks").iter()).any(|(property, keys)| property != "volume" && keys.as_array().is_some_and(|k| !k.is_empty()))
}

/// The options of a clip layout the renderer does not draw.
fn layout_problems(layout: Option<&Layout>, visual: bool) -> Vec<String> {
    let Some(layout) = layout else { return Vec::new() };
    let mut problems = Vec::new();
    let animation = layout.animation.as_ref();
    let unsupported_tracks = animation.and_then(|a| a.get("tracks")).and_then(Value::as_object).is_some_and(|tracks| {
        tracks.iter().any(|(name, keys)| {
            !["xPct", "yPct", "scale", "rotationDeg", "opacity", "volume"].contains(&name.as_str()) && keys.as_array().is_some_and(|keys| !keys.is_empty())
        })
    }) || animation
        .and_then(|a| a.get("colorTracks"))
        .and_then(Value::as_object)
        .is_some_and(|tracks| tracks.values().any(|keys| keys.as_array().is_some_and(|keys| !keys.is_empty())));
    if has_keys(animation) && visual && unsupported_tracks {
        problems.push("keyframes".into());
    }
    if let Some(animation) = animation.and_then(Value::as_object) {
        for option in animation.keys().filter(|key| !["tracks", "colorTracks"].contains(&key.as_str())) {
            problems.push(format!("animation option `{option}`"));
        }
    }
    if !visual && layout.crop.is_some() {
        problems.push("crop".into());
    }
    if layout.local_mask().is_some() && !visual {
        problems.push("mask".into());
    }
    if !visual && layout.color.is_some_and(|c| !c.neutral()) {
        problems.push("color adjustment".into());
    }
    match layout.blend_mode.as_deref() {
        None | Some("normal") => {}
        Some(mode) if !visual => problems.push(format!("`{mode}` blend mode")),
        Some(_) => {}
    }
    if !visual && (layout.flip_x == Some(true) || layout.flip_y == Some(true)) {
        problems.push("flip".into());
    }
    for key in layout.rest.keys() {
        if !["animation", "mask", "color", "blendMode"].contains(&key.as_str()) && !INERT_LAYOUT_KEYS.contains(&key.as_str()) {
            problems.push(format!("layout option `{key}`"));
        }
    }
    problems
}

fn inspect_text(storyboard: &Storyboard, index: usize, path: String) -> Inspected {
    inspect_overlay(storyboard, &storyboard.text_overlays[index], path)
}

fn inspect_overlay(storyboard: &Storyboard, text: &crate::storyboard::TextOverlay, path: String) -> Inspected {
    let mut extra = Vec::new();
    for key in text.rest.keys().filter(|key| key.as_str() != "params") {
        extra.push(format!("layer option `{key}`"));
    }
    if let Some(style) = &text.style {
        for key in style.rest.keys().filter(|key| !["accent", "bodyFill"].contains(&key.as_str())) {
            extra.push(format!("style option `{key}`"));
        }
    }
    if let Some(preset) = crate::scene::shape::IDS.iter().copied().find(|id| text.preset.as_deref() == Some(*id)) {
        let mut problems = layout_problems(text.layout.as_ref(), false);
        problems.extend(extra);
        if text.style.as_ref().and_then(|s| s.background.as_deref()).is_some_and(|color| parse_color(color).is_none()) {
            problems.push("style.background: color does not parse".into());
        }
        let animation = text.layout.as_ref().and_then(|l| l.animation.as_ref()).or(text.anim.as_ref());
        for property in ["fontSize", "letterSpacing", "lineHeight"] {
            if animation.and_then(|a| a.get("tracks")).and_then(|t| t.get(property)).and_then(Value::as_array).is_some_and(|keys| !keys.is_empty()) {
                problems.push(format!("shape animation `{property}`"));
            }
        }
        if let Some(params) = text.rest.get("params") {
            if let Some(params) = params.as_object() {
                for (key, value) in params {
                    match key.as_str() {
                        "fill" | "stroke" => {
                            if !value.as_str().is_some_and(|s| s.is_empty() || parse_color(s).is_some()) {
                                problems.push(format!("params.{key}: color does not parse"));
                            }
                        }
                        "strokeWidth" | "opacity" | "radius" => {
                            let n = value.as_f64().or_else(|| value.as_str().and_then(|s| s.trim().parse::<f64>().ok()));
                            if !n.is_some_and(|n| n.is_finite() && n >= 0.0 && (key != "opacity" || n <= 1.0)) {
                                problems.push(format!("params.{key}: invalid shape number"));
                            }
                            if key == "radius" && preset != "shape-rect" {
                                problems.push("params.radius: Rectangle only".into());
                            }
                        }
                        _ => problems.push(format!("params option `{key}`")),
                    }
                }
            } else {
                problems.push("params must be an object".into());
            }
        }
        if text.rest.get("params").and_then(|p| p.get("fill")).and_then(Value::as_str).is_none_or(str::is_empty)
            && parse_color(&storyboard.accent_color).is_none()
        {
            problems.push("accent color does not parse".into());
        }
        return Inspected { kind: preset, path, problems };
    }
    if text.preset.as_deref() != Some("plain") {
        let preset = text.preset.as_deref().map_or("no preset".to_owned(), |p| format!("`{p}` preset"));
        return Inspected { kind: "text", path, problems: vec![preset] };
    }
    let mut problems = layout_problems(text.layout.as_ref(), false);
    problems.extend(extra);
    if text.rest.get("params").and_then(Value::as_object).is_some_and(|p| !p.is_empty()) {
        problems.push("plain text shape params".into());
    }
    let animation = text.layout.as_ref().and_then(|layout| layout.animation.as_ref()).or(text.anim.as_ref());
    if let Some(colors) = animation.and_then(|a| a.get("colorTracks")).and_then(Value::as_object) {
        for (property, keys) in colors {
            if ["fill", "background"].contains(&property.as_str())
                && keys
                    .as_array()
                    .is_some_and(|keys| keys.iter().any(|key| key.get("v").and_then(Value::as_str).is_none_or(|color| parse_color(color).is_none())))
            {
                problems.push(format!("animated {property} color does not parse"));
            }
        }
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
    fn a_plain_text_overlay_with_supported_animation_has_empty_coverage() {
        let entries = report_at(
            r#"{"scenes":[],"textOverlays":[{"content":"t","preset":"plain","durationSec":2,"style":{"fontFamily":"Inter","fontSize":64},
                "layout":{"xPct":0,"animation":{"tracks":{"opacity":[{"t":0,"v":0},{"t":1,"v":1}]}}}}]}"#,
            0,
        );
        assert_eq!(entries, []);
    }

    #[test]
    fn supported_video_animation_does_not_hide_unknown_options() {
        let entries = report_at(
            r#"{"scenes":[],"videoOverlays":[{"url":"video.mp4","kind":"video","durationSec":2,"layout":{"rotationDeg":30,"flipX":true,"animation":{"tracks":{"opacity":[{"t":0,"v":0.5}]},"futureOption":true}}}]}"#,
            0,
        );
        assert_eq!(entries.iter().map(|e| e.reason.as_str()).collect::<Vec<_>>(), ["animation option `futureOption`"]);
    }

    #[test]
    fn supported_transitions_do_not_hide_simultaneous_unknown_transitions() {
        let absolute = report_at(r#"{"scenes":[{"image":"a","startSec":0,"durationSec":2,"transition":"fade"}]}"#, 0);
        assert!(!absolute.iter().any(|entry| entry.reason == "`fade` transition"));
        let overlap = report_at(
            r#"{"scenes":[{"image":"a","durationSec":0.4,"transition":"fade"},{"image":"b","durationSec":0.4,"transition":"future-transition"},{"image":"c","durationSec":1,"transition":"cut"}]}"#,
            0,
        );
        assert!(overlap.iter().any(|entry| entry.reason == "`future-transition` transition"));
        assert!(!overlap.iter().any(|entry| entry.reason == "`fade` transition"));
    }

    #[test]
    fn supported_video_transitions_have_no_blanket_media_reason() {
        let entries = report_at(r#"{"scenes":[],"videoOverlays":[{"url":"a","kind":"video","durationSec":2,"transition":"flip"}]}"#, 0);
        assert!(entries.is_empty());
    }

    #[test]
    fn supported_video_reveals_have_no_blanket_media_reason() {
        let entries = report_at(
            r#"{"scenes":[],"videoOverlays":[{"url":"a","kind":"video","reveal":{"type":"fade"}},{"url":"b","reveal":{"type":"wipe","phase":"black_then_color"}},{"url":"c","reveal":{"type":"wipe","texture":"paper"}}]}"#,
            0,
        );
        assert!(entries.is_empty());
    }

    #[test]
    fn supported_video_mask_and_color_have_no_blanket_media_reason() {
        let entries = report_at(
            r#"{"scenes":[],"videoOverlays":[{"url":"v","kind":"video","durationSec":2,"layout":{"color":{"brightness":2,"contrast":1,"saturation":1},"mask":{"shape":"rectangle","xPct":0,"yPct":0,"widthPct":100,"heightPct":100,"rotationDeg":0,"featherPct":50,"inverted":false}}}]}"#,
            0,
        );
        assert!(entries.is_empty());
    }

    #[test]
    fn text_animation_keeps_font_and_template_coverage() {
        let entries = report_at(
            r#"{"scenes":[],"textOverlays":[{"content":"x","preset":"plain","durationSec":2,"style":{"fontFamily":"Unbundled","fontSize":64},"layout":{"animation":{"tracks":{"opacity":[{"t":0,"v":1}]}}}},{"content":"y","preset":"lower-third","durationSec":2,"layout":{"animation":{"tracks":{"opacity":[{"t":0,"v":1}]}}}}]}"#,
            0,
        );
        assert_eq!(entries.iter().map(|e| e.reason.as_str()).collect::<Vec<_>>(), ["font `Unbundled`", "`lower-third` preset"]);
    }

    #[test]
    fn composition_coverage_names_layers_and_refuses_bad_definitions() {
        let mut value = serde_json::json!({"scenes":[],"textOverlays":[{"preset":"motion-comp","content":"","durationSec":4,"params":{"spanSec":4,"overlays":[{"preset":"plain","content":"word","relStart":0,"dur":2,"style":{"fontFamily":"Missing","fontSize":32},"future":true},{"preset":"shape-cross","content":"","relStart":0,"dur":4,"layout":{"crop":{"xPct":0,"yPct":0,"widthPct":50,"heightPct":50}}}]}}]});
        let entries = report_at(&value.to_string(), 0);
        assert!(entries.iter().any(|e| e.path == "textOverlays[0].params.overlays[0]" && e.reason == "font `Missing`"));
        assert!(entries.iter().any(|e| e.path == "textOverlays[0].params.overlays[0]" && e.reason.contains("future")));
        assert!(entries.iter().any(|e| e.path == "textOverlays[0].params.overlays[1]" && e.reason == "crop"));
        value["textOverlays"][0]["params"]["schemaVersion"] = 2.into();
        assert!(Storyboard::parse(&value.to_string()).unwrap_err().0.contains("schemaVersion"));
        value["textOverlays"][0]["params"]["schemaVersion"] = 1.into();
        value["textOverlays"][0]["params"]["overlays"][0]["dur"] = (-1).into();
        assert!(Storyboard::parse(&value.to_string()).unwrap_err().0.contains("overlays[0]"));
    }

    #[test]
    fn every_text_preset_but_plain_is_one_entry() {
        let entries = report_at(r#"{"scenes":[],"textOverlays":[{"content":"t","preset":"lower-third","durationSec":2},{"content":"u","durationSec":2}]}"#, 0);
        assert_eq!(entries.iter().map(|e| (e.kind.as_str(), e.reason.as_str())).collect::<Vec<_>>(), [("text", "`lower-third` preset"), ("text", "no preset")]);
    }

    #[test]
    fn supported_camera_motion_has_empty_coverage() {
        let entries = report_at(r#"{"scenes":[{"image":"a.png","durationSec":2,"movement":"Slow Zoom In","transition":"cut"}]}"#, 0);
        assert_eq!(entries, []);
    }

    #[test]
    fn unknown_effects_remain_reported() {
        let entries = report_at(r#"{"scenes":[],"effects":[{"effect":"unknown","startSec":0,"durationSec":1}]}"#, 0);
        assert_eq!(entries, [Entry { kind: "effect".into(), path: "effects[0]".into(), reason: "`unknown` effect".into() }]);
    }

    #[test]
    fn supported_effects_do_not_hide_unknown_media() {
        for kind in ["fade_in", "fade_out", "zoom_out_from_black", "flash", "zoom_punch", "whip_pan"] {
            let json = format!(
                r#"{{"scenes":[],"videoOverlays":[{{"url":"a.png","kind":"future-video","durationSec":1}}],"effects":[{{"effect":"{kind}","durationSec":1}}]}}"#
            );
            let entries = report_at(&json, 0);
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].reason, "`future-video` media");
        }
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
