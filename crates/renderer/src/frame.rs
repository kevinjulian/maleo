//! The renderer: one frame of a render storyboard, drawn back to front in the
//! stacking order Remotion resolves, with its coverage report (D2, D4).

use parley::LayoutContext;
use vello::Scene;
use vello::kurbo::{Affine, Rect};
use vello::peniko::{Color, ImageData};

use crate::blur::Blur;
use crate::correction::Correction;
use crate::coverage::{self, Entry};
use crate::fonts::Fonts;
use crate::gpu::Gpu;
use crate::media::Media;
use crate::paint::Rgba;
use crate::scene::text::WordBrush;
use crate::scene::{Canvas, Treatments, background, caption, composition, effect, image, shape, text};
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
    correction: Correction,
    fonts: Fonts,
    layouts: LayoutContext<WordBrush>,
    media: Media,
}

/// Treatments drawn offscreen on the renderer's device; the images stay
/// registered with vello until the frame is drawn.
struct GpuTreatments<'a> {
    gpu: &'a mut Gpu,
    blur: &'a Blur,
    correction: &'a Correction,
    registered: Vec<ImageData>,
}

impl GpuTreatments<'_> {
    fn target(&mut self, content: &Scene, bounds: Rect, name: &str, scale: f64) -> Result<wgpu::Texture, String> {
        let (width, height) = ((bounds.width() / scale).ceil() as u32, (bounds.height() / scale).ceil() as u32);
        let limit = self.gpu.device.limits().max_texture_dimension_2d;
        if ![bounds.x0, bounds.y0, bounds.x1, bounds.y1].iter().all(|v| v.is_finite()) || width == 0 || height == 0 || width > limit || height > limit {
            return Err(format!("{name} target {width}x{height} exceeds GPU bounds"));
        }
        let mut local = Scene::new();
        local.append(content, Some(Affine::scale(1.0 / scale) * Affine::translate(-bounds.origin().to_vec2())));
        let target = self.gpu.target(width, height);
        self.gpu.draw(&local, &target.create_view(&Default::default()), width, height, Color::TRANSPARENT)?;
        Ok(target)
    }
}

