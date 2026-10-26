//! Sequential presentations from video/lib/transitions.tsx and Remotion's
//! fade/wipe/flip/clockWipe/linearTiming. Placement samplers remain separate.

use super::{Canvas, Treatments};
use crate::timeline::Placed;
use vello::kurbo::{Affine, Arc, BezPath, Circle, Point, Rect, Shape, Vec2};
use vello::peniko::{Fill, Mix};

#[derive(Debug, Clone, Copy, PartialEq)]
enum Clip {
    Horizontal(f64, f64),
    Clock(f64),
    Circle(f64),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    pub opacity: f64,
    pub scale: f64,
    pub x_pct: f64,
    clip: Option<Clip>,
    rotate_y: Option<f64>,
    visible: bool,
    pixel: Option<f64>,
    pixelated: bool,
}

impl Default for Sample {
    fn default() -> Self {
        Self { opacity: 1.0, scale: 1.0, x_pct: 0.0, clip: None, rotate_y: None, visible: true, pixel: None, pixelated: false }
    }
}

pub fn series_supported(kind: &str) -> bool {
    matches!(kind, "cut" | "fade" | "slide" | "zoom" | "wipe" | "flip" | "clock_wipe" | "pixel")
}

pub fn progress(frame: i64, frames: i64) -> f64 {
    (frame as f64 / frames.max(1) as f64).clamp(0.0, 1.0)
}

fn series(kind: &str, frame: i64, frames: i64, entering: bool) -> Option<Sample> {
    if !series_supported(kind) {
        return None;
    }
    let p = progress(frame, frames);
    let mut sample = Sample::default();
    match kind {
        // Remotion fade() defaults to keeping the outgoing scene opaque.
        "fade" if entering => sample.opacity = p,
        "slide" => sample.x_pct = if entering { (1.0 - p) * 100.0 } else { -p * 100.0 },
        "zoom" => {
            sample.opacity = if entering { p } else { 1.0 - p };
            sample.scale = if entering { 1.12 - 0.12 * p } else { 1.0 + 0.12 * p };
        }
        "wipe" => sample.clip = Some(if entering { Clip::Horizontal(0.0, p) } else { Clip::Horizontal(p, 1.0) }),
        "clock_wipe" if entering => sample.clip = Some(Clip::Clock(p)),
        "flip" => {
            let angle = if entering { -180.0 * (1.0 - p) } else { 180.0 * p };
            sample.rotate_y = Some(angle);
            sample.visible = angle.abs() < 90.0;
        }
        "pixel" => {
            let step = (p * 9.0).floor() / 9.0;
            sample.opacity = if entering { step } else { 1.0 - step };
            sample.scale = if entering { 1.04 - step * 0.04 } else { 1.0 + step * 0.03 };
            sample.pixel = Some(p);
            sample.pixelated = true;
        }
        _ => {}
    }
    Some(sample)
}

// StoryboardReel.sceneEntranceStyle: distinct from the series presentations.
fn absolute_entrance(kind: &str, frame: i64, frames: i64) -> Option<Sample> {
    if !series_supported(kind) || kind == "cut" {
        return None;
    }
    let p = progress(frame, frames);
    let step = (p * 7.0).floor() / 7.0;
    let mut s = Sample::default();
    if matches!(kind, "fade" | "zoom" | "wipe" | "flip" | "clock_wipe" | "pixel") {
        s.opacity = if kind == "pixel" { step } else { p };
    }
    match kind {
        "zoom" => s.scale = 1.15 - 0.15 * p,
        "slide" => s.x_pct = (1.0 - p) * 100.0,
        "wipe" => s.clip = Some(Clip::Horizontal(0.0, p)),
        "flip" => s.rotate_y = Some(-90.0 * (1.0 - p)),
        "clock_wipe" => s.clip = Some(Clip::Circle(p * 0.75)),
        "pixel" => {
            s.scale = 1.04 - 0.04 * step;
            s.pixelated = true;
        }
        _ => {}
    }
    Some(s)
}

