//! The Rust candidate: parley lays the cue out like the CSS box in Captions.tsx,
//! and vello draws it offscreen through wgpu.

use std::collections::HashMap;

use parley::fontique::Blob;
use parley::{
    CHROMIUM_LINE_BREAK_OVERRIDE, FontContext, FontFamily, FontStyle, FontWeight, Layout, LayoutContext, LineHeight, OverflowWrap, PositionedLayoutItem,
    StyleProperty,
};
use vello::kurbo::{Affine, Join, Rect, Stroke};
use vello::peniko::{Blob as ImageBlob, Color, Fill, ImageAlphaType, ImageBrush, ImageData, ImageFormat, Mix};
use vello::{AaConfig, RenderParams, Renderer, RendererOptions, Scene, wgpu};

use crate::fixture::{CaptionFrame, Rgba};

const FAMILY: &str = "Inter, system-ui, sans-serif";
const LINE_HEIGHT: f32 = 1.15;
const STROKE_WIDTH: f64 = 3.0;
/// Inner padding when the cue has a background: `14px 24px`.
const PAD: (f32, f32) = (24.0, 14.0);

/// The word a glyph run belongs to; -1 for text between words.
#[derive(Clone, Copy, PartialEq, Debug)]
struct WordBrush(i32);

impl Default for WordBrush {
    fn default() -> Self {
        Self(-1)
    }
}

pub struct CaptionRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    vello: Renderer,
    fonts: FontContext,
    layouts: LayoutContext<WordBrush>,
    inter: Vec<u64>,
}

fn rgba(color: Rgba) -> Color {
    Color::from_rgba8(color[0], color[1], color[2], color[3])
}

