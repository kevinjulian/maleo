//! Hit testing (D6): a handle of the selection box first, then the selection
//! box itself, then elements top-down by the rotated box at the playhead,
//! the base scene last. Elements on hidden or locked tracks are not picked.
//!
//! Handles are placed as the web's stylesheet places them: squares of
//! `handle_size` inside the box corners (outside them for a coarse pointer),
//! the rotate handle at the top centre (at the right middle for a mask box),
//! all scaled with the box.

use maleo_editor_core::schema::EditScope;

use super::edit::track_flag;
use super::geometry::{base_scene_at, contains, from_local, overlays_at, to_local};
use super::gesture::{Corner, Mode};
use super::view::View;
use super::{Frame, Point, Source, Target};

/// The box a selection is edited through.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SelectionBox {
    pub frame: Frame,
    pub scale: f64,
    /// A mask box: its rotate handle sits at the right middle.
    pub local: bool,
    pub locked: bool,
}

/// What a point lands on.
#[derive(Clone, Debug, PartialEq)]
pub enum Hit {
    Handle(Mode),
    /// Inside the selection box, away from its handles.
    Inside,
    Element(Target),
    Scene(f64),
    /// On the canvas, over nothing pickable.
    Empty,
    /// Off the canvas.
    Outside,
}

/// Handle centres in the box's unscaled local pixels, topmost first (the DOM order reversed).
pub fn handle_centers(frame: Frame, view: &View, local: bool) -> [(Mode, Point); 5] {
    let canvas = view.canvas_size();
    let (w, h) = (frame.w * canvas.w / 100.0, frame.h * canvas.h / 100.0);
    let half = view.handle_size / 2.0;
    let inset = if view.handles_outside { -half } else { half };
    let corner = |c: Corner| {
        let (sx, sy) = c.signs();
        let x = if sx > 0.0 { w - inset } else { inset };
        let y = if sy > 0.0 { h - inset } else { inset };
        (Mode::Resize(c), Point { x, y })
    };
    let rotate = if local { Point { x: w + half, y: h / 2.0 } } else { Point { x: w / 2.0, y: half } };
    [(Mode::Rotate, rotate), corner(Corner::Se), corner(Corner::Sw), corner(Corner::Ne), corner(Corner::Nw)]
}

/// Handle centres in canvas percent, for drawing.
pub fn handle_points(selection: &SelectionBox, view: &View) -> Vec<(Mode, Point)> {
    let canvas = view.canvas_size();
    handle_centers(selection.frame, view, selection.local)
        .into_iter()
        .map(|(mode, local)| (mode, from_local(selection.frame, selection.scale, canvas, local)))
        .collect()
}

fn pick_selection(selection: &SelectionBox, view: &View, point: Point) -> Option<Hit> {
    let canvas = view.canvas_size();
    let local = to_local(selection.frame, selection.scale, canvas, point);
    let half = view.handle_size / 2.0;
    if !selection.locked {
        for (mode, center) in handle_centers(selection.frame, view, selection.local) {
            if (local.x - center.x).abs() <= half && (local.y - center.y).abs() <= half {
                return Some(Hit::Handle(mode));
            }
        }
    }
    contains(selection.frame, selection.scale, canvas, point).then_some(Hit::Inside)
}

/// The topmost pickable overlay under `point`, ignoring any selection.
pub fn pick_element(scope: &EditScope, view: &View, time: f64, point: Point) -> Option<Target> {
    let canvas = view.canvas_size();
    overlays_at(scope, time).into_iter().rev().find(|e| !e.locked && contains(e.frame, e.scale, canvas, point)).map(|e| e.target)
}

/// What `point` (canvas percent) lands on at `time`.
pub fn pick(scope: &EditScope, view: &View, selection: Option<&SelectionBox>, time: f64, point: Point) -> Hit {
    if let Some(hit) = selection.and_then(|selection| pick_selection(selection, view, point)) {
        return hit;
    }
    if let Some(target) = pick_element(scope, view, time, point) {
        return Hit::Element(target);
    }
    let on_canvas = (0.0..=100.0).contains(&point.x) && (0.0..=100.0).contains(&point.y);
    if !on_canvas {
        return Hit::Outside;
    }
    match base_scene_at(scope, time) {
        Some(id) if !track_flag(scope, -1.0, "locked") => Hit::Scene(id),
        _ => Hit::Empty,
    }
}

