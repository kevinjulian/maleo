//! Whole-project coverage for export eligibility (OpenSpec p2-export E1). CPU only:
//! it parses the storyboard and walks every frame, without a GPU or a session.
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn project_coverage(storyboard_json: &str, fps: f64, frames: f64) -> Result<String, JsError> {
    if !fps.is_finite() || fps <= 0.0 {
        return Err(JsError::new("Invalid coverage frame rate"));
    }
    if !frames.is_finite() || frames < 1.0 || frames.fract() != 0.0 || frames > (1u64 << 53) as f64 {
        return Err(JsError::new("Invalid coverage storyboard duration"));
    }
    let storyboard = maleo_renderer::storyboard::Storyboard::parse(storyboard_json).map_err(|e| JsError::new(&e.0))?;
    let entries = maleo_renderer::coverage::project(&storyboard, fps, frames as i64);
    serde_json::to_string(&entries).map_err(|e| JsError::new(&e.to_string()))
}
