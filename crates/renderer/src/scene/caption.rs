//! Caption cues, as `packages/video/src/components/Captions.tsx` draws them.
//! The layout rules come from spike C (`render.rs`): `max-content` width
//! capped at `maxWidth`, `14px 24px` box padding, `top: N%` with
//! `translate: 0 -100%`, line height 1.15, centred lines without hanging
//! spaces, inline-block words, a 3 px miter stroke and the faded-word layer.
//! The shadow blurs on the GPU (`blur.rs`).

use std::collections::HashMap;
use std::ops::Range;

use parley::{Alignment, Layout, LayoutContext, PositionedLayoutItem};
use serde_json::{Map, Value};
use vello::Scene;
use vello::kurbo::{Affine, Join, Rect, Stroke};
use vello::peniko::{Fill, ImageBrush, Mix};

use super::text::{Font, WordBrush, layout, line_shift};
use super::{Canvas, SILHOUETTE, Treatments, pixel_bounds};
use crate::coverage::caption_style;
use crate::fonts::Fonts;
use crate::paint::{Paint, Rgba, brush, parse_color, parse_paint};
use crate::storyboard::{CaptionWord, Storyboard};

const LINE_HEIGHT: f32 = 1.15;
const STROKE_WIDTH: f64 = 3.0;
/// Inner padding when the cue has a background: `14px 24px`.
const PAD: (f64, f64) = (24.0, 14.0);
/// Seconds the entrance motions take.
const ENTRY_SEC: f64 = 0.16;

/// `weightValue()` in `Captions.tsx`.
fn weight_value(weight: Option<&str>) -> f32 {
    match weight {
        Some("Black") => 900.0,
        Some("Bold") => 800.0,
        Some("Medium") => 600.0,
        _ => 500.0,
    }
}

/// The active word at `local_sec`: the last word started, held through gaps.
pub fn active_word(words: &[CaptionWord], local_sec: f64) -> i32 {
    let mut active = -1;
    for (index, word) in words.iter().enumerate() {
        if local_sec >= word.start_sec {
            active = index as i32;
        }
        if local_sec >= word.start_sec && local_sec < word.end_sec {
            break;
        }
    }
    active
}

/// `textParts()`: timed tokens aligned to the authored text, spaces and line
/// breaks kept. A word that is not found makes the whole text one plain part.
pub fn text_parts(text: &str, words: &[CaptionWord]) -> Vec<(String, Option<usize>)> {
    let mut out = Vec::new();
    let mut cursor = 0;
    for (index, word) in words.iter().enumerate() {
        let Some(found) = text[cursor..].find(&word.text) else { return vec![(text.to_owned(), None)] };
        let start = cursor + found;
        if start > cursor {
            out.push((text[cursor..start].to_owned(), None));
        }
        out.push((word.text.clone(), Some(index)));
        cursor = start + word.text.len();
    }
    if cursor < text.len() {
        out.push((text[cursor..].to_owned(), None));
    }
    out
}

/// `alphaColor()`: the opacity applies to `#rrggbb` only.
fn alpha_color(value: &str, opacity_pct: f64) -> Option<Rgba> {
    let color = parse_color(value)?;
    let hex6 = value.len() == 7 && value.starts_with('#') && value[1..].bytes().all(|b| b.is_ascii_hexdigit());
    Some(if hex6 { color.with_alpha((opacity_pct.clamp(0.0, 100.0) / 100.0) as f32) } else { color })
}

struct Shadow {
    offset: (f64, f64),
    blur: f32,
    color: Rgba,
}

struct WordPaint {
    color: Rgba,
    opacity: f32,
    scale: f64,
}

/// Everything the cue draws at one frame.
struct Cue {
    text: String,
    ranges: Vec<Range<usize>>,
    words: Vec<WordPaint>,
    font: Font,
    fill: Rgba,
    stroke: Option<Rgba>,
    shadow: Option<Shadow>,
    background: Option<Paint>,
    vertical_pct: f64,
    max_width: f64,
    opacity: f64,
    scale: f64,
    slide: f64,
}

