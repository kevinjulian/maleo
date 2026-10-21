//! Exact project time: a port of `packages/vui/src/kernel/time/` — rationals,
//! timebases, ticks in the project and source domains, and SMPTE timecode
//! (design decision 4; task 4.3).
//!
//! The TS does integer arithmetic in JavaScript numbers, so this does it in
//! f64 with the same operations in the same order: results are identical,
//! including where the TS would lose precision past 2^53. A conversion that
//! has to round says so in its result rather than hiding it, and the one
//! rounding rule is half away from zero.

use crate::keyframes::js_round;

/// The largest integer a JavaScript number holds exactly.
pub const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

fn is_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0
}

/// A JavaScript number as `${value}` writes it, for error messages.
fn shown(value: f64) -> String {
    crate::json::js_number_string(value).unwrap_or_else(|| {
        if value.is_nan() {
            "NaN".to_owned()
        } else if value > 0.0 {
            "Infinity".to_owned()
        } else {
            "-Infinity".to_owned()
        }
    })
}

/* ---- Rational ------------------------------------------------------------ */

/// An exact ratio of two integers, normalised: positive denominator, reduced.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rational {
    pub numerator: f64,
    pub denominator: f64,
}

fn greatest_common_divisor(a: f64, b: f64) -> f64 {
    let (mut x, mut y) = (a.abs(), b.abs());
    while y != 0.0 {
        let next = x % y;
        x = y;
        y = next;
    }
    if x == 0.0 { 1.0 } else { x }
}

/// `rational(numerator, denominator)`.
pub fn rational(numerator: f64, denominator: f64) -> Result<Rational, String> {
    if !is_integer(numerator) || !is_integer(denominator) {
        return Err(format!("@maleo/vui: a rational needs integers, received {}/{}", shown(numerator), shown(denominator)));
    }
    if denominator == 0.0 {
        return Err("@maleo/vui: a rational may not have a zero denominator".to_owned());
    }
    let sign = if denominator < 0.0 { -1.0 } else { 1.0 };
    let divisor = greatest_common_divisor(numerator, denominator);
    Ok(Rational { numerator: (sign * numerator) / divisor, denominator: (sign * denominator) / divisor })
}

pub fn rational_equals(a: Rational, b: Rational) -> bool {
    a.numerator * b.denominator == b.numerator * a.denominator
}

/// Negative, zero, or positive, by cross-multiplication.
pub fn rational_compare(a: Rational, b: Rational) -> i32 {
    let left = a.numerator * b.denominator;
    let right = b.numerator * a.denominator;
    if left == right {
        0
    } else if left < right {
        -1
    } else {
        1
    }
}

pub fn rational_multiply(a: Rational, b: Rational) -> Result<Rational, String> {
    rational(a.numerator * b.numerator, a.denominator * b.denominator)
}

pub fn rational_divide(a: Rational, b: Rational) -> Result<Rational, String> {
    if b.numerator == 0.0 {
        return Err("@maleo/vui: cannot divide a rational by zero".to_owned());
    }
    rational(a.numerator * b.denominator, a.denominator * b.numerator)
}

/// The one lossy operation, named so it reads as one.
pub fn rational_to_number(value: Rational) -> f64 {
    value.numerator / value.denominator
}

pub fn format_rational(value: Rational) -> String {
    format!("{}/{}", shown(value.numerator), shown(value.denominator))
}

/// `frameRateFromLabel(label)`: the spoken rates map to their exact ratios.
pub fn frame_rate_from_label(label: f64) -> Result<Rational, String> {
    match label {
        23.976 => rational(24000.0, 1001.0),
        29.97 => rational(30000.0, 1001.0),
        59.94 => rational(60000.0, 1001.0),
        _ if is_integer(label) && label > 0.0 => rational(label, 1.0),
        _ => Err(format!("@maleo/vui: {} is not an exactly representable frame rate; supply it as a ratio, for example rational(30000, 1001)", shown(label))),
    }
}

/* ---- Timebase ------------------------------------------------------------ */

pub const DEFAULT_TICKS_PER_FRAME: f64 = 1000.0;

/// What one tick is worth: a frame rate and a whole number of ticks per frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Timebase {
    pub ticks_per_second: Rational,
    pub frame_rate: Rational,
    pub ticks_per_frame: f64,
}

/// The content editor's timebase: 30 fps, 1000 ticks per frame.
pub const CONTENT_TIMEBASE: Timebase = Timebase {
    ticks_per_second: Rational { numerator: 30_000.0, denominator: 1.0 },
    frame_rate: Rational { numerator: 30.0, denominator: 1.0 },
    ticks_per_frame: 1000.0,
};

