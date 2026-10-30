//! PCM-only browser boundary. No GPU or AudioContext is needed to construct the budget or mix.
use maleo_media::{
    audio::Mix,
    pcm::{self, Budget, Decoded, Format, Window},
};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn project_audio(storyboard_json: &str, fps: f64, frames: f64) -> Result<String, JsError> {
    if !frames.is_finite() || frames < 1.0 || frames.fract() != 0.0 || frames > (1u64 << 53) as f64 {
        return Err(error("Invalid audio storyboard duration"));
    }
    let storyboard = maleo_renderer::storyboard::Storyboard::parse(storyboard_json).map_err(error)?;
    let mix = maleo_renderer::audio_requests::project(&storyboard, fps, frames as i64).map_err(error)?;
    serde_json::to_string(&mix).map_err(error)
}

#[wasm_bindgen]
pub fn audio_requests(mix_json: &str, metadata_json: &str, sample_rate: u32, start_sample: f64, frames: u32) -> Result<String, JsError> {
    if !start_sample.is_finite() || start_sample < 0.0 || start_sample.fract() != 0.0 || start_sample > (1u64 << 53) as f64 {
        return Err(error("Invalid audio planning position"));
    }
    let mix = serde_json::from_str(mix_json).map_err(error)?;
    let metadata: Vec<pcm::Metadata> = serde_json::from_str(metadata_json).map_err(error)?;
    let requests = pcm::requests(&mix, Format { sample_rate, channels: 2 }, start_sample as u64, frames, &metadata).map_err(error)?;
    serde_json::to_string(&requests).map_err(error)
}

#[wasm_bindgen]
#[derive(Default)]
pub struct PcmBudget {
    budget: Budget,
}
#[wasm_bindgen]
impl PcmBudget {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    pub fn reserve(&mut self, bytes: u32) -> Result<u64, JsError> {
        self.budget.reserve(u64::from(bytes)).map_err(error)
    }
    pub fn resize(&mut self, lease: u64, bytes: u32) -> Result<(), JsError> {
        self.budget.resize(lease, u64::from(bytes)).map_err(error)
    }
    pub fn release(&mut self, lease: u64) {
        self.budget.release(lease);
    }
    pub fn used(&self) -> u32 {
        self.budget.used() as u32
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    path: String,
    sample_rate: u32,
    channels: u32,
    first_timestamp: f64,
    frames: u64,
    windows: Vec<Span>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Span {
    start: u64,
    offset: usize,
    count: usize,
}

/// Callers reserve all host/WASM input and output copies before invoking this boundary.
#[wasm_bindgen]
pub fn mix_audio(
    mix_json: &str,
    inputs_json: &str,
    samples: &[f32],
    sample_rate: u32,
    channels: u32,
    start_sample: f64,
    frames: u32,
) -> Result<Vec<f32>, JsError> {
    let format = Format { sample_rate, channels };
    format.block_bytes(frames).map_err(error)?;
    if !start_sample.is_finite()
        || start_sample < 0.0
        || start_sample.fract() != 0.0
        || start_sample > (1u64 << 53) as f64
        || samples.len() > pcm::PCM_BYTES as usize / 4
    {
        return Err(error("Invalid PCM input or output position"));
    }
    let mix: Mix = serde_json::from_str(mix_json).map_err(error)?;
    let inputs: Vec<Input> = serde_json::from_str(inputs_json).map_err(error)?;
    let windows = inputs
        .iter()
        .map(|input| {
            input
                .windows
                .iter()
                .map(|span| {
                    let end = span.offset.checked_add(span.count).ok_or_else(|| error("Invalid PCM buffer offset"))?;
                    let data = samples.get(span.offset..end).ok_or_else(|| error("PCM window exceeds supplied buffer"))?;
                    Ok(Window { start: span.start, data })
                })
                .collect::<Result<Vec<_>, JsError>>()
        })
        .collect::<Result<Vec<_>, JsError>>()?;
    let sources: Vec<_> = inputs
        .iter()
        .zip(&windows)
        .map(|(input, windows)| Decoded {
            path: &input.path,
            format: Format { sample_rate: input.sample_rate, channels: input.channels },
            first_timestamp: input.first_timestamp,
            frames: input.frames,
            windows,
        })
        .collect();
    let mut output = vec![0.0; frames as usize * channels as usize];
    pcm::mix_into(&mix, format, start_sample as u64, &sources, &mut output).map_err(error)?;
    Ok(output)
}
fn error(message: impl std::fmt::Display) -> JsError {
    JsError::new(&message.to_string())
}
