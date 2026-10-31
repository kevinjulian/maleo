//! Plain text overlays (`preset === "plain"` in `StoryboardReel.tsx`) and the
//! text layout both text layers share.
//!
//! A plain overlay with a layout box is a `TemplateFrame` box with a flex
//! column inside: the text block is centred across, and `align` picks top,
//! middle or bottom (the column's `justifyContent`). Without a box it sits in
//! the frame inset by 64 px, centred. The block shrinks to its text, carries
//! the overlay background with `12px 22px` padding and a 12 px radius, and a
//! `0 4px 16px rgba(0,0,0,0.5)` text shadow.

use parley::{
    Alignment, CHROMIUM_LINE_BREAK_OVERRIDE, FontFamily, FontStyle, FontWeight, Layout, LayoutContext, LineHeight, OverflowWrap, PositionedLayoutItem,
    StyleProperty,
};
use vello::Scene;
use vello::kurbo::{Affine, Rect, RoundedRect};
use vello::peniko::{Fill, ImageBrush};

use super::{Canvas, SILHOUETTE, Treatments, pixel_bounds};
use crate::fonts::{FAMILY, Fonts};
use crate::paint::{Rgba, parse_color};
use crate::storyboard::{Storyboard, TextOverlay};

/// The word a glyph run belongs to; -1 for text between words.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct WordBrush(pub i32);

impl Default for WordBrush {
    fn default() -> Self {
        Self(-1)
    }
}

/// Font settings for one text block.
#[derive(Debug, Clone, Copy)]
pub struct Font {
    pub size: f32,
    pub weight: f32,
    pub italic: bool,
    pub line_height: f32,
    pub letter_spacing: Option<f32>,
    /// CSS `overflow-wrap: anywhere`.
    pub break_anywhere: bool,
}

/// Lays `text` out as Chrome breaks it, with per-word brushes.
pub fn layout(
    fonts: &mut Fonts,
    layouts: &mut LayoutContext<WordBrush>,
    text: &str,
    font: Font,
    words: &[std::ops::Range<usize>],
    max: Option<f32>,
) -> Layout<WordBrush> {
    let mut builder = layouts.ranged_builder(&mut fonts.context, text, 1.0, false);
    builder.set_line_break_override(Some(CHROMIUM_LINE_BREAK_OVERRIDE));
    builder.push_default(StyleProperty::FontFamily(FontFamily::Source(FAMILY.into())));
    builder.push_default(StyleProperty::FontSize(font.size));
    builder.push_default(StyleProperty::FontWeight(FontWeight::new(font.weight)));
    builder.push_default(StyleProperty::FontStyle(if font.italic { FontStyle::Italic } else { FontStyle::Normal }));
    builder.push_default(StyleProperty::LineHeight(LineHeight::FontSizeRelative(font.line_height)));
    if let Some(spacing) = font.letter_spacing {
        builder.push_default(StyleProperty::LetterSpacing(spacing));
    }
    if font.break_anywhere {
        builder.push_default(StyleProperty::OverflowWrap(OverflowWrap::Anywhere));
    }
    builder.push_default(StyleProperty::Brush(WordBrush::default()));
    for (index, range) in words.iter().enumerate() {
        builder.push(StyleProperty::Brush(WordBrush(index as i32)), range.clone());
    }
    let mut layout = builder.build(text);
    layout.break_all_lines(max);
    layout
}

/// The horizontal offset of a line for `text-align`, hanging spaces excluded.
pub fn line_shift(align: Alignment, content_width: f32, metrics: &parley::LineMetrics) -> f32 {
    let free = content_width - (metrics.advance - metrics.trailing_whitespace);
    match align {
        Alignment::Center => free / 2.0,
        Alignment::End | Alignment::Right => free,
        _ => 0.0,
    }
}

