//! ShapePrimitive in `packages/video/src/compositions/reel-text.tsx`.
//! Rectangle/Circle retain CSS border-box geometry; polygons share normalized paths.
use super::{Canvas, Treatments, text_motion};
use crate::paint::{Rgba, parse_color};
use crate::storyboard::{Layout, TextOverlay};
use serde_json::Value;
use vello::kurbo::{Affine, BezPath, Ellipse, Join, Point, Rect, RoundedRect, Shape, Stroke};
use vello::peniko::Fill;

pub const IDS: &[&str] = &["shape-rect", "shape-circle", "shape-triangle", "shape-star", "shape-cross"];

pub fn number(params: Option<&Value>, key: &str, fallback: f64) -> f64 {
    let value = params.and_then(|p| p.get(key));
    value.and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))).filter(|v| v.is_finite() && *v >= 0.0).unwrap_or(fallback)
}

fn string<'a>(params: Option<&'a Value>, key: &str) -> Option<&'a str> {
    params.and_then(|p| p.get(key)).and_then(Value::as_str).filter(|s| !s.is_empty())
}

pub fn points(preset: &str, width: f64, height: f64, stroke: f64) -> Result<Vec<Point>, String> {
    if ![width, height, stroke].iter().all(|v| v.is_finite() && *v >= 0.0) {
        return Err("invalid shape geometry".into());
    }
    let normalized = match preset {
        "shape-triangle" => vec![(0.5, 0.0), (1.0, 1.0), (0.0, 1.0)],
        "shape-star" => (0..10)
            .map(|i| {
                let angle = -std::f64::consts::FRAC_PI_2 + f64::from(i) * std::f64::consts::PI / 5.0;
                let radius = if i % 2 == 0 { 0.5 } else { 0.25 };
                (0.5 + angle.cos() * radius, 0.5 + angle.sin() * radius)
            })
            .collect(),
        "shape-cross" => vec![
            (1.0 / 3.0, 0.0),
            (2.0 / 3.0, 0.0),
            (2.0 / 3.0, 1.0 / 3.0),
            (1.0, 1.0 / 3.0),
            (1.0, 2.0 / 3.0),
            (2.0 / 3.0, 2.0 / 3.0),
            (2.0 / 3.0, 1.0),
            (1.0 / 3.0, 1.0),
            (1.0 / 3.0, 2.0 / 3.0),
            (0.0, 2.0 / 3.0),
            (0.0, 1.0 / 3.0),
            (1.0 / 3.0, 1.0 / 3.0),
        ],
        _ => return Err("expected polygon primitive".into()),
    };
    let stroke = stroke.min(width).min(height);
    Ok(normalized.into_iter().map(|(x, y)| Point::new(stroke / 2.0 + x * (width - stroke), stroke / 2.0 + y * (height - stroke))).collect())
}

fn outline(preset: &str, rect: Rect, radius: f64) -> BezPath {
    if preset == "shape-circle" {
        Ellipse::new(rect.center(), (rect.width() / 2.0, rect.height() / 2.0), 0.0).to_path(0.01)
    } else {
        RoundedRect::from_rect(rect, radius.min(rect.width() / 2.0).min(rect.height() / 2.0)).to_path(0.01)
    }
}

pub fn draw(canvas: &mut Canvas<'_>, treatments: &mut dyn Treatments, overlay: &TextOverlay, accent: &str, time: (f64, f64)) -> Result<(), String> {
    let mut source = overlay.clone();
    source.layout.get_or_insert_with(Layout::default);
    let sampled = text_motion::sample(&source, time.0, time.1)?;
    let preset = overlay.preset.as_deref().unwrap_or_default();
    let params = overlay.rest.get("params");
    let fill = parse_color(string(params, "fill").unwrap_or(accent)).unwrap_or(Rgba::TRANSPARENT);
    let stroke = string(params, "stroke").and_then(parse_color);
    let width = number(params, "strokeWidth", 0.0);
    let radius = number(params, "radius", 0.0);
    let opacity = number(params, "opacity", 1.0).min(1.0);
    text_motion::draw_frame(canvas, treatments, &sampled, |canvas, _| {
        canvas.group(opacity, |canvas| {
            let rect = canvas.frame();
            if ["shape-rect", "shape-circle"].contains(&preset) {
                let outer = outline(preset, rect, radius);
                canvas.scene.fill(Fill::NonZero, Affine::IDENTITY, fill.color(), None, &outer);
                if let Some(stroke) = stroke.filter(|_| width > 0.0) {
                    let mut ring = outer;
                    if width * 2.0 < rect.width().min(rect.height()) {
                        ring.extend(outline(preset, rect.inset(-width), (radius - width).max(0.0)).elements().iter().copied());
                    }
                    canvas.scene.fill(Fill::EvenOdd, Affine::IDENTITY, stroke.color(), None, &ring);
                }
            } else {
                let width = if stroke.is_some() { width.min(rect.width()).min(rect.height()) } else { 0.0 };
                let points = points(preset, rect.width(), rect.height(), width)?;
                let mut path = BezPath::new();
                path.move_to(points[0]);
                for point in &points[1..] {
                    path.line_to(*point);
                }
                path.close_path();
                canvas.scene.fill(Fill::NonZero, Affine::IDENTITY, fill.color(), None, &path);
                if let Some(stroke) = stroke.filter(|_| width > 0.0) {
                    canvas.scene.stroke(&Stroke::new(width).with_join(Join::Round), Affine::IDENTITY, stroke.color(), None, &path);
                }
            }
            Ok(())
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn polygon_geometry_matches_shared_source_fixtures() {
        let cases: Value = serde_json::from_str(include_str!("../../tests/fixtures/shape-geometry.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let preset = case["preset"].as_str().unwrap();
            if let Some(expected) = case["geometry"]["points"].as_array() {
                let actual = points(preset, case["width"].as_f64().unwrap(), case["height"].as_f64().unwrap(), case["stroke"].as_f64().unwrap()).unwrap();
                for (actual, expected) in actual.iter().zip(expected) {
                    assert!((actual.x - expected[0].as_f64().unwrap()).abs() < 1e-10);
                    assert!((actual.y - expected[1].as_f64().unwrap()).abs() < 1e-10);
                }
                assert_eq!(actual.len(), expected.len());
            }
        }
        assert!(points("shape-star", f64::NAN, 10.0, 0.0).is_err());
    }
}
