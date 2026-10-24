//! The storyboard background: `StoryboardScene.tsx` fills the frame with
//! `bgColor`, a CSS color or a Style rail gradient. An unparsed value draws
//! nothing; coverage reports it.

use vello::kurbo::{Affine, Rect};
use vello::peniko::Fill;

use super::Canvas;
use crate::paint::{brush, parse_paint};

pub fn draw(canvas: &mut Canvas<'_>, value: &str, rect: Rect) {
    let Some(paint) = parse_paint(value) else { return };
    let (brush, transform) = brush(&paint, rect);
    canvas.scene.fill(Fill::NonZero, Affine::IDENTITY, &brush, transform, &rect);
}

/// A plain black backdrop (the absolute and visual-timeline reels).
pub fn black(canvas: &mut Canvas<'_>) {
    let frame = canvas.frame();
    canvas.scene.fill(Fill::NonZero, Affine::IDENTITY, vello::peniko::Color::BLACK, None, &frame);
}
