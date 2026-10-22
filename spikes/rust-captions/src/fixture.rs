//! Fixture data and the caption rules of `packages/video/src/components/Captions.tsx`,
//! restated so both renderers draw the same state for a frame.

use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Doc {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub background: String,
    pub fg_color: String,
    pub accent_color: String,
    pub frames: Vec<u32>,
    pub fixtures: Vec<Fixture>,
}

#[derive(Deserialize)]
pub struct Fixture {
    pub id: String,
    pub text: String,
    pub words: Vec<Word>,
    pub style: Style,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub text: String,
    pub start_sec: f64,
    pub end_sec: f64,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub font_size: Option<f32>,
    pub fill: Option<String>,
    pub weight: Option<String>,
    pub italic: Option<bool>,
    pub all_caps: Option<bool>,
    pub stroke: Option<String>,
    pub shadow: Option<String>,
    pub shadow_blur: Option<f32>,
    pub shadow_distance: Option<f32>,
    pub shadow_angle: Option<f32>,
    pub shadow_opacity: Option<f32>,
    pub background: Option<String>,
    pub vertical_position: Option<f32>,
    pub style: Option<String>,
    pub active_color: Option<String>,
    pub inactive_opacity: Option<f32>,
    pub max_width: Option<f32>,
}

/// A color as straight-alpha RGBA.
pub type Rgba = [u8; 4];

/// `#rrggbb` with an opacity percentage; `None` for absent or `transparent`.
pub fn color(value: Option<&str>, opacity_pct: f32) -> Option<Rgba> {
    let hex = value.filter(|v| *v != "transparent")?.strip_prefix('#')?;
    let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    let alpha = (opacity_pct.clamp(0.0, 100.0) / 100.0 * 255.0).round() as u8;
    Some([byte(0)?, byte(2)?, byte(4)?, alpha])
}

/// A shadow as Captions.tsx draws it: offset, blur radius and color.
pub struct Shadow {
    pub dx: f32,
    pub dy: f32,
    pub blur: f32,
    pub color: Rgba,
}

/// One word of the cue: where it sits in the displayed text and how it paints.
pub struct WordPaint {
    pub range: std::ops::Range<usize>,
    pub color: Rgba,
    pub opacity: f32,
    pub scale: f32,
}

/// Everything the renderer needs for one fixture at one frame.
pub struct CaptionFrame {
    pub text: String,
    pub words: Vec<WordPaint>,
    pub font_size: f32,
    pub weight: f32,
    pub italic: bool,
    pub fill: Rgba,
    pub stroke: Option<Rgba>,
    pub shadow: Option<Shadow>,
    pub background: Option<Rgba>,
    pub vertical_pct: f32,
    pub max_width: f32,
}

fn weight_value(weight: Option<&str>) -> f32 {
    match weight {
        Some("Black") => 900.0,
        Some("Bold") => 800.0,
        Some("Medium") => 600.0,
        _ => 500.0,
    }
}

/// The active word at `local_sec`: the last word started, held through gaps.
pub fn active_word(words: &[Word], local_sec: f64) -> i32 {
    let mut active = -1;
    for (index, word) in words.iter().enumerate() {
        if local_sec >= word.start_sec {
            active = index as i32;
        }
        if local_sec >= word.start_sec && local_sec < word.end_sec {
            break;
        }
    }
    active
}

impl CaptionFrame {
    pub fn new(doc: &Doc, fixture: &Fixture, frame: u32) -> Self {
        let style = &fixture.style;
        let local_sec = f64::from(frame) / doc.fps;
        let active = active_word(&fixture.words, local_sec);
        let fill = color(style.fill.as_deref().or(Some(&doc.fg_color)), 100.0).expect("fill color");
        let highlight = color(style.active_color.as_deref(), 100.0).or_else(|| color(Some(&doc.accent_color), 100.0)).expect("highlight color");
        let mode = style.style.as_deref().unwrap_or("Standard");
        let highlighted = mode == "Karaoke" || mode == "Word pop";
        let inactive = style.inactive_opacity.unwrap_or(55.0).clamp(0.0, 100.0) / 100.0;
        let caps = style.all_caps.unwrap_or(false);
        let shown = |s: &str| if caps { s.to_uppercase() } else { s.to_owned() };

        // textParts(): timed tokens aligned to the authored text, spaces kept.
        let (mut text, mut words, mut cursor) = (String::new(), Vec::new(), 0);
        for (index, word) in fixture.words.iter().enumerate() {
            let start = cursor + fixture.text[cursor..].find(&word.text).expect("word in text");
            text.push_str(&shown(&fixture.text[cursor..start]));
            let begin = text.len();
            text.push_str(&shown(&word.text));
            let emphasized = index as i32 == active;
            words.push(WordPaint {
                range: begin..text.len(),
                color: if emphasized && highlighted { highlight } else { fill },
                opacity: if highlighted && !emphasized { inactive } else { 1.0 },
                scale: if emphasized && mode == "Word pop" { 1.12 } else { 1.0 },
            });
            cursor = start + word.text.len();
        }
        text.push_str(&shown(&fixture.text[cursor..]));

        let shadow = color(style.shadow.as_deref(), style.shadow_opacity.unwrap_or(100.0)).map(|color| {
            let distance = style.shadow_distance.unwrap_or(2.0);
            let angle = style.shadow_angle.unwrap_or(90.0).to_radians();
            Shadow { dx: angle.cos() * distance, dy: angle.sin() * distance, blur: style.shadow_blur.unwrap_or(12.0), color }
        });

        Self {
            text,
            words,
            font_size: style.font_size.unwrap_or(56.0),
            weight: weight_value(style.weight.as_deref()),
            italic: style.italic.unwrap_or(false),
            fill,
            stroke: color(style.stroke.as_deref(), 100.0),
            shadow,
            background: color(style.background.as_deref(), 100.0),
            vertical_pct: style.vertical_position.unwrap_or(88.0),
            max_width: doc.width as f32 * style.max_width.unwrap_or(86.0) / 100.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words() -> Vec<Word> {
        (0..3).map(|i| Word { text: format!("w{i}"), start_sec: 0.5 * i as f64, end_sec: 0.5 * i as f64 + 0.4 }).collect()
    }

    #[test]
    fn the_last_started_word_stays_active_through_a_gap() {
        assert_eq!(active_word(&words(), 0.7), 1);
        assert_eq!(active_word(&words(), 0.95), 1);
        assert_eq!(active_word(&words(), 1.0), 2);
        assert_eq!(active_word(&words(), -0.1), -1);
    }

    #[test]
    fn colors_parse_hex_and_refuse_transparent() {
        assert_eq!(color(Some("#ff8000"), 50.0), Some([255, 128, 0, 128]));
        assert_eq!(color(Some("transparent"), 100.0), None);
        assert_eq!(color(None, 100.0), None);
    }
}