/// CSS `white-space: normal`: runs of white space, line breaks included,
/// collapse to one space, and lines do not start or end with one.
fn collapse_white_space(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The shadow every styled plain overlay carries.
const SHADOW_OFFSET_Y: f64 = 4.0;
const SHADOW_BLUR: f32 = 16.0;
const SHADOW_COLOR: Rgba = Rgba { r: 0, g: 0, b: 0, a: 0.5 };
const PADDING: (f64, f64) = (22.0, 12.0);
const RADIUS: f64 = 12.0;
/// The browser's default text size and color, for a style without them.
const DEFAULT_SIZE: f32 = 16.0;
const DEFAULT_FILL: Rgba = Rgba { r: 0, g: 0, b: 0, a: 1.0 };

/// The text block of a plain overlay, resolved from its style.
struct Block {
    text: String,
    font: Font,
    fill: Rgba,
    background: Option<Rgba>,
    shadow: bool,
    align: Alignment,
    /// The flex column's `justifyContent`: 0 top, 0.5 middle, 1 bottom.
    justify: f64,
}

fn block(fg_color: &str, overlay: &TextOverlay) -> Block {
    let upper = overlay.style.as_ref().is_some_and(|s| s.casing.as_deref() == Some("upper"));
    let text = collapse_white_space(&if upper { overlay.content.to_uppercase() } else { overlay.content.clone() });
    match &overlay.style {
        // textPresetStyle("plain") in the storyboard foreground color.
        None => Block {
            text,
            font: Font { size: 64.0, weight: 400.0, italic: false, line_height: 1.2, letter_spacing: None, break_anywhere: false },
            fill: parse_color(fg_color).unwrap_or(DEFAULT_FILL),
            background: None,
            shadow: false,
            align: Alignment::Center,
            justify: 0.5,
        },
        Some(style) => {
            let align = style.align.as_deref().unwrap_or("center");
            let background = style.background.as_deref().filter(|b| *b != "transparent").and_then(parse_color);
            Block {
                text,
                font: Font {
                    size: style.font_size.map_or(DEFAULT_SIZE, |s| s as f32),
                    weight: style.weight.map_or(400.0, |w| w as f32),
                    italic: false,
                    line_height: style.line_height.map_or(1.1, |l| l as f32),
                    letter_spacing: style.letter_spacing.map(|l| l as f32),
                    break_anywhere: false,
                },
                fill: style.fill.as_deref().and_then(parse_color).unwrap_or(DEFAULT_FILL),
                background,
                shadow: true,
                align: match align {
                    "left" => Alignment::Left,
                    "right" => Alignment::Right,
                    _ => Alignment::Center,
                },
                justify: match align {
                    "left" => 0.0,
                    "right" => 1.0,
                    _ => 0.5,
                },
            }
        }
    }
}

/// Calls `draw` with every glyph run of `layout` from `origin`: its x offset
/// and glyphs. Skia positions horizontal text at subpixel x but rounds each
/// baseline to a whole pixel.
// ponytail: rounds in this scene's coordinates, which are device pixels only
// under integer translations; track the device transform on Canvas if scaled
// or fractionally placed text must match too.
fn glyph_runs(
    layout: &Layout<WordBrush>,
    origin: (f64, f64),
    content_width: f32,
    align: Alignment,
    mut draw: impl FnMut(&parley::GlyphRun<'_, WordBrush>, f64, Vec<vello::Glyph>),
) {
    for line in layout.lines() {
        let shift = f64::from(line_shift(align, content_width, line.metrics()));
        for item in line.items() {
            let PositionedLayoutItem::GlyphRun(run) = item else { continue };
            let glyphs = run.positioned_glyphs().map(|g| vello::Glyph { id: g.id, x: g.x, y: (origin.1 + f64::from(g.y)).round() as f32 }).collect();
            draw(&run, origin.0 + shift, glyphs);
        }
    }
}

fn draw_run(scene: &mut Scene, run: &parley::GlyphRun<'_, WordBrush>, x: f64, glyphs: impl Iterator<Item = vello::Glyph>, color: Rgba) {
    scene
        .draw_glyphs(run.run().font())
        .font_size(run.run().font_size())
        .normalized_coords(run.run().normalized_coords())
        .transform(Affine::translate((x, 0.0)))
        .brush(color.color())
        .hint(false)
        .draw(Fill::NonZero, glyphs);
}

/// Draws every glyph of `layout` from `origin` in `color`.
pub(super) fn draw_glyphs(scene: &mut Scene, layout: &Layout<WordBrush>, origin: (f64, f64), content_width: f32, align: Alignment, color: Rgba) {
    glyph_runs(layout, origin, content_width, align, |run, x, glyphs| draw_run(scene, run, x, glyphs.into_iter(), color));
}

/// Skia draws text up to this size from its glyph cache, each glyph's mask
/// blurred alone (`SkScalerContext` applies the mask filter per glyph);
/// larger text is drawn as one blurred path.
const MAX_MASK_TEXT_SIZE: f32 = 256.0;

/// One shadow silhouette per glyph, with the pixel box its blurred mask fills.
fn glyph_silhouettes(layout: &Layout<WordBrush>, origin: (f64, f64), content_width: f32, align: Alignment, size: f32, reach: f64) -> Vec<(Scene, Rect)> {
    let size = f64::from(size);
    let mut silhouettes = Vec::new();
    glyph_runs(layout, origin, content_width, align, |run, x, glyphs| {
        for (glyph, advance) in glyphs.into_iter().zip(run.glyphs().map(|g| f64::from(g.advance))) {
            let (gx, gy) = (x + f64::from(glyph.x), f64::from(glyph.y));
            let bounds = Rect::new(gx - 0.5 * size, gy - 1.5 * size, gx + advance + 0.5 * size, gy + 0.75 * size).inflate(reach, reach);
            let mut scene = Scene::new();
            draw_run(&mut scene, run, x, std::iter::once(glyph), SILHOUETTE);
            silhouettes.push((scene, Rect::new(bounds.x0.floor(), bounds.y0.floor(), bounds.x1.ceil(), bounds.y1.ceil())));
        }
    });
    silhouettes
}

/// Draws the plain text overlay `index`.
pub fn draw(
    canvas: &mut Canvas<'_>,
    shadows: &mut dyn Treatments,
    fonts: &mut Fonts,
    layouts: &mut LayoutContext<WordBrush>,
    storyboard: &Storyboard,
    index: usize,
    time: (f64, f64),
) -> Result<(), String> {
    draw_overlay(canvas, shadows, fonts, layouts, &storyboard.fg_color, &storyboard.text_overlays[index], time)
}

pub fn draw_overlay(
    canvas: &mut Canvas<'_>,
    shadows: &mut dyn Treatments,
    fonts: &mut Fonts,
    layouts: &mut LayoutContext<WordBrush>,
    fg_color: &str,
    overlay: &TextOverlay,
    time: (f64, f64),
) -> Result<(), String> {
    let (seconds, duration_sec) = time;
    let sampled = super::text_motion::sample(overlay, seconds, duration_sec)?;
    let overlay = &sampled.overlay;
    let block = block(fg_color, overlay);
    let (container, opacity, box_fill) = match &overlay.layout {
        // TemplateFrame: the layout box, its opacity and its bgOpacity fill.
        Some(l) => {
            let (x, y) = (canvas.width * l.x_pct.unwrap_or(0.0) / 100.0, canvas.height * l.y_pct.unwrap_or(0.0) / 100.0);
            let rect = Rect::new(x, y, x + canvas.width * l.width_pct.unwrap_or(100.0) / 100.0, y + canvas.height * l.height_pct.unwrap_or(100.0) / 100.0);
            let style = overlay.style.as_ref();
            let bg_opacity = style.and_then(|s| s.bg_opacity).unwrap_or(0.0);
            let fill = style
                .and_then(|s| s.background.as_deref())
                .filter(|b| *b != "transparent" && bg_opacity > 0.0)
                .and_then(parse_color)
                .map(|c| c.with_alpha((bg_opacity.min(1.0) * 100.0).round() as f32 / 100.0));
            (rect, l.opacity.unwrap_or(1.0), fill)
        }
        None => (canvas.frame().inset(-64.0), 1.0, None),
    };
    let padding = if block.background.is_some() { PADDING } else { (0.0, 0.0) };
    let widths = layout(fonts, layouts, &block.text, block.font, &[], None).calculate_content_widths();
    // Shrink to fit: the text's own width, at most the room the box gives,
    // never below its longest word.
    let room = (container.width() - 2.0 * padding.0) as f32;
    let content_width = widths.max.min(room.max(widths.min));
    let text = layout(fonts, layouts, &block.text, block.font, &[], Some(content_width + 1e-3));
    let size = (f64::from(content_width) + 2.0 * padding.0, f64::from(text.height()) + 2.0 * padding.1);
    let x = container.x0 + (container.width() - size.0) / 2.0;
    let y = container.y0 + (container.height() - size.1) * block.justify;
    let div = Rect::new(x, y, x + size.0, y + size.1);
    let origin = (x + padding.0, y + padding.1);
    // Chromium folds an opacity layer around one draw op into that op's paint
    // (SkMulDiv255Round): a single unboxed, unfiltered line of text and its
    // shadow is one text blob, so it skips the layer's byte composite.
    let fold = block.background.is_none() && sampled.blur <= 0.0 && text.len() == 1;
    let folded = fold.then(|| (sampled.content_opacity().clamp(0.0, 1.0) * 255.0).round() as f32);
    let content_opacity = if fold { 1.0 } else { sampled.content_opacity() };
    let paint = |c: Rgba| match folded {
        Some(opacity) => Rgba { a: ((c.a * 255.0).round() * opacity / 255.0).round() / 255.0, ..c },
        None => c,
    };

    let shadow_origin = (origin.0, origin.1 + SHADOW_OFFSET_Y);
    let silhouettes = if !block.shadow {
        Vec::new()
    } else if block.font.size <= MAX_MASK_TEXT_SIZE {
        glyph_silhouettes(&text, shadow_origin, content_width, block.align, block.font.size, f64::from(SHADOW_BLUR) * 1.5)
    } else {
        let mut silhouette = Scene::new();
        draw_glyphs(&mut silhouette, &text, shadow_origin, content_width, block.align, SILHOUETTE);
        let reach = f64::from(SHADOW_BLUR) * 1.5 + f64::from(block.font.size) * 0.5;
        vec![(silhouette, div.inflate(reach, reach + SHADOW_OFFSET_Y))]
    };
    let blurred: Vec<_> = silhouettes
        .iter()
        .filter_map(|(silhouette, bounds)| {
            let bounds = pixel_bounds(*bounds, canvas.width, canvas.height);
            shadows.shadow(silhouette, bounds, SHADOW_BLUR, paint(SHADOW_COLOR)).map(|image| (image, bounds))
        })
        .collect();
    let mut body = Scene::new();
    {
        let canvas = &mut Canvas { scene: &mut body, media: canvas.media, width: canvas.width, height: canvas.height, pixelated: canvas.pixelated };
        if let Some(background) = block.background {
            canvas.scene.fill(Fill::NonZero, Affine::IDENTITY, background.color(), None, &RoundedRect::from_rect(div, RADIUS));
        }
        // Skia blits each blurred mask in bytes, so every blit truncates:
        // on #10182b a tail is a level darker, and overlapping tails more.
        for (image, bounds) in &blurred {
            canvas.skia_layer(1.0, |canvas| canvas.scene.draw_image(&ImageBrush::new(image.clone()), Affine::translate(bounds.origin().to_vec2())));
        }
        draw_glyphs(canvas.scene, &text, origin, content_width, block.align, paint(block.fill));
    }
    let before = sampled.before_blur(container);
    let mut content = Scene::new();
    content.append(&body, Some(before));
    if sampled.blur > 0.0 {
        let reach = f64::from(SHADOW_BLUR) * 1.5 + f64::from(block.font.size) * 0.5;
        let bounds = before.transform_rect_bbox(div.inflate(reach, reach + SHADOW_OFFSET_Y)).inflate(sampled.blur * 3.0, sampled.blur * 3.0);
        let bounds = Rect::new(bounds.x0.floor(), bounds.y0.floor(), bounds.x1.ceil(), bounds.y1.ceil());
        let image = shadows.blur_content(&content, bounds, sampled.blur as f32)?;
        content.reset();
        content.draw_image(&ImageBrush::new(image), Affine::translate(bounds.origin().to_vec2()));
    }
    let rotation = overlay.layout.as_ref().and_then(|l| l.rotation_deg).unwrap_or(0.0);
    canvas.transformed(super::image::outer_transform(container, rotation, sampled.box_scale), |canvas| {
        canvas.group(opacity, |canvas| {
            if let Some(fill) = box_fill {
                canvas.scene.fill(Fill::NonZero, Affine::IDENTITY, fill.color(), None, &container);
            }
            canvas.group(content_opacity, |canvas| canvas.scene.append(&content, Some(sampled.after_blur(container))));
        });
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn white_space_collapses_as_css_normal() {
        assert_eq!(collapse_white_space("  Hello\n\n  world \t!  "), "Hello world !");
    }
}