/// `timebase(frameRate, ticksPerFrame)`.
pub fn timebase(frame_rate: Rational, ticks_per_frame: f64) -> Result<Timebase, String> {
    if !is_integer(ticks_per_frame) || ticks_per_frame < 1.0 {
        return Err(format!("@maleo/vui: ticksPerFrame must be a positive integer, received {}", shown(ticks_per_frame)));
    }
    if frame_rate.numerator <= 0.0 {
        return Err(format!("@maleo/vui: a frame rate must be positive, received {}", format_rational(frame_rate)));
    }
    Ok(Timebase { ticks_per_second: rational_multiply(frame_rate, rational(ticks_per_frame, 1.0)?)?, frame_rate, ticks_per_frame })
}

pub fn timebase_equals(a: Timebase, b: Timebase) -> bool {
    a.ticks_per_frame == b.ticks_per_frame && rational_equals(a.frame_rate, b.frame_rate)
}

pub fn format_timebase(value: Timebase) -> String {
    format!("{}fps×{}", format_rational(value.frame_rate), shown(value.ticks_per_frame))
}

/// Drop-frame counting exists for 30000/1001 and 60000/1001 only.
pub fn supports_drop_frame(value: Timebase) -> bool {
    value.frame_rate.denominator == 1001.0 && (value.frame_rate.numerator == 30000.0 || value.frame_rate.numerator == 60000.0)
}

/* ---- Ticks ---------------------------------------------------------------- */

/// Which way a conversion moved its value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Exact,
    Up,
    Down,
}

impl Direction {
    pub fn as_str(self) -> &'static str {
        match self {
            Direction::Exact => "exact",
            Direction::Up => "up",
            Direction::Down => "down",
        }
    }
}

/// A conversion's result and what it had to do to it (`Rounded<T>`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rounded {
    pub value: f64,
    pub exact: bool,
    pub direction: Direction,
}

/// `roundHalfAwayFromZero`: symmetric around the origin, unlike `Math.round`.
pub fn round_half_away_from_zero(value: f64) -> f64 {
    if value < 0.0 { -js_round(-value) } else { js_round(value) }
}

fn rounded(exact: f64, whole: f64) -> Rounded {
    if whole == exact {
        Rounded { value: whole, exact: true, direction: Direction::Exact }
    } else {
        Rounded { value: whole, exact: false, direction: if whole > exact { Direction::Up } else { Direction::Down } }
    }
}

/// `projectTime(ticks)` / `sourceTime(ticks)`: a time is a whole tick count.
pub fn whole_ticks(ticks: f64, domain: &str) -> Result<f64, String> {
    if is_integer(ticks) { Ok(ticks) } else { Err(format!("@maleo/vui: {domain} ticks must be an integer, received {}", shown(ticks))) }
}

/// `framesToProject(frames, base)`: never rounds.
pub fn frames_to_ticks(frames: f64, base: Timebase) -> Result<f64, String> {
    if !is_integer(frames) {
        return Err(format!("@maleo/vui: frame numbers are integers, received {}", shown(frames)));
    }
    whole_ticks(frames * base.ticks_per_frame, "project")
}

/// `timeToFrames(time, base)`: reports a position between frames.
pub fn ticks_to_frames(ticks: f64, base: Timebase) -> Rounded {
    let exact = ticks / base.ticks_per_frame;
    rounded(exact, round_half_away_from_zero(exact))
}

/// `timeToExactSeconds(time, base)`: lossless.
pub fn ticks_to_exact_seconds(ticks: f64, base: Timebase) -> Result<Rational, String> {
    rational(ticks * base.ticks_per_second.denominator, base.ticks_per_second.numerator)
}

/// `timeToSeconds(time, base)`: lossy at the last bit, and named so.
pub fn ticks_to_seconds(ticks: f64, base: Timebase) -> Result<f64, String> {
    ticks_to_exact_seconds(ticks, base).map(rational_to_number)
}

/// `secondsToProject` / `secondsToSource`: float seconds to the nearest tick.
pub fn seconds_to_ticks(seconds: f64, base: Timebase) -> Result<Rounded, String> {
    if !seconds.is_finite() {
        return Err(format!("@maleo/vui: seconds must be finite, received {}", shown(seconds)));
    }
    let exact = (seconds * base.ticks_per_second.numerator) / base.ticks_per_second.denominator;
    Ok(rounded(exact, round_half_away_from_zero(exact)))
}

