//! Bounded PCM working sets and device-rate mixing. Hosts own decoding and output.
use crate::audio::Mix;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const PCM_BYTES: u64 = 16 * 1024 * 1024;
pub const LOOKAHEAD_SECONDS: u32 = 2;

/// Reservations include host buffers, transfer copies, mixer output and tempo state.
#[derive(Default)]
pub struct Budget {
    next: u64,
    used: u64,
    leases: BTreeMap<u64, u64>,
}
impl Budget {
    pub fn reserve(&mut self, bytes: u64) -> Result<u64, String> {
        if bytes == 0 || bytes > PCM_BYTES - self.used {
            return Err("PCM working set exceeds the 16 MiB budget".into());
        }
        let id = self.next.checked_add(1).ok_or("PCM lease handles exhausted")?;
        self.next = id;
        self.leases.insert(id, bytes);
        self.used += bytes;
        Ok(id)
    }
    /// Shrink only after temporary copies have been detached or released.
    pub fn resize(&mut self, id: u64, bytes: u64) -> Result<(), String> {
        let old = self.leases.get_mut(&id).ok_or("PCM reservation is unavailable")?;
        if bytes == 0 || bytes > PCM_BYTES - (self.used - *old) {
            return Err("PCM working set exceeds the 16 MiB budget".into());
        }
        self.used = self.used - *old + bytes;
        *old = bytes;
        Ok(())
    }
    pub fn release(&mut self, id: u64) {
        if let Some(bytes) = self.leases.remove(&id) {
            self.used -= bytes;
        }
    }
    pub fn used(&self) -> u64 {
        self.used
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Format {
    pub sample_rate: u32,
    /// The output adapter requests mono or stereo speaker layout.
    pub channels: u32,
}
impl Format {
    pub fn validate(self) -> Result<(), String> {
        if !(8000..=192000).contains(&self.sample_rate) || !(1..=2).contains(&self.channels) {
            return Err("Unsupported PCM sample rate or speaker layout".into());
        }
        Ok(())
    }
    pub fn block_bytes(self, frames: u32) -> Result<u64, String> {
        self.validate()?;
        if frames == 0 || frames > self.sample_rate * LOOKAHEAD_SECONDS {
            return Err("PCM block exceeds two-second lookahead".into());
        }
        Ok(u64::from(frames) * u64::from(self.channels) * 4)
    }
}

/// Interleaved samples at their original sample rate. Adjacent windows may share no samples.
pub struct Window<'a> {
    pub start: u64,
    pub data: &'a [f32],
}
pub struct Decoded<'a> {
    pub path: &'a str,
    pub format: Format,
    pub first_timestamp: f64,
    pub frames: u64,
    pub windows: &'a [Window<'a>],
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metadata {
    pub path: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub first_timestamp: f64,
    pub frames: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub path: String,
    pub url: String,
    pub start: f64,
    pub end: f64,
}

fn source_time(mix: &Mix, source: &crate::audio::Source, first: f64, frames: u64, sample_rate: u32, time: f64) -> Result<f64, String> {
    let mut elapsed = time - source.start_frame as f64 / mix.fps;
    if source.loop_source {
        let end = first + frames as f64 / f64::from(sample_rate);
        let loop_frames = ((end - source.media_start_sec) * mix.fps / source.playback_rate).floor();
        if loop_frames < 1.0 {
            return Err(format!("Invalid trimmed audio loop duration: {}", source.path));
        }
        elapsed = elapsed.rem_euclid(loop_frames / mix.fps);
    }
    Ok(source.media_start_sec + elapsed * source.playback_rate)
}

