//! Image scene visuals, visual-timeline images and image overlays, laid out as
//! `StoryboardScene.tsx`, `AnimatedVisual.tsx`, `VisualMediaFrame.tsx`,
//! `CameraMotion.tsx` and the overlay branch of `StoryboardReel.tsx` do.
//!
//! Only static layout draws here: box, crop, fit and opacity, and the static
//! camera (a 1.02 scale about the focal point). Coverage reports motion,
//! rotation, flips, masks, color, blend modes, reveals and transitions.

use vello::kurbo::{Affine, Rect};
use vello::peniko::{ImageBrush, ImageData};

use super::{Canvas, background};
use crate::media::draw_placeholder;
use crate::storyboard::{Crop, FocalPoint, Layout, Scene, Storyboard, TimelineVisual, VideoOverlay};
use crate::timeline;

/// The scale of the `static` camera preset.
const STATIC_CAMERA_SCALE: f64 = 1.02;

/// CSS `object-fit`, from a layout's `fit` (`layoutObjectFit`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fit {
    Cover,
    Contain,
    Fill,
}

impl Fit {
    pub fn of(layout: Option<&Layout>) -> Self {
        match layout.and_then(|l| l.fit.as_deref()) {
            Some("stretch") => Self::Fill,
            Some("contain") => Self::Contain,
            _ => Self::Cover,
        }
    }

    /// The crop geometry's fit name: the default and unknown values are `cover`.
    fn crop_fit(layout: &Layout) -> Self {
        Self::of(Some(layout))
    }
}

/// The image's drawn rectangle inside `rect` for `fit`, centred (`object-position: 50% 50%`).
pub fn fit_rect(image: (f64, f64), rect: Rect, fit: Fit) -> Rect {
    let (iw, ih) = image;
    let (sx, sy) = (rect.width() / iw, rect.height() / ih);
    let (w, h) = match fit {
        Fit::Fill => (rect.width(), rect.height()),
        Fit::Cover => (iw * sx.max(sy), ih * sx.max(sy)),
        Fit::Contain => (iw * sx.min(sy), ih * sx.min(sy)),
    };
    let center = rect.center();
    Rect::new(center.x - w / 2.0, center.y - h / 2.0, center.x + w / 2.0, center.y + h / 2.0)
}

/// `sourceCropGeometry` in `@maleo/shared/visual-media.ts`: the crop window
/// in the destination box and the whole source behind it, relative to the box.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CropGeometry {
    pub window: Rect,
    pub source: Rect,
}

pub fn crop_geometry(source: (f64, f64), destination: (f64, f64), crop: Crop, fit: Fit) -> Option<CropGeometry> {
    let values = [source.0, source.1, destination.0, destination.1, crop.width_pct, crop.height_pct];
    if !values.iter().all(|v| v.is_finite() && *v > 0.0) {
        return None;
    }
    let aspect = (source.0 * crop.width_pct) / (source.1 * crop.height_pct);
    let wide = aspect > destination.0 / destination.1;
    let width = if fit == Fit::Fill || (if fit == Fit::Contain { wide } else { !wide }) { destination.0 } else { destination.1 * aspect };
    let height = if fit == Fit::Fill || (if fit == Fit::Contain { !wide } else { wide }) { destination.1 } else { destination.0 / aspect };
    let (left, top) = ((destination.0 - width) / 2.0, (destination.1 - height) / 2.0);
    let source_width = width * 100.0 / crop.width_pct;
    let source_height = height * 100.0 / crop.height_pct;
    let source_left = -width * crop.x_pct / crop.width_pct;
    let source_top = -height * crop.y_pct / crop.height_pct;
    Some(CropGeometry {
        window: Rect::new(left, top, left + width, top + height),
        source: Rect::new(source_left, source_top, source_left + source_width, source_top + source_height),
    })
}

/// What fills a media box: the camera (`CameraMotion`, always `cover`) or an
/// `<Img>` with an object fit.
#[derive(Debug, Clone, Copy)]
enum Content {
    Camera(Option<FocalPoint>),
    Image(Fit),
}

fn image_size(image: &ImageData) -> (f64, f64) {
    (f64::from(image.width), f64::from(image.height))
}

/// Draws `image` so its pixel rectangle lands on `drawn`, under `extra`.
fn draw_image_at(canvas: &mut Canvas<'_>, image: &ImageData, drawn: Rect, extra: Affine) {
    let (iw, ih) = image_size(image);
    let to_rect = Affine::translate((drawn.x0, drawn.y0)) * Affine::scale_non_uniform(drawn.width() / iw, drawn.height() / ih);
    canvas.scene.draw_image(&ImageBrush::new(image.clone()), extra * to_rect);
}