impl CaptionRenderer {
    /// `font_files`: the Inter files @remotion/google-fonts loads, as TTF.
    pub fn new(font_files: &[Vec<u8>]) -> Self {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default())).expect("adapter");
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).expect("device");
        let vello =
            Renderer::new(&device, RendererOptions { antialiasing_support: vello::AaSupport::area_only(), ..Default::default() }).expect("vello renderer");
        let mut fonts = FontContext::new();
        let mut inter = Vec::new();
        for data in font_files {
            let blob = Blob::new(std::sync::Arc::new(data.clone()));
            inter.push(blob.id());
            fonts.collection.register_fonts(blob, None);
        }
        Self { device, queue, vello, fonts, layouts: LayoutContext::new(), inter }
    }

    fn layout(&mut self, cue: &CaptionFrame, max_advance: Option<f32>) -> Layout<WordBrush> {
        let mut builder = self.layouts.ranged_builder(&mut self.fonts, &cue.text, 1.0, false);
        builder.set_line_break_override(Some(CHROMIUM_LINE_BREAK_OVERRIDE));
        builder.push_default(StyleProperty::FontFamily(FontFamily::Source(FAMILY.into())));
        builder.push_default(StyleProperty::FontSize(cue.font_size));
        builder.push_default(StyleProperty::FontWeight(FontWeight::new(cue.weight)));
        builder.push_default(StyleProperty::FontStyle(if cue.italic { FontStyle::Italic } else { FontStyle::Normal }));
        builder.push_default(StyleProperty::LineHeight(LineHeight::FontSizeRelative(LINE_HEIGHT)));
        builder.push_default(StyleProperty::OverflowWrap(OverflowWrap::Anywhere));
        builder.push_default(StyleProperty::Brush(WordBrush::default()));
        for (index, word) in cue.words.iter().enumerate() {
            builder.push(StyleProperty::Brush(WordBrush(index as i32)), word.range.clone());
        }
        let mut layout = builder.build(&cue.text);
        layout.break_all_lines(max_advance);
        layout
    }

    /// Lays the cue out as Captions.tsx does and returns the frame as RGBA.
    pub fn render(&mut self, cue: &CaptionFrame, width: u32, height: u32, background: Rgba) -> (Vec<u8>, Geometry) {
        let pad = if cue.background.is_some() { PAD } else { (0.0, 0.0) };
        // `width: max-content` capped by `maxWidth`, padding inside the box.
        let max_content = self.layout(cue, None).width();
        let content_width = max_content.min(cue.max_width - 2.0 * pad.0);
        let layout = self.layout(cue, Some(content_width + 1e-3));
        let box_width = content_width + 2.0 * pad.0;
        let box_height = layout.height() + 2.0 * pad.1;
        // `top: vertical%` then `translate: 0 -100%`, centred horizontally.
        let box_left = (width as f32 - box_width) / 2.0;
        let box_top = height as f32 * cue.vertical_pct / 100.0 - box_height;
        let origin = (box_left + pad.0, box_top + pad.1);
        let geometry = Geometry { baselines: layout.lines().map(|line| origin.1 + line.metrics().baseline).collect() };

        let shadow = cue.shadow.as_ref().map(|shadow| {
            let mut scene = Scene::new();
            let at = (origin.0 + shadow.dx, origin.1 + shadow.dy);
            self.draw_text(&mut scene, cue, &layout, content_width, at, Some(shadow.color));
            let pixels = self.rasterize(&scene, width, height, [0, 0, 0, 0]);
            shadow_image(&pixels, width, height, shadow.blur, shadow.color)
        });

        let mut scene = Scene::new();
        if let Some(fill) = cue.background {
            let rect = Rect::new(box_left as f64, box_top as f64, (box_left + box_width) as f64, (box_top + box_height) as f64);
            scene.fill(Fill::NonZero, Affine::IDENTITY, rgba(fill), None, &rect);
        }
        if let Some(image) = shadow {
            scene.draw_image(&ImageBrush::new(image), Affine::IDENTITY);
        }
        self.draw_text(&mut scene, cue, &layout, content_width, origin, None);
        (self.rasterize(&scene, width, height, background), geometry)
    }

    /// Draws every word: fill, then the stroke over it, in a layer when faded.
    /// With `silhouette`, draws the shadow shape in that color instead.
    fn draw_text(&self, scene: &mut Scene, cue: &CaptionFrame, layout: &Layout<WordBrush>, content_width: f32, origin: (f32, f32), silhouette: Option<Rgba>) {
        // The word box of `display: inline-block`: union of its runs on one line.
        let mut boxes: HashMap<i32, Rect> = HashMap::new();
        let mut runs = Vec::new();
        for line in layout.lines() {
            let metrics = line.metrics();
            // `text-align: center`, hanging trailing spaces excluded.
            let shift = (content_width - (metrics.advance - metrics.trailing_whitespace)) / 2.0;
            for item in line.items() {
                let PositionedLayoutItem::GlyphRun(run) = item else { continue };
                let word = run.style().brush.0;
                let x = origin.0 + shift + run.offset();
                let rect =
                    Rect::new(x as f64, (origin.1 + metrics.block_min_coord) as f64, (x + run.advance()) as f64, (origin.1 + metrics.block_max_coord) as f64);
                boxes.entry(word).and_modify(|r| *r = r.union(rect)).or_insert(rect);
                runs.push((run, origin.0 + shift, word));
            }
        }
        let full = Rect::new(0.0, 0.0, 1e5, 1e5);
        for (run, x0, word) in runs {
            let paint = (word >= 0).then(|| &cue.words[word as usize]);
            let (color, opacity, scale) = paint.map_or((cue.fill, 1.0, 1.0), |p| (p.color, p.opacity, p.scale));
            let transform = if scale == 1.0 {
                Affine::IDENTITY
            } else {
                let center = boxes[&word].center();
                Affine::translate(center.to_vec2()) * Affine::scale(scale as f64) * Affine::translate(-center.to_vec2())
            };
            let glyphs: Vec<vello::Glyph> = run.positioned_glyphs().map(|g| vello::Glyph { id: g.id, x: x0 + g.x, y: origin.1 + g.y }).collect();
            let font = run.run().font();
            let coords = run.run().normalized_coords();
            let brush = rgba(silhouette.unwrap_or(color));
            if opacity < 1.0 {
                scene.push_layer(Fill::NonZero, Mix::Normal, opacity, Affine::IDENTITY, &full);
            }
            scene
                .draw_glyphs(font)
                .font_size(run.run().font_size())
                .normalized_coords(coords)
                .transform(transform)
                .brush(brush)
                .hint(false)
                .draw(Fill::NonZero, glyphs.iter().copied());
            // Color emoji have no outline to stroke.
            if let Some(stroke) = cue.stroke.filter(|_| self.inter.contains(&font.data.id())) {
                scene
                    .draw_glyphs(font)
                    .font_size(run.run().font_size())
                    .normalized_coords(coords)
                    .transform(transform)
                    .brush(rgba(silhouette.unwrap_or(stroke)))
                    .hint(false)
                    .draw(&Stroke::new(STROKE_WIDTH).with_join(Join::Miter).with_miter_limit(4.0), glyphs.iter().copied());
            }
            if opacity < 1.0 {
                scene.pop_layer();
            }
        }
    }

    /// Renders a scene offscreen through wgpu and reads it back as RGBA.
    fn rasterize(&mut self, scene: &Scene, width: u32, height: u32, base: Rgba) -> Vec<u8> {
        let size = wgpu::Extent3d { width, height, depth_or_array_layers: 1 };
        let target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("caption"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = target.create_view(&Default::default());
        let params = RenderParams { base_color: rgba(base), width, height, antialiasing_method: AaConfig::Area };
        self.vello.render_to_texture(&self.device, &self.queue, scene, &view, &params).expect("vello render");

        let row = (width * 4).div_ceil(256) * 256;
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: u64::from(row * height),
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            target.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(height) },
            },
            size,
        );
        self.queue.submit([encoder.finish()]);
        let slice = buffer.slice(..);
        slice.map_async(wgpu::MapMode::Read, |result| result.expect("map"));
        self.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None }).expect("poll");
        let mapped = slice.get_mapped_range().expect("mapped");
        let mut pixels = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            let start = (y * row) as usize;
            pixels.extend_from_slice(&mapped[start..start + (width * 4) as usize]);
        }
        pixels
    }
}

