//! Image comparison: SSIM (Wang et al. 2004: 11x11 Gaussian window, sigma 1.5,
//! K1 0.01, K2 0.03, on BT.601 luma) and pixel-level structural checks.

use crate::fixture::Rgba;

pub struct Image {
    pub width: usize,
    pub height: usize,
    pub rgba: Vec<u8>,
}

impl Image {
    fn px(&self, x: usize, y: usize) -> [u8; 4] {
        let i = (y * self.width + x) * 4;
        [self.rgba[i], self.rgba[i + 1], self.rgba[i + 2], self.rgba[i + 3]]
    }

    pub fn crop(&self, [x0, y0, x1, y1]: [usize; 4]) -> Image {
        let mut rgba = Vec::with_capacity((x1 - x0) * (y1 - y0) * 4);
        for y in y0..y1 {
            rgba.extend_from_slice(&self.rgba[(y * self.width + x0) * 4..(y * self.width + x1) * 4]);
        }
        Image { width: x1 - x0, height: y1 - y0, rgba }
    }
}

fn luma(image: &Image) -> Vec<f64> {
    image.rgba.chunks_exact(4).map(|p| 0.299 * f64::from(p[0]) + 0.587 * f64::from(p[1]) + 0.114 * f64::from(p[2])).collect()
}

/// Separable Gaussian filter with edge clamping.
fn gaussian(src: &[f64], w: usize, h: usize) -> Vec<f64> {
    const RADIUS: i64 = 5;
    let kernel: Vec<f64> = (-RADIUS..=RADIUS).map(|i| (-((i * i) as f64) / (2.0 * 1.5 * 1.5)).exp()).collect();
    let total: f64 = kernel.iter().sum();
    let clamp = |v: i64, max: usize| v.clamp(0, max as i64 - 1) as usize;
    let mut tmp = vec![0.0; w * h];
    for y in 0..h {
        for x in 0..w {
            tmp[y * w + x] = kernel.iter().enumerate().map(|(k, g)| g * src[y * w + clamp(x as i64 + k as i64 - RADIUS, w)]).sum::<f64>() / total;
        }
    }
    let mut out = vec![0.0; w * h];
    for y in 0..h {
        for x in 0..w {
            out[y * w + x] = kernel.iter().enumerate().map(|(k, g)| g * tmp[clamp(y as i64 + k as i64 - RADIUS, h) * w + x]).sum::<f64>() / total;
        }
    }
    out
}

/// Mean SSIM over the whole image.
pub fn ssim(a: &Image, b: &Image) -> f64 {
    assert_eq!((a.width, a.height), (b.width, b.height), "same size");
    let (w, h) = (a.width, a.height);
    let (x, y) = (luma(a), luma(b));
    let product = |p: &[f64], q: &[f64]| p.iter().zip(q).map(|(p, q)| p * q).collect::<Vec<f64>>();
    let (mx, my) = (gaussian(&x, w, h), gaussian(&y, w, h));
    let (xx, yy, xy) = (gaussian(&product(&x, &x), w, h), gaussian(&product(&y, &y), w, h), gaussian(&product(&x, &y), w, h));
    let (c1, c2) = ((0.01f64 * 255.0).powi(2), (0.03f64 * 255.0).powi(2));
    let total: f64 = (0..w * h)
        .map(|i| {
            let (vx, vy, cov) = (xx[i] - mx[i] * mx[i], yy[i] - my[i] * my[i], xy[i] - mx[i] * my[i]);
            ((2.0 * mx[i] * my[i] + c1) * (2.0 * cov + c2)) / ((mx[i] * mx[i] + my[i] * my[i] + c1) * (vx + vy + c2))
        })
        .sum();
    total / (w * h) as f64
}

fn near(p: [u8; 4], c: Rgba, tolerance: i32) -> bool {
    (0..3).all(|i| (i32::from(p[i]) - i32::from(c[i])).abs() <= tolerance)
}

/// Bounding box `[x0, y0, x1, y1)` of pixels matching `test`, if any.
pub fn bbox(image: &Image, test: impl Fn([u8; 4]) -> bool) -> Option<[usize; 4]> {
    let mut found: Option<[usize; 4]> = None;
    for y in 0..image.height {
        for x in 0..image.width {
            if test(image.px(x, y)) {
                let b = found.get_or_insert([x, y, x + 1, y + 1]);
                *b = [b[0].min(x), b[1].min(y), b[2].max(x + 1), b[3].max(y + 1)];
            }
        }
    }
    found
}

/// Pixels that are not the frame background: the caption's ink, box and shadow.
pub fn caption_bbox(image: &Image, background: Rgba) -> Option<[usize; 4]> {
    bbox(image, |p| !near(p, background, 6))
}

/// Pixels close to `color`: a fill, a box, or the highlighted word.
pub fn color_bbox(image: &Image, color: Rgba) -> Option<[usize; 4]> {
    bbox(image, |p| near(p, color, 24))
}

/// Horizontal ink extent `[x0, x1)` inside rows `y0..y1`, for line-break checks.
pub fn band_extent(image: &Image, background: Rgba, y0: usize, y1: usize) -> Option<[usize; 2]> {
    let band = image.crop([0, y0.min(image.height), image.width, y1.min(image.height)]);
    bbox(&band, |p| !near(p, background, 40)).map(|b| [b[0], b[2]])
}

/// Reference above, candidate below, cropped to `rect`.
pub fn stack(top: &Image, bottom: &Image, rect: [usize; 4]) -> Image {
    let (a, b) = (top.crop(rect), bottom.crop(rect));
    let mut rgba = a.rgba;
    rgba.extend(std::iter::repeat_n([255u8, 0, 255, 255], a.width * 4).flatten());
    rgba.extend_from_slice(&b.rgba);
    Image { width: a.width, height: a.height * 2 + 4, rgba }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn noise(seed: u32) -> Image {
        let mut s = seed;
        let rgba = (0..64 * 64 * 4)
            .map(|_| {
                s = s.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                (s >> 16) as u8
            })
            .collect();
        Image { width: 64, height: 64, rgba }
    }

    #[test]
    fn an_image_against_itself_scores_one_and_against_noise_less() {
        let a = noise(1);
        assert_eq!(ssim(&a, &a), 1.0);
        assert!(ssim(&a, &noise(2)) < 0.2);
    }
}