fn cue(storyboard: &Storyboard, index: usize, local_sec: f64, width: f64) -> Cue {
    let style: Map<String, Value> = caption_style(storyboard, index);
    let text_of = |key: &str| style.get(key).and_then(Value::as_str);
    let number = |key: &str| style.get(key).and_then(Value::as_f64);
    let caption = &storyboard.caption_cues[index].caption;
    let fill = text_of("fill").and_then(parse_color).or_else(|| parse_color(&storyboard.fg_color)).unwrap_or(Rgba { r: 255, g: 255, b: 255, a: 1.0 });
    let highlight =
        text_of("activeColor").filter(|c| *c != "transparent").and_then(parse_color).or_else(|| parse_color(&storyboard.accent_color)).unwrap_or(fill);
    let mode = text_of("style").unwrap_or("Standard");
    let highlighted = mode == "Karaoke" || mode == "Word pop";
    let typewriter = mode == "Typewriter";
    let inactive = (number("inactiveOpacity").unwrap_or(55.0).clamp(0.0, 100.0) / 100.0) as f32;
    let caps = style.get("allCaps").and_then(Value::as_bool).unwrap_or(false);
    let shown = |s: &str| if caps { s.to_uppercase() } else { s.to_owned() };
    let active = active_word(&caption.words, local_sec);

    let (mut text, mut ranges, mut words) = (String::new(), Vec::new(), Vec::new());
    for (part, word) in text_parts(&caption.text, &caption.words) {
        let begin = text.len();
        text.push_str(&shown(&part));
        let Some(word) = word else { continue };
        let emphasized = word as i32 == active;
        ranges.push(begin..text.len());
        words.push(WordPaint {
            color: if emphasized && highlighted { highlight } else { fill },
            opacity: if typewriter {
                if word as i32 > active { 0.0 } else { 1.0 }
            } else if highlighted && !emphasized {
                inactive
            } else {
                1.0
            },
            scale: if emphasized && mode == "Word pop" { 1.12 } else { 1.0 },
        });
    }

    let shadow = text_of("shadow").filter(|s| *s != "transparent").and_then(|s| alpha_color(s, number("shadowOpacity").unwrap_or(100.0))).map(|color| {
        let distance = number("shadowDistance").unwrap_or(2.0);
        let angle = number("shadowAngle").unwrap_or(90.0).to_radians();
        Shadow { offset: (angle.cos() * distance, angle.sin() * distance), blur: number("shadowBlur").unwrap_or(12.0) as f32, color }
    });
    let entry = (local_sec / ENTRY_SEC).clamp(0.0, 1.0);
    let motion = text_of("motion").unwrap_or("None");
    Cue {
        text,
        ranges,
        words,
        font: Font {
            size: number("fontSize").unwrap_or(56.0) as f32,
            weight: weight_value(text_of("weight")),
            italic: style.get("italic").and_then(Value::as_bool).unwrap_or(false),
            line_height: LINE_HEIGHT,
            letter_spacing: None,
            break_anywhere: true,
        },
        fill,
        stroke: text_of("stroke").filter(|s| *s != "transparent").and_then(parse_color),
        shadow,
        background: text_of("background").filter(|s| *s != "transparent").and_then(parse_paint),
        vertical_pct: number("verticalPosition").unwrap_or(88.0),
        max_width: width * number("maxWidth").unwrap_or(86.0) / 100.0,
        opacity: if motion == "Fade" { entry } else { 1.0 },
        scale: if motion == "Pop" { 0.9 + entry * 0.1 } else { 1.0 },
        slide: if motion == "Slide Up" { (1.0 - entry) * 24.0 } else { 0.0 },
    }
}

