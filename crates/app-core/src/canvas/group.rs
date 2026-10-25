//! The group transform for a multi-selection (D5), in canvas pixels so a
//! non-square canvas does not skew it.
//!
//! The group box is the axis-aligned bounds of the members' rotated boxes.
//! Move adds one offset to every member. Resize scales every member's centre
//! and size by one factor about the opposite corner, limited so no member
//! leaves the 2..200 percent size range; a rotated member keeps its shape.
//! Rotate turns every centre about the group centre and adds the angle to
//! each member's rotation. Pinch and twist are a resize and a rotate about the
//! group centre.

use maleo_editor_core::keyframes::{js_max, js_min, js_round};

use super::geometry::{bounds_px, center_px};
use super::gesture::{Corner, factor_limits, snap_axis};
use super::{Frame, Guides, Patch, Point, Size, clamp, rotate, wrap_degrees};

/// A member's box as the group reads it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Member {
    pub frame: Frame,
    pub scale: f64,
}

/// The group box in canvas percent (rotation 0).
pub fn group_frame(members: &[Member], canvas: Size) -> Frame {
    let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for m in members {
        let [l, t, r, bottom] = bounds_px(m.frame, m.scale, canvas);
        b = [b[0].min(l), b[1].min(t), b[2].max(r), b[3].max(bottom)];
    }
    Frame {
        x: b[0] / canvas.w * 100.0,
        y: b[1] / canvas.h * 100.0,
        w: (b[2] - b[0]) / canvas.w * 100.0,
        h: (b[3] - b[1]) / canvas.h * 100.0,
        rotation: 0.0,
        aspect_locked: true,
    }
}

/// Every member moved by `(dx, dy)` canvas pixels, the group box snapped.
pub fn group_move(members: &[Member], dx: f64, dy: f64, canvas: Size, alt: bool) -> (Vec<Patch>, Guides, Point) {
    let g = group_frame(members, canvas);
    let (raw_x, raw_y) = (g.x + dx / canvas.w * 100.0, g.y + dy / canvas.h * 100.0);
    let (x, gx) = if alt { (raw_x, None) } else { snap_axis(raw_x, g.w) };
    let (y, gy) = if alt { (raw_y, None) } else { snap_axis(raw_y, g.h) };
    let offset = Point { x: x - g.x, y: y - g.y };
    let patches = members
        .iter()
        .map(|m| Patch { x: Some(clamp(m.frame.x + offset.x, -50.0, 150.0)), y: Some(clamp(m.frame.y + offset.y, -50.0, 150.0)), ..Patch::default() })
        .collect();
    (patches, Guides { x: gx, y: gy }, offset)
}

/// The factor range that keeps every member's size within limits.
fn limits(members: &[Member]) -> (f64, f64) {
    members.iter().fold((f64::NEG_INFINITY, f64::INFINITY), |(lo, hi), m| {
        let (a, b) = factor_limits(m.frame.w, m.frame.h);
        (js_max(lo, a), js_min(hi, b))
    })
}

/// Every member scaled by `factor` about the canvas-pixel `anchor`.
fn scaled(members: &[Member], anchor: Point, factor: f64, canvas: Size) -> Vec<Patch> {
    members
        .iter()
        .map(|m| {
            let c = center_px(m.frame, canvas);
            let next = Point { x: anchor.x + (c.x - anchor.x) * factor, y: anchor.y + (c.y - anchor.y) * factor };
            let (w, h) = (m.frame.w * factor, m.frame.h * factor);
            Patch { x: Some(next.x / canvas.w * 100.0 - w / 2.0), y: Some(next.y / canvas.h * 100.0 - h / 2.0), w: Some(w), h: Some(h), rotation: None }
        })
        .collect()
}

/// The factor snapped so the group width lands on the 5 percent grid.
fn snapped_factor(factor: f64, group_w: f64, (lo, hi): (f64, f64)) -> f64 {
    clamp(js_round(group_w * factor / 5.0) * 5.0 / group_w, lo, hi)
}

/// A corner drag on the group box: one factor about the opposite corner.
pub fn group_resize(members: &[Member], corner: Corner, dx: f64, dy: f64, canvas: Size, alt: bool) -> (Vec<Patch>, f64) {
    let g = group_frame(members, canvas);
    let (w, h) = (g.w * canvas.w / 100.0, g.h * canvas.h / 100.0);
    let (sx, sy) = corner.signs();
    let range = limits(members);
    let mut factor = clamp(1.0 + (w * sx * dx + h * sy * dy) / (w * w + h * h), range.0, range.1);
    if !alt {
        factor = snapped_factor(factor, g.w, range);
    }
    let anchor = Point { x: (g.x + if sx > 0.0 { 0.0 } else { g.w }) * canvas.w / 100.0, y: (g.y + if sy > 0.0 { 0.0 } else { g.h }) * canvas.h / 100.0 };
    (scaled(members, anchor, factor, canvas), factor)
}