/// Fills `rect` with `content`, clipped to `rect`.
fn draw_content(canvas: &mut Canvas<'_>, image: &ImageData, rect: Rect, content: Content) {
    if rect.is_zero_area() {
        return;
    }
    canvas.clipped(rect, |canvas| match content {
        Content::Image(fit) => draw_image_at(canvas, image, fit_rect(image_size(image), rect, fit), Affine::IDENTITY),
        Content::Camera(focal) => {
            // `scale` about `transform-origin` (the focal point, else the centre).
            let origin = match focal {
                Some(f) => (rect.x0 + rect.width() * f.x_pct / 100.0, rect.y0 + rect.height() * f.y_pct / 100.0),
                None => (rect.center().x, rect.center().y),
            };
            let camera = Affine::translate(origin) * Affine::scale(STATIC_CAMERA_SCALE) * Affine::translate((-origin.0, -origin.1));
            draw_image_at(canvas, image, fit_rect(image_size(image), rect, Fit::Cover), camera);
        }
    });
}

/// `VisualMediaFrame`: the source crop (when any) inside `container`, then the content.
/// The crop's destination size is the layout's box in frame pixels.
fn draw_media(canvas: &mut Canvas<'_>, url: &str, container: Rect, layout: Option<&Layout>, content: Content) {
    let Some(image) = canvas.media.get(url).cloned() else {
        draw_placeholder(canvas.scene, Affine::IDENTITY, container);
        return;
    };
    let crop = layout.and_then(|l| l.crop.map(|c| (l, c)));
    let Some((layout, crop)) = crop else {
        draw_content(canvas, &image, container, content);
        return;
    };
    let destination = (canvas.width * layout.width_pct.unwrap_or(100.0) / 100.0, canvas.height * layout.height_pct.unwrap_or(100.0) / 100.0);
    let Some(geometry) = crop_geometry(image_size(&image), destination, crop, Fit::crop_fit(layout)) else { return };
    let offset = |r: Rect| r + container.origin().to_vec2();
    let window = offset(geometry.window);
    let source = geometry.source + window.origin().to_vec2();
    canvas.clipped(container, |canvas| canvas.clipped(window, |canvas| draw_content(canvas, &image, source, content)));
}

/// The `AnimatedVisual` box: left/top/width from the layout, height from
/// `heightPct`, the frame height when a wrapper fills it (crop, flip, mask,
/// color), else `auto`: the image's own aspect for an `<Img>`, nothing for
/// the absolutely positioned camera.
fn visual_box(canvas: &Canvas<'_>, layout: &Layout, url: &str, content: Content) -> Rect {
    let (x, y) = (canvas.width * layout.x_pct.unwrap_or(0.0) / 100.0, canvas.height * layout.y_pct.unwrap_or(0.0) / 100.0);
    let width = canvas.width * layout.width_pct.unwrap_or(100.0) / 100.0;
    let color_adjusted = layout.rest.get("color").and_then(|c| c.as_object()).is_some_and(|c| c.values().any(|v| v.as_f64() != Some(1.0)));
    let wrapped = layout.crop.is_some()
        || layout.flip_x == Some(true)
        || layout.flip_y == Some(true)
        || layout.rest.get("mask").is_some_and(|m| !m.is_null())
        || color_adjusted;
    let height = match (layout.height_pct, wrapped, content) {
        (Some(pct), _, _) => canvas.height * pct / 100.0,
        (None, true, _) => canvas.height,
        (None, false, Content::Camera(_)) => 0.0,
        (None, false, Content::Image(_)) => match canvas.media.get(url) {
            Some(image) => width * f64::from(image.height) / f64::from(image.width),
            // No image, no intrinsic size: a square marks where it goes.
            None => width,
        },
    };
    Rect::new(x, y, x + width, y + height)
}

/// `AnimatedVisual` around media: no layout fills the frame.
fn draw_visual(canvas: &mut Canvas<'_>, url: &str, layout: Option<&Layout>, content: Content) {
    match layout {
        None => {
            let frame = canvas.frame();
            draw_media(canvas, url, frame, None, content);
        }
        Some(layout) => {
            let rect = visual_box(canvas, layout, url, content);
            canvas.group(layout.opacity.unwrap_or(1.0), |canvas| draw_media(canvas, url, rect, Some(layout), content));
        }
    }
}

