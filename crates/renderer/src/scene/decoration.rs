//! StoryboardScene.tsx decoration order and AnimatedText.tsx spring labels.

use super::{
    Canvas, background,
    text::{self, Font, WordBrush},
};
use crate::fonts::Fonts;
use crate::paint::{Rgba, parse_color};
use crate::storyboard::{Scene, Storyboard};
use parley::{Alignment, LayoutContext};
use vello::kurbo::{Affine, Rect, RoundedRect};
use vello::peniko::{Blob, Extend, Fill, ImageAlphaType, ImageBrush, ImageData, ImageFormat, Mix};

/// Remotion spring's two fixed underdamped configurations (mass 1).
pub fn spring(frame: i64, fps: f64, damping: f64, stiffness: f64) -> f64 {
    let t = frame.max(0) as f64 * (1.0 / fps).min(0.064);
    let half = damping / 2.0;
    let w = (stiffness - half * half).sqrt();
    1.0 - (-half * t).exp() * ((w * t).cos() + half / w * (w * t).sin())
}

#[derive(Debug, PartialEq)]
pub struct Chapter {
    pub label: String,
    pub start_sec: f64,
    pub end_sec: f64,
}

/// StoryboardReel.chapterSpans uses nominal scene timing, not series overlaps.
pub fn chapters(storyboard: &Storyboard) -> Vec<Chapter> {
    let mut spans: Vec<Chapter> = Vec::new();
    let mut key: Option<&str> = None;
    for (scene, start) in storyboard.scenes.iter().zip(crate::timeline::scene_starts(&storyboard.scenes)) {
        let next = scene.chapter.as_deref();
        if spans.is_empty() || (next.is_some() && next != key) {
            spans.push(Chapter { label: next.unwrap_or(&scene.label).to_owned(), start_sec: start, end_sec: start + scene.duration_sec });
            key = next;
        } else if let Some(last) = spans.last_mut() {
            last.end_sec = start + scene.duration_sec;
        }
    }
    spans
}

pub fn progress(canvas: &mut Canvas<'_>, storyboard: &Storyboard, frame: i64, duration_frames: i64) {
    let rect = Rect::new(0.0, 0.0, canvas.width, 8.0);
    if let Some(color) = parse_color(&format!("{}26", storyboard.fg_color)) {
        canvas.scene.fill(Fill::NonZero, Affine::IDENTITY, color.color(), None, &rect);
    }
    let width = canvas.width * (frame as f64 / duration_frames as f64).min(1.0);
    if width > 0.0 {
        // CSS reduces radii when the fill is narrower than its height.
        let radius = width.min(4.0);
        let shape = RoundedRect::from_rect(Rect::new(0.0, 0.0, width, 8.0), (0.0, radius, radius, 0.0));
        if let Some(color) = parse_color(&storyboard.accent_color) {
            canvas.scene.fill(Fill::NonZero, Affine::IDENTITY, color.color(), None, &shape);
        }
    }
}

pub fn chapter_pill(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn super::Treatments,
    fonts: &mut Fonts,
    layouts: &mut LayoutContext<WordBrush>,
    storyboard: &Storyboard,
    frame: i64,
    fps: f64,
) {
    let spans = chapters(storyboard);
    if spans.len() < 2 {
        return;
    }
    let sec = frame as f64 / fps;
    let Some((index, chapter)) = spans.iter().enumerate().find(|(_, c)| sec >= c.start_sec && sec < c.end_sec) else { return };
    let minimal = storyboard.pacing_devices.as_ref().and_then(|p| p.rest.get("variant")).and_then(|v| v.as_str()) == Some("minimal");
    let label = if minimal { "" } else { chapter.label.trim() };
    let font = |weight| Font { size: 30.0, weight, italic: false, line_height: 1.2, letter_spacing: Some(0.6), break_anywhere: false };
    let counter = text::layout(fonts, layouts, &format!("{}/{}", index + 1, spans.len()), font(800.0), &[], None);
    let label = (!label.is_empty()).then(|| text::layout(fonts, layouts, &label.split_whitespace().collect::<Vec<_>>().join(" "), font(700.0), &[], None));
    let cw = counter.calculate_content_widths().max;
    let lw = label.as_ref().map_or(0.0, |l| l.calculate_content_widths().max + 12.0);
    let height = f64::from(counter.height().max(label.as_ref().map_or(0.0, |l| l.height())));
    let x = canvas.width * 0.04;
    let s = spring(frame - (chapter.start_sec * fps).floor() as i64, fps, 16.0, 160.0);
    let y = canvas.height * 0.045 - 18.0 * (1.0 - s);
    let rect = Rect::new(x, y, x + f64::from(cw + lw) + 48.0, y + height + 24.0);
    let shape = RoundedRect::from_rect(rect, rect.height() / 2.0);
    let mut silhouette = vello::Scene::new();
    silhouette.fill(Fill::NonZero, Affine::translate((0.0, 8.0)), super::SILHOUETTE.color(), None, &shape);
    let bounds = super::pixel_bounds(rect.inflate(42.0, 50.0), canvas.width, canvas.height);
    let shadow = treatments.shadow(&silhouette, bounds, 28.0, Rgba { r: 0, g: 0, b: 0, a: 0.35 });
    let white = Rgba { r: 255, g: 255, b: 255, a: 1.0 };
    let accent = parse_color(&storyboard.accent_color).unwrap_or(white);
    let fg = parse_color(&storyboard.fg_color).unwrap_or(white);
    canvas.group(s.clamp(0.0, 1.0), |canvas| {
        if let Some(image) = shadow {
            canvas.scene.draw_image(&ImageBrush::new(image), Affine::translate(bounds.origin().to_vec2()));
        }
        if let Some(bg) = parse_color(&format!("{}CC", storyboard.bg_color)) {
            canvas.scene.fill(Fill::NonZero, Affine::IDENTITY, bg.color(), None, &shape);
        }
        canvas.scene.stroke(
            &vello::kurbo::Stroke::new(2.0),
            Affine::IDENTITY,
            accent.color(),
            None,
            &RoundedRect::from_rect(rect.inset(-1.0), (rect.height() - 2.0) / 2.0),
        );
        text::draw_glyphs(canvas.scene, &counter, (x + 24.0, y + 12.0 + (height - f64::from(counter.height())) / 2.0), cw, Alignment::Left, accent);
        if let Some(label) = label {
            canvas.group(0.92, |canvas| {
                text::draw_glyphs(
                    canvas.scene,
                    &label,
                    (x + 24.0 + f64::from(cw) + 12.0, y + 12.0 + (height - f64::from(label.height())) / 2.0),
                    lw - 12.0,
                    Alignment::Left,
                    fg,
                )
            });
        }
    });
}