/// The element a shift-click toggles: the topmost overlay, else the base scene.
pub fn pick_toggle(scope: &EditScope, view: &View, time: f64, point: Point) -> Option<Target> {
    match pick(scope, view, None, time, point) {
        Hit::Element(target) => Some(target),
        Hit::Scene(id) => Some(Target::new(Source::Scene, id)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use maleo_editor_core::admit_scope;
    use serde_json::{Value, json};

    fn view() -> View {
        View::from_value(&json!({ "area": { "x": 0, "y": 0, "width": 1000, "height": 500 }, "aspect": 2 })).expect("view")
    }

    fn scope(clips: Value, flags: Value) -> EditScope {
        admit_scope(
            &json!({ "mediaAssets": [], "slides": [], "posts": [], "doc": { "schemaVersion": 2, "markers": [], "clips": clips, "trackFlags": flags } })
                .to_string(),
        )
        .expect("admits")
    }

    fn image(id: u32, track: f64, layout: Value) -> Value {
        json!({ "id": format!("video:{id}"), "type": "image", "startSec": 0, "durationSec": 4, "track": track, "video": { "id": id, "kind": "image", "url": "a.png", "start": 0, "dur": 4, "track": track, "layout": layout } })
    }

    fn scene() -> Value {
        json!({ "id": "scene:1", "type": "image", "startSec": 0, "durationSec": 4, "track": 0, "scene": { "id": 1, "name": "S", "src": "s.png", "dur": 4 } })
    }

    #[test]
    fn a_rotated_element_is_not_picked_inside_its_bounds_but_outside_its_box() {
        let s = scope(json!([scene(), image(2, 1.0, json!({ "xPct": 40, "yPct": 30, "widthPct": 20, "heightPct": 40, "rotationDeg": 45 }))]), json!({}));
        // The box is a 200 px square rotated 45 degrees about (500, 250); (410, 160) is in its bounds, not in it.
        assert_eq!(pick(&s, &view(), None, 1.0, Point { x: 41.0, y: 32.0 }), Hit::Scene(1.0));
        assert_eq!(pick(&s, &view(), None, 1.0, Point { x: 50.0, y: 50.0 }), Hit::Element(Target::new(Source::Video, 2.0)));
    }

    #[test]
    fn text_stacks_above_an_image() {
        let text = json!({ "id": "text:5", "type": "text", "startSec": 0, "durationSec": 4, "track": 0, "text": { "id": 5, "content": "T", "start": 0, "dur": 4, "track": 0, "layout": { "xPct": 0, "yPct": 0, "widthPct": 100, "heightPct": 100 } } });
        let s = scope(json!([text, image(2, 3.0, json!({}))]), json!({}));
        assert_eq!(pick(&s, &view(), None, 1.0, Point { x: 50.0, y: 50.0 }), Hit::Element(Target::new(Source::Text, 5.0)));
    }

    #[test]
    fn a_locked_track_falls_through_to_the_scene_or_nothing() {
        let s = scope(json!([scene(), image(2, 1.0, json!({}))]), json!({ "1": { "locked": true } }));
        assert_eq!(pick(&s, &view(), None, 1.0, Point { x: 50.0, y: 50.0 }), Hit::Scene(1.0));
        let all = scope(json!([scene(), image(2, 1.0, json!({}))]), json!({ "1": { "locked": true }, "-1": { "locked": true } }));
        assert_eq!(pick(&all, &view(), None, 1.0, Point { x: 50.0, y: 50.0 }), Hit::Empty);
        assert_eq!(pick(&all, &view(), None, 1.0, Point { x: 50.0, y: -5.0 }), Hit::Outside);
    }

    #[test]
    fn a_handle_of_the_selection_wins_over_the_element_under_it() {
        let s = scope(
            json!([
                image(2, 1.0, json!({ "xPct": 0, "yPct": 0, "widthPct": 100, "heightPct": 100 })),
                image(3, 2.0, json!({ "xPct": 40, "yPct": 40, "widthPct": 20, "heightPct": 20 }))
            ]),
            json!({}),
        );
        let selected =
            SelectionBox { frame: Frame { x: 40.0, y: 40.0, w: 20.0, h: 20.0, rotation: 0.0, aspect_locked: false }, scale: 1.0, local: false, locked: false };
        // The se handle's centre is 12 px inside the box's bottom-right corner (600, 300).
        let se = Point { x: (600.0 - 12.0) / 10.0, y: (300.0 - 12.0) / 5.0 };
        assert_eq!(pick(&s, &view(), Some(&selected), 1.0, se), Hit::Handle(Mode::Resize(Corner::Se)));
        assert_eq!(pick(&s, &view(), Some(&selected), 1.0, Point { x: 50.0, y: 50.0 }), Hit::Inside);
        assert_eq!(pick(&s, &view(), Some(&selected), 1.0, Point { x: 10.0, y: 10.0 }), Hit::Element(Target::new(Source::Video, 2.0)));
        let rotate = Point { x: 50.0, y: (200.0 + 12.0) / 5.0 };
        assert_eq!(pick(&s, &view(), Some(&selected), 1.0, rotate), Hit::Handle(Mode::Rotate));
        let locked = SelectionBox { locked: true, ..selected };
        assert_eq!(pick(&s, &view(), Some(&locked), 1.0, se), Hit::Inside);
    }
}