/// Exact local windows needed by the mixer, including interpolation and loop seams.
pub fn requests(mix: &Mix, format: Format, start_sample: u64, frames: u32, metadata: &[Metadata]) -> Result<Vec<Request>, String> {
    mix.validate()?;
    format.block_bytes(frames)?;
    let end = start_sample.checked_add(u64::from(frames)).filter(|end| *end <= 1u64 << 53).ok_or("Invalid PCM planning position")?;
    let mut seen = std::collections::BTreeSet::new();
    for info in metadata {
        Decoded {
            path: &info.path,
            format: Format { sample_rate: info.sample_rate, channels: info.channels },
            first_timestamp: info.first_timestamp,
            frames: info.frames,
            windows: &[],
        }
        .validate()?;
        if !seen.insert(&info.path) || !mix.sources.iter().any(|source| source.path == info.path) {
            return Err("Unknown or duplicate audio metadata".into());
        }
    }
    let mut requests = Vec::new();
    for source in &mix.sources {
        let mut spans: Vec<(u64, u64)> = Vec::new();
        let mut info = None;
        let found = metadata.iter().find(|info| info.path == source.path);
        // Gain is constant within a composition frame; evaluate it once per frame.
        let mut audible = (-1i64, false);
        for sample in start_sample..end {
            let time = sample as f64 / f64::from(format.sample_rate);
            let frame = (time * mix.fps).floor();
            if frame >= mix.frames as f64 {
                continue;
            }
            if audible.0 != frame as i64 {
                audible = (frame as i64, mix.gain(source, frame as i64) != 0.0);
            }
            if !audible.1 {
                continue;
            }
            let metadata = found.ok_or_else(|| format!("Audio buffering: missing metadata for {}", source.path))?;
            info = Some(metadata);
            let position = (source_time(mix, source, metadata.first_timestamp, metadata.frames, metadata.sample_rate, time)? - metadata.first_timestamp)
                * f64::from(metadata.sample_rate);
            if position < 0.0 || position >= metadata.frames as f64 {
                continue;
            }
            let left = position.floor() as u64;
            let right = if position.fract() == 0.0 { left + 1 } else { (left + 2).min(metadata.frames) };
            if let Some(last) = spans.last_mut()
                && left >= last.0
                && left <= last.1
            {
                last.1 = last.1.max(right);
            } else {
                spans.push((left, right));
            }
        }
        let Some(info) = info else {
            continue;
        };
        spans.sort_unstable();
        let mut merged: Vec<(u64, u64)> = Vec::new();
        for (start, end) in spans {
            if let Some(last) = merged.last_mut()
                && start <= last.1
            {
                last.1 = last.1.max(end);
            } else {
                merged.push((start, end));
            }
        }
        for (mut start, end) in merged {
            while start < end {
                let stop = end.min(start + u64::from(info.sample_rate) * 2 - 2);
                requests.push(Request {
                    path: source.path.clone(),
                    url: source.url.clone(),
                    start: (info.first_timestamp + start as f64 / f64::from(info.sample_rate)).max(0.0),
                    end: info.first_timestamp + stop as f64 / f64::from(info.sample_rate),
                });
                start = stop;
            }
        }
    }
    Ok(requests)
}
impl Decoded<'_> {
    fn validate(&self) -> Result<(), String> {
        self.format.validate()?;
        if self.path.is_empty() || !self.first_timestamp.is_finite() || self.frames == 0 || self.frames > (1u64 << 53) {
            return Err("Invalid decoded audio identity or timing".into());
        }
        let mut end = 0;
        for window in self.windows {
            let frames = window.data.len() as u64 / u64::from(self.format.channels);
            let last = window.start.checked_add(frames).ok_or("Invalid PCM window span")?;
            if frames == 0
                || !window.data.len().is_multiple_of(self.format.channels as usize)
                || window.start < end
                || last > self.frames
                || window.data.iter().any(|value| !value.is_finite())
            {
                return Err("Invalid, overlapping or non-finite PCM window".into());
            }
            end = last;
        }
        Ok(())
    }
    fn at(&self, frame: u64, channel: usize) -> Result<f64, String> {
        for window in self.windows {
            if let Some(offset) = frame.checked_sub(window.start)
                && offset < (window.data.len() / self.format.channels as usize) as u64
            {
                return Ok(f64::from(window.data[offset as usize * self.format.channels as usize + channel]));
            }
        }
        Err(format!("Audio buffering: missing PCM for {} at sample {frame}", self.path))
    }
    fn sample(&self, time: f64, channel: usize, output_channels: u32) -> Result<f64, String> {
        let position = (time - self.first_timestamp) * f64::from(self.format.sample_rate);
        if position < 0.0 {
            return Ok(0.0);
        }
        if position >= self.frames as f64 {
            return Ok(0.0);
        }
        let left = position.floor() as u64;
        let right = (left + 1).min(self.frames - 1);
        let fraction = position - left as f64;
        let interpolate = |channel| -> Result<f64, String> {
            let a = self.at(left, channel)?;
            if fraction == 0.0 {
                return Ok(a);
            }
            Ok(a + (self.at(right, channel)? - a) * fraction)
        };
        if self.format.channels == 2 && output_channels == 1 {
            Ok((interpolate(0)? + interpolate(1)?) * 0.5)
        } else {
            interpolate(if self.format.channels == 1 { 0 } else { channel })
        }
    }
}

