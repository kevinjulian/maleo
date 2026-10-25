//! Gesture math on one box: move with anchor and grid snapping, rotate in 15
//! degree steps, corner resize in the box's own pixel axes, and the arrow-key
//! nudge. Ports of `movePatch`, `rotatePatch`, `cornerPatch` (over
//! `resizeCanvasLayout`) and `nudgePatch` in `clip-box.tsx`.
//!
//! Without alt, a box edge or centre within 2 percent of a canvas edge or
//! centre snaps to it and reports the guide; otherwise the position falls to a
//! 5 percent grid. Alt turns both off.

use maleo_editor_core::keyframes::{js_max, js_min, js_round};

use super::{Frame, Guides, Patch, Point, Size, clamp, wrap_degrees};

const SNAP_ANCHORS: [f64; 3] = [0.0, 50.0, 100.0];
const SNAP_THRESHOLD: f64 = 2.0;
const SNAP_GRID: f64 = 5.0;

/// A corner handle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Corner {
    Nw,
    Ne,
    Sw,
    Se,
}

impl Corner {
    pub const ALL: [Self; 4] = [Self::Nw, Self::Ne, Self::Sw, Self::Se];

    pub fn name(self) -> &'static str {
        match self {
            Self::Nw => "nw",
            Self::Ne => "ne",
            Self::Sw => "sw",
            Self::Se => "se",
        }
    }

    /// `+1` toward the right or bottom edge the corner sits on.
    pub fn signs(self) -> (f64, f64) {
        match self {
            Self::Nw => (-1.0, -1.0),
            Self::Ne => (1.0, -1.0),
            Self::Sw => (-1.0, 1.0),
            Self::Se => (1.0, 1.0),
        }
    }
}

/// What a handle does: `TransformMode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Move,
    Rotate,
    Resize(Corner),
}

impl Mode {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "move" => Some(Self::Move),
            "rotate" => Some(Self::Rotate),
            other => Corner::ALL.into_iter().find(|c| c.name() == other).map(Self::Resize),
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Move => "move",
            Self::Rotate => "rotate",
            Self::Resize(corner) => corner.name(),
        }
    }
}

fn snap_to_grid(v: f64) -> f64 {
    js_round(v / SNAP_GRID) * SNAP_GRID
}

/// `snapAxis(pos, size)`: the leading position snapped, and the anchor that fired.
pub fn snap_axis(pos: f64, size: f64) -> (f64, Option<f64>) {
    let mut best: Option<(f64, f64)> = None;
    for edge in [pos, pos + size / 2.0, pos + size] {
        for anchor in SNAP_ANCHORS {
            let delta = anchor - edge;
            if delta.abs() <= SNAP_THRESHOLD && best.is_none_or(|(d, _)| delta.abs() < d.abs()) {
                best = Some((delta, anchor));
            }
        }
    }
    match best {
        Some((delta, anchor)) => (pos + delta, Some(anchor)),
        None => (snap_to_grid(pos), None),
    }
}

/// `movePatch`: a drag by `(dx, dy)` canvas pixels, snapped on the rotated bounds.
pub fn move_patch(init: Frame, dx: f64, dy: f64, canvas: Size, scale: f64, alt: bool) -> (Patch, Guides) {
    let angle = init.rotation * std::f64::consts::PI / 180.0;
    let w = init.w * canvas.w / 100.0 * scale;
    let h = init.h * canvas.h / 100.0 * scale;
    let rw = (angle.cos().abs() * w + angle.sin().abs() * h) / canvas.w * 100.0;
    let rh = (angle.sin().abs() * w + angle.cos().abs() * h) / canvas.h * 100.0;
    let raw_x = init.x + dx / canvas.w * 100.0;
    let raw_y = init.y + dy / canvas.h * 100.0;
    let (ox, oy) = ((init.w - rw) / 2.0, (init.h - rh) / 2.0);
    let (x, gx) = if alt { (raw_x + ox, None) } else { snap_axis(raw_x + ox, rw) };
    let (y, gy) = if alt { (raw_y + oy, None) } else { snap_axis(raw_y + oy, rh) };
    (Patch { x: Some(clamp(x - ox, -50.0, 150.0)), y: Some(clamp(y - oy, -50.0, 150.0)), ..Patch::default() }, Guides { x: gx, y: gy })
}

