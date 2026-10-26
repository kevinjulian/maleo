//! RevealEffect.tsx timing and phase styles, sampled without host state.

use crate::storyboard::Reveal;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Clip {
    pub kind: &'static str,
    pub values: Vec<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Filter {
    pub kind: &'static str,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Layer {
    pub opacity: f64,
    pub clip: Option<Clip>,
    pub translate: [f64; 2],
    pub filters: Vec<Filter>,
    #[serde(skip)]
    pub texture: Option<&'static str>,
    #[serde(skip)]
    pub texture_at: usize,
}

impl Default for Layer {
    fn default() -> Self {
        Self { opacity: 1.0, clip: None, translate: [0.0; 2], filters: Vec::new(), texture: None, texture_at: 0 }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Sample {
    pub duration: i64,
    pub delay: i64,
    pub split: i64,
    pub clip: Option<Layer>,
    pub color: Option<Layer>,
    pub dark: Option<Layer>,
    pub build: Vec<Filter>,
}

pub fn duration(reveal: Option<&Reveal>, frames: i64, fps: f64) -> i64 {
    let requested = reveal.and_then(|r| r.duration_sec).map_or(frames, |s| (s * fps).round() as i64);
    requested.min(frames.max(1)).max(1)
}

fn progress(raw: f64) -> f64 {
    1.0 - (1.0 - raw.clamp(0.0, 1.0)).powi(3)
}

fn wipe(direction: Option<&str>, p: f64) -> Clip {
    let hidden = (1.0 - p) * 100.0;
    let (kind, values) = match direction {
        Some("right") => ("inset", vec![0.0, 0.0, 0.0, hidden]),
        Some("top") => ("inset", vec![0.0, 0.0, hidden, 0.0]),
        Some("bottom") => ("inset", vec![hidden, 0.0, 0.0, 0.0]),
        Some("top_left_to_bottom_right") => ("polygon", vec![0.0, 0.0, p * 200.0, 0.0, 0.0, p * 200.0]),
        Some("draw_top_left_to_bottom_right") => ("polygon", vec![0.0, 0.0, p * 200.0, 0.0, (p * 200.0 - 34.0).max(0.0), 100.0, 0.0, 100.0]),
        Some("center") => ("circle", vec![(p * 75.0).max(1.0), 50.0, 50.0]),
        _ => ("inset", vec![0.0, hidden, 0.0, 0.0]),
    };
    Clip { kind, values }
}

fn textured(reveal: &Reveal, mut layer: Layer) -> Layer {
    layer.texture = match reveal.texture.as_deref() {
        Some("paper") => Some("paper"),
        Some("dust") => Some("dust"),
        Some("ink") => Some("ink"),
        Some("glitch") => Some("glitch"),
        _ => None,
    };
    if layer.texture == Some("ink") {
        layer.filters.push(Filter { kind: "contrast", value: 1.08 });
    }
    layer.texture_at = layer.filters.len();
    layer
}

fn layer(reveal: &Reveal, p: f64) -> Layer {
    let p = p.clamp(0.0, 1.0);
    let intensity = reveal.intensity.unwrap_or(1.0).clamp(0.0, 1.0);
    let mut layer = Layer::default();
    match reveal.kind.as_str() {
        "fade" => layer.opacity = p,
        "spotlight" => {
            layer.clip = Some(wipe(Some("center"), p));
            layer.opacity = (0.2 + p * (0.8 + intensity * 0.2)).min(1.0);
        }
        "sketch_draw" => {
            layer.clip = Some(wipe(reveal.direction.as_deref(), p));
            layer.filters = vec![Filter { kind: "contrast", value: 1.0 + (1.0 - p) * intensity * 0.8 }, Filter { kind: "saturate", value: 0.7 + p * 0.3 }];
            layer.opacity = (0.15 + p * 0.85).min(1.0);
        }
        _ => layer.clip = Some(wipe(reveal.direction.as_deref(), p)),
    }
    textured(reveal, layer)
}

pub fn sample(reveal: Option<&Reveal>, frame: i64, frames: i64, fps: f64) -> Sample {
    let duration = duration(reveal, frames, fps);
    let delay = reveal.and_then(|r| r.delay_sec).map_or(0, |s| (s * fps).round().max(0.0) as i64);
    let split = (duration as f64 * 0.45).round().max(1.0) as i64;
    let Some(reveal) = reveal else {
        return Sample { duration, delay, split, clip: None, color: None, dark: None, build: Vec::new() };
    };
    let p = progress((frame as f64 - delay as f64) / duration as f64);
    let phased = matches!(reveal.phase.as_deref(), Some("dark_pixels_first" | "black_then_color"));
    let color_p = if phased { progress((frame as f64 - delay as f64 - split as f64) / (duration - split).max(1) as f64) } else { p };
    let clip = Some(layer(reveal, p));
    let color = Some(layer(reveal, color_p));
    let dark = if reveal.phase.as_deref() == Some("black_then_color") {
        if reveal.black_direction.as_deref() == Some("none") {
            reveal.texture.as_deref().filter(|t| *t != "clean").map(|_| textured(reveal, Layer::default()))
        } else {
            let hidden = (1.0 - progress((frame as f64 - delay as f64) / split as f64)) * 100.0;
            let dark = Layer {
                translate: match reveal.black_direction.as_deref() {
                    Some("left") => [-hidden, 0.0],
                    Some("top") => [0.0, -hidden],
                    Some("bottom") => [0.0, hidden],
                    _ => [hidden, 0.0],
                },
                ..Layer::default()
            };
            Some(textured(reveal, dark))
        }
    } else {
        clip.clone()
    };
    let build = if reveal.color_build.as_deref().is_some_and(|c| c != "none") {
        vec![Filter { kind: "saturate", value: 0.35 + color_p * 0.65 }, Filter { kind: "contrast", value: 0.92 + color_p * 0.08 }]
    } else {
        Vec::new()
    };
    Sample { duration, delay, split, clip, color, dark, build }
}

#[derive(Clone, Copy)]
pub struct At<'a> {
    pub reveal: &'a Reveal,
    pub frame: i64,
    pub frames: i64,
    pub fps: f64,
}

pub fn clip_path(clip: &Clip, rect: vello::kurbo::Rect) -> vello::kurbo::BezPath {
    use vello::kurbo::{BezPath, Circle, Rect, Shape};
    let v = &clip.values;
    match clip.kind {
        "inset" => Rect::new(
            rect.x0 + rect.width() * v[3] / 100.0,
            rect.y0 + rect.height() * v[0] / 100.0,
            rect.x1 - rect.width() * v[1] / 100.0,
            rect.y1 - rect.height() * v[2] / 100.0,
        )
        .to_path(0.01),
        "circle" => {
            let radius = ((rect.width().powi(2) + rect.height().powi(2)) / 2.0).sqrt() * v[0] / 100.0;
            Circle::new((rect.x0 + rect.width() * v[1] / 100.0, rect.y0 + rect.height() * v[2] / 100.0), radius).to_path(0.01)
        }
        _ => {
            let mut path = BezPath::new();
            for (i, xy) in v.as_chunks::<2>().0.iter().enumerate() {
                let point = (rect.x0 + rect.width() * xy[0] / 100.0, rect.y0 + rect.height() * xy[1] / 100.0);
                if i == 0 {
                    path.move_to(point);
                } else {
                    path.line_to(point);
                }
            }
            path.close_path();
            path
        }
    }
}

pub fn draw<F>(
    canvas: &mut super::Canvas<'_>,
    treatments: &mut dyn super::Treatments,
    rect: vello::kurbo::Rect,
    at: Option<At<'_>>,
    mut draw: F,
) -> Result<(), String>
where
    F: FnMut(&mut super::Canvas<'_>, &mut dyn super::Treatments) -> Result<(), String>,
{
    let Some(at) = at else { return draw(canvas, treatments) };
    let sample = sample(Some(at.reveal), at.frame, at.frames, at.fps);
    if matches!(at.reveal.phase.as_deref(), Some("dark_pixels_first" | "black_then_color")) {
        let dark = sample.dark.unwrap_or_default();
        draw_layer(canvas, treatments, rect, rect.inflate(rect.width() * 0.1, rect.height() * 0.1), &dark, &mut |canvas, treatments| {
            draw_dark(canvas, treatments, rect, &mut draw)
        })?;
        let mut color = sample.color.expect("color layer");
        color.filters.extend(sample.build);
        draw_layer(canvas, treatments, rect, rect, &color, &mut draw)
    } else {
        let mut layer = sample.clip.expect("reveal layer");
        layer.filters.extend(sample.build);
        draw_layer(canvas, treatments, rect, rect, &layer, &mut draw)
    }
}

fn draw_layer<F>(
    canvas: &mut super::Canvas<'_>,
    treatments: &mut dyn super::Treatments,
    rect: vello::kurbo::Rect,
    source_bounds: vello::kurbo::Rect,
    layer: &Layer,
    draw: &mut F,
) -> Result<(), String>
where
    F: FnMut(&mut super::Canvas<'_>, &mut dyn super::Treatments) -> Result<(), String>,
{
    use vello::kurbo::{Affine, Rect};
    use vello::peniko::Fill;
    if layer.opacity <= 0.0 || rect.is_zero_area() {
        return Ok(());
    }
    let mut filtered = None;
    if layer.filters.iter().any(|f| f.value != 1.0) || layer.texture.is_some() {
        let mut scene = vello::Scene::new();
        draw(
            &mut super::Canvas { scene: &mut scene, media: canvas.media, width: canvas.width, height: canvas.height, pixelated: canvas.pixelated },
            treatments,
        )?;
        let mut bounds = Rect::new(source_bounds.x0.floor(), source_bounds.y0.floor(), source_bounds.x1.ceil(), source_bounds.y1.ceil());
        let mut index = 0;
        loop {
            if let Some(texture) = layer.texture.filter(|_| index == layer.texture_at) {
                texture_scene(canvas, treatments, rect, texture, &mut scene, &mut bounds)?;
            }
            if index == layer.filters.len() {
                break;
            }

            let filter = &layer.filters[index];
            index += 1;
            let mut color = crate::storyboard::ClipColor { brightness: 1.0, contrast: 1.0, saturation: 1.0 };
            if filter.kind == "contrast" {
                color.contrast = filter.value;
            } else {
                color.saturation = filter.value;
            }
            if filter.kind == "contrast"
                && (layer.texture.is_none() || index != layer.texture_at)
                && layer.filters.get(index).is_some_and(|f| f.kind == "saturate")
            {
                color.saturation = layer.filters[index].value;
                index += 1;
            }
            if color.neutral() {
                continue;
            }
            let image = treatments.color(&scene, bounds, color)?;
            scene.reset();
            super::image::draw_image_at(
                &mut super::Canvas { scene: &mut scene, media: canvas.media, width: canvas.width, height: canvas.height, pixelated: canvas.pixelated },
                &image,
                bounds,
                Affine::IDENTITY,
            );
        }
        filtered = Some(scene);
    }
    canvas.transformed(Affine::translate((rect.width() * layer.translate[0] / 100.0, rect.height() * layer.translate[1] / 100.0)), |canvas| {
        canvas.group(layer.opacity, |canvas| {
            if let Some(clip) = &layer.clip {
                canvas.scene.push_clip_layer(Fill::NonZero, Affine::IDENTITY, &clip_path(clip, rect));
            }
            let result = if let Some(scene) = filtered {
                canvas.scene.append(&scene, None);
                Ok(())
            } else {
                draw(canvas, treatments)
            };
            if layer.clip.is_some() {
                canvas.scene.pop_layer();
            }
            result
        })
    })
}

fn texture_scene(
    canvas: &super::Canvas<'_>,
    treatments: &mut dyn super::Treatments,
    rect: vello::kurbo::Rect,
    texture: &str,
    scene: &mut vello::Scene,
    bounds: &mut vello::kurbo::Rect,
) -> Result<(), String> {
    use crate::paint::Rgba;
    use vello::kurbo::{Affine, Rect, Vec2};
    if texture == "paper" || texture == "dust" {
        let image = treatments.texture_content(scene, *bounds, rect, texture == "paper")?;
        scene.reset();
        super::image::draw_image_at(
            &mut super::Canvas { scene, media: canvas.media, width: canvas.width, height: canvas.height, pixelated: canvas.pixelated },
            &image,
            *bounds,
            Affine::IDENTITY,
        );
        return Ok(());
    }
    let shadows = if texture == "ink" {
        vec![(0.0, 0.0, 2.0, Rgba { r: 0, g: 0, b: 0, a: 0.28 })]
    } else {
        vec![(2.0, 0.0, 0.0, Rgba { r: 0, g: 255, b: 255, a: 0.22 }), (-2.0, 0.0, 0.0, Rgba { r: 255, g: 0, b: 120, a: 0.18 })]
    };
    for (x, y, sigma, color) in shadows {
        let pad = (sigma * 3.0_f32).ceil() as f64;
        let region = bounds.inflate(pad, pad);
        let shadow_bounds = Rect::new(region.x0.floor(), region.y0.floor(), region.x1.ceil(), region.y1.ceil());
        let shadow = treatments.drop_shadow(scene, shadow_bounds, sigma, color)?;
        let shifted = shadow_bounds + Vec2::new(x, y);
        let mut composed = vello::Scene::new();
        super::image::draw_image_at(
            &mut super::Canvas { scene: &mut composed, media: canvas.media, width: canvas.width, height: canvas.height, pixelated: canvas.pixelated },
            &shadow,
            shifted,
            Affine::IDENTITY,
        );
        composed.append(scene, None);
        *scene = composed;
        *bounds = bounds.union(shifted);
    }
    Ok(())
}

fn draw_dark<F>(canvas: &mut super::Canvas<'_>, treatments: &mut dyn super::Treatments, rect: vello::kurbo::Rect, draw: &mut F) -> Result<(), String>
where
    F: FnMut(&mut super::Canvas<'_>, &mut dyn super::Treatments) -> Result<(), String>,
{
    use vello::kurbo::{Affine, Rect};
    let region = rect.inflate(rect.width() * 0.1, rect.height() * 0.1);
    let bounds = Rect::new(region.x0.floor(), region.y0.floor(), region.x1.ceil(), region.y1.ceil());
    let mut content = vello::Scene::new();
    draw(&mut super::Canvas { scene: &mut content, media: canvas.media, width: canvas.width, height: canvas.height, pixelated: canvas.pixelated }, treatments)?;
    let image = treatments.dark_content(&content, bounds)?;
    canvas.clipped(region, |canvas| super::image::draw_image_at(canvas, &image, bounds, Affine::IDENTITY));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn same(actual: &Value, expected: &Value, path: &str) {
        match (actual, expected) {
            (Value::Number(a), Value::Number(b)) => assert!((a.as_f64().unwrap() - b.as_f64().unwrap()).abs() < 1e-10, "{path}: {a} vs {b}"),
            (Value::Array(a), Value::Array(b)) => {
                assert_eq!(a.len(), b.len(), "{path}");
                for (i, (a, b)) in a.iter().zip(b).enumerate() {
                    same(a, b, &format!("{path}[{i}]"));
                }
            }
            (Value::Object(a), Value::Object(b)) => {
                assert_eq!(a.len(), b.len(), "{path}");
                for (k, a) in a {
                    same(a, &b[k], &format!("{path}.{k}"));
                }
            }
            _ => assert_eq!(actual, expected, "{path}"),
        }
    }

    #[test]
    fn diagonal_paths_and_circle_use_css_physical_geometry() {
        use vello::kurbo::{Rect, Shape};
        let rect = Rect::new(10.0, 20.0, 410.0, 120.0);
        let triangle = clip_path(&wipe(Some("top_left_to_bottom_right"), 0.5), rect);
        let drawn = clip_path(&wipe(Some("draw_top_left_to_bottom_right"), 0.5), rect);
        assert!(!triangle.contains((110.0, 110.0).into()));
        assert!(drawn.contains((110.0, 110.0).into()));
        let circle = clip_path(&wipe(Some("center"), 0.0), rect);
        let radius = ((400.0_f64.powi(2) + 100.0_f64.powi(2)) / 2.0).sqrt() * 0.01;
        assert!(circle.contains((210.0 + radius - 0.1, 70.0).into()));
        assert!(!circle.contains((210.0 + radius + 0.1, 70.0).into()));
    }

    #[test]
    fn timing_and_phase_styles_match_source_helpers() {
        let fixture: Value = serde_json::from_str(include_str!("../../tests/fixtures/reveal-timing.json")).unwrap();
        for case in fixture.as_array().unwrap() {
            let reveal: Option<Reveal> = serde_json::from_value(case["reveal"].clone()).unwrap();
            for expected in case["samples"].as_array().unwrap() {
                let sampled = sample(reveal.as_ref(), expected["frame"].as_i64().unwrap(), case["clipFrames"].as_i64().unwrap(), case["fps"].as_f64().unwrap());
                assert_eq!(sampled.duration, case["duration"].as_i64().unwrap());
                assert_eq!(sampled.delay, case["delay"].as_i64().unwrap());
                assert_eq!(sampled.split, case["split"].as_i64().unwrap());
                let value = serde_json::to_value(sampled).unwrap();
                for key in ["clip", "color", "dark", "build"] {
                    same(&value[key], &expected[key], &format!("{} frame {} {key}", case["name"], expected["frame"]));
                }
            }
        }
    }
}
