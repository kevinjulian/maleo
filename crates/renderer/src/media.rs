//! Host-supplied images by URL and typed video intervals by placement.
//!
//! The renderer does no IO: a native host decodes files, the browser host
//! decodes complete local Files, and both hand over straight-alpha RGBA, or
//! (browser video) a registered texture already on the renderer's device.
//! An image the host has not supplied draws a placeholder in the element's
//! box, and coverage lists the element as missing media.

use std::collections::HashMap;
use std::sync::Arc;

use maleo_media::visual_pool::{FrameIdentity, rgba_bytes};
use vello::Scene;
use vello::kurbo::{Affine, Line, Rect, Stroke};
use vello::peniko::{Blob, Color, Fill, ImageAlphaType, ImageData, ImageFormat};

#[derive(Clone, Copy)]
pub enum Source<'a> {
    Image(&'a str),
    Video { path: &'a str, url: &'a str, time: Option<f64> },
}

struct VideoFrame {
    cache_id: Option<u64>,
    url: String,
    identity: FrameIdentity,
    image: ImageData,
}

#[derive(Default)]
pub struct Media {
    images: HashMap<String, ImageData>,
    videos: HashMap<String, VideoFrame>,
    frames: HashMap<u64, (FrameIdentity, ImageData)>,
    image_ids: HashMap<String, u64>,
}

/// The placeholder: a flat gray box crossed corner to corner.
const PLACEHOLDER_FILL: Color = Color::from_rgb8(0x5a, 0x5a, 0x5a);
const PLACEHOLDER_LINE: Color = Color::from_rgb8(0x9a, 0x9a, 0x9a);

impl Media {
    /// Stores an image. `rgba` is straight alpha, `width * height * 4` bytes.
    pub fn put(&mut self, url: &str, width: u32, height: u32, rgba: Vec<u8>) -> Result<(), String> {
        let data = image(width, height, rgba)?;
        self.image_ids.remove(url);
        self.images.insert(url.to_owned(), data);
        Ok(())
    }

    pub fn get(&self, url: &str) -> Option<&ImageData> {
        self.images.get(url)
    }

    pub fn has(&self, url: &str) -> bool {
        self.images.contains_key(url)
    }

    /// The adapter accepts generation/lease completion before calling this boundary.
    pub fn put_video(&mut self, path: &str, url: &str, identity: FrameIdentity, rgba: Vec<u8>) -> Result<(), String> {
        identity.bytes()?;
        if identity.presentation.is_none() {
            return Err("Video presentation interval is missing".into());
        }
        if path.is_empty()
            || url.is_empty()
            || identity.source_id.is_empty()
            || identity.revision.is_empty()
            || !identity.start.is_finite()
            || !identity.end.is_finite()
            || identity.end <= identity.start
        {
            return Err("Invalid video frame identity".into());
        }
        let image = image(identity.width, identity.height, rgba)?;
        self.videos.insert(path.into(), VideoFrame { cache_id: None, url: url.into(), identity, image });
        Ok(())
    }

    /// One CPU buffer per native cache ID; placement bindings share its image data.
    pub fn cache_frame(&mut self, id: u64, identity: FrameIdentity, rgba: Vec<u8>) -> Result<(), String> {
        self.check_cached(id, &identity)?;
        let image = image(identity.width, identity.height, rgba)?;
        self.frames.insert(id, (identity, image));
        Ok(())
    }

    /// A frame the host already holds as an image, such as a registered GPU texture.
    pub fn cache_frame_image(&mut self, id: u64, identity: FrameIdentity, image: ImageData) -> Result<(), String> {
        self.check_cached(id, &identity)?;
        if image.width != identity.width || image.height != identity.height {
            return Err("Cached visual image does not match its identity".into());
        }
        self.frames.insert(id, (identity, image));
        Ok(())
    }