/// `StoryboardScene`: the background, then each visible visual.
pub fn draw_scene(canvas: &mut Canvas<'_>, storyboard: &Storyboard, scene: &Scene, placed: &timeline::Placed, local: i64, fps: f64) {
    let frame = canvas.frame();
    background::draw(canvas, &storyboard.bg_color, frame);
    let visuals = timeline::scene_visuals(scene, local, placed.frames, placed.hold, fps);
    let clips = scene.visual_clips.as_deref().unwrap_or_default();
    let base = scene.layout.as_ref();
    let individual = clips.iter().any(|c| c.layout.as_ref().is_some_and(|l| l.width_pct.is_some()));
    let positioned = base.filter(|l| {
        !(l.x_pct.unwrap_or(0.0) == 0.0
            && l.y_pct.unwrap_or(0.0) == 0.0
            && l.width_pct.unwrap_or(100.0) == 100.0
            && l.height_pct.unwrap_or(100.0) == 100.0
            && l.rotation_deg.unwrap_or(0.0) == 0.0
            && l.opacity.unwrap_or(1.0) == 1.0)
    });
    let focal = scene.focal_point;
    let draw_all = |canvas: &mut Canvas<'_>, container: Rect| {
        for at in &visuals {
            let clip = at.index.map(|i| &clips[i]);
            let url = clip.map_or(scene.image.as_str(), |c| c.url.as_str());
            let merged = Layout::merged(base, clip.and_then(|c| c.layout.as_ref()));
            if individual {
                // sceneVisualLayout(): the frame height when the layout has none.
                let mut layout = merged.unwrap_or_default();
                layout.height_pct = layout.height_pct.or(Some(100.0));
                draw_visual(canvas, url, Some(&layout), Content::Camera(focal));
            } else {
                draw_media(canvas, url, container, merged.as_ref(), Content::Camera(focal));
            }
        }
    };
    match positioned.filter(|_| !individual) {
        Some(l) => {
            let x = canvas.width * l.x_pct.unwrap_or(0.0) / 100.0;
            let y = canvas.height * l.y_pct.unwrap_or(0.0) / 100.0;
            let rect = Rect::new(x, y, x + canvas.width * l.width_pct.unwrap_or(100.0) / 100.0, y + canvas.height * l.height_pct.unwrap_or(100.0) / 100.0);
            canvas.group(l.opacity.unwrap_or(1.0), |canvas| canvas.clipped(rect, |canvas| draw_all(canvas, rect)));
        }
        None => draw_all(canvas, frame),
    }
}

/// A `visualTimeline` image: the camera inside the clip's visual box.
pub fn draw_timeline_visual(canvas: &mut Canvas<'_>, clip: &TimelineVisual) {
    draw_visual(canvas, &clip.url, clip.layout.as_ref(), Content::Camera(clip.focal_point));
}

/// An image overlay: an `<Img>` with the layout's object fit.
pub fn draw_overlay(canvas: &mut Canvas<'_>, overlay: &VideoOverlay) {
    draw_visual(canvas, &overlay.url, overlay.layout.as_ref(), Content::Image(Fit::of(overlay.layout.as_ref())));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(r: Rect) -> [f64; 4] {
        [r.x0, r.y0, r.width(), r.height()].map(|v| (v * 1e6).round() / 1e6)
    }

    // Expected values printed by `sourceCropGeometry` in `@maleo/shared` (`bun -e`)
    // for a 1600x900 source, a 1080x1920 box and the crop below.
    #[test]
    fn crop_geometry_matches_the_typescript_helper() {
        let crop = Crop { x_pct: 10.0, y_pct: 20.0, width_pct: 50.0, height_pct: 40.0 };
        let cover = crop_geometry((1600.0, 900.0), (1080.0, 1920.0), crop, Fit::Cover).unwrap();
        assert_eq!(rect(cover.window), [-1593.333333, 0.0, 4266.666667, 1920.0]);
        assert_eq!(rect(cover.source), [-853.333333, -960.0, 8533.333333, 4800.0]);
        let contain = crop_geometry((1600.0, 900.0), (1080.0, 1920.0), crop, Fit::Contain).unwrap();
        assert_eq!(rect(contain.window), [0.0, 717.0, 1080.0, 486.0]);
        assert_eq!(rect(contain.source), [-216.0, -243.0, 2160.0, 1215.0]);
        let fill = crop_geometry((1600.0, 900.0), (1080.0, 1920.0), crop, Fit::Fill).unwrap();
        assert_eq!(rect(fill.window), [0.0, 0.0, 1080.0, 1920.0]);
        assert_eq!(rect(fill.source), [-216.0, -960.0, 2160.0, 4800.0]);
        assert_eq!(crop_geometry((0.0, 900.0), (1080.0, 1920.0), crop, Fit::Cover), None);
    }

    #[test]
    fn object_fit_centres_the_image() {
        let frame = Rect::new(0.0, 0.0, 1080.0, 1920.0);
        assert_eq!(rect(fit_rect((1600.0, 900.0), frame, Fit::Cover)), [-1166.666667, 0.0, 3413.333333, 1920.0]);
        assert_eq!(rect(fit_rect((1600.0, 900.0), frame, Fit::Contain)), [0.0, 656.25, 1080.0, 607.5]);
        assert_eq!(rect(fit_rect((1600.0, 900.0), frame, Fit::Fill)), [0.0, 0.0, 1080.0, 1920.0]);
    }

    #[test]
    fn fit_names_follow_layout_object_fit() {
        let layout = |fit: &str| Layout { fit: Some(fit.into()), ..Default::default() };
        assert_eq!(Fit::of(Some(&layout("stretch"))), Fit::Fill);
        assert_eq!(Fit::of(Some(&layout("contain"))), Fit::Contain);
        assert_eq!(Fit::of(Some(&layout("other"))), Fit::Cover);
        assert_eq!(Fit::of(None), Fit::Cover);
    }
}
