//! The images a host supplies, keyed by the URL the storyboard names.
//!
//! The renderer does no IO: a native host decodes files, the browser host
//! decodes with `createImageBitmap`, and both hand over straight-alpha RGBA.
//! An image the host has not supplied draws a placeholder in the element's
//! box, and coverage lists the element as missing media.

use std::collections::HashMap;
use std::sync::Arc;

use vello::Scene;
use vello::kurbo::{Affine, Line, Rect, Stroke};
use vello::peniko::{Blob, Color, Fill, ImageAlphaType, ImageData, ImageFormat};

#[derive(Default)]
pub struct Media {
    images: HashMap<String, ImageData>,
}

/// The placeholder: a flat gray box crossed corner to corner.
const PLACEHOLDER_FILL: Color = Color::from_rgb8(0x5a, 0x5a, 0x5a);
const PLACEHOLDER_LINE: Color = Color::from_rgb8(0x9a, 0x9a, 0x9a);

impl Media {
    /// Stores an image. `rgba` is straight alpha, `width * height * 4` bytes.
    pub fn put(&mut self, url: &str, width: u32, height: u32, rgba: Vec<u8>) -> Result<(), String> {
        let expected = width as usize * height as usize * 4;
        if width == 0 || height == 0 || rgba.len() != expected {
            return Err(format!("image `{url}`: {} bytes for {width}x{height}, expected {expected}", rgba.len()));
        }
        let data = ImageData { data: Blob::new(Arc::new(rgba)), format: ImageFormat::Rgba8, alpha_type: ImageAlphaType::Alpha, width, height };
        self.images.insert(url.to_owned(), data);
        Ok(())
    }

    pub fn get(&self, url: &str) -> Option<&ImageData> {
        self.images.get(url)
    }

    pub fn has(&self, url: &str) -> bool {
        self.images.contains_key(url)
    }
}

/// Draws the missing-media placeholder over `rect`.
pub fn draw_placeholder(scene: &mut Scene, transform: Affine, rect: Rect) {
    scene.fill(Fill::NonZero, transform, PLACEHOLDER_FILL, None, &rect);
    let stroke = Stroke::new(4.0);
    for line in [Line::new((rect.x0, rect.y0), (rect.x1, rect.y1)), Line::new((rect.x1, rect.y0), (rect.x0, rect.y1))] {
        scene.stroke(&stroke, transform, PLACEHOLDER_LINE, None, &line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_image_must_match_its_size() {
        let mut media = Media::default();
        assert!(media.put("a.png", 2, 2, vec![0; 16]).is_ok());
        assert!(media.has("a.png"));
        assert!(media.put("b.png", 2, 2, vec![0; 15]).is_err());
        assert!(!media.has("b.png"));
    }
}
