//! Image scene visuals, visual-timeline images and image overlays, laid out as
//! `StoryboardScene.tsx`, `AnimatedVisual.tsx`, `VisualMediaFrame.tsx`,
//! `CameraMotion.tsx` and the overlay branch of `StoryboardReel.tsx` do.
//!
//! Layout samples use editor-core keyframes in clip-local seconds. Camera
//! paths retain normalized progress and source-pixel offsets. Coverage still
//! reports transitions and unsupported media.

use vello::kurbo::{Affine, Rect};
use vello::peniko::{Color, Fill, ImageBrush, ImageData, Mix};

use super::{Canvas, Treatments, background, camera, reveal};
use crate::media::draw_placeholder;
use crate::storyboard::{Crop, FocalPoint, Layout, Scene, Storyboard, TimelineVisual, VideoOverlay};
use crate::timeline;
use maleo_editor_core::keyframes::sample_clip_property;

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
    Camera(Option<FocalPoint>, camera::Sample),
    Image(Fit),
}

fn image_size(image: &ImageData) -> (f64, f64) {
    (f64::from(image.width), f64::from(image.height))
}

/// Draws `image` so its pixel rectangle lands on `drawn`, under `extra`.
pub(super) fn draw_image_at(canvas: &mut Canvas<'_>, image: &ImageData, drawn: Rect, extra: Affine) {
    let (iw, ih) = image_size(image);
    let to_rect = Affine::translate((drawn.x0, drawn.y0)) * Affine::scale_non_uniform(drawn.width() / iw, drawn.height() / ih);
    canvas.scene.draw_image(&ImageBrush::new(image.clone()), extra * to_rect);
}

/// Pinned Vello 0.11 raw-image ABI: reserved quality 3 selects our source sampler.
/// Registered GPU intermediates retain the ordinary ImageBrush sampler.
fn draw_css_image_at(canvas: &mut Canvas<'_>, image: &ImageData, drawn: Rect, extra: Affine) {
    if canvas.pixelated {
        let transform = extra
            * Affine::translate((drawn.x0, drawn.y0))
            * Affine::scale_non_uniform(drawn.width() / f64::from(image.width), drawn.height() / f64::from(image.height));
        canvas.scene.draw_image(&ImageBrush::new(image.clone()).with_quality(vello::peniko::ImageQuality::Low), transform);
        return;
    }
    let start = canvas.scene.encoding().draw_data.len();
    draw_image_at(canvas, image, drawn, extra);
    let data = &mut canvas.scene.encoding_mut().draw_data;
    assert_eq!(data.len(), start + 3, "Vello image encoding changed; review source-sampler adapter");
    let flags = &mut data[start + 2];
    assert_eq!((*flags >> 12) & 3, 1, "source sampler expects Vello medium image encoding");
    *flags = (*flags & !(3 << 12)) | (3 << 12);
}

// Blink ImagePainter snaps image paint bounds independently of CSS layout.
// https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/paint/image_painter.cc
fn paint_rect(rect: Rect) -> Rect {
    Rect::new(rect.x0.round(), rect.y0.round(), rect.x1.round(), rect.y1.round())
}

