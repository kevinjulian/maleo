//! Element boxes at a time: each visible element's layout sampled at the
//! playhead through `maleo-editor-core` keyframes, as a rotated rectangle.
//!
//! A box is drawn as CSS draws the web's clip box: `left/top/width/height` in
//! canvas percent, rotated about its centre in screen pixels (so a rotation on
//! a non-square canvas stays circular) and scaled about its centre.

use maleo_editor_core::schema::EditScope;
use serde_json::Value;

use super::edit::{Layout, Resolved, normalize_layout, resolve, sampled_layout, track_flag};
use super::{Frame, Point, Size, Source, Target, order, rotate};

/// One element on the canvas at a time.
#[derive(Clone, Debug, PartialEq)]
pub struct Element {
    pub target: Target,
    pub resolved: Resolved,
    /// The normalized layout with its animated values at the time.
    pub layout: Layout,
    pub frame: Frame,
    pub scale: f64,
    pub locked: bool,
    pub hidden: bool,
}

/// The element `target` at timeline second `time`, sampled.
pub fn element(scope: &EditScope, target: &Target, time: f64) -> Option<Element> {
    let resolved = resolve(scope, target)?;
    let (sampled, scale) = sampled_layout(resolved.layout.as_ref(), resolved.kind, time - resolved.start);
    let layout = normalize_layout(Some(&sampled), resolved.kind);
    let track = if target.source == Source::Scene { -1.0 } else { resolved.track };
    Some(Element {
        target: target.clone(),
        frame: Frame::of(&layout),
        layout,
        scale,
        locked: track_flag(scope, track, "locked"),
        hidden: track_flag(scope, track, "hidden"),
        resolved,
    })
}

fn live(start: f64, dur: f64, time: f64) -> bool {
    time >= start && time <= start + dur.max(0.0)
}

/// The overlays visible at `time`, bottom to top: image and video overlays by
/// track, then text by track (D6). Hidden tracks are left out.
pub fn overlays_at(scope: &EditScope, time: f64) -> Vec<Element> {
    let mut found: Vec<(u8, f64, Element)> = Vec::new();
    for clip in scope.doc.clips.iter() {
        let (source, family) = if let Some(video) = clip.payload("video") {
            (Source::Video, video)
        } else if let Some(text) = clip.payload("text") {
            (Source::Text, text)
        } else {
            continue;
        };
        let Some(id) = family.get("id").and_then(Value::as_f64) else { continue };
        if !live(clip.start_sec, clip.duration_sec, time) || track_flag(scope, clip.track, "hidden") {
            continue;
        }
        if let Some(element) = element(scope, &Target::new(source, id), time) {
            found.push((u8::from(source == Source::Text), clip.track, element));
        }
    }
    // Stable: within a kind and track, a later clip stacks above an earlier one.
    // Text sorts after every track (tracks stay far below 1e9).
    let keys: Vec<f64> = found.iter().map(|(text, track, _)| f64::from(*text) * 1e9 + track).collect();
    order(&keys).into_iter().map(|i| found[i].2.clone()).collect()
}

/// `sceneAtTime`: the scene covering `time`; with overlapping scenes the latest
/// start or the higher track wins.
pub fn base_scene_at(scope: &EditScope, time: f64) -> Option<f64> {
    let mut best: Option<(f64, f64, f64)> = None;
    for clip in scope.doc.clips.iter() {
        let Some(scene) = clip.payload("scene") else { continue };
        let Some(id) = scene.get("id").and_then(Value::as_f64) else { continue };
        let (start, dur) = (clip.start_sec, clip.duration_sec.max(1.0));
        let wins = best.is_none_or(|(_, best_start, best_track)| start >= best_start || clip.track > best_track);
        if time >= start && time < start + dur && wins {
            best = Some((id, start, clip.track));
        }
    }
    best.map(|(id, _, _)| id)
}

/// A frame's centre in canvas pixels.
pub fn center_px(frame: Frame, canvas: Size) -> Point {
    let c = frame.center();
    Point { x: c.x * canvas.w / 100.0, y: c.y * canvas.h / 100.0 }
}

/// A canvas-percent point in the box's own unscaled pixel frame, origin at its
/// top-left corner before rotation and scale.
pub fn to_local(frame: Frame, scale: f64, canvas: Size, point: Point) -> Point {
    let c = center_px(frame, canvas);
    let d = rotate(Point { x: point.x * canvas.w / 100.0 - c.x, y: point.y * canvas.h / 100.0 - c.y }, -frame.rotation);
    Point { x: d.x / scale + frame.w * canvas.w / 200.0, y: d.y / scale + frame.h * canvas.h / 200.0 }
}

/// A point in the box's local frame back in canvas percent.
pub fn from_local(frame: Frame, scale: f64, canvas: Size, local: Point) -> Point {
    let c = center_px(frame, canvas);
    let d = rotate(Point { x: (local.x - frame.w * canvas.w / 200.0) * scale, y: (local.y - frame.h * canvas.h / 200.0) * scale }, frame.rotation);
    Point { x: (c.x + d.x) / canvas.w * 100.0, y: (c.y + d.y) / canvas.h * 100.0 }
}

