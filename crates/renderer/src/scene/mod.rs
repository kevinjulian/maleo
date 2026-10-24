//! One module per layer (D2). Each draws an element the way its composition
//! in `packages/video/src` lays it out, into one vello scene in frame pixels.

pub mod background;
pub mod caption;
pub mod image;
pub mod text;

use vello::Scene;
use vello::kurbo::{Affine, Rect};
use vello::peniko::{Fill, ImageData, Mix};

use crate::media::Media;
use crate::paint::Rgba;

/// The color a shadow's silhouette is drawn in: opaque, because the blur pass
/// applies the shadow color's alpha (`blur.rs`). A silhouette in the shadow
/// color would apply it twice.
pub const SILHOUETTE: Rgba = Rgba { r: 0, g: 0, b: 0, a: 1.0 };

/// A blurred shadow the frame composer renders offscreen (see `blur.rs`).
pub trait Shadows {
    /// Draws `silhouette` (frame coordinates) inside `bounds`, blurs it with
    /// CSS blur `radius` in `color`, and returns the image to place at
    /// `bounds.origin()`. `None` when the bounds are empty.
    fn shadow(&mut self, silhouette: &Scene, bounds: Rect, radius: f32, color: Rgba) -> Option<ImageData>;
}

/// What a layer draws into.
pub struct Canvas<'a> {
    pub scene: &'a mut Scene,
    pub media: &'a Media,
    pub width: f64,
    pub height: f64,
}

impl Canvas<'_> {
    pub fn frame(&self) -> Rect {
        Rect::new(0.0, 0.0, self.width, self.height)
    }

    /// Runs `draw` clipped to `rect` (CSS `overflow: hidden`).
    pub fn clipped(&mut self, rect: Rect, draw: impl FnOnce(&mut Self)) {
        self.scene.push_clip_layer(Fill::NonZero, Affine::IDENTITY, &rect);
        draw(self);
        self.scene.pop_layer();
    }

    /// Runs `draw` as one group at `opacity` (CSS `opacity` on an element).
    pub fn group(&mut self, opacity: f64, draw: impl FnOnce(&mut Self)) {
        if opacity >= 1.0 {
            draw(self);
            return;
        }
        let everything = Rect::new(-1e6, -1e6, 1e6, 1e6);
        self.scene.push_layer(Fill::NonZero, Mix::Normal, opacity.clamp(0.0, 1.0) as f32, Affine::IDENTITY, &everything);
        draw(self);
        self.scene.pop_layer();
    }
}

/// Integer pixel bounds around `rect`, inside the frame.
pub fn pixel_bounds(rect: Rect, width: f64, height: f64) -> Rect {
    Rect::new(rect.x0.floor().max(0.0), rect.y0.floor().max(0.0), rect.x1.ceil().min(width), rect.y1.ceil().min(height))
}
