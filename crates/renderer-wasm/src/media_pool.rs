//! The preview worker's adapter to portable lease/cache policy. No GPU initialization needed.
use maleo_media::visual_pool::{DecodeRequest, FrameIdentity, VisualPool};
use serde::Deserialize;
use serde_json::json;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Action {
    Enqueue { request: DecodeRequest },
    Acquire,
    Lookup { request: DecodeRequest },
    Retain { frames: Vec<u64> },
    Resize { lease: u64, width: u32, height: u32, bytes: Option<u64> },
    Complete { lease: u64, identity: FrameIdentity },
    Release { lease: u64 },
    Cancel { consumer: String },
    Clear,
    Stats,
}

#[wasm_bindgen]
pub struct MediaPool {
    pool: VisualPool,
}
#[wasm_bindgen]
impl MediaPool {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self { pool: VisualPool::default() }
    }
    /// Commands return JSON; RGBA buffers stay in the host under the returned frame identity.
    pub fn dispatch(&mut self, json: &str) -> Result<String, JsError> {
        let action: Action = serde_json::from_str(json).map_err(error)?;
        let result = match action {
            Action::Enqueue { request } => json!({"accepted":self.pool.enqueue(request).map_err(error)?}),
            Action::Acquire => serde_json::to_value(self.pool.acquire()).map_err(error)?,
            Action::Lookup { request } => json!({"frame":self.pool.lookup(&request)}),
            Action::Retain { frames } => {
                self.pool.retain(&frames).map_err(error)?;
                json!({})
            }
            Action::Resize { lease, width, height, bytes } => json!({"evicted":self.pool.resize(lease,width,height,bytes).map_err(error)?}),
            Action::Complete { lease, identity } => json!({"frame":self.pool.complete(lease,identity).map_err(error)?}),
            Action::Release { lease } => {
                self.pool.release(lease);
                json!({})
            }
            Action::Cancel { consumer } => json!({"leases":self.pool.cancel(&consumer)}),
            Action::Clear => json!({"evicted":self.pool.clear()}),
            Action::Stats => serde_json::to_value(self.pool.stats()).map_err(error)?,
        };
        serde_json::to_string(&result).map_err(error)
    }
}
impl Default for MediaPool {
    fn default() -> Self {
        Self::new()
    }
}
fn error(message: impl std::fmt::Display) -> JsError {
    JsError::new(&message.to_string())
}