impl Treatments for GpuTreatments<'_> {
    fn texture_content(&mut self, content: &Scene, bounds: Rect, rect: Rect, paper: bool) -> Result<ImageData, String> {
        let target = self.target(content, bounds, "reveal texture", 1.0)?;
        // CSS mask-image paints into a pixel-snapped background-image box.
        let mask_box = [
            (bounds.x0 - rect.x0.round()) as f32,
            (bounds.y0 - rect.y0.round()) as f32,
            (rect.x1.round() - rect.x0.round()) as f32,
            (rect.y1.round() - rect.y0.round()) as f32,
        ];
        let image = self.gpu.register(self.correction.texture(&self.gpu.device, &self.gpu.queue, &target, mask_box, paper));
        self.registered.push(image.clone());
        Ok(image)
    }
    fn drop_shadow(&mut self, content: &Scene, bounds: Rect, sigma: f32, color: Rgba) -> Result<ImageData, String> {
        let target = self.target(content, bounds, "reveal drop shadow", 1.0)?;
        let tint = [f32::from(color.r) / 255.0, f32::from(color.g) / 255.0, f32::from(color.b) / 255.0, color.a];
        let image = self.gpu.register(self.blur.shadow(&self.gpu.device, &self.gpu.queue, &target, sigma * 2.0, tint));
        self.registered.push(image.clone());
        Ok(image)
    }

    fn project(&mut self, content: &Scene, bounds: Rect, degrees: f64) -> Result<ImageData, String> {
        let target = self.target(content, bounds, "projected transition", 1.0)?;
        let image = self.gpu.register(self.correction.project(&self.gpu.device, &self.gpu.queue, &target, degrees));
        self.registered.push(image.clone());
        Ok(image)
    }

    fn dark_content(&mut self, content: &Scene, bounds: Rect) -> Result<ImageData, String> {
        let target = self.target(content, bounds, "dark-pixel filter", 1.0)?;
        let image = self.gpu.register(self.correction.dark(&self.gpu.device, &self.gpu.queue, &target));
        self.registered.push(image.clone());
        Ok(image)
    }

    fn blur_mask(&mut self, content: &Scene, bounds: Rect, sigma: f32) -> Result<(ImageData, Rect), String> {
        // A broad Gaussian has no pixel-scale detail. Keep at least sixteen samples
        // per sigma, then reconstruct the smooth mask with bilinear sampling.
        let scale = f64::from((sigma / 16.0).floor().clamp(1.0, 32.0));
        let bounds = Rect::new(bounds.x0, bounds.y0, bounds.x0 + (bounds.width() / scale).ceil() * scale, bounds.y0 + (bounds.height() / scale).ceil() * scale);
        let target = self.target(content, bounds, "mask blur", scale)?;
        let image = self.gpu.register(self.blur.mask(&self.gpu.device, &self.gpu.queue, &target, sigma, scale as f32));
        self.registered.push(image.clone());
        Ok((image, bounds))
    }

    fn color(&mut self, content: &Scene, bounds: Rect, color: crate::storyboard::ClipColor) -> Result<ImageData, String> {
        let target = self.target(content, bounds, "color correction", 1.0)?;
        let image = self.gpu.register(self.correction.apply(&self.gpu.device, &self.gpu.queue, &target, color));
        self.registered.push(image.clone());
        Ok(image)
    }

    fn blur_content(&mut self, content: &Scene, bounds: Rect, radius: f32) -> Result<ImageData, String> {
        let target = self.target(content, bounds, "content blur", 1.0)?;
        let image = self.gpu.register(self.blur.content(&self.gpu.device, &self.gpu.queue, &target, radius));
        self.registered.push(image.clone());
        Ok(image)
    }

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
        let correction = Correction::new(&gpu.device);
        Self { gpu, blur, correction, fonts: Fonts::new(), layouts: LayoutContext::new(), media: Media::default() }
    }

    pub fn gpu(&self) -> &Gpu {
        &self.gpu
    }

    /// Moves the renderer to a new device after the old one was lost (OpenSpec
    /// p2-preview-runtime D6). The GPU-owned parts are rebuilt; fonts and the
    /// supplied images are CPU-side and stay, so no image is supplied again.
    pub fn replace_gpu(&mut self, gpu: Gpu) {
        self.blur = Blur::new(&gpu.device);
        self.correction = Correction::new(&gpu.device);
        self.gpu = gpu;
    }

    /// Supplies the decoded image for `url` (straight-alpha RGBA).
    pub fn put_image(&mut self, url: &str, width: u32, height: u32, rgba: Vec<u8>) -> Result<(), String> {
        self.media.put(url, width, height, rgba)
    }

    pub fn coverage(&self, storyboard: &Storyboard, frame: i64) -> Vec<Entry> {
        coverage::report(storyboard, frame, FPS, &|url| self.media.has(url))
    }

    /// Builds the frame's scene. The returned images are treatment textures to
    /// release once the scene is drawn.
    fn compose(
        &mut self,
        storyboard: &Storyboard,
        frame: i64,
        width: u32,
        height: u32,
        fps: f64,
        duration_frames: i64,
    ) -> Result<(Scene, Vec<ImageData>), String> {
        let Self { gpu, blur, correction, fonts, layouts, media } = self;
        let mut scene = Scene::new();
        let mut shadows = GpuTreatments { gpu, blur, correction, registered: Vec::new() };
        let mut canvas = Canvas { scene: &mut scene, media, width: f64::from(width), height: f64::from(height), pixelated: false };
        let effect_time = frame as f64 / fps;
        let base_transform = effect::sample(&storyboard.effects, effect_time).transform(canvas.width, canvas.height);
        if !storyboard.hide_base && timeline::base_mode(storyboard) != BaseMode::Series {
            canvas.transformed(base_transform, background::black);
        }
        for visible in timeline::visible(storyboard, frame, fps) {
            let result = match visible {
                Visible::Scene { placed, local } => canvas.transformed(base_transform, |canvas| {
                    image::draw_scene(canvas, &mut shadows, (&mut *fonts, &mut *layouts), storyboard, &placed, local, fps)
                }),
                Visible::TimelineVisual { placed, local } => canvas.transformed(base_transform, |canvas| {
                    image::draw_timeline_visual(
                        canvas,
                        &mut shadows,
                        &storyboard.visual_timeline.as_deref().unwrap_or_default()[placed.index],
                        &placed,
                        local,
                        fps,
                    )
                }),
                Visible::VideoOverlay { placed, local } => {
                    image::draw_overlay(&mut canvas, &mut shadows, &storyboard.video_overlays[placed.index], &placed, local, fps)
                }
                Visible::TextOverlay { index, local, frames } if storyboard.text_overlays[index].preset.as_deref() == Some("plain") => {
                    text::draw(&mut canvas, &mut shadows, fonts, layouts, storyboard, index, (local as f64 / fps, frames as f64 / fps))
                }
                Visible::TextOverlay { index, local, frames } if storyboard.text_overlays[index].preset.as_deref().is_some_and(|p| shape::IDS.contains(&p)) => {
                    shape::draw(
                        &mut canvas,
                        &mut shadows,
                        &storyboard.text_overlays[index],
                        &storyboard.accent_color,
                        (local as f64 / fps, frames as f64 / fps),
                    )
                }
                Visible::TextOverlay { index, local, frames } if storyboard.text_overlays[index].preset.as_deref() == Some("motion-comp") => {
                    composition::draw(&mut canvas, &mut shadows, fonts, layouts, storyboard, &storyboard.text_overlays[index], (local, frames, fps))
                }
                Visible::Caption { index, local_sec } => {
                    caption::draw(&mut canvas, &mut shadows, fonts, layouts, storyboard, index, local_sec);
                    Ok(())
                }
                Visible::Effect { index } => {
                    effect::draw(&mut canvas, &storyboard.effects, index, effect_time);
                    Ok(())
                }
                // Coverage lists what is not drawn.
                Visible::ChapterPills => {
                    crate::scene::decoration::chapter_pill(&mut canvas, &mut shadows, fonts, layouts, storyboard, frame, fps);
                    Ok(())
                }
                Visible::ProgressBar => {
                    crate::scene::decoration::progress(&mut canvas, storyboard, frame, duration_frames);
                    Ok(())
                }
                Visible::TextOverlay { .. } => Ok(()),
            };
            if let Err(error) = result {
                for image in shadows.registered.drain(..) {
                    shadows.gpu.release(image);
                }
                return Err(error);
            }
        }
        Ok((scene, shadows.registered))
    }

    /// Draws `frame` of `storyboard` at `width` x `height` and reads it back.
    pub async fn render(&mut self, storyboard: &Storyboard, frame: i64, width: u32, height: u32) -> Result<Frame, String> {
        self.render_with_timing(storyboard, frame, width, height, FPS, timeline::composition_frames(storyboard, FPS)).await
    }

    /// Native parity uses the same timing supplied by the browser session.
    pub async fn render_with_timing(
        &mut self,
        storyboard: &Storyboard,
        frame: i64,
        width: u32,
        height: u32,
        fps: f64,
        duration_frames: i64,
    ) -> Result<Frame, String> {
        if !fps.is_finite() || fps <= 0.0 || duration_frames < 1 {
            return Err("invalid render timing".into());
        }
        let coverage = coverage::report(storyboard, frame, fps, &|url| self.media.has(url));
        let (scene, shadows) = self.compose(storyboard, frame, width, height, fps, duration_frames)?;
        let rgba = self.gpu.render(&scene, width, height, Color::TRANSPARENT).await;
        for image in shadows {
            self.gpu.release(image);
        }
        Ok(Frame { width, height, rgba: rgba?, coverage })
    }

    /// Draws `frame` into `view` (a [`crate::gpu::FORMAT`] storage texture)
    /// without reading it back, and returns the coverage report.
    pub fn draw(
        &mut self,
        storyboard: &Storyboard,
        frame: i64,
        view: &wgpu::TextureView,
        width: u32,
        height: u32,
        timing: (f64, i64),
    ) -> Result<Vec<Entry>, String> {
        let (fps, duration_frames) = timing;
        if !fps.is_finite() || fps <= 0.0 || duration_frames < 1 {
            return Err("invalid render timing".into());
        }
        let coverage = coverage::report(storyboard, frame, fps, &|url| self.media.has(url));
        let (scene, shadows) = self.compose(storyboard, frame, width, height, fps, duration_frames)?;
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

    #[test]
    fn session_timing_controls_effects_and_progress_without_changing_the_storyboard() {
        pollster::block_on(async {
            let mut renderer = Renderer::new().await.unwrap();
            let storyboard = Storyboard::parse(r##"{"scenes":[{"image":"","durationSec":2,"movement":"Static","transition":"cut"}],"bgColor":"#ffffff","accentColor":"#ff0000","fgColor":"#ffffff","pacingDevices":{"progressBar":true},"effects":[{"effect":"fade_in","startSec":0,"durationSec":1}]}"##).unwrap();
            let a = renderer.render_with_timing(&storyboard, 12, 100, 100, 24.0, 96).await.unwrap();
            let b = renderer.render_with_timing(&storyboard, 30, 100, 100, 60.0, 240).await.unwrap();
            assert_eq!(a.rgba, b.rgba, "equal absolute time and progress at different session frame rates");
            assert_eq!(&a.rgba[(2 * 100 + 5) * 4..(2 * 100 + 5) * 4 + 4], &[255, 0, 0, 255]);
            assert_ne!(&a.rgba[(2 * 100 + 20) * 4..(2 * 100 + 20) * 4 + 4], &[255, 0, 0, 255], "duration includes trailing content supplied by the session");
            let midpoint = &a.rgba[(50 * 100 + 50) * 4..(50 * 100 + 50) * 4 + 4];
            assert!((i16::from(midpoint[0]) - 128).abs() <= 1);
            assert!(renderer.render_with_timing(&storyboard, 0, 100, 100, 0.0, 240).await.err().unwrap().contains("timing"));
        });
    }

    fn renderer() -> Renderer {
        pollster::block_on(Renderer::new()).expect("renderer")
    }

    fn px(frame: &Frame, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * frame.width + x) * 4) as usize;
        frame.rgba[i..i + 4].try_into().unwrap()
    }

    #[test]
    fn pixel_presentation_keeps_production_opacity_bytes() {
        let mut renderer = renderer();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("corpus/transition-series-pixel");
        for name in ["0.png", "1.png"] {
            let image = ::image::open(root.join("media").join(name)).unwrap().to_rgba8();
            renderer.put_image(&format!("media/{name}"), image.width(), image.height(), image.into_raw()).unwrap();
        }
        let storyboard = Storyboard::parse(include_str!("../corpus/transition-series-pixel/storyboard.json")).unwrap();
        let frame = pollster::block_on(renderer.render(&storyboard, 24, 1080, 1920)).unwrap();
        let reference = ::image::open(root.join("reference/24.png")).unwrap().to_rgba8();
        let expected = [131, 46, 98, 192];
        assert_eq!(reference.get_pixel(10, 10).0, expected, "stale pixel-opacity reference");
        assert_eq!(px(&frame, 10, 10), expected);
        for (x, y) in [(552, 25), (552, 1906)] {
            assert_eq!(reference.get_pixel(x, y).0, [135, 53, 104, 192], "stale grid reference");
            let pixel = px(&frame, x, y);
            assert_eq!(pixel[1], 53, "grid coverage at ({x},{y})");
            assert_eq!(pixel[3], 192);
        }
    }

    #[test]
    fn projected_transition_redraws_after_gpu_replacement() {
        let mut renderer = renderer();
        renderer.put_image("a", 1, 1, vec![30, 60, 210, 255]).unwrap();
        renderer.put_image("b", 1, 1, vec![210, 50, 30, 128]).unwrap();
        let storyboard =
            Storyboard::parse(r#"{"scenes":[{"image":"a","durationSec":2,"transition":"flip"},{"image":"b","durationSec":2,"transition":"cut"}]}"#).unwrap();
        let before = pollster::block_on(renderer.render(&storyboard, 55, 100, 100)).unwrap();
        assert!(before.coverage.is_empty());
        assert!(before.rgba.iter().any(|b| *b != 0));
        renderer.replace_gpu(pollster::block_on(Gpu::new()).unwrap());
        let after = pollster::block_on(renderer.render(&storyboard, 55, 100, 100)).unwrap();
        assert_eq!(after.rgba, before.rgba);
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

    #[test]
    fn a_content_blur_target_outside_gpu_bounds_is_an_error() {
        let mut renderer = renderer();
        let mut shadows = GpuTreatments { gpu: &mut renderer.gpu, blur: &renderer.blur, correction: &renderer.correction, registered: Vec::new() };
        let error = shadows.blur_content(&Scene::new(), Rect::new(0.0, 0.0, 1e6, 1e6), 4.0).expect_err("refused bounds");
        assert!(error.contains("exceeds GPU bounds"), "{error}");
        assert!(shadows.registered.is_empty());
    }

    #[test]
    fn css_source_sampling_uses_premultiplied_byte_weights() {
        let mut renderer = renderer();
        let storyboard = Storyboard::parse(
            r#"{"scenes":[],"hideBase":true,"videoOverlays":[{"url":"a","durationSec":1,"layout":{"widthPct":100,"heightPct":100,"fit":"stretch"}}]}"#,
        )
        .unwrap();
        for alpha in [255, 128] {
            let input = [1, 2, 3, 5].into_iter().flat_map(|red| [red, 0, 0, alpha]).collect();
            renderer.put_image("a", 2, 2, input).unwrap();
            let frame = pollster::block_on(renderer.render(&storyboard, 0, 3, 3)).unwrap();
            // Four taps at equal weights truncate 2.75 to 2; float bilerp rounds to 3.
            assert_eq!(px(&frame, 1, 1), [2, 0, 0, alpha]);
        }
    }

    #[test]
    fn direct_reveal_fade_and_wipe_draw_sampled_pixels() {
        let mut renderer = renderer();
        renderer.put_image("a", 1, 1, vec![255, 0, 0, 255]).unwrap();
        for kind in ["fade", "wipe"] {
            let storyboard=Storyboard::from_value(serde_json::json!({"scenes":[{"image":"","durationSec":2,"transition":"cut"}],"bgColor":"#0000ff","videoOverlays":[{"url":"a","durationSec":2,"layout":{"widthPct":100,"heightPct":100,"fit":"stretch"},"reveal":{"type":kind}}]})).unwrap();
            let start = pollster::block_on(renderer.render(&storyboard, 0, 100, 100)).unwrap();
            assert_eq!(px(&start, 50, 50), [0, 0, 255, 255]);
            let middle = pollster::block_on(renderer.render(&storyboard, 30, 100, 100)).unwrap();
            assert!(middle.coverage.is_empty());
            if kind == "fade" {
                assert_eq!(px(&middle, 50, 50), [223, 0, 32, 255]);
            } else {
                assert_eq!(px(&middle, 80, 50), [255, 0, 0, 255]);
                assert_eq!(px(&middle, 95, 50), [0, 0, 255, 255]);
            }
        }
    }

    #[test]
    fn scene_blends_do_not_see_previous_scene_pixels() {
        let mut renderer = renderer();
        renderer.put_image("blue", 1, 1, vec![0, 0, 255, 255]).unwrap();
        renderer.put_image("red", 1, 1, vec![255, 0, 0, 255]).unwrap();
        let storyboard = Storyboard::from_value(serde_json::json!({"scenes":[{"image":"blue","startSec":0,"durationSec":2,"movement":"Static","transition":"cut"},{"image":"red","startSec":0,"durationSec":2,"movement":"Static","transition":"cut","layout":{"xPct":25,"yPct":25,"widthPct":50,"heightPct":50,"blendMode":"multiply"}}],"bgColor":"transparent"})).unwrap();
        let frame = pollster::block_on(renderer.render(&storyboard, 0, 100, 100)).unwrap();
        assert!(frame.coverage.is_empty());
        assert_eq!(px(&frame, 50, 50), [255, 0, 0, 255], "isolated red multiplies transparent, not prior blue");
        assert_eq!(px(&frame, 10, 10), [0, 0, 255, 255]);
    }

    #[test]
    fn treatment_failure_does_not_poison_later_frames() {
        let mut renderer = renderer();
        renderer.put_image("a", 1, 1, vec![210, 80, 40, 128]).unwrap();
        let json = serde_json::json!({"scenes":[],"hideBase":true,"videoOverlays":[{"url":"a","durationSec":2,"layout":{"widthPct":100,"heightPct":100,"color":{"brightness":1.4,"contrast":1,"saturation":1}}}]});
        let good = Storyboard::from_value(json.clone()).unwrap();
        let before = pollster::block_on(renderer.render(&good, 0, 100, 100)).unwrap();
        let mut bad = json;
        let mut second = bad["videoOverlays"][0].clone();
        second["layout"]["widthPct"] = serde_json::json!(10000000);
        bad["videoOverlays"].as_array_mut().unwrap().push(second);
        let error = pollster::block_on(renderer.render(&Storyboard::from_value(bad).unwrap(), 0, 100, 100)).err().expect("frame fails");
        assert!(error.contains("exceeds GPU bounds"), "{error}");
        let after = pollster::block_on(renderer.render(&good, 0, 100, 100)).unwrap();
        assert_eq!(before.rgba.iter().zip(&after.rgba).filter(|(a, b)| a != b).count(), 0);
    }

    #[test]
    fn treated_images_survive_gpu_replacement_without_resupply() {
        let mut renderer = renderer();
        renderer.put_image("a", 4, 4, [210, 50, 100, 128].repeat(16)).unwrap();
        let storyboard = Storyboard::from_value(serde_json::json!({"scenes":[{"image":"","durationSec":2,"transition":"cut"}],"bgColor":"#5078a0","videoOverlays":[{"url":"a","durationSec":2,"layout":{"xPct":10,"yPct":10,"widthPct":80,"heightPct":70,"fit":"stretch","blendMode":"multiply","color":{"brightness":1.4,"contrast":0.8,"saturation":2},"mask":{"shape":"ellipse","xPct":10,"yPct":10,"widthPct":80,"heightPct":80,"rotationDeg":20,"featherPct":50,"inverted":true}}}]})).unwrap();
        let before = pollster::block_on(renderer.render(&storyboard, 12, 200, 240)).unwrap();
        renderer.replace_gpu(pollster::block_on(Gpu::new()).unwrap());
        let after = pollster::block_on(renderer.render(&storyboard, 12, 200, 240)).unwrap();
        assert!(after.coverage.is_empty());
        assert_eq!(before.rgba.iter().zip(&after.rgba).filter(|(a, b)| a != b).count(), 0);
        assert_ne!(px(&after, 30, 40), [80, 120, 160, 255], "treated source remains visible");
    }

    #[test]
    fn translucent_blending_matches_css_channel_math() {
        let mut renderer = renderer();
        renderer.put_image("a", 1, 1, vec![200, 100, 50, 128]).unwrap();
        for mode in ["normal", "multiply", "screen"] {
            let storyboard = Storyboard::from_value(serde_json::json!({"scenes":[{"image":"","durationSec":2,"transition":"cut"}],"bgColor":"#5078a0","videoOverlays":[{"url":"a","durationSec":2,"layout":{"widthPct":100,"heightPct":100,"fit":"stretch","opacity":0.6,"blendMode":mode}}]})).unwrap();
            let frame = pollster::block_on(renderer.render(&storyboard, 0, 100, 100)).unwrap();
            assert!(frame.coverage.is_empty());
            let pixel = px(&frame, 50, 50);
            for (c, (base, src)) in [80.0, 120.0, 160.0].into_iter().zip([200.0, 100.0, 50.0]).enumerate() {
                let mixed = match mode {
                    "multiply" => base * src / 255.0,
                    "screen" => 255.0 - (255.0 - base) * (255.0 - src) / 255.0,
                    _ => src,
                };
                let expected = base + (mixed - base) * 128.0 / 255.0 * 0.6;
                assert!((f64::from(pixel[c]) - expected).abs() <= 1.0, "{mode} channel {c}: {} vs {expected}", pixel[c]);
            }
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn broad_mask_targets_keep_at_least_sixteen_samples_per_sigma() {
        let mut renderer = renderer();
        let mut treatments = GpuTreatments { gpu: &mut renderer.gpu, blur: &renderer.blur, correction: &renderer.correction, registered: Vec::new() };
        let (image, bounds) = treatments.blur_mask(&Scene::new(), Rect::new(-232.0, 6.0, 1267.0, 1549.0), 151.2).unwrap();
        assert_eq!((image.width, image.height), (167, 172));
        assert_eq!((bounds.width(), bounds.height()), (1503.0, 1548.0));
        for image in treatments.registered {
            treatments.gpu.release(image);
        }
    }

    #[test]
    fn feathered_mask_and_inverse_preserve_transparent_content() {
        let mut renderer = renderer();
        renderer.put_image("a", 1, 1, vec![255, 0, 0, 128]).unwrap();
        let mut outputs = Vec::new();
        for inverted in [false, true] {
            let storyboard = Storyboard::from_value(serde_json::json!({"scenes":[],"hideBase":true,"videoOverlays":[{"url":"a","durationSec":2,"layout":{"widthPct":100,"heightPct":100,"fit":"stretch","mask":{"shape":"rectangle","xPct":25,"yPct":25,"widthPct":50,"heightPct":50,"rotationDeg":30,"featherPct":50,"inverted":inverted}}}]})).unwrap();
            let frame = pollster::block_on(renderer.render(&storyboard, 0, 100, 80)).unwrap();
            assert!(frame.coverage.is_empty());
            outputs.push(frame);
        }
        assert!(px(&outputs[0], 50, 40)[3] > px(&outputs[0], 2, 2)[3]);
        for (i, (a, b)) in outputs[0].rgba.as_chunks::<4>().0.iter().zip(outputs[1].rgba.as_chunks::<4>().0).enumerate() {
            assert!((i16::from(a[3]) + i16::from(b[3]) - 128).abs() <= 1, "mask plus inverse changed source alpha at {i}: {a:?} + {b:?}");
            for p in [a, b] {
                if p[3] > 0 {
                    assert_eq!(&p[..3], &[255, 0, 0]);
                }
            }
        }
    }

    #[test]
    fn masks_clip_locally_and_invert_without_changing_backdrop() {
        let mut renderer = renderer();
        renderer.put_image("a", 1, 1, vec![255, 0, 0, 255]).unwrap();
        for inverted in [false, true] {
            let storyboard = Storyboard::from_value(serde_json::json!({"scenes":[{"image":"","durationSec":2,"transition":"cut"}],"bgColor":"#0000ff","videoOverlays":[{"url":"a","durationSec":2,"layout":{"widthPct":100,"heightPct":100,"fit":"stretch","mask":{"shape":"ellipse","xPct":25,"yPct":25,"widthPct":50,"heightPct":50,"rotationDeg":0,"featherPct":0,"inverted":inverted}}}]})).unwrap();
            let frame = pollster::block_on(renderer.render(&storyboard, 0, 400, 100)).unwrap();
            assert!(frame.coverage.is_empty());
            let red = [255, 0, 0, 255];
            let blue = [0, 0, 255, 255];
            assert_eq!(px(&frame, 200, 50), if inverted { blue } else { red });
            assert_eq!(px(&frame, 10, 50), if inverted { red } else { blue });
            assert_eq!(px(&frame, 105, 27), if inverted { red } else { blue }, "ellipse corner");
        }
    }

    #[test]
    fn invalid_color_target_fails_the_frame() {
        let mut renderer = renderer();
        renderer.put_image("a", 1, 1, vec![200, 80, 20, 255]).unwrap();
        let storyboard = Storyboard::parse(r#"{"scenes":[],"videoOverlays":[{"url":"a","layout":{"widthPct":10000000,"heightPct":100,"color":{"brightness":2,"contrast":1,"saturation":1}}}]}"#).unwrap();
        let error = pollster::block_on(renderer.render(&storyboard, 0, 100, 100)).err().expect("refused");
        assert!(error.contains("color correction target") && error.contains("exceeds GPU bounds"), "{error}");
    }

    #[test]
    fn blurred_text_pixels_are_stable_after_seeking() {
        let mut renderer = renderer();
        let storyboard = Storyboard::parse(include_str!("../corpus/text-keyed-blur/storyboard.json")).unwrap();
        let mut direct = std::collections::BTreeMap::new();
        for frame in [0, 45, 75] {
            direct.insert(frame, pollster::block_on(renderer.render(&storyboard, frame, 1080, 1920)).unwrap().rgba);
        }
        for frame in [75, 45, 0] {
            let rgba = pollster::block_on(renderer.render(&storyboard, frame, 1080, 1920)).unwrap().rgba;
            let changed = rgba.iter().zip(&direct[&frame]).filter(|(a, b)| a != b).count();
            assert_eq!(changed, 0, "blurred text frame {frame} changed after seeking");
        }
    }

    #[test]
    fn camera_transforms_the_intrinsic_clip_before_parent_clipping() {
        let mut renderer = renderer();
        renderer.put_image("wide", 4, 2, [255, 0, 0, 255].repeat(8)).unwrap();
        let tracking =
            Storyboard::parse(r##"{"scenes":[{"image":"wide","movement":"follow-tracking","durationSec":4,"transition":"cut"}],"bgColor":"#0000ff"}"##)
                .unwrap();
        for width in [100, 400] {
            let frame = pollster::block_on(renderer.render(&tracking, 0, width, 100)).unwrap();
            assert_eq!(px(&frame, width - 10, 50), [0, 0, 255, 255], "25 source pixels leave a right gap at any canvas width");
            assert_eq!(px(&frame, width - 30, 50), [255, 0, 0, 255]);
        }
        let rotated = Storyboard::parse(r##"{"scenes":[{"image":"wide","movement":"static","durationSec":4,"transition":"cut","motion":{"keyframes":[{"t":0,"scale":1,"x":0,"y":0,"rotate":45},{"t":1,"scale":1,"x":0,"y":0,"rotate":45}]}}],"bgColor":"#0000ff"}"##).unwrap();
        let frame = pollster::block_on(renderer.render(&rotated, 0, 100, 100)).unwrap();
        assert_eq!(px(&frame, 1, 1), [0, 0, 255, 255], "cover-fit pixels outside the image box cannot enter through rotation");
        assert_eq!(px(&frame, 50, 50), [255, 0, 0, 255]);
    }
}
