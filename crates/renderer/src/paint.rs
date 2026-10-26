//! CSS colors and the gradient strings the Style rail writes into `bgColor`
//! (`linear-gradient(135deg, #F97316 0%, #E11D48 100%)`), parsed into vello
//! brushes with the geometry CSS gives them.
//!
//! A string this module does not parse is `None`; the caller reports it as
//! coverage rather than drawing a fallback color (D3).

use vello::kurbo::{Affine, Point, Rect};
use vello::peniko::{Brush, Color, ColorStop, Gradient};

/// A CSS color as straight-alpha sRGB, alpha 0..1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: f32,
}

impl Rgba {
    pub const TRANSPARENT: Self = Self { r: 0, g: 0, b: 0, a: 0.0 };

    pub fn color(self) -> Color {
        Color::from_rgba8(self.r, self.g, self.b, (self.a.clamp(0.0, 1.0) * 255.0).round() as u8)
    }

    pub fn with_alpha(self, factor: f32) -> Self {
        Self { a: self.a * factor, ..self }
    }
}

/// A background value: a color or a gradient.
#[derive(Debug, Clone, PartialEq)]
pub enum Paint {
    Solid(Rgba),
    /// CSS angle in degrees: 0 points up, clockwise.
    Linear {
        angle: f64,
        stops: Vec<(f64, Rgba)>,
    },
    /// Farthest-corner ending shape at `at`, in fractions of the box.
    Radial {
        circle: bool,
        at: (f64, f64),
        stops: Vec<(f64, Rgba)>,
    },
}

/// `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` with commas or
/// spaces, `transparent`, `black` and `white`.
pub fn parse_color(value: &str) -> Option<Rgba> {
    let value = value.trim();
    let lower = value.to_ascii_lowercase();
    // Exact fallback expression emitted by shared keyframe-evaluation.ts.
    if let Some(args) = lower.strip_prefix("color-mix(in srgb,").and_then(|s| s.strip_suffix(')')) {
        if args.contains("color-mix(") {
            return None;
        }
        let parts = top_level_args(args);
        let [first, second] = parts.as_slice() else { return None };
        let (a, Some(weight)) = parse_stop(first)? else { return None };
        let (b, None) = parse_stop(second)? else { return None };
        if !(0.0..=1.0).contains(&weight) {
            return None;
        }
        let (wa, wb) = (weight * f64::from(a.a), (1.0 - weight) * f64::from(b.a));
        let alpha = wa + wb;
        if alpha == 0.0 {
            return Some(Rgba::TRANSPARENT);
        }
        let channel = |a, b| ((f64::from(a) * wa + f64::from(b) * wb) / alpha).round() as u8;
        return Some(Rgba { r: channel(a.r, b.r), g: channel(a.g, b.g), b: channel(a.b, b.b), a: alpha as f32 });
    }
    match lower.as_str() {
        "transparent" => return Some(Rgba::TRANSPARENT),
        "black" => return Some(Rgba { r: 0, g: 0, b: 0, a: 1.0 }),
        "white" => return Some(Rgba { r: 255, g: 255, b: 255, a: 1.0 }),
        _ => {}
    }
    if let Some(hex) = value.strip_prefix('#') {
        return parse_hex(hex);
    }
    let args = lower.strip_prefix("rgba(").or_else(|| lower.strip_prefix("rgb("))?.strip_suffix(')')?;
    let parts: Vec<&str> = args.split(|c: char| c == ',' || c == '/' || c.is_whitespace()).filter(|p| !p.is_empty()).collect();
    let channel = |p: &str| -> Option<u8> {
        Some(match p.strip_suffix('%') {
            Some(pct) => (pct.parse::<f32>().ok()?.clamp(0.0, 100.0) * 2.55).round() as u8,
            None => p.parse::<f32>().ok()?.clamp(0.0, 255.0).round() as u8,
        })
    };
    let alpha = match parts.get(3) {
        None => 1.0,
        Some(p) => match p.strip_suffix('%') {
            Some(pct) => pct.parse::<f32>().ok()? / 100.0,
            None => p.parse::<f32>().ok()?,
        },
    };
    if !(3..=4).contains(&parts.len()) {
        return None;
    }
    Some(Rgba { r: channel(parts[0])?, g: channel(parts[1])?, b: channel(parts[2])?, a: alpha.clamp(0.0, 1.0) })
}

