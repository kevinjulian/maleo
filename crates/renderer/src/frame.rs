//! The renderer: one frame of a render storyboard, drawn back to front in the
//! stacking order Remotion resolves, with its coverage report (D2, D4).

use parley::LayoutContext;
use vello::Scene;
use vello::kurbo::{Affine, Rect};
use vello::peniko::{Color, ImageData};

use crate::blur::Blur;
use crate::coverage::{self, Entry};
use crate::fonts::Fonts;
use crate::gpu::Gpu;
use crate::media::Media;
use crate::paint::Rgba;
use crate::scene::text::WordBrush;
use crate::scene::{Canvas, Shadows, background, caption, image, text};
use crate::storyboard::Storyboard;
use crate::timeline::{self, BaseMode, FPS, Visible};

/// A drawn frame: straight-alpha RGBA rows and what it could not draw.
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub coverage: Vec<Entry>,
}

pub struct Renderer {
    gpu: Gpu,
    blur: Blur,
    fonts: Fonts,
    layouts: LayoutContext<WordBrush>,
    media: Media,
}

/// Shadows drawn offscreen on the renderer's device; the images stay
/// registered with vello until the frame is drawn.
struct GpuShadows<'a> {
    gpu: &'a mut Gpu,
    blur: &'a Blur,
    registered: Vec<ImageData>,
}

impl Shadows for GpuShadows<'_> {
    fn shadow(&mut self, silhouette: &Scene, bounds: Rect, radius: f32, color: Rgba) -> Option<ImageData> {
        let (width, height) = (bounds.width() as u32, bounds.height() as u32);
        if width == 0 || height == 0 {
            return None;
        }
        let mut local = Scene::new();
        local.append(silhouette, Some(Affine::translate(-bounds.origin().to_vec2())));
        let target = self.gpu.target(width, height);
        self.gpu.draw(&local, &target.create_view(&Default::default()), width, height, Color::TRANSPARENT).ok()?;
        let tint = [f32::from(color.r) / 255.0, f32::from(color.g) / 255.0, f32::from(color.b) / 255.0, color.a];
        let shadow = self.blur.shadow(&self.gpu.device, &self.gpu.queue, &target, radius, tint);
        let image = self.gpu.register(shadow);
        self.registered.push(image.clone());
        Some(image)
    }
}

impl Renderer {
    pub async fn new() -> Result<Self, String> {
        Ok(Self::with_gpu(Gpu::new().await?))
    }

    pub fn with_gpu(gpu: Gpu) -> Self {
        let blur = Blur::new(&gpu.device);
        Self { gpu, blur, fonts: Fonts::new(), layouts: LayoutContext::new(), media: Media::default() }
    }

    pub fn gpu(&self) -> &Gpu {
        &self.gpu
    }

    /// Moves the renderer to a new device after the old one was lost (OpenSpec
    /// p2-preview-runtime D6). The GPU-owned parts are rebuilt; fonts and the
    /// supplied images are CPU-side and stay, so no image is supplied again.
    pub fn replace_gpu(&mut self, gpu: Gpu) {
        self.blur = Blur::new(&gpu.device);
        self.gpu = gpu;
    }

    /// Supplies the decoded image for `url` (straight-alpha RGBA).
    pub fn put_image(&mut self, url: &str, width: u32, height: u32, rgba: Vec<u8>) -> Result<(), String> {
        self.media.put(url, width, height, rgba)
    }

    pub fn coverage(&self, storyboard: &Storyboard, frame: i64) -> Vec<Entry> {
        coverage::report(storyboard, frame, FPS, &|url| self.media.has(url))
    }

    /// Builds the frame's scene. The returned images are shadow textures to
    /// release once the scene is drawn.
    fn compose(&mut self, storyboard: &Storyboard, frame: i64, width: u32, height: u32) -> (Scene, Vec<ImageData>) {
        let Self { gpu, blur, fonts, layouts, media } = self;
        let mut scene = Scene::new();
        let mut shadows = GpuShadows { gpu, blur, registered: Vec::new() };
        let mut canvas = Canvas { scene: &mut scene, media, width: f64::from(width), height: f64::from(height) };
        if !storyboard.hide_base && timeline::base_mode(storyboard) != BaseMode::Series {
            background::black(&mut canvas);
        }
        for visible in timeline::visible(storyboard, frame, FPS) {
            match visible {
                Visible::Scene { placed, local } => image::draw_scene(&mut canvas, storyboard, &storyboard.scenes[placed.index], &placed, local, FPS),
                Visible::TimelineVisual { placed, .. } => {
                    image::draw_timeline_visual(&mut canvas, &storyboard.visual_timeline.as_deref().unwrap_or_default()[placed.index])
                }
                Visible::VideoOverlay { placed, .. } => image::draw_overlay(&mut canvas, &storyboard.video_overlays[placed.index]),
                Visible::TextOverlay { index, .. } if storyboard.text_overlays[index].preset.as_deref() == Some("plain") => {
                    text::draw(&mut canvas, &mut shadows, fonts, layouts, storyboard, index)
                }
                Visible::Caption { index, local_sec } => caption::draw(&mut canvas, &mut shadows, fonts, layouts, storyboard, index, local_sec),
                // Coverage lists what is not drawn.
                Visible::TextOverlay { .. } | Visible::Effect { .. } | Visible::ChapterPills | Visible::ProgressBar => {}
            }
        }
        (scene, shadows.registered)
    }

