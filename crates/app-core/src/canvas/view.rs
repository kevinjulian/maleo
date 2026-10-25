//! Where the canvas sits on the screen (D2 `canvas_view`): the preview area,
//! the fit of the canvas into it, the zoom, the pan and the pixel density.
//!
//! Screen points arrive in device pixels; the area, the pan and every size
//! the engine reports are in logical pixels (device pixels / density). A point
//! outside the canvas maps outside `[0, 100]` percent; nothing is clamped.

use serde_json::Value;

use super::{Point, Size};

/// How the canvas fits the preview area.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fit {
    /// The whole canvas shows, letterboxed on the long side.
    Contain,
    /// The canvas covers the area, cropped on the long side.
    Cover,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    /// The preview area: left, top, width and height in logical pixels.
    pub area: [f64; 4],
    /// Canvas width over height.
    pub aspect: f64,
    pub fit: Fit,
    pub zoom: f64,
    pub pan: Point,
    /// Device pixels per logical pixel.
    pub density: f64,
    /// The side of a handle's square, in logical pixels.
    pub handle_size: f64,
    /// Corner handles sit outside the box corners (a coarse pointer).
    pub handles_outside: bool,
}

impl Default for View {
    fn default() -> Self {
        Self {
            area: [0.0, 0.0, 100.0, 100.0],
            aspect: 1.0,
            fit: Fit::Contain,
            zoom: 1.0,
            pan: Point::default(),
            density: 1.0,
            handle_size: 24.0,
            handles_outside: false,
        }
    }
}

fn positive(value: Option<f64>, name: &str) -> Result<Option<f64>, String> {
    match value {
        Some(n) if !(n.is_finite() && n > 0.0) => Err(format!("`{name}` must be a positive number")),
        other => Ok(other),
    }
}

impl View {
    /// `{"area": {"x", "y", "width", "height"}, "aspect", "fit"?, "zoom"?, "pan"?: {"x", "y"},
    /// "density"?, "handleSize"?, "handlesOutside"?}`.
    pub fn from_value(value: &Value) -> Result<Self, String> {
        let area = value.get("area").ok_or("a view needs an `area`")?;
        let side = |key: &str| area.get(key).and_then(Value::as_f64).ok_or_else(|| format!("`area.{key}` is not a number"));
        let (width, height) = (side("width")?, side("height")?);
        positive(Some(width), "area.width")?;
        positive(Some(height), "area.height")?;
        let read = |key: &str| value.get(key).and_then(Value::as_f64);
        let fit = match value.get("fit").and_then(Value::as_str) {
            None | Some("contain") => Fit::Contain,
            Some("cover") => Fit::Cover,
            Some(other) => return Err(format!("unknown fit {other:?}")),
        };
        let pan = value.get("pan").map_or(Point::default(), |pan| Point {
            x: pan.get("x").and_then(Value::as_f64).unwrap_or(0.0),
            y: pan.get("y").and_then(Value::as_f64).unwrap_or(0.0),
        });
        let defaults = Self::default();
        Ok(Self {
            area: [side("x")?, side("y")?, width, height],
            aspect: positive(read("aspect"), "aspect")?.ok_or("a view needs an `aspect`")?,
            fit,
            zoom: positive(read("zoom"), "zoom")?.unwrap_or(1.0),
            pan,
            density: positive(read("density"), "density")?.unwrap_or(1.0),
            handle_size: positive(read("handleSize"), "handleSize")?.unwrap_or(defaults.handle_size),
            handles_outside: value.get("handlesOutside").and_then(Value::as_bool).unwrap_or(false),
        })
    }

    /// The canvas rectangle on the screen: left, top, width, height (logical pixels).
    pub fn canvas_rect(&self) -> [f64; 4] {
        let [x, y, w, h] = self.area;
        let wide = w / h > self.aspect;
        let (fw, fh) = match (self.fit, wide) {
            (Fit::Contain, true) | (Fit::Cover, false) => (h * self.aspect, h),
            (Fit::Contain, false) | (Fit::Cover, true) => (w, w / self.aspect),
        };
        let (cw, ch) = (fw * self.zoom, fh * self.zoom);
        [x + w / 2.0 + self.pan.x - cw / 2.0, y + h / 2.0 + self.pan.y - ch / 2.0, cw, ch]
    }

    /// The canvas size in logical pixels.
    pub fn canvas_size(&self) -> Size {
        let [_, _, w, h] = self.canvas_rect();
        Size { w, h }
    }

    /// A device-pixel screen point in logical pixels.
    pub fn logical(&self, screen: Point) -> Point {
        Point { x: screen.x / self.density, y: screen.y / self.density }
    }

    /// A device-pixel screen point in canvas percent.
    pub fn to_canvas(&self, screen: Point) -> Point {
        let [x, y, w, h] = self.canvas_rect();
        let p = self.logical(screen);
        Point { x: (p.x - x) / w * 100.0, y: (p.y - y) / h * 100.0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn view(value: Value) -> View {
        View::from_value(&value).expect("a view")
    }

    #[test]
    fn a_letterboxed_preview_maps_its_centre_to_the_canvas_centre() {
        let v = view(json!({ "area": { "x": 10, "y": 20, "width": 400, "height": 400 }, "aspect": 16.0 / 9.0 }));
        let p = v.to_canvas(Point { x: 210.0, y: 220.0 });
        assert!((p.x - 50.0).abs() < 1e-9 && (p.y - 50.0).abs() < 1e-9, "{p:?}");
        assert_eq!(v.canvas_size(), Size { w: 400.0, h: 225.0 });
    }

    #[test]
    fn a_point_in_the_letterbox_maps_above_the_canvas() {
        let v = view(json!({ "area": { "x": 0, "y": 0, "width": 400, "height": 400 }, "aspect": 16.0 / 9.0 }));
        let p = v.to_canvas(Point { x: 200.0, y: 40.0 });
        assert!(p.y < 0.0, "{p:?}");
        assert!((p.x - 50.0).abs() < 1e-9);
    }

    #[test]
    fn zoom_pan_and_density_move_the_canvas() {
        let v = view(json!({ "area": { "x": 0, "y": 0, "width": 200, "height": 100 }, "aspect": 2, "zoom": 2, "pan": { "x": 50, "y": 0 }, "density": 2 }));
        assert_eq!(v.canvas_rect(), [-50.0, -50.0, 400.0, 200.0]);
        // Device (300, 100) is logical (150, 50): a quarter past the left edge of a 400-wide canvas.
        let p = v.to_canvas(Point { x: 300.0, y: 100.0 });
        assert!((p.x - 50.0).abs() < 1e-9 && (p.y - 50.0).abs() < 1e-9, "{p:?}");
    }

    #[test]
    fn cover_crops_the_long_side() {
        let v = view(json!({ "area": { "x": 0, "y": 0, "width": 400, "height": 400 }, "aspect": 2, "fit": "cover" }));
        assert_eq!(v.canvas_rect(), [-200.0, 0.0, 800.0, 400.0]);
    }

    #[test]
    fn a_bad_view_is_refused() {
        assert!(View::from_value(&json!({ "area": { "x": 0, "y": 0, "width": 0, "height": 1 }, "aspect": 1 })).is_err());
        assert!(View::from_value(&json!({ "area": { "x": 0, "y": 0, "width": 1, "height": 1 } })).is_err());
        assert!(View::from_value(&json!({ "area": { "x": 0, "y": 0, "width": 1, "height": 1 }, "aspect": 1, "fit": "fill" })).is_err());
    }
}