/// Where the caption box landed, for the structural checks.
pub struct Geometry {
    /// Baseline of each line, in frame pixels.
    pub baselines: Vec<f32>,
}

/// CSS `text-shadow` blur: a Gaussian with sigma = radius / 2 over the
/// silhouette's alpha, tinted with the shadow color.
// ponytail: CPU blur; vello has no blur for arbitrary shapes. A wgpu blur pass replaces it in P2.
fn shadow_image(silhouette: &[u8], width: u32, height: u32, radius: f32, color: Rgba) -> ImageData {
    let (w, h) = (width as usize, height as usize);
    let alpha: Vec<f32> = silhouette.chunks_exact(4).map(|p| f32::from(p[3]) / 255.0).collect();
    let sigma = (radius / 2.0).max(0.01);
    let reach = (sigma * 3.0).ceil() as i64;
    let kernel: Vec<f32> = (-reach..=reach).map(|i| (-((i * i) as f32) / (2.0 * sigma * sigma)).exp()).collect();
    let total: f32 = kernel.iter().sum();
    let pass = |src: &[f32], horizontal: bool| -> Vec<f32> {
        let mut out = vec![0.0; w * h];
        for y in 0..h {
            for x in 0..w {
                let mut acc = 0.0;
                for (k, weight) in kernel.iter().enumerate() {
                    let d = k as i64 - reach;
                    let (sx, sy) = if horizontal { (x as i64 + d, y as i64) } else { (x as i64, y as i64 + d) };
                    if sx >= 0 && sy >= 0 && (sx as usize) < w && (sy as usize) < h {
                        acc += src[sy as usize * w + sx as usize] * weight;
                    }
                }
                out[y * w + x] = acc / total;
            }
        }
        out
    };
    let blurred = pass(&pass(&alpha, true), false);
    let mut data = Vec::with_capacity(w * h * 4);
    for a in blurred {
        data.extend_from_slice(&[color[0], color[1], color[2], (a * f32::from(color[3])).round().clamp(0.0, 255.0) as u8]);
    }
    ImageData { data: ImageBlob::from(data), format: ImageFormat::Rgba8, alpha_type: ImageAlphaType::Alpha, width, height }
}