    /// Draws `frame` of `storyboard` at `width` x `height` and reads it back.
    pub async fn render(&mut self, storyboard: &Storyboard, frame: i64, width: u32, height: u32) -> Result<Frame, String> {
        let coverage = self.coverage(storyboard, frame);
        let (scene, shadows) = self.compose(storyboard, frame, width, height);
        let rgba = self.gpu.render(&scene, width, height, Color::TRANSPARENT).await;
        for image in shadows {
            self.gpu.release(image);
        }
        Ok(Frame { width, height, rgba: rgba?, coverage })
    }

    /// Draws `frame` into `view` (a [`crate::gpu::FORMAT`] storage texture)
    /// without reading it back, and returns the coverage report.
    pub fn draw(&mut self, storyboard: &Storyboard, frame: i64, view: &wgpu::TextureView, width: u32, height: u32) -> Result<Vec<Entry>, String> {
        let coverage = self.coverage(storyboard, frame);
        let (scene, shadows) = self.compose(storyboard, frame, width, height);
        let drawn = self.gpu.draw(&scene, view, width, height, Color::TRANSPARENT);
        for image in shadows {
            self.gpu.release(image);
        }
        drawn.map(|()| coverage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn renderer() -> Renderer {
        pollster::block_on(Renderer::new()).expect("renderer")
    }

    fn px(frame: &Frame, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * frame.width + x) * 4) as usize;
        frame.rgba[i..i + 4].try_into().unwrap()
    }

    #[test]
    fn a_missing_image_draws_the_placeholder_in_its_box_and_is_listed() {
        let mut renderer = renderer();
        let storyboard = Storyboard::parse(
            r##"{"scenes":[{"image":"","durationSec":2,"movement":"Static","transition":"cut"}],"bgColor":"#000000",
                "videoOverlays":[{"url":"missing.png","durationSec":2,"layout":{"xPct":25,"yPct":25,"widthPct":50,"heightPct":50}}]}"##,
        )
        .unwrap();
        let frame = pollster::block_on(renderer.render(&storyboard, 0, 200, 200)).unwrap();
        assert_eq!(frame.coverage, [Entry { kind: "image-overlay".into(), path: "videoOverlays[0]".into(), reason: "missing media".into() }]);
        assert_eq!(px(&frame, 10, 10), [0, 0, 0, 255], "outside the box: background");
        assert_eq!(px(&frame, 60, 70), [0x5a, 0x5a, 0x5a, 255], "inside the box: placeholder fill");
        assert_eq!(px(&frame, 140, 140)[0], 0x9a, "the cross runs corner to corner");
    }

    #[test]
    fn a_replaced_gpu_draws_the_images_supplied_before() {
        let mut renderer = renderer();
        let storyboard = Storyboard::parse(
            r##"{"scenes":[{"image":"","durationSec":2,"movement":"Static","transition":"cut"}],"bgColor":"#000000",
                "videoOverlays":[{"url":"red.png","durationSec":2,"layout":{"xPct":25,"yPct":25,"widthPct":50,"heightPct":50}}]}"##,
        )
        .unwrap();
        renderer.put_image("red.png", 4, 4, [255, 0, 0, 255].repeat(16)).unwrap();
        let before = pollster::block_on(renderer.render(&storyboard, 0, 200, 200)).unwrap();
        assert_eq!(px(&before, 100, 100), [255, 0, 0, 255]);
        renderer.replace_gpu(pollster::block_on(Gpu::new()).expect("gpu"));
        let frame = pollster::block_on(renderer.render(&storyboard, 0, 200, 200)).unwrap();
        assert!(frame.coverage.is_empty(), "{:?}", frame.coverage);
        assert_eq!(px(&frame, 100, 100), [255, 0, 0, 255], "inside the box: the image, not the placeholder");
    }

    #[test]
    fn the_same_input_draws_the_same_bytes() {
        let mut renderer = renderer();
        let storyboard = Storyboard::parse(
            r##"{"scenes":[{"image":"","durationSec":2,"movement":"Static","transition":"cut"}],"bgColor":"linear-gradient(135deg, #F97316 0%, #E11D48 100%)",
                "captionCues":[{"id":"c","type":"caption","startSec":0,"durationSec":2,"track":0,
                  "caption":{"text":"Halo dunia","words":[],"style":{"shadow":"#000000","stroke":"#000000","background":"#202020"}}}]}"##,
        )
        .unwrap();
        let a = pollster::block_on(renderer.render(&storyboard, 10, 270, 480)).unwrap();
        let b = pollster::block_on(renderer.render(&storyboard, 10, 270, 480)).unwrap();
        assert!(a.coverage.is_empty(), "{:?}", a.coverage);
        assert!(a.rgba == b.rgba);
    }
}
