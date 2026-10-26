//! Clip-local SVG mask geometry in physical pixels, before outer transforms.

use crate::storyboard::{ClipMask, MaskShape};
use vello::kurbo::{Affine, BezPath, Ellipse, Rect, Shape};

fn shape_rect(rect: Rect, mask: ClipMask) -> Rect {
    let x = rect.x0 + rect.width() * mask.x_pct / 100.0;
    let y = rect.y0 + rect.height() * mask.y_pct / 100.0;
    Rect::new(x, y, x + rect.width() * mask.width_pct / 100.0, y + rect.height() * mask.height_pct / 100.0)
}

fn rotation(shape: Rect, mask: ClipMask) -> Affine {
    let center = shape.center().to_vec2();
    Affine::translate(center) * Affine::rotate(mask.rotation_deg.to_radians()) * Affine::translate(-center)
}

pub fn path(rect: Rect, mask: ClipMask) -> BezPath {
    let shape = shape_rect(rect, mask);
    let mut path = match mask.shape {
        MaskShape::Rectangle => shape.to_path(0.01),
        MaskShape::Ellipse => Ellipse::from_rect(shape).to_path(0.01),
    };
    path.apply_affine(rotation(shape, mask));
    if mask.inverted {
        path.extend(rect.path_elements(0.01));
    }
    path
}

/// SVG filter region is -100%..200% of the unrotated shape, then rotated.
pub fn filter_clip(rect: Rect, mask: ClipMask) -> BezPath {
    let shape = shape_rect(rect, mask);
    let mut path = shape.inflate(shape.width(), shape.height()).to_path(0.01);
    path.apply_affine(rotation(shape, mask));
    path
}

pub fn feather_bounds(path: &BezPath, sigma: f64) -> Rect {
    let bounds = path.bounding_box().inflate((sigma * 3.0).ceil(), (sigma * 3.0).ceil());
    Rect::new(bounds.x0.floor(), bounds.y0.floor(), bounds.x1.ceil(), bounds.y1.ceil())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rotation_uses_physical_dimensions_of_a_nonsquare_box() {
        let mask = ClipMask {
            shape: MaskShape::Rectangle,
            x_pct: 25.0,
            y_pct: 25.0,
            width_pct: 50.0,
            height_pct: 50.0,
            rotation_deg: 90.0,
            feather_pct: 0.0,
            inverted: false,
        };
        let bounds = path(Rect::new(10.0, 20.0, 410.0, 120.0), mask).bounding_box();
        for (actual, expected) in [bounds.x0, bounds.y0, bounds.x1, bounds.y1].into_iter().zip([185.0, -30.0, 235.0, 170.0]) {
            assert!((actual - expected).abs() < 1e-10);
        }
    }
}