/// Draws every word: fill, then the stroke over it, in a layer when faded.
/// With `silhouette`, draws the shadow shape in that color instead.
fn draw_text(scene: &mut Scene, fonts: &Fonts, cue: &Cue, layout: &Layout<WordBrush>, content_width: f32, origin: (f64, f64), silhouette: Option<Rgba>) {
    // The word box of `display: inline-block`: union of its runs on one line.
    let mut boxes: HashMap<i32, Rect> = HashMap::new();
    let mut runs = Vec::new();
    for line in layout.lines() {
        let metrics = line.metrics();
        let shift = f64::from(line_shift(Alignment::Center, content_width, metrics));
        for item in line.items() {
            let PositionedLayoutItem::GlyphRun(run) = item else { continue };
            let word = run.style().brush.0;
            let x = origin.0 + shift + f64::from(run.offset());
            let rect = Rect::new(x, origin.1 + f64::from(metrics.block_min_coord), x + f64::from(run.advance()), origin.1 + f64::from(metrics.block_max_coord));
            boxes.entry(word).and_modify(|r| *r = r.union(rect)).or_insert(rect);
            runs.push((run, origin.0 + shift, word));
        }
    }
    let everything = Rect::new(-1e6, -1e6, 1e6, 1e6);
    for (run, x0, word) in runs {
        let paint = usize::try_from(word).ok().map(|w| &cue.words[w]);
        let (color, opacity, scale) = paint.map_or((cue.fill, 1.0, 1.0), |p| (p.color, p.opacity, p.scale));
        let transform = if scale == 1.0 {
            Affine::IDENTITY
        } else {
            let center = boxes[&word].center().to_vec2();
            Affine::translate(center) * Affine::scale(scale) * Affine::translate(-center)
        };
        let glyphs: Vec<vello::Glyph> = run.positioned_glyphs().map(|g| vello::Glyph { id: g.id, x: x0 as f32 + g.x, y: origin.1 as f32 + g.y }).collect();
        let font = run.run().font();
        if opacity < 1.0 {
            scene.push_layer(Fill::NonZero, Mix::Normal, opacity, Affine::IDENTITY, &everything);
        }
        scene
            .draw_glyphs(font)
            .font_size(run.run().font_size())
            .normalized_coords(run.run().normalized_coords())
            .transform(transform)
            .brush(silhouette.unwrap_or(color).color())
            .hint(false)
            .draw(Fill::NonZero, glyphs.iter().copied());
        // Color emoji have no outline to stroke.
        if let Some(stroke) = cue.stroke.filter(|_| !fonts.is_emoji(font)) {
            scene
                .draw_glyphs(font)
                .font_size(run.run().font_size())
                .normalized_coords(run.run().normalized_coords())
                .transform(transform)
                .brush(silhouette.unwrap_or(stroke).color())
                .hint(false)
                .draw(&Stroke::new(STROKE_WIDTH).with_join(Join::Miter).with_miter_limit(4.0), glyphs.iter().copied());
        }
        if opacity < 1.0 {
            scene.pop_layer();
        }
    }
}

/// Lays the cue out at `font`: the content width and the layout.
fn fit(fonts: &mut Fonts, layouts: &mut LayoutContext<WordBrush>, cue: &Cue, font: Font, pad: (f64, f64)) -> (f32, Layout<WordBrush>) {
    // `width: max-content` capped by `maxWidth`, padding inside the box.
    let max_content = layout(fonts, layouts, &cue.text, font, &cue.ranges, None).width();
    let content_width = max_content.min((cue.max_width - 2.0 * pad.0) as f32);
    (content_width, layout(fonts, layouts, &cue.text, font, &cue.ranges, Some(content_width + 1e-3)))
}