    fn check_cached(&self, id: u64, identity: &FrameIdentity) -> Result<(), String> {
        identity.bytes()?;
        if id == 0
            || self.frames.contains_key(&id)
            || identity.source_id.is_empty()
            || identity.revision.is_empty()
            || !identity.start.is_finite()
            || !identity.end.is_finite()
            || identity.end <= identity.start
        {
            return Err("Invalid cached visual identity".into());
        }
        Ok(())
    }

    pub fn bind_video(&mut self, request: &crate::media_requests::VideoRequest, id: u64) -> Result<(), String> {
        let (identity, image) = self.frames.get(&id).ok_or("Cached video frame is unavailable")?;
        if identity.presentation.is_none() {
            return Err("Video presentation interval is missing".into());
        }
        let time = request.time.ok_or("Video request is blocked")?;
        if request.blocker.is_some() || !time.is_finite() || request.path.is_empty() || request.url.is_empty() || identity.start > time || time >= identity.end
        {
            return Err("Cached video frame does not cover the requested source time".into());
        }
        self.videos.insert(request.path.clone(), VideoFrame { cache_id: Some(id), url: request.url.clone(), identity: identity.clone(), image: image.clone() });
        Ok(())
    }

    pub fn bind_image(&mut self, url: &str, id: u64) -> Result<(), String> {
        let (_, image) = self.frames.get(&id).ok_or("Cached image frame is unavailable")?;
        if url.is_empty() {
            return Err("Image URL is missing".into());
        }
        self.images.insert(url.into(), image.clone());
        self.image_ids.insert(url.into(), id);
        Ok(())
    }

    /// Returns the removed image, so a host can release a texture it registered.
    pub fn remove_frame(&mut self, id: u64) -> Option<ImageData> {
        let removed = self.frames.remove(&id).map(|(_, image)| image);
        self.videos.retain(|_, frame| frame.cache_id != Some(id));
        self.images.retain(|url, _| self.image_ids.get(url) != Some(&id));
        self.image_ids.retain(|_, frame| *frame != id);
        removed
    }

    pub fn remove_video(&mut self, path: &str) {
        self.videos.remove(path);
    }

    pub fn resolve(&self, source: Source<'_>) -> Option<&ImageData> {
        match source {
            Source::Image(url) => self.get(url),
            Source::Video { path, url, time } => {
                let time = time?;
                let frame = self.videos.get(path)?;
                (frame.url == url && frame.identity.start <= time && time < frame.identity.end).then_some(&frame.image)
            }
        }
    }
}

fn image(width: u32, height: u32, rgba: Vec<u8>) -> Result<ImageData, String> {
    let expected = rgba_bytes(width, height)?;
    if rgba.len() as u64 != expected {
        return Err(format!("Decoded visual: {} bytes for {width}x{height}, expected {expected}", rgba.len()));
    }
    Ok(ImageData { data: Blob::new(Arc::new(rgba)), format: ImageFormat::Rgba8, alpha_type: ImageAlphaType::Alpha, width, height })
}