/// `rotatePatch`: a turn about the box centre from `start` to `at`, both in
/// canvas pixels from the canvas's top-left corner.
pub fn rotate_patch(init: Frame, canvas: Size, start: Point, at: Point, alt: bool) -> Patch {
    let cx = (init.x + init.w / 2.0) / 100.0 * canvas.w;
    let cy = (init.y + init.h / 2.0) / 100.0 * canvas.h;
    let delta = (at.y - cy).atan2(at.x - cx) - (start.y - cy).atan2(start.x - cx);
    let mut rotation = init.rotation + delta.sin().atan2(delta.cos()) * 180.0 / std::f64::consts::PI;
    if !alt {
        rotation = js_round(rotation / 15.0) * 15.0;
    }
    Patch { rotation: Some(wrap_degrees(rotation)), ..Patch::default() }
}

/// The factor bounds that keep both sides within 2..200 percent.
pub fn factor_limits(w: f64, h: f64) -> (f64, f64) {
    (js_max(2.0 / w, 2.0 / h), js_min(200.0 / w, 200.0 / h))
}

/// `resizeCanvasLayout`: a corner drag in the box's own pixel axes, so a
/// rotated resize stays accurate on a non-square canvas.
#[allow(clippy::too_many_arguments)]
pub fn resize_canvas_layout(init: Frame, corner: Corner, dx: f64, dy: f64, canvas: Size, lock: bool, snap: bool, scale: f64) -> Patch {
    let angle = init.rotation * std::f64::consts::PI / 180.0;
    let (cos, sin) = (angle.cos(), angle.sin());
    let (sx, sy) = corner.signs();
    let w = init.w * canvas.w / 100.0;
    let h = init.h * canvas.h / 100.0;
    let dw = sx * (cos * dx + sin * dy) / scale;
    let dh = sy * (-sin * dx + cos * dy) / scale;
    let (lo, hi) = factor_limits(init.w, init.h);
    let (mut nw, mut nh) = if lock {
        let factor = clamp(1.0 + (w * dw + h * dh) / (w * w + h * h), lo, hi);
        (w * factor, h * factor)
    } else {
        (clamp(w + dw, canvas.w * 0.02, canvas.w * 2.0), clamp(h + dh, canvas.h * 0.02, canvas.h * 2.0))
    };
    if snap {
        if lock {
            let factor = clamp(js_round(nw / canvas.w * 20.0) * canvas.w / 20.0 / w, lo, hi);
            nw = w * factor;
            nh = h * factor;
        } else {
            nw = clamp(js_round(nw / canvas.w * 20.0) * canvas.w / 20.0, canvas.w * 0.02, canvas.w * 2.0);
            nh = clamp(js_round(nh / canvas.h * 20.0) * canvas.h / 20.0, canvas.h * 0.02, canvas.h * 2.0);
        }
    }
    let cx = scale * (cos * sx * (nw - w) / 2.0 - sin * sy * (nh - h) / 2.0);
    let cy = scale * (sin * sx * (nw - w) / 2.0 + cos * sy * (nh - h) / 2.0);
    Patch {
        x: Some(init.x + (cx - (nw - w) / 2.0) / canvas.w * 100.0),
        y: Some(init.y + (cy - (nh - h) / 2.0) / canvas.h * 100.0),
        w: Some(nw / canvas.w * 100.0),
        h: Some(nh / canvas.h * 100.0),
        rotation: None,
    }
}

/// The anchor an edge sits within half a percent of, for a resize's guides.
fn edge_guide(pos: f64, size: f64) -> Option<f64> {
    SNAP_ANCHORS.into_iter().find(|a| (a - pos).abs() < 0.5 || (a - pos - size).abs() < 0.5)
}

/// `cornerPatch`: a corner drag; shift or an aspect lock keeps the ratio.
#[allow(clippy::too_many_arguments)]
pub fn corner_patch(init: Frame, corner: Corner, dx: f64, dy: f64, canvas: Size, scale: f64, alt: bool, shift: bool) -> (Patch, Guides) {
    let patch = resize_canvas_layout(init, corner, dx, dy, canvas, init.aspect_locked || shift, !alt, scale);
    let next = init.with(&patch);
    let guides = if alt { Guides::default() } else { Guides { x: edge_guide(next.x, next.w), y: edge_guide(next.y, next.h) } };
    (patch, guides)
}

/// `resizeLayoutValue` on a frame: an aspect-locked size scales both sides.
pub fn resize_value(init: Frame, height_axis: bool, value: f64) -> Patch {
    if !init.aspect_locked {
        return if height_axis { Patch { h: Some(value), ..Patch::default() } } else { Patch { w: Some(value), ..Patch::default() } };
    }
    let (lo, hi) = factor_limits(init.w, init.h);
    let factor = clamp(value / if height_axis { init.h } else { init.w }, lo, hi);
    Patch { w: Some(init.w * factor), h: Some(init.h * factor), ..Patch::default() }
}