fn absolute_exit(kind: &str, frame: i64, from: i64, frames: i64) -> Option<Sample> {
    if frames <= 0 || frame < from || !matches!(kind, "slide" | "zoom" | "flip") {
        return None;
    }
    let p = progress(frame - from, frames);
    let mut s = Sample::default();
    match kind {
        "slide" => s.x_pct = -p * 100.0,
        "zoom" => {
            s.scale = 1.0 + 0.12 * p;
            s.opacity = 1.0 - p;
        }
        "flip" => {
            s.rotate_y = Some(90.0 * p);
            s.opacity = 1.0 - p;
        }
        _ => {}
    }
    Some(s)
}

// StoryboardScene.VisualEntrance: flip and clock-wipe are intentionally inert.
fn visual_entrance(kind: &str, frame: i64, frames: i64) -> Option<Sample> {
    if !series_supported(kind) {
        return None;
    }
    let p = progress(frame, frames);
    let step = (p * 7.0).floor() / 7.0;
    let mut s = Sample::default();
    if matches!(kind, "fade" | "zoom" | "pixel") {
        s.opacity = if kind == "pixel" { step } else { p };
    }
    match kind {
        "zoom" => s.scale = 1.1 - 0.1 * p,
        "slide" => s.x_pct = (1.0 - p) * 100.0,
        "wipe" => s.clip = Some(Clip::Horizontal(0.0, p)),
        "pixel" => {
            s.scale = 1.03 - 0.03 * step;
            s.pixelated = true;
        }
        _ => {}
    }
    Some(s)
}