/// Draws the missing-media placeholder over `rect`.
pub fn draw_placeholder(scene: &mut Scene, transform: Affine, rect: Rect) {
    scene.fill(Fill::NonZero, transform, PLACEHOLDER_FILL, None, &rect);
    let stroke = Stroke::new(4.0);
    for line in [Line::new((rect.x0, rect.y0), (rect.x1, rect.y1)), Line::new((rect.x1, rect.y0), (rect.x0, rect.y1))] {
        scene.stroke(&stroke, transform, PLACEHOLDER_LINE, None, &line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_image_must_match_its_size() {
        let mut media = Media::default();
        assert!(media.put("a.png", 2, 2, vec![0; 16]).is_ok());
        assert!(media.has("a.png"));
        assert!(media.put("b.png", 2, 2, vec![0; 15]).is_err());
        assert!(!media.has("b.png"));
    }

    #[test]
    fn video_requires_exact_placement_url_and_presentation_interval() {
        let mut media = Media::default();
        let identity = FrameIdentity { source_id: "s".into(), revision: "r".into(), start: 1.0, end: 1.5, presentation: Some([1.0, 1.5]), width: 2, height: 2 };
        media.put("same", 2, 2, vec![0; 16]).unwrap();
        media.put_video("videoOverlays[0]", "same", identity.clone(), vec![255; 16]).unwrap();
        let source = |path, url, time| Source::Video { path, url, time };
        assert!(media.resolve(source("videoOverlays[0]", "same", Some(1.0))).is_some());
        for absent in [
            source("videoOverlays[1]", "same", Some(1.0)),
            source("videoOverlays[0]", "changed", Some(1.0)),
            source("videoOverlays[0]", "same", Some(1.5)),
            source("videoOverlays[0]", "same", None),
        ] {
            assert!(media.resolve(absent).is_none());
        }
        assert!(media.put_video("videoOverlays[0]", "same", identity, vec![0; 15]).is_err());
        assert!(media.resolve(source("videoOverlays[0]", "same", Some(1.1))).is_some());
        media.remove_video("videoOverlays[0]");
        assert!(media.resolve(source("videoOverlays[0]", "same", Some(1.1))).is_none());
        assert!(media.has("same"));
    }

    #[test]
    fn video_selection_windows_keep_presentation_timestamps_and_reject_missing_or_invalid_intervals() {
        let mut media = Media::default();
        let identity = FrameIdentity {
            source_id: "s".into(),
            revision: "r".into(),
            start: 1.0 / 24.0,
            end: 3.0 / 24.0,
            presentation: Some([1.0 / 12.0, 2.0 / 12.0]),
            width: 1,
            height: 1,
        };
        media.put_video("clip", "source", identity.clone(), vec![255; 4]).unwrap();
        assert!(media.resolve(Source::Video { path: "clip", url: "source", time: Some(0.06) }).is_some());
        for presentation in [None, Some([1.0, 1.0]), Some([f64::NAN, 2.0])] {
            let invalid = FrameIdentity { presentation, ..identity.clone() };
            assert!(media.put_video("clip", "source", invalid, vec![255; 4]).is_err());
        }
        let image = FrameIdentity { presentation: None, ..identity };
        media.cache_frame(1, image, vec![255; 4]).unwrap();
        media.bind_image("image", 1).unwrap();
        let request = crate::media_requests::VideoRequest { path: "clip".into(), url: "source".into(), time: Some(0.06), blocker: None };
        assert!(media.bind_video(&request, 1).is_err());
        assert!(media.has("image"));
    }

    #[test]
    fn cached_frames_share_bytes_across_placements_and_eviction_removes_all_bindings() {
        let mut media = Media::default();
        let identity = FrameIdentity { source_id: "s".into(), revision: "r".into(), start: 0.0, end: 1.0, presentation: Some([0.0, 1.0]), width: 1, height: 1 };
        media.cache_frame(1, identity.clone(), vec![255; 4]).unwrap();
        media.bind_image("image", 1).unwrap();
        let mut request = crate::media_requests::VideoRequest { path: "left".into(), url: "same".into(), time: Some(0.2), blocker: None };
        media.bind_video(&request, 1).unwrap();
        request.path = "right".into();
        media.bind_video(&request, 1).unwrap();
        assert_eq!(media.get("image").unwrap().data.id(), media.videos["left"].image.data.id());
        assert_eq!(media.videos["left"].image.data.id(), media.videos["right"].image.data.id());
        assert!(media.cache_frame(1, identity, vec![0; 4]).is_err());
        media.put("legacy", 1, 1, vec![0; 4]).unwrap();
        media.remove_frame(1);
        assert!(media.frames.is_empty());
        assert!(media.videos.is_empty());
        assert!(!media.has("image"));
        assert!(media.has("legacy"));
        assert!(media.bind_video(&request, 1).is_err());
    }
}