/// Fills `rect` with `content`, clipped to `rect`.
fn draw_content(canvas: &mut Canvas<'_>, image: &ImageData, rect: Rect, content: Content) {
    if rect.is_zero_area() {
        return;
    }
    // Blink's axis-aligned overflow clip snaps its paint edges independently
    // of the fractional layout used by camera and outer transforms.
    canvas.clipped(paint_rect(rect), |canvas| match content {
        Content::Image(fit) => draw_css_image_at(canvas, image, paint_rect(fit_rect(image_size(image), rect, fit)), Affine::IDENTITY),
        Content::Camera(focal, sample) => {
            // `scale` about `transform-origin` (the focal point, else the centre).
            let origin = match focal {
                Some(f) => (rect.x0 + rect.width() * f.x_pct / 100.0, rect.y0 + rect.height() * f.y_pct / 100.0),
                None => (rect.center().x, rect.center().y),
            };
            let camera = Affine::translate((origin.0 + sample.x, origin.1 + sample.y))
                * Affine::rotate(sample.rotation.to_radians())
                * Affine::scale(sample.scale)
                * Affine::translate((-origin.0, -origin.1));
            canvas.group(sample.opacity, |canvas| {
                canvas.transformed(camera, |canvas| {
                    canvas.clipped(paint_rect(rect), |canvas| {
                        draw_css_image_at(canvas, image, paint_rect(fit_rect(image_size(image), rect, Fit::Cover)), Affine::IDENTITY)
                    })
                })
            });
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
        let flip = flip_transform(container, layout);
        canvas.transformed(flip, |canvas| draw_content(canvas, &image, container, content));
        return;
    };
    let destination = (canvas.width * layout.width_pct.unwrap_or(100.0) / 100.0, canvas.height * layout.height_pct.unwrap_or(100.0) / 100.0);
    let Some(geometry) = crop_geometry(image_size(&image), destination, crop, Fit::crop_fit(layout)) else { return };
    let offset = |r: Rect| r + container.origin().to_vec2();
    let window = offset(geometry.window);
    let source = geometry.source + window.origin().to_vec2();
    canvas.clipped(container, |canvas| {
        canvas.transformed(flip_transform(window, Some(layout)), |canvas| canvas.clipped(window, |canvas| draw_content(canvas, &image, source, content)))
    });
}

fn flip_transform(rect: Rect, layout: Option<&Layout>) -> Affine {
    let center = rect.center().to_vec2();
    Affine::translate(center)
        * Affine::scale_non_uniform(
            if layout.is_some_and(|l| l.flip_x == Some(true)) { -1.0 } else { 1.0 },
            if layout.is_some_and(|l| l.flip_y == Some(true)) { -1.0 } else { 1.0 },
        )
        * Affine::translate(-center)
}

pub(super) fn outer_transform(rect: Rect, rotation: f64, scale: f64) -> Affine {
    let center = rect.center().to_vec2();
    Affine::translate(center) * Affine::rotate(rotation.to_radians()) * Affine::scale(scale) * Affine::translate(-center)
}

/// The `AnimatedVisual` box: left/top/width from the layout, height from
/// `heightPct`, the frame height when a wrapper fills it (crop, flip, mask,
/// color), else `auto`: the image's own aspect for an `<Img>`, nothing for
/// the absolutely positioned camera.
fn visual_box(canvas: &Canvas<'_>, layout: &Layout, url: &str, content: Content) -> Rect {
    let (x, y) = (canvas.width * layout.x_pct.unwrap_or(0.0) / 100.0, canvas.height * layout.y_pct.unwrap_or(0.0) / 100.0);
    let width = canvas.width * layout.width_pct.unwrap_or(100.0) / 100.0;
    let color_adjusted = layout.color.is_some_and(|c| !c.neutral());
    let wrapped = layout.crop.is_some() || layout.flip_x == Some(true) || layout.flip_y == Some(true) || layout.local_mask().is_some() || color_adjusted;
    let height = match (layout.height_pct, wrapped, content) {
        (Some(pct), _, _) => canvas.height * pct / 100.0,
        (None, true, _) => canvas.height,
        (None, false, Content::Camera(..)) => 0.0,
        (None, false, Content::Image(_)) => match canvas.media.get(url) {
            Some(image) => width * f64::from(image.height) / f64::from(image.width),
            // No image, no intrinsic size: a square marks where it goes.
            None => width,
        },
    };
    Rect::new(x, y, x + width, y + height)
}

/// Correct the complete fitted/cropped/flipped local content before outer layout.
fn draw_corrected(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    url: &str,
    rect: Rect,
    layout: Option<&Layout>,
    content: Content,
) -> Result<(), String> {
    let Some(color) = layout.and_then(|l| l.color).filter(|c| !c.neutral()) else {
        draw_media(canvas, url, rect, layout, content);
        return Ok(());
    };
    if rect.is_zero_area() {
        return Ok(());
    }
    let bounds = Rect::new(rect.x0.floor(), rect.y0.floor(), rect.x1.ceil(), rect.y1.ceil());
    let mut scene = vello::Scene::new();
    draw_media(
        &mut Canvas { scene: &mut scene, media: canvas.media, width: canvas.width, height: canvas.height, pixelated: canvas.pixelated },
        url,
        rect,
        layout,
        content,
    );
    let image = treatments.color(&scene, bounds, color)?;
    draw_image_at(canvas, &image, bounds, Affine::IDENTITY);
    Ok(())
}

fn draw_treated(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    url: &str,
    rect: Rect,
    layout: Option<&Layout>,
    content: Content,
) -> Result<(), String> {
    let Some(mask) = layout.and_then(Layout::local_mask) else {
        return draw_corrected(canvas, treatments, url, rect, layout, content);
    };
    if rect.is_zero_area() {
        return Ok(());
    }
    if mask.feather_pct > 0.0 {
        let path = super::mask::path(rect, crate::storyboard::ClipMask { inverted: false, ..mask });
        let sigma = rect.width().min(rect.height()) * mask.feather_pct / 300.0;
        let bounds = super::mask::feather_bounds(&path, sigma);
        let mut silhouette = vello::Scene::new();
        silhouette.fill(Fill::NonZero, Affine::IDENTITY, if mask.inverted { Color::BLACK } else { Color::WHITE }, None, &path);
        let (image, bounds) = treatments.blur_mask(&silhouette, bounds, sigma as f32)?;
        canvas.scene.push_layer(Fill::NonZero, Mix::Normal, 1.0, Affine::IDENTITY, &rect);
        let result = draw_corrected(canvas, treatments, url, rect, layout, content);
        if result.is_ok() {
            canvas.scene.push_luminance_mask_layer(Fill::NonZero, 1.0, Affine::IDENTITY, &rect);
            canvas.scene.fill(Fill::NonZero, Affine::IDENTITY, if mask.inverted { Color::WHITE } else { Color::BLACK }, None, &rect);
            let clip = super::mask::filter_clip(rect, mask);
            canvas.scene.push_clip_layer(Fill::NonZero, Affine::IDENTITY, &clip);
            draw_image_at(canvas, &image, bounds, Affine::IDENTITY);
            canvas.scene.pop_layer();
            canvas.scene.pop_layer();
        }
        canvas.scene.pop_layer();
        return result;
    }
    let path = super::mask::path(rect, mask);
    canvas.scene.push_clip_layer(vello::peniko::Fill::EvenOdd, Affine::IDENTITY, &path);
    let result = draw_corrected(canvas, treatments, url, rect, layout, content);
    canvas.scene.pop_layer();
    result
}

fn draw_revealed(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    url: &str,
    rect: Rect,
    layout: Option<&Layout>,
    content: Content,
    at: Option<reveal::At<'_>>,
) -> Result<(), String> {
    reveal::draw(canvas, treatments, rect, at, |canvas, treatments| draw_treated(canvas, treatments, url, rect, layout, content))
}

/// `AnimatedVisual` around media: no layout fills the frame.
fn draw_visual(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    url: &str,
    layout: Option<&Layout>,
    content: Content,
    seconds: f64,
    at: Option<reveal::At<'_>>,
) -> Result<(), String> {
    match layout {
        None => {
            let frame = canvas.frame();
            draw_revealed(canvas, treatments, url, frame, None, content, at)
        }
        Some(layout) => {
            let sample = |property, fallback| sample_clip_property(layout.animation.as_ref(), property, seconds, fallback);
            let x = sample("xPct", layout.x_pct.unwrap_or(0.0)) - layout.x_pct.unwrap_or(0.0);
            let y = sample("yPct", layout.y_pct.unwrap_or(0.0)) - layout.y_pct.unwrap_or(0.0);
            let rect = visual_box(canvas, layout, url, content) + vello::kurbo::Vec2::new(x * canvas.width / 100.0, y * canvas.height / 100.0);
            let transform = outer_transform(rect, sample("rotationDeg", layout.rotation_deg.unwrap_or(0.0)), sample("scale", 1.0));
            canvas.transformed(transform, |canvas| {
                canvas.group(sample("opacity", layout.opacity.unwrap_or(1.0)), |canvas| draw_revealed(canvas, treatments, url, rect, Some(layout), content, at))
            })
        }
    }
}

/// `StoryboardScene`: the background, then each visible visual.
fn draw_scene_content(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    storyboard: &Storyboard,
    scene: &Scene,
    placed: &timeline::Placed,
    local: i64,
    fps: f64,
) -> Result<(), String> {
    let frame = canvas.frame();
    background::draw(canvas, &storyboard.bg_color, frame);
    let visuals = timeline::scene_visuals(scene, local, placed.frames, placed.hold, fps);
    let clips = scene.visual_clips.as_deref().unwrap_or_default();
    let base = scene.layout.as_ref();
    let has_keys = |layout: Option<&Layout>| {
        layout
            .and_then(|l| l.animation.as_ref())
            .and_then(|a| a.get("tracks"))
            .and_then(|t| t.as_object())
            .is_some_and(|tracks| tracks.iter().any(|(property, keys)| property != "volume" && keys.as_array().is_some_and(|keys| !keys.is_empty())))
    };
    let compositing = |l: Option<&Layout>| {
        l.is_some_and(|l| l.color.is_some_and(|c| !c.neutral()) || l.local_mask().is_some() || l.blend_mode.as_deref().is_some_and(|m| m != "normal"))
    };
    let individual = (clips.is_empty() && (has_keys(base) || compositing(base)))
        || clips.iter().any(|c| {
            compositing(Layout::merged(base, c.layout.as_ref()).as_ref())
                || has_keys(c.layout.as_ref().filter(|l| l.animation.is_some()).or(base))
                || c.layout.as_ref().is_some_and(|l| l.width_pct.is_some())
        });
    let positioned = base.filter(|l| {
        !(l.x_pct.unwrap_or(0.0) == 0.0
            && l.y_pct.unwrap_or(0.0) == 0.0
            && l.width_pct.unwrap_or(100.0) == 100.0
            && l.height_pct.unwrap_or(100.0) == 100.0
            && l.rotation_deg.unwrap_or(0.0) == 0.0
            && l.opacity.unwrap_or(1.0) == 1.0)
    });
    let focal = scene.focal_point;
    let mut draw_all = |canvas: &mut Canvas<'_>, container: Rect| -> Result<(), String> {
        for at in &visuals {
            let clip = at.index.map(|i| &clips[i]);
            let url = clip.map_or(scene.image.as_str(), |c| c.url.as_str());
            let merged = Layout::merged(base, clip.and_then(|c| c.layout.as_ref()));
            let sample = camera::sample(Some(&scene.movement), clip.and_then(|c| c.motion.as_ref()).or(scene.motion.as_ref()), at.local, at.motion_frames, fps);
            let reveal = clip.and_then(|c| c.reveal.as_ref()).map(|reveal| reveal::At { reveal, frame: at.local, frames: at.motion_frames, fps });
            let kind = clip.filter(|_| at.index.is_some_and(|i| i > 0)).and_then(|clip| clip.transition.as_deref());
            let duration = timeline::transition_frames(kind, clip.and_then(|clip| clip.transition_dur_sec), fps);
            let transition_rect = if individual { canvas.frame() } else { container };
            if individual {
                let mut layout = merged.unwrap_or_default();
                layout.height_pct = layout.height_pct.or(Some(100.0));
                canvas.blended(layout.blend_mode.as_deref(), |canvas| {
                    super::transition::draw_visual_entrance(canvas, treatments, transition_rect, kind, at.local, duration, |canvas, treatments| {
                        draw_visual(canvas, treatments, url, Some(&layout), Content::Camera(focal, sample), at.local as f64 / fps, reveal)
                    })
                })?;
            } else {
                canvas.blended(merged.as_ref().and_then(|l| l.blend_mode.as_deref()), |canvas| {
                    super::transition::draw_visual_entrance(canvas, treatments, transition_rect, kind, at.local, duration, |canvas, treatments| {
                        draw_revealed(canvas, treatments, url, container, merged.as_ref(), Content::Camera(focal, sample), reveal)
                    })
                })?;
            }
        }
        Ok(())
    };
    match positioned.filter(|_| !individual) {
        Some(l) => {
            let x = canvas.width * l.x_pct.unwrap_or(0.0) / 100.0;
            let y = canvas.height * l.y_pct.unwrap_or(0.0) / 100.0;
            let rect = Rect::new(x, y, x + canvas.width * l.width_pct.unwrap_or(100.0) / 100.0, y + canvas.height * l.height_pct.unwrap_or(100.0) / 100.0);
            canvas.transformed(outer_transform(rect, l.rotation_deg.unwrap_or(0.0), 1.0), |canvas| {
                canvas.group(l.opacity.unwrap_or(1.0), |canvas| canvas.clipped(rect, |canvas| draw_all(canvas, rect)))
            })
        }
        None => draw_all(canvas, frame),
    }
}

/// CSS isolation prevents scene-local blends from seeing previous scenes.
pub fn draw_scene(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    text: (&mut crate::fonts::Fonts, &mut parley::LayoutContext<super::text::WordBrush>),
    storyboard: &Storyboard,
    placed: &timeline::Placed,
    local: i64,
    fps: f64,
) -> Result<(), String> {
    let (fonts, layouts) = text;
    let scene = &storyboard.scenes[placed.index];
    let draw = |canvas: &mut Canvas<'_>, treatments: &mut dyn Treatments| {
        let rect = canvas.frame();
        canvas.scene.push_layer(Fill::NonZero, Mix::Normal, 1.0, Affine::IDENTITY, &rect);
        let result = draw_scene_content(canvas, treatments, storyboard, scene, placed, local, fps);
        if result.is_ok() {
            super::decoration::scene(canvas, fonts, layouts, storyboard, scene, local, fps);
        }
        canvas.scene.pop_layer();
        result
    };
    if timeline::base_mode(storyboard) == timeline::BaseMode::Series {
        super::transition::draw_series(canvas, treatments, placed, local, draw)
    } else {
        super::transition::draw_absolute(canvas, treatments, placed, local, draw)
    }
}

