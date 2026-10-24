//! Image comparison, from spike C `compare.rs`: SSIM (Wang et al. 2004: 11x11
//! Gaussian window, sigma 1.5, K1 0.01, K2 0.03, on BT.601 luma).

pub struct Image {
    pub width: usize,
    pub height: usize,
    pub rgba: Vec<u8>,
}

impl Image {
    /// The pixels of `[x0, y0, x1, y1)`, clamped to the image.
    pub fn crop(&self, [x0, y0, x1, y1]: [usize; 4]) -> Image {
        let (x1, y1) = (x1.min(self.width), y1.min(self.height));
        let (x0, y0) = (x0.min(x1), y0.min(y1));
        let mut rgba = Vec::with_capacity((x1 - x0) * (y1 - y0) * 4);
        for y in y0..y1 {
            rgba.extend_from_slice(&self.rgba[(y * self.width + x0) * 4..(y * self.width + x1) * 4]);
        }
        Image { width: x1 - x0, height: y1 - y0, rgba }
    }
}

/// Luma over a black backdrop: a transparent pixel compares as black, as a
/// PNG with alpha does when composited for review.
fn luma(image: &Image) -> Vec<f64> {
    image
        .rgba
        .as_chunks::<4>()
        .0
        .iter()
        .map(|p| (0.299 * f64::from(p[0]) + 0.587 * f64::from(p[1]) + 0.114 * f64::from(p[2])) * f64::from(p[3]) / 255.0)
        .collect()
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

/// The box `[x0, y0, x1, y1)` of pixels in `rect` unlike the pixel at its
/// top-left corner (the background there) by more than 6 per channel, in
/// image coordinates: the caption box, or the ink when the cue has no box.
pub fn ink_box(image: &Image, rect: [usize; 4]) -> Option<[usize; 4]> {
    let crop = image.crop(rect);
    let pixels = crop.rgba.as_chunks::<4>().0;
    let background = *pixels.first()?;
    let mut found: Option<[usize; 4]> = None;
    for (i, p) in pixels.iter().enumerate() {
        if (0..3).any(|c| p[c].abs_diff(background[c]) > 6) {
            let (x, y) = (rect[0] + i % crop.width, rect[1] + i / crop.width);
            let b = found.get_or_insert([x, y, x + 1, y + 1]);
            *b = [b[0].min(x), b[1].min(y), b[2].max(x + 1), b[3].max(y + 1)];
        }
    }
    found
}

/// The largest edge difference between two boxes, in pixels; `None` when only one exists.
pub fn edge_delta(a: Option<[usize; 4]>, b: Option<[usize; 4]>) -> Option<usize> {
    match (a, b) {
        (Some(a), Some(b)) => Some((0..4).map(|i| a[i].abs_diff(b[i])).max().unwrap_or(0)),
        (None, None) => Some(0),
        _ => None,
    }
}

/// A review image: per-pixel absolute difference, amplified 4x, opaque.
pub fn difference(a: &Image, b: &Image) -> Image {
    let rgba = a
        .rgba
        .as_chunks::<4>()
        .0
        .iter()
        .zip(b.rgba.as_chunks::<4>().0.iter())
        .flat_map(|(p, q)| [0, 1, 2].map(|i| (p[i].abs_diff(q[i]) as u16 * 4).min(255) as u8).into_iter().chain([255]))
        .collect();
    Image { width: a.width, height: a.height, rgba }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn noise(seed: u32) -> Image {
        let mut s = seed;
        let rgba = (0..64 * 64 * 4)
            .map(|i| {
                s = s.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                if i % 4 == 3 { 255 } else { (s >> 16) as u8 }
            })
            .collect();
        Image { width: 64, height: 64, rgba }
    }

    #[test]
    fn the_ink_box_is_what_differs_from_the_region_corner() {
        let mut rgba = vec![10u8; 8 * 6 * 4];
        for (x, y) in [(3, 2), (5, 4)] {
            rgba[(y * 8 + x) * 4..(y * 8 + x) * 4 + 3].copy_from_slice(&[200, 200, 200]);
        }
        let image = Image { width: 8, height: 6, rgba };
        assert_eq!(ink_box(&image, [1, 1, 8, 6]), Some([3, 2, 6, 5]));
        assert_eq!(edge_delta(Some([3, 2, 6, 5]), Some([4, 2, 6, 7])), Some(2));
        assert_eq!(edge_delta(Some([3, 2, 6, 5]), None), None);
    }

    #[test]
    fn an_image_against_itself_scores_one_and_against_noise_less() {
        let a = noise(1);
        assert_eq!(ssim(&a, &a), 1.0);
        assert!(ssim(&a, &noise(2)) < 0.2);
    }
}