fn parse_hex(hex: &str) -> Option<Rgba> {
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let nibble = |i: usize| u8::from_str_radix(&hex[i..=i], 16).ok().map(|n| n * 17);
    let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    match hex.len() {
        3 | 4 => Some(Rgba { r: nibble(0)?, g: nibble(1)?, b: nibble(2)?, a: if hex.len() == 4 { f32::from(nibble(3)?) / 255.0 } else { 1.0 } }),
        6 | 8 => Some(Rgba { r: byte(0)?, g: byte(2)?, b: byte(4)?, a: if hex.len() == 8 { f32::from(byte(6)?) / 255.0 } else { 1.0 } }),
        _ => None,
    }
}

/// Splits on commas outside parentheses.
fn top_level_args(args: &str) -> Vec<&str> {
    let (mut out, mut depth, mut start) = (Vec::new(), 0, 0);
    for (i, c) in args.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            ',' if depth == 0 => {
                out.push(args[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(args[start..].trim());
    out
}

/// A color stop: a color and an optional percentage.
fn parse_stop(stop: &str) -> Option<(Rgba, Option<f64>)> {
    let stop = stop.trim();
    // The position follows the color's closing parenthesis or last space.
    let split = if stop.ends_with(')') { None } else { stop.rfind(char::is_whitespace) };
    match split {
        None => Some((parse_color(stop)?, None)),
        Some(at) => {
            let position = stop[at..].trim().strip_suffix('%')?.parse::<f64>().ok()? / 100.0;
            Some((parse_color(&stop[..at])?, Some(position)))
        }
    }
}

/// CSS stop fix-up: the first and last default to 0 and 1, a position below
/// an earlier one is raised to it, and runs without one are spaced evenly.
fn resolve_stops(raw: &[(Rgba, Option<f64>)]) -> Option<Vec<(f64, Rgba)>> {
    if raw.len() < 2 {
        return None;
    }
    let mut positions: Vec<Option<f64>> = raw.iter().map(|(_, p)| *p).collect();
    let last = positions.len() - 1;
    positions[0] = positions[0].or(Some(0.0));
    positions[last] = positions[last].or(Some(1.0));
    let mut highest = f64::MIN;
    for p in positions.iter_mut().flatten() {
        highest = highest.max(*p);
        *p = highest;
    }
    let mut i = 0;
    while i < positions.len() {
        if positions[i].is_none() {
            let before = i - 1;
            let after = (i..positions.len()).find(|&j| positions[j].is_some())?;
            let (a, b) = (positions[before]?, positions[after]?);
            for (j, slot) in positions.iter_mut().enumerate().take(after).skip(i) {
                *slot = Some(a + (b - a) * (j - before) as f64 / (after - before) as f64);
            }
            i = after;
        }
        i += 1;
    }
    Some(positions.into_iter().zip(raw).map(|(p, (c, _))| (p.unwrap_or_default(), *c)).collect())
}

fn parse_angle(value: &str) -> Option<f64> {
    let value = value.trim();
    match value {
        "to top" => Some(0.0),
        "to right" => Some(90.0),
        "to bottom" => Some(180.0),
        "to left" => Some(270.0),
        _ => {
            if let Some(deg) = value.strip_suffix("deg") {
                deg.trim().parse().ok()
            } else if let Some(turn) = value.strip_suffix("turn") {
                turn.trim().parse::<f64>().ok().map(|t| t * 360.0)
            } else {
                None
            }
        }
    }
}

/// `[circle|ellipse] [farthest-corner] [at <x> <y>]`, positions as keywords
/// or percentages.
fn parse_radial_shape(value: &str) -> Option<(bool, (f64, f64))> {
    let (shape, at) = match value.split_once("at") {
        Some((shape, at)) => (shape.trim(), Some(at.trim())),
        None => (value.trim(), None),
    };
    let circle = match shape.split_whitespace().filter(|w| *w != "farthest-corner").collect::<Vec<_>>().as_slice() {
        [] | ["ellipse"] => false,
        ["circle"] => true,
        _ => return None,
    };
    let coordinate = |word: &str, horizontal: bool| -> Option<f64> {
        match word {
            "center" => Some(0.5),
            "left" if horizontal => Some(0.0),
            "right" if horizontal => Some(1.0),
            "top" if !horizontal => Some(0.0),
            "bottom" if !horizontal => Some(1.0),
            _ => word.strip_suffix('%')?.parse::<f64>().ok().map(|p| p / 100.0),
        }
    };
    let at = match at.map(|a| a.split_whitespace().collect::<Vec<_>>()) {
        None => (0.5, 0.5),
        Some(words) => match words.as_slice() {
            [one] if *one == "top" || *one == "bottom" => (0.5, coordinate(one, false)?),
            [one] => (coordinate(one, true)?, 0.5),
            [x, y] => (coordinate(x, true)?, coordinate(y, false)?),
            _ => return None,
        },
    };
    Some((circle, at))
}

/// A background string: a color, `linear-gradient(...)` or `radial-gradient(...)`.
pub fn parse_paint(value: &str) -> Option<Paint> {
    let value = value.trim();
    let gradient = |prefix: &str| value.strip_prefix(prefix).and_then(|rest| rest.strip_suffix(')')).map(top_level_args);
    if let Some(args) = gradient("linear-gradient(") {
        let (angle, stops) = match args.first().and_then(|a| parse_angle(a)) {
            Some(angle) => (angle, &args[1..]),
            None => (180.0, &args[..]),
        };
        let stops: Option<Vec<_>> = stops.iter().map(|s| parse_stop(s)).collect();
        return Some(Paint::Linear { angle, stops: resolve_stops(&stops?)? });
    }
    if let Some(args) = gradient("radial-gradient(") {
        let first_is_stop = args.first().and_then(|a| parse_stop(a)).is_some();
        let ((circle, at), stops) = if first_is_stop { ((false, (0.5, 0.5)), &args[..]) } else { (parse_radial_shape(args.first()?)?, &args[1..]) };
        let stops: Option<Vec<_>> = stops.iter().map(|s| parse_stop(s)).collect();
        return Some(Paint::Radial { circle, at, stops: resolve_stops(&stops?)? });
    }
    parse_color(value).map(Paint::Solid)
}

/// The brush and its transform that paint `paint` over `rect`.
pub fn brush(paint: &Paint, rect: Rect) -> (Brush, Option<Affine>) {
    let stops = |stops: &[(f64, Rgba)]| -> Vec<ColorStop> {
        let mut out: Vec<_> = stops.iter().map(|(p, c)| ColorStop::from((*p as f32, c.color()))).collect();
        // Vello normalizes the first/last offsets. CSS holds their colors to
        // the box edges, so include those constant intervals explicitly.
        if let Some((_, c)) = stops.first().filter(|(p, _)| *p > 0.0) {
            out.insert(0, ColorStop::from((0.0, c.color())));
        }
        if let Some((_, c)) = stops.last().filter(|(p, _)| *p < 1.0) {
            out.push(ColorStop::from((1.0, c.color())));
        }
        out
    };
    let (w, h) = (rect.width(), rect.height());
    match paint {
        Paint::Solid(color) => (Brush::Solid(color.color()), None),
        Paint::Linear { angle, stops: s } => {
            // The gradient line runs through the centre; its length makes the
            // corners on either side land on the first and last stop.
            let a = angle.to_radians();
            let (dx, dy) = (a.sin(), -a.cos());
            let half = (w * dx.abs() + h * dy.abs()) / 2.0;
            let center = rect.center();
            let start = Point::new(center.x - dx * half, center.y - dy * half);
            let end = Point::new(center.x + dx * half, center.y + dy * half);
            (Brush::Gradient(Gradient::new_linear(start, end).with_stops(stops(s).as_slice())), None)
        }
        Paint::Radial { circle, at, stops: s } => {
            let center = Point::new(rect.x0 + at.0 * w, rect.y0 + at.1 * h);
            let (dx, dy) = ((center.x - rect.x0).max(rect.x1 - center.x), (center.y - rect.y0).max(rect.y1 - center.y));
            if *circle {
                let radius = dx.hypot(dy);
                (Brush::Gradient(Gradient::new_radial(center, radius as f32).with_stops(stops(s).as_slice())), None)
            } else {
                // farthest-side radii scaled until the ellipse meets the corner: x sqrt(2).
                let (rx, ry) = (dx * std::f64::consts::SQRT_2, dy * std::f64::consts::SQRT_2);
                let transform = Affine::translate(center.to_vec2()) * Affine::scale_non_uniform(1.0, ry / rx) * Affine::translate(-center.to_vec2());
                (Brush::Gradient(Gradient::new_radial(center, rx as f32).with_stops(stops(s).as_slice())), Some(transform))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORANGE: Rgba = Rgba { r: 0xF9, g: 0x73, b: 0x16, a: 1.0 };
    const ROSE: Rgba = Rgba { r: 0xE1, g: 0x1D, b: 0x48, a: 1.0 };

    #[test]
    fn colors_parse_in_every_form_the_editor_writes() {
        assert_eq!(parse_color("#F97316"), Some(ORANGE));
        assert_eq!(parse_color("#fff"), Some(Rgba { r: 255, g: 255, b: 255, a: 1.0 }));
        assert_eq!(parse_color("#00000080").map(|c| (c.a * 255.0).round()), Some(128.0));
        assert_eq!(parse_color("rgba(0,0,0,0.5)"), Some(Rgba { r: 0, g: 0, b: 0, a: 0.5 }));
        assert_eq!(parse_color("rgb(10 20 30 / 50%)"), Some(Rgba { r: 10, g: 20, b: 30, a: 0.5 }));
        assert_eq!(parse_color("transparent"), Some(Rgba::TRANSPARENT));
        assert_eq!(parse_color("color-mix(in srgb, transparent 50%, #ffffff)"), Some(Rgba { r: 255, g: 255, b: 255, a: 0.5 }));
        assert_eq!(parse_color("color-mix(in srgb, rgba(0,0,255,0.5) 50%, #ff0000)"), Some(Rgba { r: 170, g: 0, b: 85, a: 0.75 }));
        assert_eq!(parse_color("color-mix(in srgb, black 110%, white)"), None);
        assert_eq!(parse_color("hsl(0 100% 50%)"), None);
        assert_eq!(parse_color("#12345"), None);
    }

    #[test]
    fn a_style_rail_gradient_parses_with_its_angle_and_stops() {
        assert_eq!(
            parse_paint("linear-gradient(135deg, #F97316 0%, #E11D48 100%)"),
            Some(Paint::Linear { angle: 135.0, stops: vec![(0.0, ORANGE), (1.0, ROSE)] })
        );
    }

    #[test]
    fn missing_stop_positions_are_spaced_evenly() {
        let Some(Paint::Linear { stops, .. }) = parse_paint("linear-gradient(to right, #F97316, #fff, #E11D48)") else { panic!() };
        assert_eq!(stops.iter().map(|s| s.0).collect::<Vec<_>>(), [0.0, 0.5, 1.0]);
        let Some(Paint::Linear { stops, .. }) = parse_paint("linear-gradient(#F97316 40%, #E11D48 20%)") else { panic!() };
        assert_eq!(stops.iter().map(|s| s.0).collect::<Vec<_>>(), [0.4, 0.4], "a lower position is raised");
    }

    #[test]
    fn a_radial_gradient_parses_with_shape_and_position() {
        let parsed = parse_paint("radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%)");
        assert_eq!(
            parsed,
            Some(Paint::Radial { circle: false, at: (0.5, 0.5), stops: vec![(0.4, Rgba::TRANSPARENT), (1.0, Rgba { r: 0, g: 0, b: 0, a: 0.7 })] })
        );
        assert!(matches!(parse_paint("radial-gradient(circle at 25% 75%, #fff, #000)"), Some(Paint::Radial { circle: true, at: (0.25, 0.75), .. })));
    }

    #[test]
    fn strings_outside_the_supported_grammar_do_not_parse() {
        for value in [
            "conic-gradient(#fff, #000)",
            "linear-gradient(to top right, #fff, #000)",
            "linear-gradient(#fff)",
            "radial-gradient(closest-side, #fff, #000)",
            "repeating-linear-gradient(45deg, #fff 0%, #000 10%)",
            "url(a.png)",
        ] {
            assert_eq!(parse_paint(value), None, "{value}");
        }
    }

    #[test]
    fn a_135_degree_line_spans_the_box_diagonal_projection() {
        let (Brush::Gradient(gradient), None) = brush(&parse_paint("linear-gradient(135deg, #000, #fff)").unwrap(), Rect::new(0.0, 0.0, 1080.0, 1920.0)) else {
            panic!()
        };
        let vello::peniko::GradientKind::Linear(line) = gradient.kind else { panic!() };
        // Length |W sin a| + |H cos a| = (1080 + 1920) / sqrt(2), through the centre.
        let length = (line.end - line.start).hypot();
        assert!((length - 3000.0 / std::f64::consts::SQRT_2).abs() < 1e-6, "{length}");
        assert!(((line.start.midpoint(line.end)) - Point::new(540.0, 960.0)).hypot() < 1e-9);
        assert!(line.end.x > line.start.x && line.end.y > line.start.y, "toward the bottom right");
    }
}