/// `sourceDurationToProject(duration, from, to)`: a source duration crosses
/// into project ticks once, with both timebases named.
pub fn source_duration_to_project(ticks: f64, from: Timebase, to: Timebase) -> Result<Rounded, String> {
    let seconds = rational_multiply(rational(ticks, 1.0)?, rational(from.ticks_per_second.denominator, from.ticks_per_second.numerator)?)?;
    let exact_ticks = rational_multiply(seconds, to.ticks_per_second)?;
    let exact = exact_ticks.numerator / exact_ticks.denominator;
    Ok(rounded(exact, round_half_away_from_zero(exact)))
}

/// `compareAcrossTimebases(a, aBase, b, bBase)`: exact, never through a float.
pub fn compare_across_timebases(a: f64, a_base: Timebase, b: f64, b_base: Timebase) -> Result<i32, String> {
    Ok(rational_compare(ticks_to_exact_seconds(a, a_base)?, ticks_to_exact_seconds(b, b_base)?))
}

/* ---- Timecode ------------------------------------------------------------- */

/// A timecode taken apart (`TimecodeParts`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TimecodeParts {
    pub hours: f64,
    pub minutes: f64,
    pub seconds: f64,
    pub frames: f64,
    pub drop_frame: bool,
}

/// The nominal whole-number rate a timecode counts in: 30 for 29.97.
pub fn nominal_frame_rate(base: Timebase) -> f64 {
    js_round(base.frame_rate.numerator / base.frame_rate.denominator)
}

fn dropped_per_minute(base: Timebase) -> f64 {
    nominal_frame_rate(base) / 15.0
}

fn assert_drop_frame_allowed(base: Timebase, drop_frame: bool) -> Result<(), String> {
    if drop_frame && !supports_drop_frame(base) {
        return Err(format!(
            "@maleo/vui: drop-frame counting is defined for 30000/1001 and 60000/1001, not for {}/{}",
            shown(base.frame_rate.numerator),
            shown(base.frame_rate.denominator)
        ));
    }
    Ok(())
}

/// `framesToTimecodeParts(frames, base, options)`: drop-frame counts in
/// ten-minute blocks so no error survives a block boundary.
pub fn frames_to_timecode_parts(frames: f64, base: Timebase, drop_frame: bool) -> Result<TimecodeParts, String> {
    assert_drop_frame_allowed(base, drop_frame)?;
    if !is_integer(frames) || frames < 0.0 {
        return Err(format!("@maleo/vui: timecode is formatted from a non-negative whole frame number, received {}", shown(frames)));
    }
    let nominal = nominal_frame_rate(base);
    let mut counted = frames;
    if drop_frame {
        let drop = dropped_per_minute(base);
        let frames_per_counted_minute = nominal * 60.0 - drop;
        let frames_per_ten_minutes = nominal * 600.0 - drop * 9.0;
        let blocks = (frames / frames_per_ten_minutes).floor();
        let within_block = frames % frames_per_ten_minutes;
        counted = frames + drop * 9.0 * blocks;
        if within_block > drop {
            counted += drop * ((within_block - drop) / frames_per_counted_minute).floor();
        }
    }
    Ok(TimecodeParts {
        frames: counted % nominal,
        seconds: (counted / nominal).floor() % 60.0,
        minutes: (counted / (nominal * 60.0)).floor() % 60.0,
        hours: (counted / (nominal * 60.0 * 60.0)).floor() % 24.0,
        drop_frame,
    })
}

/// `timecodePartsToFrames(parts, base)`: the exact inverse of the above.
pub fn timecode_parts_to_frames(parts: TimecodeParts, base: Timebase) -> Result<f64, String> {
    assert_drop_frame_allowed(base, parts.drop_frame)?;
    let nominal = nominal_frame_rate(base);
    if parts.frames >= nominal {
        return Err(format!("@maleo/vui: frame {} does not exist at a nominal {} fps", shown(parts.frames), shown(nominal)));
    }
    let counted = ((parts.hours * 60.0 + parts.minutes) * 60.0 + parts.seconds) * nominal + parts.frames;
    if !parts.drop_frame {
        return Ok(counted);
    }
    let drop = dropped_per_minute(base);
    let total_minutes = parts.hours * 60.0 + parts.minutes;
    Ok(counted - drop * (total_minutes - (total_minutes / 10.0).floor()))
}

/// `pad`: `value.toString().padStart(2, "0")`.
fn pad(value: f64) -> String {
    let text = shown(value);
    if text.chars().count() < 2 { format!("0{text}") } else { text }
}

