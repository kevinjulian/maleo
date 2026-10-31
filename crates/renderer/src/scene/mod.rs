//! One module per layer (D2). Each draws an element the way its composition
//! in `packages/video/src` lays it out, into one vello scene in frame pixels.

pub mod background;
pub mod camera;
pub mod caption;
pub mod composition;
pub mod decoration;
pub mod effect;
pub mod image;
mod mask;
pub mod reveal;
pub mod shape;
pub mod text;
mod text_motion;
pub mod transition;

use vello::Scene;
use vello::kurbo::{Affine, Rect};
use vello::peniko::{Fill, ImageData, Mix};

use crate::media::Media;
use crate::paint::Rgba;

/// The color a shadow's silhouette is drawn in: opaque, because the blur pass
/// applies the shadow color's alpha (`blur.rs`). A silhouette in the shadow
/// color would apply it twice.
pub const SILHOUETTE: Rgba = Rgba { r: 0, g: 0, b: 0, a: 1.0 };

/// Per-frame GPU treatments owned by the frame composer.
pub trait Treatments {
    /// Draws `silhouette` (frame coordinates) inside `bounds`, blurs it with
    /// CSS blur `radius` in `color`, and returns the image to place at
    /// `bounds.origin()`. `None` when the bounds are empty.
    fn shadow(&mut self, silhouette: &Scene, bounds: Rect, radius: f32, color: Rgba) -> Option<ImageData>;
    fn blur_mask(&mut self, content: &Scene, bounds: Rect, sigma: f32) -> Result<(ImageData, Rect), String>;
    fn texture_content(&mut self, content: &Scene, bounds: Rect, rect: Rect, paper: bool) -> Result<ImageData, String>;
    fn drop_shadow(&mut self, content: &Scene, bounds: Rect, sigma: f32, color: Rgba) -> Result<ImageData, String>;
    fn project(&mut self, content: &Scene, bounds: Rect, degrees: f64) -> Result<ImageData, String>;
    fn dark_content(&mut self, content: &Scene, bounds: Rect) -> Result<ImageData, String>;
    fn color(&mut self, content: &Scene, bounds: Rect, color: crate::storyboard::ClipColor) -> Result<ImageData, String>;
    /// Blur full-color content. A GPU failure must fail the frame.
    fn blur_content(&mut self, content: &Scene, bounds: Rect, radius: f32) -> Result<ImageData, String>;
}

/// What a layer draws into.
pub struct Canvas<'a> {
    pub scene: &'a mut Scene,
    pub media: &'a Media,
    pub width: f64,
    pub height: f64,
    pub pixelated: bool,
}

impl Canvas<'_> {
    pub fn frame(&self) -> Rect {
        Rect::new(0.0, 0.0, self.width, self.height)
    }

    /// One clip's CSS mix-blend-mode, against the current isolated backdrop.
    pub fn blended<T>(&mut self, mode: Option<&str>, draw: impl FnOnce(&mut Self) -> T) -> T {
        let mix = match mode {
            Some("multiply") => Mix::Multiply,
            Some("screen") => Mix::Screen,
            _ => return draw(self),
        };
        let everything = Rect::new(-1e6, -1e6, 1e6, 1e6);
        self.scene.push_layer(Fill::NonZero, mix, 1.0, Affine::IDENTITY, &everything);
        let result = draw(self);
        self.scene.pop_layer();
        result
    }

    /// Apply one element's CSS transform to its content and local clips.
    pub fn transformed<T>(&mut self, transform: Affine, draw: impl FnOnce(&mut Canvas<'_>) -> T) -> T {
        let mut scene = Scene::new();
        let result = draw(&mut Canvas { scene: &mut scene, media: self.media, width: self.width, height: self.height, pixelated: self.pixelated });
        self.scene.append(&scene, Some(transform));
        result
    }

    /// Runs `draw` clipped to `rect` (CSS `overflow: hidden`).
    pub fn clipped<T>(&mut self, rect: Rect, draw: impl FnOnce(&mut Self) -> T) -> T {
        self.scene.push_clip_layer(Fill::NonZero, Affine::IDENTITY, &rect);
        let result = draw(self);
        self.scene.pop_layer();
        result
    }

    /// Runs `draw` as one group at `opacity` (CSS `opacity` on an element).
    pub fn group<T>(&mut self, opacity: f64, draw: impl FnOnce(&mut Self) -> T) -> T {
        if opacity >= 1.0 {
            return draw(self);
        }
        let everything = Rect::new(-1e6, -1e6, 1e6, 1e6);
        self.scene.push_layer(Fill::NonZero, Mix::Normal, opacity.clamp(0.0, 1.0) as f32, Affine::IDENTITY, &everything);
        let result = draw(self);
        self.scene.pop_layer();
        result
    }

    /// PixelPresentation and EffectsLayer use Skia's byte-opacity composition path.
    pub fn byte_group<T>(&mut self, opacity: f64, draw: impl FnOnce(&mut Self) -> T) -> T {
        if opacity >= 1.0 {
            return draw(self);
        }
        self.skia_layer(opacity, draw)
    }

    /// Composes `draw` with Skia's byte arithmetic even at full opacity:
    /// `SkPMSrcOver` truncates, so a faint layer darkens a dark backdrop by a
    /// whole level where floating-point source-over rounds back to it.
    pub fn skia_layer<T>(&mut self, opacity: f64, draw: impl FnOnce(&mut Self) -> T) -> T {
        let before = self.scene.encoding().draw_data.len();
        let rect = Rect::new(-1e6, -1e6, 1e6, 1e6);
        self.scene.push_layer(Fill::NonZero, Mix::Normal, opacity.clamp(0.0, 1.0) as f32, Affine::IDENTITY, &rect);
        // Pinned Vello 0.11 raw mix 16 is implemented in the vendored fine shader.
        let data = &mut self.scene.encoding_mut().draw_data;
        assert_eq!(data.len(), before + 2, "Vello layer encoding changed");
        assert_eq!(data[before], 3, "expected normal source-over layer");
        data[before] = (16 << 8) | 3;
        let result = draw(self);
        self.scene.pop_layer();
        result
    }
}

/// Integer pixel bounds around `rect`, inside the frame.
pub fn pixel_bounds(rect: Rect, width: f64, height: f64) -> Rect {
    Rect::new(rect.x0.floor().max(0.0), rect.y0.floor().max(0.0), rect.x1.ceil().min(width), rect.y1.ceil().min(height))
}
