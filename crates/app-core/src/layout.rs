//! Layout and text defaults (`p1-envelope-inspector` I1): the layout a clip has
//! when a field is absent or out of range, and a text preset's default style.
//! `normalize_layout` lives with the canvas rules that also read it.

use serde_json::{Value, json};

pub use crate::canvas::edit::normalize_layout;

/// `defaultTextStyle(preset)`: a plain preset is regular weight and keeps its
/// casing; every other preset is bold and upper case.
pub fn default_text_style(preset: Option<&str>) -> Value {
    let plain = preset == Some("plain");
    json!({
        "fontFamily": "Inter",
        "fontSize": 64,
        "weight": if plain { 400 } else { 800 },
        "fill": "#ffffff",
        "background": "transparent",
        "accent": "#7C66FF",
        "bodyFill": "#ffffff",
        "bgOpacity": 0,
        "scale": 1,
        "align": "center",
        "casing": if plain { "none" } else { "upper" },
    })
}
