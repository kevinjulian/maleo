//! Draws every output frame in order (OpenSpec p2-export E4).
//!
//! Frame `n` is drawn at `n / fps` after the host supplies every media frame it
//! requests. Two readback slots alternate: while the GPU finishes and copies
//! frame `n`, the CPU composes frame `n + 1`. A frame whose coverage report is
//! not empty (an unsupported element, missing media) stops the run before it is
//! handed on, so it is never encoded.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use maleo_renderer::coverage::Entry;
use maleo_renderer::frame::Renderer;
use maleo_renderer::storyboard::Storyboard;

#[derive(Debug, PartialEq)]
pub enum RenderError {
    /// A frame does not draw exactly; nothing from it reached the sink.
    Coverage {
        frame: i64,
        entries: Vec<Entry>,
    },
    /// A stage failed: `media`, `render`, `readback` or the sink's stage.
    Failed {
        stage: &'static str,
        message: String,
    },
    Cancelled,
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenderError::Coverage { frame, entries } => {
                let first = entries.first().map(|e| format!("{} {}", e.path, e.reason)).unwrap_or_default();
                write!(f, "frame {frame} cannot be exported: {first}")
            }
            RenderError::Failed { stage, message } => write!(f, "{stage}: {message}"),
            RenderError::Cancelled => write!(f, "cancelled"),
        }
    }
}

fn failed(stage: &'static str) -> impl Fn(String) -> RenderError {
    move |message| RenderError::Failed { stage, message }
}

/// Supplies requested video frames before each draw. The server host decodes
/// with FFmpeg; tests supply pre-decoded samples.
pub trait VideoSupply {
    fn supply(&mut self, renderer: &mut Renderer, storyboard: &Storyboard, frame: i64, fps: f64) -> Result<(), String>;
}

/// No video: any video request stays unsupplied and its frame reports missing media.
pub struct NoVideo;

impl VideoSupply for NoVideo {
    fn supply(&mut self, _: &mut Renderer, _: &Storyboard, _: i64, _: f64) -> Result<(), String> {
        Ok(())
    }
}

/// Decodes every still image in `media` (everything that is not a movie) into the renderer.
pub fn load_images(renderer: &mut Renderer, media: &BTreeMap<String, PathBuf>) -> Result<(), RenderError> {
    for (url, path) in media {
        let movie = path.extension().and_then(|e| e.to_str()).is_some_and(|e| ["mp4", "mov", "webm", "mkv", "m4v"].contains(&e.to_ascii_lowercase().as_str()));
        let audio = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| ["wav", "mp3", "m4a", "aac", "ogg", "opus", "flac"].contains(&e.to_ascii_lowercase().as_str()));
        if movie || audio {
            continue;
        }
        let decoded = image::open(path).map_err(|e| RenderError::Failed { stage: "media", message: format!("{url}: {e}") })?.to_rgba8();
        let (width, height) = decoded.dimensions();
        renderer.put_image(url, width, height, decoded.into_raw()).map_err(|e| RenderError::Failed { stage: "media", message: format!("{url}: {e}") })?;
    }
    Ok(())
}

/// Receives each frame, in order, as tightly packed straight-alpha RGBA.
pub type FrameSink<'a> = dyn FnMut(i64, &[u8]) -> Result<(), RenderError> + 'a;

pub struct Output {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /// Frames drawn and handed on: `0..frames`.
    pub frames: i64,
    /// The composition length the timing uses (progress bars, pacing). An
    /// export draws the whole composition, so it equals `frames` there.
    pub duration: i64,
}

struct Slot {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    buffer: wgpu::Buffer,
    mapped: Arc<Mutex<Option<Result<(), String>>>>,
}

/// Draws frames `0..frames` and hands each one, as tightly packed straight-alpha
/// RGBA, to `sink` in order. `cancelled` is checked before every frame.
pub fn render_frames(
    renderer: &mut Renderer,
    storyboard: &Storyboard,
    output: &Output,
    video: &mut dyn VideoSupply,
    cancelled: &dyn Fn() -> bool,
    sink: &mut FrameSink<'_>,
) -> Result<(), RenderError> {
    let (width, height) = (output.width, output.height);
    let row = (width * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let slots: Vec<Slot> = (0..2)
        .map(|_| {
            let texture = renderer.gpu().target(width, height);
            let view = texture.create_view(&Default::default());
            let buffer = renderer.gpu().device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("maleo-host-readback"),
                size: u64::from(row * height),
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            Slot { texture, view, buffer, mapped: Arc::new(Mutex::new(None)) }
        })
        .collect();
    let mut tight = vec![0u8; (width * height * 4) as usize];
    let mut pending: Option<(i64, usize)> = None;

    let mut finish = |renderer: &Renderer, frame: i64, slot: &Slot, tight: &mut Vec<u8>| -> Result<(), RenderError> {
        renderer.gpu().device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None }).map_err(|e| failed("readback")(format!("poll: {e}")))?;
        let result = slot.mapped.lock().map_err(|_| failed("readback")("map state poisoned".into()))?.take();
        match result {
            Some(Ok(())) => {}
            Some(Err(message)) => return Err(failed("readback")(message)),
            None => return Err(failed("readback")("buffer map did not complete".into())),
        }
        {
            let data = slot.buffer.slice(..).get_mapped_range().map_err(|e| failed("readback")(format!("map range: {e}")))?;
            for y in 0..height as usize {
                let from = y * row as usize;
                let to = y * width as usize * 4;
                tight[to..to + width as usize * 4].copy_from_slice(&data[from..from + width as usize * 4]);
            }
        }
        slot.buffer.unmap();
        // As `Gpu::render`: vello may keep colour where clipping rounded alpha to zero.
        for pixel in tight.as_chunks_mut::<4>().0 {
            if pixel[3] == 0 {
                pixel[..3].fill(0);
            }
        }
        sink(frame, tight)
    };

    for frame in 0..output.frames {
        if cancelled() {
            return Err(RenderError::Cancelled);
        }
        video.supply(renderer, storyboard, frame, output.fps).map_err(failed("media"))?;
        let index = (frame % 2) as usize;
        let slot = &slots[index];
        let coverage = renderer.draw(storyboard, frame, &slot.view, width, height, (output.fps, output.duration)).map_err(failed("render"))?;
        if !coverage.is_empty() {
            return Err(RenderError::Coverage { frame, entries: coverage });
        }
        let gpu = renderer.gpu();
        let mut encoder = gpu.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            slot.texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &slot.buffer,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(height) },
            },
            slot.texture.size(),
        );
        gpu.queue.submit([encoder.finish()]);
        let signal = slot.mapped.clone();
        slot.buffer.slice(..).map_async(wgpu::MapMode::Read, move |result| {
            if let Ok(mut held) = signal.lock() {
                *held = Some(result.map_err(|e| format!("readback: {e}")));
            }
        });
        if let Some((previous, at)) = pending.replace((frame, index)) {
            finish(renderer, previous, &slots[at], &mut tight)?;
        }
    }
    if let Some((previous, at)) = pending {
        finish(renderer, previous, &slots[at], &mut tight)?;
    }
    Ok(())
}