/// Mix at 1x timeline rate. Global pitch-preserved transport runs downstream under D6.
/// On error the caller discards output. Floating point output stays unclipped until device output.
pub fn mix_into(mix: &Mix, format: Format, start_sample: u64, sources: &[Decoded<'_>], output: &mut [f32]) -> Result<(), String> {
    mix.validate()?;
    format.validate()?;
    let frames = output.len() / format.channels as usize;
    if !output.len().is_multiple_of(format.channels as usize) || frames > u32::MAX as usize {
        return Err("Invalid PCM output length".into());
    }
    let output_bytes = format.block_bytes(frames as u32)?;
    let end = start_sample.checked_add(frames as u64).ok_or("PCM output position overflow")?;
    if end > (1u64 << 53) {
        return Err("PCM output position exceeds exact sample range".into());
    }
    let mut bytes = output_bytes;
    let mut paths = std::collections::BTreeSet::new();
    for source in sources {
        source.validate()?;
        if !paths.insert(source.path) || !mix.sources.iter().any(|input| input.path == source.path) {
            return Err("Unknown or duplicate decoded audio binding".into());
        }
        for window in source.windows {
            bytes = bytes.checked_add(window.data.len() as u64 * 4).ok_or("PCM working set overflow")?;
        }
    }
    if bytes > PCM_BYTES {
        return Err("PCM working set exceeds the 16 MiB budget".into());
    }
    for (index, output_frame) in output.chunks_exact_mut(format.channels as usize).enumerate() {
        let time = (start_sample + index as u64) as f64 / f64::from(format.sample_rate);
        let frame = (time * mix.fps).floor();
        if frame >= mix.frames as f64 {
            output_frame.fill(0.0);
            continue;
        }
        let mut sum = [0.0f64; 2];
        for source in &mix.sources {
            let gain = mix.gain(source, frame as i64);
            if gain == 0.0 {
                continue;
            }
            let pcm = sources.iter().find(|pcm| pcm.path == source.path).ok_or_else(|| format!("Audio buffering: missing source {}", source.path))?;
            // Remotion calculateMediaDuration floors trimmed loops to composition frames.
            let source_time = source_time(mix, source, pcm.first_timestamp, pcm.frames, pcm.format.sample_rate, time)?;
            for (channel, value) in sum.iter_mut().enumerate().take(format.channels as usize) {
                *value += pcm.sample(source_time, channel, format.channels)? * gain;
            }
        }
        for (sample, value) in output_frame.iter_mut().zip(sum) {
            let value = value as f32;
            if !value.is_finite() {
                return Err("Non-finite mixed PCM output".into());
            }
            *sample = value;
        }
    }
    Ok(())
}