/// An arrow key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Arrow {
    Left,
    Right,
    Up,
    Down,
}

impl Arrow {
    pub fn parse(key: &str) -> Option<Self> {
        match key {
            "ArrowLeft" => Some(Self::Left),
            "ArrowRight" => Some(Self::Right),
            "ArrowUp" => Some(Self::Up),
            "ArrowDown" => Some(Self::Down),
            _ => None,
        }
    }

    /// `-1` for left and up, `+1` for right and down; times 10 with shift.
    pub fn delta(self, shift: bool) -> f64 {
        let sign = if matches!(self, Self::Left | Self::Up) { -1.0 } else { 1.0 };
        sign * if shift { 10.0 } else { 1.0 }
    }

    pub fn horizontal(self) -> bool {
        matches!(self, Self::Left | Self::Right)
    }
}

/// `nudgePatch`: one arrow-key step on a handle, under the gesture limits.
pub fn nudge_patch(init: Frame, mode: Mode, key: Arrow, shift: bool) -> Patch {
    let delta = key.delta(shift);
    match mode {
        Mode::Rotate => Patch { rotation: Some(clamp(init.rotation + delta, -180.0, 180.0)), ..Patch::default() },
        Mode::Move if key.horizontal() => Patch { x: Some(clamp(init.x + delta, -50.0, 150.0)), ..Patch::default() },
        Mode::Move => Patch { y: Some(clamp(init.y + delta, -50.0, 150.0)), ..Patch::default() },
        Mode::Resize(_) => {
            let current = if key.horizontal() { init.w } else { init.h };
            resize_value(init, !key.horizontal(), clamp(current + delta, 2.0, 200.0))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CANVAS: Size = Size { w: 800.0, h: 450.0 };

    fn frame(x: f64, y: f64, w: f64, h: f64) -> Frame {
        Frame { x, y, w, h, rotation: 0.0, aspect_locked: false }
    }

    #[test]
    fn a_drag_near_the_centre_snaps_and_shows_the_guide() {
        // Centre 1.5 percent left of the canvas centre: x 28.5 + 20 / 2 width 40 → centre 48.5.
        let (patch, guides) = move_patch(frame(10.0, 20.0, 40.0, 30.0), 18.5 / 100.0 * 800.0, 0.0, CANVAS, 1.0, false);
        assert!((patch.x.expect("x") - 30.0).abs() < 1e-9);
        assert_eq!(guides.x, Some(50.0));
        let (free, none) = move_patch(frame(10.0, 20.0, 40.0, 30.0), 18.5 / 100.0 * 800.0, 0.0, CANVAS, 1.0, true);
        assert!((free.x.expect("x") - 28.5).abs() < 1e-9);
        assert_eq!(none.x, None);
    }

    #[test]
    fn an_aspect_locked_corner_keeps_the_ratio() {
        let init = Frame { aspect_locked: true, ..frame(10.0, 20.0, 40.0, 30.0) };
        let (patch, _) = corner_patch(init, Corner::Se, 37.0, 13.0, CANVAS, 1.0, true, false);
        let (w, h) = (patch.w.expect("w"), patch.h.expect("h"));
        assert!((w / 40.0 - h / 30.0).abs() < 1e-12);
    }

    #[test]
    fn rotation_snaps_to_fifteen_degrees() {
        let patch = rotate_patch(frame(25.0, 25.0, 50.0, 50.0), Size { w: 100.0, h: 100.0 }, Point { x: 100.0, y: 50.0 }, Point { x: 50.0, y: 98.0 }, false);
        assert_eq!(patch.rotation, Some(90.0));
    }

    #[test]
    fn a_nudge_moves_one_percent_or_ten_with_shift() {
        let init = frame(20.0, 20.0, 40.0, 30.0);
        assert_eq!(nudge_patch(init, Mode::Move, Arrow::Right, false).x, Some(21.0));
        assert_eq!(nudge_patch(init, Mode::Move, Arrow::Up, true).y, Some(10.0));
        assert_eq!(nudge_patch(init, Mode::Rotate, Arrow::Left, false).rotation, Some(-1.0));
        assert_eq!(nudge_patch(init, Mode::Resize(Corner::Se), Arrow::Down, false).h, Some(31.0));
        assert_eq!(nudge_patch(frame(149.5, 0.0, 10.0, 10.0), Mode::Move, Arrow::Right, true).x, Some(150.0));
    }
}
