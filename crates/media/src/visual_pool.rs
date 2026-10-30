//! Host-free decoder leases and accounting for cached plus in-flight CPU RGBA.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

pub const VIDEO_DECODERS: usize = 2;
pub const IMAGE_DECODERS: usize = 2;
pub const VISUAL_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VisualKind {
    Image,
    Video,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecodeRequest {
    pub consumer: String,
    pub generation: u64,
    pub sequence: u64,
    pub source_id: String,
    pub revision: String,
    pub time: f64,
    pub width: u32,
    pub height: u32,
    pub kind: VisualKind,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrameIdentity {
    pub source_id: String,
    pub revision: String,
    pub start: f64,
    pub end: f64,
    /// Original presentation interval; start/end above are the cache selection window.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presentation: Option<[f64; 2]>,
    pub width: u32,
    pub height: u32,
}
impl FrameIdentity {
    fn covers(&self, request: &DecodeRequest) -> bool {
        self.source_id == request.source_id && self.revision == request.revision && self.start <= request.time && request.time < self.end
    }
    pub fn bytes(&self) -> Result<u64, String> {
        if self.source_id.is_empty()
            || self.revision.is_empty()
            || !self.start.is_finite()
            || !self.end.is_finite()
            || self.end <= self.start
            || self.presentation.is_some_and(|[start, end]| !start.is_finite() || !end.is_finite() || end <= start)
        {
            return Err("Invalid decoded frame identity".into());
        }
        rgba_bytes(self.width, self.height)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lease {
    pub id: u64,
    pub request: DecodeRequest,
    pub bytes: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedFrame {
    pub id: u64,
    pub identity: FrameIdentity,
    pub bytes: u64,
    last_use: u64,
}
#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolStats {
    pub video_decoders: usize,
    pub reserved_bytes: u64,
    pub cached_bytes: u64,
    pub queued: usize,
}
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DecodePlan {
    Wait,
    Start { lease: Lease, evicted: Vec<u64> },
    Failed { request: DecodeRequest, message: String },
}

#[derive(Default)]
pub struct VisualPool {
    next: u64,
    touched: u64,
    pending: VecDeque<DecodeRequest>,
    latest: BTreeMap<String, (u64, u64)>,
    active: BTreeMap<u64, Lease>,
    cache: Vec<CachedFrame>,
    retained: BTreeSet<u64>,
}

pub fn rgba_bytes(width: u32, height: u32) -> Result<u64, String> {
    let bytes = u64::from(width).checked_mul(u64::from(height)).and_then(|value| value.checked_mul(4));
    match bytes {
        Some(bytes) if bytes > 0 && bytes <= VISUAL_BYTES => Ok(bytes),
        _ => Err("Decoded visual exceeds the 256 MiB visual budget".into()),
    }
}

impl VisualPool {
    /// One active request and one replaceable latest request per logical placement.
    pub fn enqueue(&mut self, request: DecodeRequest) -> Result<bool, String> {
        rgba_bytes(request.width, request.height)?;
        if request.consumer.is_empty() || request.source_id.is_empty() || request.revision.is_empty() || !request.time.is_finite() {
            return Err("Invalid visual decode request".into());
        }
        let token = (request.generation, request.sequence);
        if self.latest.get(&request.consumer).is_some_and(|previous| token <= *previous) {
            return Ok(false);
        }
        self.latest.insert(request.consumer.clone(), token);
        if let Some(queued) = self.pending.iter_mut().find(|queued| queued.consumer == request.consumer) {
            *queued = request;
        } else {
            self.pending.push_back(request);
        }
        Ok(true)
    }
    pub fn lookup(&mut self, request: &DecodeRequest) -> Option<CachedFrame> {
        let cached = self.cache.iter_mut().find(|frame| frame.identity.covers(request))?;
        self.touched += 1;
        cached.last_use = self.touched;
        Some(cached.clone())
    }
    /// The current and next presentation intervals stay resident until their consumers release them.
    pub fn retain(&mut self, frames: &[u64]) -> Result<(), String> {
        if frames.iter().any(|id| !self.cache.iter().any(|frame| frame.id == *id)) {
            return Err("Cannot retain an unknown decoded frame".into());
        }
        self.retained = frames.iter().copied().collect();
        Ok(())
    }
    fn make_room(&mut self, bytes: u64) -> Option<Vec<u64>> {
        let stats = self.stats();
        let mut used = stats.cached_bytes + stats.reserved_bytes;
        let mut candidates: Vec<_> = self.cache.iter().filter(|frame| !self.retained.contains(&frame.id)).collect();
        candidates.sort_by_key(|frame| frame.last_use);
        let mut evicted = Vec::new();
        for frame in candidates {
            if used + bytes <= VISUAL_BYTES {
                break;
            }
            used -= frame.bytes;
            evicted.push(frame.id);
        }
        if used + bytes > VISUAL_BYTES {
            return None;
        }
        self.cache.retain(|frame| !evicted.contains(&frame.id));
        Some(evicted)
    }
    pub fn acquire(&mut self) -> DecodePlan {
        let stats = self.stats();
        let images = self.active.values().filter(|lease| lease.request.kind == VisualKind::Image).count();
        let next = self.pending.iter().position(|request| {
            !self.active.values().any(|lease| lease.request.consumer == request.consumer)
                && match request.kind {
                    VisualKind::Image => images < IMAGE_DECODERS,
                    // Local cap beside the host broker (`decoder.rs`): never reserve visual bytes for
                    // video jobs that would only wait for a physical codec lease.
                    VisualKind::Video => stats.video_decoders < VIDEO_DECODERS,
                }
        });
        let Some(index) = next else { return DecodePlan::Wait };
        let request = &self.pending[index];
        let bytes = rgba_bytes(request.width, request.height).expect("queued request validated");
        let Some(evicted) = self.make_room(bytes) else {
            // Active outputs may release their reservations before this queued request runs.
            if !self.active.is_empty() {
                return DecodePlan::Wait;
            }
            return DecodePlan::Failed {
                request: self.pending.remove(index).unwrap(),
                message: "Requested visual working set exceeds the 256 MiB visual budget".into(),
            };
        };
        let request = self.pending.remove(index).unwrap();
        self.next += 1;
        let lease = Lease { id: self.next, request, bytes };
        self.active.insert(lease.id, lease.clone());
        DecodePlan::Start { lease, evicted }
    }
    /// Host reserves actual dimensions before allocating/copying RGBA, including resolution changes.
    pub fn resize(&mut self, id: u64, width: u32, height: u32, reservation: Option<u64>) -> Result<Vec<u64>, String> {
        let minimum = rgba_bytes(width, height)?;
        let bytes = reservation.unwrap_or(minimum);
        if bytes < minimum || bytes > VISUAL_BYTES {
            return Err("Decoded visual temporary buffers exceed the 256 MiB visual budget".into());
        }
        let old = self.active.get(&id).ok_or("Unknown visual decoder lease")?.bytes;
        let evicted = if bytes > old { self.make_room(bytes - old).ok_or("Decoded visual working set exceeds the 256 MiB visual budget")? } else { Vec::new() };
        let lease = self.active.get_mut(&id).unwrap();
        lease.bytes = bytes;
        lease.request.width = width;
        lease.request.height = height;
        Ok(evicted)
    }
    /// Temporary host buffers must be released before completion. Obsolete output is not cached.
    pub fn complete(&mut self, id: u64, identity: FrameIdentity) -> Result<Option<CachedFrame>, String> {
        let lease = self.active.remove(&id).ok_or("Unknown visual decoder lease")?;
        if self.latest.get(&lease.request.consumer) != Some(&(lease.request.generation, lease.request.sequence)) {
            return Ok(None);
        }
        let bytes = identity.bytes()?;
        if bytes > lease.bytes || identity.width != lease.request.width || identity.height != lease.request.height || !identity.covers(&lease.request) {
            return Err("Decoded frame does not match its reservation or presentation interval".into());
        }
        self.touched += 1;
        if let Some(existing) = self.cache.iter_mut().find(|frame| frame.identity == identity) {
            existing.last_use = self.touched;
            return Ok(Some(existing.clone()));
        }
        let frame = CachedFrame { id, identity, bytes, last_use: self.touched };
        self.cache.push(frame.clone());
        Ok(Some(frame))
    }
    /// Decoder/copy errors release the complete reservation, even after a failed completion.
    pub fn release(&mut self, id: u64) {
        self.active.remove(&id);
    }
    pub fn cancel(&mut self, consumer: &str) -> Vec<u64> {
        self.pending.retain(|request| request.consumer != consumer);
        self.latest.remove(consumer);
        // Host closes these leases, then calls release; never grant their capacity early.
        self.active.values().filter(|lease| lease.request.consumer == consumer).map(|lease| lease.id).collect()
    }
    pub fn clear(&mut self) -> Vec<u64> {
        self.pending.clear();
        self.latest.clear();
        self.retained.clear();
        self.cache.drain(..).map(|frame| frame.id).collect()
    }
    pub fn stats(&self) -> PoolStats {
        PoolStats {
            video_decoders: self.active.values().filter(|lease| lease.request.kind == VisualKind::Video).count(),
            reserved_bytes: self.active.values().map(|lease| lease.bytes).sum(),
            cached_bytes: self.cache.iter().map(|frame| frame.bytes).sum(),
            queued: self.pending.len(),
        }
    }
}