/// Draws caption cue `index` at cue-local time `local_sec`.
pub fn draw(
    canvas: &mut Canvas<'_>,
    shadows: &mut dyn Treatments,
    fonts: &mut Fonts,
    layouts: &mut LayoutContext<WordBrush>,
    storyboard: &Storyboard,
    index: usize,
    local_sec: f64,
) {
    let cue = cue(storyboard, index, local_sec, canvas.width);
    let pad = if cue.background.is_some() { PAD } else { (0.0, 0.0) };
    let (mut content_width, mut text) = fit(fonts, layouts, &cue, cue.font, pad);
    // The measured fit: a cue taller than 80% of the frame shrinks to fit.
    let measured = f64::from(text.height()) + 2.0 * pad.1;
    let scale = (canvas.height * 0.8 / measured.max(1.0)).min(1.0);
    if scale < 1.0 {
        let font = Font { size: cue.font.size * scale as f32, ..cue.font };
        (content_width, text) = fit(fonts, layouts, &cue, font, pad);
    }
    let box_width = f64::from(content_width) + 2.0 * pad.0;
    let box_height = f64::from(text.height()) + 2.0 * pad.1;
    // `top: vertical%` then `translate: 0 -100%`, centred horizontally.
    let box_left = (canvas.width - box_width) / 2.0;
    let box_top = canvas.height * cue.vertical_pct / 100.0 - box_height;
    let cue_box = Rect::new(box_left, box_top, box_left + box_width, box_top + box_height);
    let origin = (box_left + pad.0, box_top + pad.1);

    let mut content = Scene::new();
    if let Some(background) = &cue.background {
        let (fill, transform) = brush(background, cue_box);
        content.fill(Fill::NonZero, Affine::IDENTITY, &fill, transform, &cue_box);
    }
    if let Some(shadow) = &cue.shadow {
        let mut silhouette = Scene::new();
        draw_text(&mut silhouette, fonts, &cue, &text, content_width, (origin.0 + shadow.offset.0, origin.1 + shadow.offset.1), Some(SILHOUETTE));
        let reach = f64::from(shadow.blur) * 1.5 + shadow.offset.0.abs().max(shadow.offset.1.abs()) + f64::from(cue.font.size) * 0.3;
        let bounds = pixel_bounds(cue_box.inflate(reach, reach), canvas.width, canvas.height);
        if let Some(image) = shadows.shadow(&silhouette, bounds, shadow.blur, shadow.color) {
            content.draw_image(&ImageBrush::new(image), Affine::translate(bounds.origin().to_vec2()));
        }
    }
    draw_text(&mut content, fonts, &cue, &text, content_width, origin, None);

    // The outer box's motion: `translate`, then `scale` about its centre.
    let center = cue_box.center().to_vec2();
    let motion = Affine::translate((0.0, cue.slide)) * Affine::translate(center) * Affine::scale(cue.scale) * Affine::translate(-center);
    canvas.group(cue.opacity, |canvas| canvas.scene.append(&content, Some(motion)));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(spec: &[(&str, f64, f64)]) -> Vec<CaptionWord> {
        spec.iter().map(|(text, start, end)| CaptionWord { text: (*text).into(), start_sec: *start, end_sec: *end }).collect()
    }

    #[test]
    fn the_last_started_word_stays_active_through_a_gap() {
        let w = words(&[("w0", 0.0, 0.4), ("w1", 0.5, 0.9), ("w2", 1.0, 1.4)]);
        assert_eq!(active_word(&w, 0.7), 1);
        assert_eq!(active_word(&w, 0.95), 1);
        assert_eq!(active_word(&w, 1.0), 2);
        assert_eq!(active_word(&w, -0.1), -1);
    }

    #[test]
    fn parts_keep_authored_spacing_and_give_up_on_a_missing_word() {
        let w = words(&[("Halo", 0.0, 0.4), ("dunia", 0.5, 0.9)]);
        assert_eq!(text_parts("Halo,  dunia!", &w), [("Halo".into(), Some(0)), (",  ".into(), None), ("dunia".into(), Some(1)), ("!".into(), None)]);
        assert_eq!(text_parts("Hello world", &w), [("Hello world".into(), None)]);
    }

    /// Cues chunked by `groupCaptionWords`; per frame, the cue `captionAt`
    /// picks and the word `captionActiveWord` marks (tests/fixtures/build.ts).
    #[test]
    fn cue_and_word_selection_match_the_typescript_helpers() {
        let fixture: Value = serde_json::from_str(include_str!("../../tests/fixtures/caption-timing.json")).unwrap();
        let storyboard = Storyboard::from_value(serde_json::json!({ "scenes": [], "captionCues": fixture["cues"] })).unwrap();
        let frames = fixture["frames"].as_array().unwrap();
        assert!(frames.iter().filter_map(|f| f["cue"].as_u64()).max() >= Some(3), "several chunks");
        for expected in frames {
            let frame = expected["frame"].as_i64().unwrap();
            let shown = crate::timeline::visible(&storyboard, frame, crate::timeline::FPS).into_iter().find_map(|v| match v {
                crate::timeline::Visible::Caption { index, local_sec } => Some((index, local_sec)),
                _ => None,
            });
            let actual = shown.map(|(index, local)| (index as u64, i64::from(active_word(&storyboard.caption_cues[index].caption.words, local))));
            let wanted = expected["cue"].as_u64().map(|cue| (cue, expected["word"].as_i64().unwrap()));
            assert_eq!(actual, wanted, "frame {frame}");
        }
    }

    #[test]
    fn shadow_opacity_applies_to_six_digit_hex_only() {
        assert_eq!(alpha_color("#000000", 50.0).map(|c| c.a), Some(0.5));
        assert_eq!(alpha_color("rgba(0,0,0,0.3)", 50.0).map(|c| c.a), Some(0.3));
    }
}