/// Whether a canvas-percent point lies inside the rotated, scaled box.
pub fn contains(frame: Frame, scale: f64, canvas: Size, point: Point) -> bool {
    let local = to_local(frame, scale, canvas, point);
    (0.0..=frame.w * canvas.w / 100.0).contains(&local.x) && (0.0..=frame.h * canvas.h / 100.0).contains(&local.y)
}

/// The axis-aligned bounds of a rotated, scaled box in canvas pixels: left, top, right, bottom.
pub fn bounds_px(frame: Frame, scale: f64, canvas: Size) -> [f64; 4] {
    let c = center_px(frame, canvas);
    let (w, h) = (frame.w * canvas.w / 100.0 * scale, frame.h * canvas.h / 100.0 * scale);
    let (sin, cos) = (frame.rotation * std::f64::consts::PI / 180.0).sin_cos();
    let (rw, rh) = ((cos.abs() * w + sin.abs() * h) / 2.0, (sin.abs() * w + cos.abs() * h) / 2.0);
    [c.x - rw, c.y - rh, c.x + rw, c.y + rh]
}

#[cfg(test)]
mod tests {
    use super::*;
    use maleo_editor_core::admit_scope;
    use serde_json::json;

    fn scope(clips: Value, flags: Value) -> EditScope {
        admit_scope(
            &json!({ "mediaAssets": [], "slides": [], "posts": [], "doc": { "schemaVersion": 2, "markers": [], "clips": clips, "trackFlags": flags } })
                .to_string(),
        )
        .expect("admits")
    }

    fn image(id: u32, start: f64, track: f64, layout: Value) -> Value {
        json!({ "id": format!("video:{id}"), "type": "image", "startSec": start, "durationSec": 4, "track": track, "video": { "id": id, "kind": "image", "url": "a.png", "start": start, "dur": 4, "track": track, "layout": layout } })
    }

    #[test]
    fn an_animated_element_moves_under_the_playhead() {
        let layout = json!({ "xPct": 0, "yPct": 0, "widthPct": 20, "heightPct": 20, "fit": "contain", "animation": { "tracks": { "xPct": [{ "t": 0, "v": 10 }, { "t": 2, "v": 50, "easing": "linear" }] } } });
        let s = scope(json!([image(1, 0.0, 0.0, layout)]), json!({}));
        let box_at = |time: f64| element(&s, &Target::new(Source::Video, 1.0), time).expect("element").frame.x;
        assert!((box_at(1.0) - 30.0).abs() < 1e-9);
        assert_eq!(box_at(0.0), 10.0);
        assert_eq!(box_at(3.0), 50.0);
    }

    #[test]
    fn a_scene_keyed_on_its_visual_follows_the_visual() {
        let clip = json!({ "id": "scene:1", "type": "image", "startSec": 2, "durationSec": 4, "track": 0, "scene": { "id": 1, "name": "S", "src": "a.png", "dur": 4,
            "visualClips": [{ "id": "v", "kind": "image", "label": "V", "url": "a.png", "startSec": 0, "durationSec": 4, "primary": true,
                "layout": { "xPct": 0, "yPct": 0, "widthPct": 50, "heightPct": 50, "fit": "cover", "animation": { "tracks": { "yPct": [{ "t": 0, "v": 0 }, { "t": 4, "v": 40 }] } } } }] } });
        let s = scope(json!([clip]), json!({}));
        let e = element(&s, &Target::new(Source::Scene, 1.0), 4.0).expect("scene");
        assert!((e.frame.y - 20.0).abs() < 1e-9, "{:?}", e.frame);
        assert_eq!(e.frame.w, 50.0);
        assert_eq!(base_scene_at(&s, 4.0), Some(1.0));
        assert_eq!(base_scene_at(&s, 7.0), None);
    }

    #[test]
    fn overlays_stack_text_above_images_and_skip_hidden_tracks() {
        let text = json!({ "id": "text:9", "type": "text", "startSec": 0, "durationSec": 4, "track": 0, "text": { "id": 9, "content": "T", "start": 0, "dur": 4, "track": 0 } });
        let s = scope(
            json!([text, image(1, 0.0, 2.0, json!({})), image(2, 0.0, 1.0, json!({})), image(3, 0.0, 3.0, json!({}))]),
            json!({ "3": { "hidden": true } }),
        );
        let order: Vec<f64> = overlays_at(&s, 1.0).iter().map(|e| e.target.id).collect();
        assert_eq!(order, vec![2.0, 1.0, 9.0]);
    }

    #[test]
    fn a_rotated_box_contains_its_corners_not_its_bounds() {
        let frame = Frame { x: 40.0, y: 40.0, w: 20.0, h: 20.0, rotation: 45.0, aspect_locked: false };
        let canvas = Size { w: 100.0, h: 100.0 };
        assert!(contains(frame, 1.0, canvas, Point { x: 50.0, y: 50.0 }));
        assert!(!contains(frame, 1.0, canvas, Point { x: 41.0, y: 41.0 }));
        let back = from_local(frame, 1.0, canvas, to_local(frame, 1.0, canvas, Point { x: 47.0, y: 52.0 }));
        assert!((back.x - 47.0).abs() < 1e-9 && (back.y - 52.0).abs() < 1e-9);
        let b = bounds_px(frame, 1.0, canvas);
        assert!((b[2] - b[0] - 20.0 * std::f64::consts::SQRT_2).abs() < 1e-9);
    }
}
