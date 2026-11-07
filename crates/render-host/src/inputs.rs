//! Every media URL a storyboard draws or plays (OpenSpec p2-export E4). The
//! render worker maps exactly these to local files before `render`, because the
//! host makes no network request. It is the renderer's own request walk over
//! every frame, plus the production audio mix's sources.

use std::collections::BTreeSet;

use maleo_renderer::audio_requests;
use maleo_renderer::media_requests::{image_requests, video_requests};
use maleo_renderer::storyboard::Storyboard;

pub fn media_urls(storyboard: &Storyboard, fps: f64, frames: i64) -> Result<BTreeSet<String>, String> {
    let mut urls = BTreeSet::new();
    for frame in 0..frames.max(0) {
        urls.extend(image_requests(storyboard, frame, fps).into_iter().map(|request| request.url));
        urls.extend(video_requests(storyboard, frame, fps).into_iter().map(|request| request.url));
    }
    urls.extend(audio_requests::project(storyboard, fps, frames)?.sources.into_iter().map(|source| source.url));
    Ok(urls)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_images_videos_and_audio_once_each() {
        let storyboard = Storyboard::parse(
            r#"{"scenes":[{"image":"a.png","durationSec":1,"transition":"cut"},{"image":"a.png","durationSec":1,"transition":"cut"}],
               "videoOverlays":[{"url":"v.mp4","kind":"video","startSec":0.5,"durationSec":1,"volume":1}],
               "audioOverlays":[{"url":"m.wav","kind":"music","startSec":0,"durationSec":2,"volume":1}]}"#,
        )
        .unwrap();
        let urls: Vec<String> = media_urls(&storyboard, 30.0, 60).unwrap().into_iter().collect();
        assert_eq!(urls, ["a.png", "m.wav", "v.mp4"]);
    }
}
