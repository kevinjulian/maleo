//! The mask-edit box: a port of `maskCanvasLayout` and `maskFromCanvas`.
//!
//! A mask is local to its element's box (percent of the box, rotated with
//! it). The edit box is that region in canvas space, so the ordinary move,
//! resize and rotate gestures can run on it; the result maps back to a mask.

use serde_json::{Map, Value};

use super::{Frame, Size, clamp, num};

/// The mask fields a box edits.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MaskRegion {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub rotation: f64,
}

impl MaskRegion {
    pub fn of(mask: &Value) -> Option<Self> {
        let read = |key: &str| mask.get(key).and_then(Value::as_f64);
        Some(Self { x: read("xPct")?, y: read("yPct")?, w: read("widthPct")?, h: read("heightPct")?, rotation: read("rotationDeg")? })
    }

    /// The mask with these fields written over it (`{ ...mask, ... }`).
    pub fn write(self, mask: &Value) -> Value {
        let mut out: Map<String, Value> = mask.as_object().cloned().unwrap_or_default();
        for (key, value) in [("xPct", self.x), ("yPct", self.y), ("widthPct", self.w), ("heightPct", self.h), ("rotationDeg", self.rotation)] {
            out.insert(key.to_owned(), num(value));
        }
        Value::Object(out)
    }
}

/// `maskCanvasLayout`: the mask region as a canvas box, for an element drawn at `scale`.
pub fn mask_box(layout: Frame, mask: MaskRegion, canvas: Size, scale: f64) -> Frame {
    let w = layout.w * canvas.w / 100.0;
    let h = layout.h * canvas.h / 100.0;
    let angle = layout.rotation * std::f64::consts::PI / 180.0;
    let dx = ((mask.x + mask.w / 2.0) / 100.0 - 0.5) * w * scale;
    let dy = ((mask.y + mask.h / 2.0) / 100.0 - 0.5) * h * scale;
    let cx = (layout.x + layout.w / 2.0) * canvas.w / 100.0 + angle.cos() * dx - angle.sin() * dy;
    let cy = (layout.y + layout.h / 2.0) * canvas.h / 100.0 + angle.sin() * dx + angle.cos() * dy;
    let width = layout.w * mask.w / 100.0 * scale;
    let height = layout.h * mask.h / 100.0 * scale;
    Frame {
        x: cx / canvas.w * 100.0 - width / 2.0,
        y: cy / canvas.h * 100.0 - height / 2.0,
        w: width,
        h: height,
        rotation: layout.rotation + mask.rotation,
        aspect_locked: false,
    }
}

/// `maskFromCanvas`: a canvas box back as the mask region it draws, kept inside the element.
pub fn mask_from_box(layout: Frame, region: Frame, canvas: Size, scale: f64) -> MaskRegion {
    let dx = (region.x + region.w / 2.0 - layout.x - layout.w / 2.0) * canvas.w / 100.0;
    let dy = (region.y + region.h / 2.0 - layout.y - layout.h / 2.0) * canvas.h / 100.0;
    let angle = layout.rotation * std::f64::consts::PI / 180.0;
    let cx = 50.0 + (angle.cos() * dx + angle.sin() * dy) / (layout.w * canvas.w / 100.0 * scale) * 100.0;
    let cy = 50.0 + (-angle.sin() * dx + angle.cos() * dy) / (layout.h * canvas.h / 100.0 * scale) * 100.0;
    let width = clamp(region.w / layout.w / scale * 100.0, 0.01, 100.0);
    let height = clamp(region.h / layout.h / scale * 100.0, 0.01, 100.0);
    MaskRegion {
        x: clamp(cx - width / 2.0, 0.0, 100.0 - width),
        y: clamp(cy - height / 2.0, 0.0, 100.0 - height),
        w: width,
        h: height,
        rotation: (((region.rotation - layout.rotation + 180.0) % 360.0) + 360.0) % 360.0 - 180.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mask_round_trips_through_its_box() {
        let layout = Frame { x: 10.0, y: 20.0, w: 40.0, h: 60.0, rotation: 75.0, aspect_locked: false };
        let mask = MaskRegion { x: 20.0, y: 30.0, w: 40.0, h: 50.0, rotation: 30.0 };
        let canvas = Size { w: 800.0, h: 450.0 };
        let back = mask_from_box(layout, mask_box(layout, mask, canvas, 1.7), canvas, 1.7);
        for (a, b) in [(back.x, mask.x), (back.y, mask.y), (back.w, mask.w), (back.h, mask.h), (back.rotation, mask.rotation)] {
            assert!((a - b).abs() < 1e-8, "{back:?}");
        }
        let wide = Frame { x: 200.0, w: 500.0, ..mask_box(layout, mask, canvas, 1.7) };
        let clamped = mask_from_box(layout, wide, canvas, 1.7);
        assert_eq!((clamped.x, clamped.w), (0.0, 100.0));
    }
}