/// Every member turned `angle` degrees about the canvas-pixel `pivot`.
fn turned(members: &[Member], pivot: Point, angle: f64, canvas: Size) -> Vec<Patch> {
    members
        .iter()
        .map(|m| {
            let c = center_px(m.frame, canvas);
            let d = rotate(Point { x: c.x - pivot.x, y: c.y - pivot.y }, angle);
            Patch {
                x: Some((pivot.x + d.x) / canvas.w * 100.0 - m.frame.w / 2.0),
                y: Some((pivot.y + d.y) / canvas.h * 100.0 - m.frame.h / 2.0),
                rotation: Some(wrap_degrees(m.frame.rotation + angle)),
                ..Patch::default()
            }
        })
        .collect()
}

fn group_center(members: &[Member], canvas: Size) -> Point {
    center_px(group_frame(members, canvas), canvas)
}

/// A rotate drag on the group box from `start` to `at` (canvas pixels).
pub fn group_rotate(members: &[Member], start: Point, at: Point, canvas: Size, alt: bool) -> (Vec<Patch>, f64) {
    let c = group_center(members, canvas);
    let delta = (at.y - c.y).atan2(at.x - c.x) - (start.y - c.y).atan2(start.x - c.x);
    let mut angle = delta.sin().atan2(delta.cos()) * 180.0 / std::f64::consts::PI;
    if !alt {
        angle = js_round(angle / 15.0) * 15.0;
    }
    (turned(members, c, angle, canvas), angle)
}

/// Pinch and twist: `factor` and `angle` about the group centre, under the
/// resize limits and snapping and the rotate snapping.
pub fn group_pinch(members: &[Member], factor: f64, angle: f64, canvas: Size, alt: bool) -> (Vec<Patch>, f64, f64) {
    let g = group_frame(members, canvas);
    let c = center_px(g, canvas);
    let range = limits(members);
    let mut factor = clamp(factor, range.0, range.1);
    let mut angle = angle;
    if !alt {
        factor = snapped_factor(factor, g.w, range);
        angle = js_round(angle / 15.0) * 15.0;
    }
    let sized = scaled(members, c, factor, canvas);
    let moved: Vec<Member> = members.iter().zip(&sized).map(|(m, p)| Member { frame: m.frame.with(p), scale: m.scale }).collect();
    let patches = turned(&moved, c, angle, canvas).into_iter().zip(sized).map(|(t, s)| Patch { w: s.w, h: s.h, ..t }).collect();
    (patches, factor, angle)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WIDE: Size = Size { w: 1600.0, h: 900.0 };

    fn member(x: f64, y: f64, w: f64, h: f64) -> Member {
        Member { frame: Frame { x, y, w, h, rotation: 0.0, aspect_locked: false }, scale: 1.0 }
    }

    #[test]
    fn a_group_move_moves_every_member_alike() {
        let members = [member(10.0, 10.0, 10.0, 10.0), member(30.0, 40.0, 10.0, 10.0)];
        let (patches, _, offset) = group_move(&members, 160.0, 0.0, WIDE, true);
        assert!((offset.x - 10.0).abs() < 1e-9);
        assert_eq!((patches[0].x, patches[1].x), (Some(20.0), Some(40.0)));
    }

    #[test]
    fn a_group_rotation_turns_centres_about_the_group_centre() {
        // On a 16:9 canvas the turn is in pixels: the group spans (160, 90)..(640, 450).
        let members = [member(10.0, 10.0, 10.0, 10.0), member(30.0, 40.0, 10.0, 10.0)];
        let (patches, angle) = group_rotate(&members, Point { x: 500.0, y: 270.0 }, Point { x: 400.0, y: 370.0 }, WIDE, false);
        assert_eq!(angle, 90.0);
        let centre = |p: &Patch| Point { x: (p.x.expect("x") + 5.0) * 16.0, y: (p.y.expect("y") + 5.0) * 9.0 };
        let (a, b) = (centre(&patches[0]), centre(&patches[1]));
        // (240, 135) turns to (535, 110); (560, 405) turns to (265, 430).
        assert!((a.x - 535.0).abs() < 1e-9 && (a.y - 110.0).abs() < 1e-9, "{a:?}");
        assert!((b.x - 265.0).abs() < 1e-9 && (b.y - 430.0).abs() < 1e-9, "{b:?}");
        assert!(patches.iter().all(|p| p.rotation == Some(90.0)));
    }

    #[test]
    fn a_group_resize_is_one_factor_about_the_opposite_corner_within_every_limit() {
        let members = [member(10.0, 10.0, 10.0, 10.0), member(30.0, 40.0, 100.0, 10.0)];
        let (_, factor) = group_resize(&members, Corner::Se, 10000.0, 10000.0, WIDE, true);
        assert!((factor - 2.0).abs() < 1e-12, "the 100-wide member caps the factor at 2");
        let (patches, factor) = group_resize(&members[..1], Corner::Se, 160.0, 90.0, WIDE, true);
        assert!((factor - 2.0).abs() < 1e-9);
        // The nw corner (10, 10) stays put.
        assert!((patches[0].x.expect("x") - 10.0).abs() < 1e-9 && (patches[0].w.expect("w") - 20.0).abs() < 1e-9);
    }
}