pub fn draw_visual_entrance(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    rect: Rect,
    kind: Option<&str>,
    local: i64,
    frames: i64,
    draw: impl FnOnce(&mut Canvas<'_>, &mut dyn Treatments) -> Result<(), String>,
) -> Result<(), String> {
    let sample = kind.filter(|_| frames > 0).and_then(|kind| visual_entrance(kind, local, frames));
    layer_in(canvas, treatments, rect, sample, draw)
}

pub fn draw_absolute(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    placed: &Placed,
    local: i64,
    draw: impl FnOnce(&mut Canvas<'_>, &mut dyn Treatments) -> Result<(), String>,
) -> Result<(), String> {
    let incoming = placed.entrance.as_ref().and_then(|(kind, frames)| absolute_entrance(kind, local, *frames));
    let outgoing = placed.exit.as_ref().and_then(|(kind, from, frames)| absolute_exit(kind, local, *from, *frames));
    layer(canvas, treatments, outgoing, |canvas, treatments| layer(canvas, treatments, incoming, draw))
}

fn path(clip: Clip, rect: Rect) -> BezPath {
    match clip {
        Clip::Horizontal(from, to) => Rect::new(rect.x0 + from * rect.width(), rect.y0, rect.x0 + to * rect.width(), rect.y1).to_path(0.01),
        Clip::Circle(radius) => Circle::new(rect.center(), rect.width().hypot(rect.height()) / 2.0_f64.sqrt() * radius).to_path(0.01),
        Clip::Clock(p) => {
            let center = rect.center();
            let radius = rect.width().hypot(rect.height()) * 0.5;
            let mut path = BezPath::new();
            path.move_to(center);
            path.line_to(Point::new(center.x, center.y - radius));
            let arc = Arc::new(center, Vec2::new(radius, radius), -std::f64::consts::FRAC_PI_2, p * std::f64::consts::TAU, 0.0);
            path.extend(arc.path_elements(0.01).skip(1));
            path.close_path();
            path
        }
    }
}

fn grid(canvas: &mut Canvas<'_>, p: f64) {
    let opacity = 0.22 * (1.0 - (0.5 - p).abs() * 2.0);
    if opacity <= 0.0 {
        return;
    }
    let rect = canvas.frame();
    canvas.scene.push_layer(Fill::NonZero, Mix::Overlay, opacity as f32, Affine::IDENTITY, &rect);
    // CSS backgrounds rasterize the gradient tile before compositor scaling.
    static TILE: std::sync::OnceLock<vello::peniko::ImageData> = std::sync::OnceLock::new();
    let image = TILE.get_or_init(|| {
        let mut pixels = Vec::with_capacity(46 * 46 * 4);
        for y in 0..46 {
            for x in 0..46 {
                let alpha = match (x == 0, y == 45) {
                    (true, true) => 178,
                    (true, false) | (false, true) => 115,
                    _ => 0,
                };
                pixels.extend_from_slice(&[255, 255, 255, alpha]);
            }
        }
        vello::peniko::ImageData {
            data: vello::peniko::Blob::new(std::sync::Arc::new(pixels)),
            format: vello::peniko::ImageFormat::Rgba8,
            alpha_type: vello::peniko::ImageAlphaType::Alpha,
            width: 46,
            height: 46,
        }
    });
    let brush = vello::peniko::ImageBrush::new(image.clone()).with_extend(vello::peniko::Extend::Repeat);
    canvas.scene.fill(Fill::NonZero, Affine::IDENTITY, &brush, None, &rect);
    canvas.scene.pop_layer();
}

fn layer(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    sample: Option<Sample>,
    draw: impl FnOnce(&mut Canvas<'_>, &mut dyn Treatments) -> Result<(), String>,
) -> Result<(), String> {
    let rect = canvas.frame();
    layer_in(canvas, treatments, rect, sample, draw)
}

fn layer_in(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    rect: Rect,
    sample: Option<Sample>,
    draw: impl FnOnce(&mut Canvas<'_>, &mut dyn Treatments) -> Result<(), String>,
) -> Result<(), String> {
    let Some(sample) = sample else { return draw(canvas, treatments) };
    if !sample.visible || sample.opacity <= 0.0 {
        return Ok(());
    }
    let mut content = vello::Scene::new();
    let local =
        &mut Canvas { scene: &mut content, media: canvas.media, width: canvas.width, height: canvas.height, pixelated: canvas.pixelated || sample.pixelated };
    draw(local, treatments)?;
    if let Some(p) = sample.pixel {
        grid(local, p);
    }
    if let Some(degrees) = sample.rotate_y.filter(|degrees| *degrees != 0.0) {
        let image = treatments.project(&content, rect, degrees)?;
        content.reset();
        super::image::draw_image_at(
            &mut Canvas { scene: &mut content, media: canvas.media, width: canvas.width, height: canvas.height, pixelated: canvas.pixelated },
            &image,
            rect,
            Affine::IDENTITY,
        );
    }
    let center = rect.center();
    let transform =
        Affine::translate((center.x + rect.width() * sample.x_pct / 100.0, center.y)) * Affine::scale(sample.scale) * Affine::translate((-center.x, -center.y));
    canvas.transformed(transform, |canvas| {
        let compose = |canvas: &mut Canvas<'_>| {
            if let Some(clip) = sample.clip {
                canvas.scene.push_clip_layer(Fill::NonZero, Affine::IDENTITY, &path(clip, rect));
            }
            canvas.scene.append(&content, None);
            if sample.clip.is_some() {
                canvas.scene.pop_layer();
            }
        };
        if sample.pixel.is_some() { canvas.byte_group(sample.opacity, compose) } else { canvas.group(sample.opacity, compose) }
    });
    Ok(())
}

pub fn draw_series(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    placed: &Placed,
    local: i64,
    draw: impl FnOnce(&mut Canvas<'_>, &mut dyn Treatments) -> Result<(), String>,
) -> Result<(), String> {
    let incoming = placed.entrance.as_ref().and_then(|(kind, frames)| series(kind, local, *frames, true));
    let outgoing = placed.exit.as_ref().and_then(|(kind, from, frames)| series(kind, local - from, *frames, false));
    // TransitionSeries puts the exit wrapper outside a simultaneous entrance.
    layer(canvas, treatments, outgoing, |canvas, treatments| layer(canvas, treatments, incoming, draw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_samples_match_source_styles() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../tests/fixtures/transition-placement.json")).unwrap();
        let check = |actual: Option<Sample>, expected: &serde_json::Value| {
            if expected.is_null() {
                assert!(actual.is_none());
                return;
            }
            let actual = actual.expect("source style");
            for (v, key) in [(actual.opacity, "opacity"), (actual.scale, "scale"), (actual.x_pct, "xPct")] {
                assert!((v - expected[key].as_f64().unwrap()).abs() < 1e-10, "{key}: {v} vs {}", expected[key]);
            }
            assert_eq!(actual.pixelated, expected["pixelated"].as_bool().unwrap());
            match actual.rotate_y {
                Some(v) => assert!((v - expected["rotateY"].as_f64().unwrap()).abs() < 1e-10),
                None => assert!(expected["rotateY"].is_null()),
            }
            match actual.clip {
                Some(Clip::Horizontal(from, to)) => {
                    assert_eq!(from, 0.0);
                    assert_eq!(expected["clip"]["kind"], "horizontal");
                    assert!((to - expected["clip"]["value"].as_f64().unwrap()).abs() < 1e-10);
                }
                Some(Clip::Circle(radius)) => {
                    assert_eq!(expected["clip"]["kind"], "circle");
                    assert!((radius - expected["clip"]["value"].as_f64().unwrap()).abs() < 1e-10);
                }
                None => assert!(expected["clip"].is_null()),
                _ => panic!("wrong placement clip"),
            }
        };
        for case in fixture["styles"].as_array().unwrap() {
            let kind = case["kind"].as_str().unwrap();
            let duration = case["duration"].as_i64().unwrap();
            for sample in case["samples"].as_array().unwrap() {
                let frame = sample["frame"].as_i64().unwrap();
                check(absolute_entrance(kind, frame, duration), &sample["entrance"]);
                check(absolute_exit(kind, frame, 30, duration), &sample["exit"]);
                check(visual_entrance(kind, frame, duration), &sample["visual"]);
            }
        }
    }

    #[test]
    fn library_clips_and_flip_backfaces_keep_their_own_semantics() {
        assert!(!series("flip", 0, 12, true).unwrap().visible);
        assert!(!series("flip", 6, 12, true).unwrap().visible);
        assert!(series("flip", 7, 12, true).unwrap().visible);
        assert!(!series("flip", 7, 12, false).unwrap().visible);
        assert_eq!(series("wipe", 3, 12, false).unwrap().clip, Some(Clip::Horizontal(0.25, 1.0)));
        let clock = path(Clip::Clock(0.25), Rect::new(0.0, 0.0, 400.0, 100.0));
        assert!(clock.contains(Point::new(300.0, 25.0)));
        assert!(!clock.contains(Point::new(100.0, 25.0)));
        assert!(!clock.contains(Point::new(300.0, 75.0)));
        assert_eq!(series("pixel", 6, 12, true).unwrap().opacity, 4.0 / 9.0);
    }

    #[test]
    fn progress_matches_reference_linear_timing() {
        let cases: serde_json::Value = serde_json::from_str(include_str!("../../tests/fixtures/transition-timing.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let frames = case["duration"].as_i64().unwrap();
            for sample in case["samples"].as_array().unwrap() {
                let expected = sample["progress"].as_f64().unwrap();
                assert!((progress(sample["frame"].as_i64().unwrap(), frames) - expected).abs() < 1e-12);
            }
        }
    }

    #[test]
    fn fade_preserves_outgoing_plate_and_zoom_fades_both_plates() {
        assert_eq!(series("fade", 6, 12, false).unwrap().opacity, 1.0);
        assert_eq!(series("fade", 6, 12, true).unwrap().opacity, 0.5);
        assert_eq!(series("zoom", 6, 12, false).unwrap(), Sample { opacity: 0.5, scale: 1.06, ..Sample::default() });
        assert_eq!(series("slide", 0, 12, true).unwrap().x_pct, 100.0);
        assert!((series("slide", 11, 12, false).unwrap().x_pct + 100.0 * 11.0 / 12.0).abs() < 1e-12);
        assert!(series("future-transition", 6, 12, true).is_none());
    }
}