/// `formatTimecodeParts(parts)`: `;` says the numbers were counted drop-frame.
pub fn format_timecode_parts(parts: TimecodeParts) -> String {
    let separator = if parts.drop_frame { ";" } else { ":" };
    [parts.hours, parts.minutes, parts.seconds, parts.frames].map(pad).join(separator)
}

/// `formatTimecode(time, base, options)`.
pub fn format_timecode(ticks: f64, base: Timebase, drop_frame: bool) -> Result<String, String> {
    let frames = ticks_to_frames(ticks, base);
    Ok(format_timecode_parts(frames_to_timecode_parts(frames.value, base, drop_frame)?))
}

/// `parseTimecode(text, base)`: `HH+[:;]MM[:;]SS[:;]FF`, the last separator
/// deciding the counting; anything else is refused rather than half-read.
pub fn parse_timecode(text: &str, base: Timebase) -> Result<f64, String> {
    let refused = || format!("@maleo/vui: \"{text}\" is not SMPTE timecode");
    let trimmed = crate::keyframes::js_trim(text);
    let digits = |field: &str| !field.is_empty() && field.bytes().all(|byte| byte.is_ascii_digit());
    let separators: Vec<(usize, char)> = trimmed.char_indices().filter(|(_, c)| *c == ':' || *c == ';').collect();
    let [(a, _), (b, _), (c, last)] = separators.as_slice() else { return Err(refused()) };
    let (hours, minutes, seconds, frames) = (&trimmed[..*a], &trimmed[a + 1..*b], &trimmed[b + 1..*c], &trimmed[c + 1..]);
    if !(digits(hours)
        && hours.len() >= 2
        && digits(minutes)
        && minutes.len() == 2
        && digits(seconds)
        && seconds.len() == 2
        && digits(frames)
        && frames.len() == 2)
    {
        return Err(refused());
    }
    let number = |field: &str| field.parse::<f64>().unwrap_or(f64::NAN);
    let parts = TimecodeParts { hours: number(hours), minutes: number(minutes), seconds: number(seconds), frames: number(frames), drop_frame: *last == ';' };
    if parts.minutes > 59.0 || parts.seconds > 59.0 {
        return Err(refused());
    }
    frames_to_ticks(timecode_parts_to_frames(parts, base)?, base)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(numerator: f64, denominator: f64) -> Timebase {
        timebase(rational(numerator, denominator).expect("rate"), DEFAULT_TICKS_PER_FRAME).expect("timebase")
    }

    #[test]
    fn frame_boundaries_are_integer_ticks() {
        let ntsc = base(30000.0, 1001.0);
        assert_eq!(seconds_to_ticks(1.0, CONTENT_TIMEBASE), Ok(Rounded { value: 30_000.0, exact: true, direction: Direction::Exact }));
        assert_eq!(frames_to_ticks(1001.0, ntsc), Ok(1_001_000.0));
        let back = ticks_to_seconds(1_001_000.0, ntsc).expect("seconds");
        assert_eq!(seconds_to_ticks(back, ntsc).map(|r| r.value), Ok(1_001_000.0));
    }

    #[test]
    fn rounding_is_half_away_from_zero_and_reported() {
        let half = 0.5 / 30_000.0;
        assert_eq!(seconds_to_ticks(half, CONTENT_TIMEBASE).map(|r| (r.value, r.direction)), Ok((1.0, Direction::Up)));
        assert_eq!(seconds_to_ticks(-half, CONTENT_TIMEBASE).map(|r| (r.value, r.direction)), Ok((-1.0, Direction::Down)));
        assert_eq!(round_half_away_from_zero(-2.5), -3.0);
    }

    #[test]
    fn ten_thousand_nudges_at_23_976_land_exactly() {
        let film = base(24000.0, 1001.0);
        let frame = frames_to_ticks(1.0, film).expect("frame");
        let mut position = 0.0;
        for _ in 0..10_000 {
            position += frame;
        }
        assert_eq!(ticks_to_frames(position, film), Rounded { value: 10_000.0, exact: true, direction: Direction::Exact });
    }

    #[test]
    fn one_hour_at_29_97_drop_frame() {
        let ntsc = base(30000.0, 1001.0);
        let hour = frames_to_ticks(107_892.0, ntsc).expect("ticks");
        assert_eq!(format_timecode(hour, ntsc, true), Ok("01;00;00;00".to_owned()));
        assert_eq!(parse_timecode("01;00;00;00", ntsc), Ok(hour));
        assert!(parse_timecode("1:00:00:00", ntsc).is_err());
        assert!(format_timecode(hour, base(25.0, 1.0), true).is_err());
    }
}