/// A `visualTimeline` image: the camera inside the clip's visual box.
pub fn draw_timeline_visual(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    clip: &TimelineVisual,
    placed: &timeline::Placed,
    local: i64,
    fps: f64,
) -> Result<(), String> {
    let frames = placed.frames;
    let sample = camera::sample(clip.movement.as_deref(), clip.motion.as_ref(), local, frames, fps);
    canvas.blended(clip.layout.as_ref().and_then(|l| l.blend_mode.as_deref()), |canvas| {
        super::transition::draw_absolute(canvas, treatments, placed, local, |canvas, treatments| {
            draw_visual(
                canvas,
                treatments,
                &clip.url,
                clip.layout.as_ref(),
                Content::Camera(clip.focal_point, sample),
                local as f64 / fps,
                clip.reveal.as_ref().map(|reveal| reveal::At { reveal, frame: local, frames, fps }),
            )
        })
    })
}

/// An image overlay: an `<Img>` with the layout's object fit.
pub fn draw_overlay(
    canvas: &mut Canvas<'_>,
    treatments: &mut dyn Treatments,
    overlay: &VideoOverlay,
    placed: &timeline::Placed,
    local: i64,
    fps: f64,
) -> Result<(), String> {
    let frames = placed.frames;
    canvas.blended(overlay.layout.as_ref().and_then(|l| l.blend_mode.as_deref()), |canvas| {
        super::transition::draw_absolute(canvas, treatments, placed, local, |canvas, treatments| {
            draw_visual(
                canvas,
                treatments,
                &overlay.url,
                overlay.layout.as_ref(),
                Content::Image(Fit::of(overlay.layout.as_ref())),
                local as f64 / fps,
                overlay.reveal.as_ref().map(|reveal| reveal::At { reveal, frame: local, frames, fps }),
            )
        })
    })
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
    fn pixelated_source_sampling_survives_nested_transforms() {
        let mut gpu = pollster::block_on(crate::gpu::Gpu::new()).unwrap();
        let mut media = crate::media::Media::default();
        media.put("a", 2, 2, [1, 2, 3, 5].into_iter().flat_map(|r| [r, 0, 0, 255]).collect()).unwrap();
        let image = media.get("a").unwrap();
        let mut scene = vello::Scene::new();
        let mut canvas = Canvas { scene: &mut scene, media: &media, width: 3.0, height: 3.0, pixelated: true };
        canvas.transformed(Affine::IDENTITY, |canvas| draw_css_image_at(canvas, image, canvas.frame(), Affine::IDENTITY));
        let actual = pollster::block_on(gpu.render(&scene, 3, 3, Color::TRANSPARENT)).unwrap();
        assert_eq!(&actual[16..20], &[5, 0, 0, 255]);
    }

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

    #[test]
    fn outer_rotation_and_scale_use_the_noncentral_box_center() {
        let rect = Rect::new(10.0, 20.0, 110.0, 60.0);
        let transform = outer_transform(rect, 90.0, 2.0);
        let center = transform * rect.center();
        assert!((center.x - 60.0).abs() < 1e-12 && (center.y - 40.0).abs() < 1e-12);
        let corner = transform * rect.origin();
        assert!((corner.x - 100.0).abs() < 1e-12 && (corner.y + 60.0).abs() < 1e-12);
        let flip = flip_transform(rect, Some(&Layout { flip_x: Some(true), ..Default::default() }));
        assert_eq!(flip * rect.origin(), vello::kurbo::Point::new(110.0, 20.0));
    }
}