pub fn scene(canvas: &mut Canvas<'_>, fonts: &mut Fonts, layouts: &mut LayoutContext<WordBrush>, storyboard: &Storyboard, scene: &Scene, frame: i64, fps: f64) {
    let rect = canvas.frame();
    let label = storyboard.show_labels && !scene.label.is_empty();
    if label {
        background::draw(canvas, "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0.75) 100%)", rect);
    }
    if scene.vignette {
        background::draw(canvas, "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%)", rect);
    }
    if scene.grain {
        static TILE: std::sync::OnceLock<ImageData> = std::sync::OnceLock::new();
        let tile = TILE.get_or_init(|| ImageData {
            data: Blob::new(std::sync::Arc::new(include_bytes!("../../assets/grain.rgba").to_vec())),
            format: ImageFormat::Rgba8,
            alpha_type: ImageAlphaType::Alpha,
            width: 200,
            height: 200,
        });
        canvas.scene.push_layer(Fill::NonZero, Mix::Overlay, 0.12, Affine::IDENTITY, &rect);
        let brush = ImageBrush::new(tile.clone()).with_extend(Extend::Repeat);
        canvas.scene.fill(Fill::NonZero, Affine::IDENTITY, &brush, None, &rect);
        canvas.scene.pop_layer();
    }
    if !label {
        return;
    }
    let width = (canvas.width - 160.0).max(0.0) as f32;
    let make = |fonts: &mut Fonts, layouts: &mut LayoutContext<WordBrush>, value: &str, size, weight| {
        let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
        let font = Font { size, weight, italic: false, line_height: 1.05, letter_spacing: Some(-1.0), break_anywhere: false };
        text::layout(fonts, layouts, &value, font, &[], Some(width))
    };
    let title = make(fonts, layouts, &scene.label, 48.0, 700.0);
    let body = (!scene.visual.is_empty()).then(|| make(fonts, layouts, &scene.visual, 36.0, 500.0));
    let body_height = body.as_ref().map_or(0.0, |b| f64::from(b.height()) + 12.0);
    let title_y = canvas.height - 80.0 - f64::from(title.height()) - body_height;
    let white = Rgba { r: 255, g: 255, b: 255, a: 1.0 };
    let mut draw = |layout: &parley::Layout<WordBrush>, y, delay, color| {
        let s = spring(frame - delay, fps, 18.0, 120.0);
        canvas.group(s.clamp(0.0, 1.0), |canvas| text::draw_glyphs(canvas.scene, layout, (80.0, y + 40.0 * (1.0 - s)), width, Alignment::Left, color));
    };
    draw(&title, title_y, 2, parse_color(&storyboard.accent_color).unwrap_or(white));
    if let Some(body) = body {
        draw(&body, title_y + f64::from(title.height()) + 12.0, 8, parse_color(&storyboard.fg_color).unwrap_or(white));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chapter_runs_and_composition_duration_match_source() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../tests/fixtures/chapter-timing.json")).unwrap();
        for case in fixture.as_array().unwrap() {
            let storyboard = Storyboard::parse(&case["storyboard"].to_string()).unwrap();
            let spans = chapters(&storyboard);
            let expected = case["chapters"].as_array().unwrap();
            assert_eq!(spans.len(), expected.len());
            for (a, b) in spans.iter().zip(expected) {
                assert_eq!(a.label, b["label"].as_str().unwrap());
                assert_eq!(a.start_sec, b["startSec"].as_f64().unwrap());
                assert_eq!(a.end_sec, b["endSec"].as_f64().unwrap());
            }
            for duration in case["durations"].as_array().unwrap() {
                assert_eq!(crate::timeline::composition_frames(&storyboard, duration["fps"].as_f64().unwrap()), duration["frames"].as_i64().unwrap());
            }
        }
    }
    #[test]
    fn fixed_springs_match_remotion_including_its_timestep_cap() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../tests/fixtures/decoration-spring.json")).unwrap();
        for case in fixture.as_array().unwrap() {
            for sample in case["samples"].as_array().unwrap() {
                let actual = spring(
                    sample["frame"].as_i64().unwrap(),
                    case["fps"].as_f64().unwrap(),
                    case["config"]["damping"].as_f64().unwrap(),
                    case["config"]["stiffness"].as_f64().unwrap(),
                );
                assert!((actual - sample["value"].as_f64().unwrap()).abs() < 1e-12, "{case}: {sample}");
            }
        }
    }
}
