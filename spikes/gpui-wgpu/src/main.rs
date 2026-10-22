//! Spike A: show a wgpu-rendered frame inside a gpui window at playback rate,
//! with the editor panes around it. See README.md for the criteria.
//!
//! cargo run --release -- [--fps 30] [--seconds 10] [--resize] [--click]

mod gpu;
mod stats;

use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use gpui::{
    App, Application, Bounds, Context, MouseButton, ObjectFit, RenderImage, SharedString, Window, WindowBounds, WindowKind, WindowOptions, div, img,
    prelude::*, px, rgb, size,
};

/// Where the synthetic click lands: the toolbar toggle, at a fixed position.
const TOGGLE_AT: (f32, f32) = (70.0, 20.0);
/// A drop within this time after a resize is attributed to the resize.
const RESIZE_WINDOW: Duration = Duration::from_millis(500);
const WIDE_WINDOW: (f32, f32) = (1440.0, 900.0);
const NARROW_WINDOW: (f32, f32) = (1280.0, 800.0);

struct Args {
    fps: f64,
    seconds: f64,
    warmup: f64,
    resize: bool,
    click: bool,
}

fn args() -> Args {
    let all: Vec<String> = std::env::args().collect();
    let value = |name: &str, default: f64| all.iter().position(|a| a == name).and_then(|i| all.get(i + 1)).and_then(|v| v.parse().ok()).unwrap_or(default);
    Args {
        fps: value("--fps", 30.0),
        seconds: value("--seconds", 10.0),
        warmup: value("--warmup", 0.5),
        resize: all.iter().any(|a| a == "--resize"),
        click: all.iter().any(|a| a == "--click"),
    }
}

struct Spike {
    args: Args,
    compositor: gpu::Compositor,
    start: Instant,
    frame: Option<Arc<RenderImage>>,
    last_index: Option<u64>,
    last_produced: Option<Instant>,
    last_render: Option<Instant>,
    /// Set by a canvas painted last, so render start to paint end is one UI frame.
    painted: Rc<Cell<Option<Instant>>>,
    ui_frame: Vec<Duration>,
    // Measurements.
    work: Vec<Duration>,
    produce_intervals: Vec<Duration>,
    render_intervals: Vec<Duration>,
    upload: Vec<Duration>,
    readback: Vec<Duration>,
    dropped: u64,
    drop_times: Vec<(f64, u64)>,
    // Pane resize check.
    wide: bool,
    resizes: Vec<Instant>,
    resize_drops: Vec<u64>,
    // Click response check.
    toggled: bool,
    shown_toggled: bool,
    click_sent: Option<Instant>,
    renders_since_click: u32,
    clicks: Vec<(Duration, u32)>,
    next_action: f64,
    done: bool,
}

impl Spike {
    fn new(args: Args) -> Self {
        let compositor = gpu::Compositor::new();
        println!("adapter: {}", compositor.adapter_info);
        Self {
            args,
            compositor,
            start: Instant::now(),
            frame: None,
            last_index: None,
            last_produced: None,
            last_render: None,
            painted: Rc::new(Cell::new(None)),
            ui_frame: Vec::new(),
            work: Vec::new(),
            produce_intervals: Vec::new(),
            render_intervals: Vec::new(),
            upload: Vec::new(),
            readback: Vec::new(),
            dropped: 0,
            drop_times: Vec::new(),
            wide: true,
            resizes: Vec::new(),
            resize_drops: Vec::new(),
            toggled: false,
            shown_toggled: false,
            click_sent: None,
            renders_since_click: 0,
            clicks: Vec::new(),
            next_action: 2.0,
            done: false,
        }
    }

    fn period(&self) -> Duration {
        Duration::from_secs_f64(1.0 / self.args.fps)
    }

    /// Advance playback: produce the frame the clock asks for, if it is new.
    fn tick(&mut self, now: Instant, window: &mut Window) {
        let elapsed = (now - self.start).as_secs_f64();
        let index = (elapsed * self.args.fps).floor() as u64;
        if self.last_index.is_some_and(|last| index <= last) {
            return;
        }
        let began = Instant::now();
        let mut bytes = Vec::new();
        let cost = self.compositor.produce(index, elapsed as f32, &mut bytes);
        let buffer = image::RgbaImage::from_raw(gpu::WIDTH, gpu::HEIGHT, bytes).expect("frame size");
        let next = Arc::new(RenderImage::new(vec![image::Frame::new(buffer)]));
        if let Some(previous) = self.frame.replace(next) {
            let _ = window.drop_image(previous);
        }
        self.last_index = Some(index);
        let previous = self.last_produced.replace(now);
        // Window show and the first atlas allocation are not playback.
        if elapsed < self.args.warmup {
            return;
        }
        self.work.push(began.elapsed());
        self.upload.push(cost.upload);
        self.readback.push(cost.composite_and_readback);
        if let Some(last) = previous {
            let interval = now - last;
            let drops = stats::dropped(interval, self.period());
            self.produce_intervals.push(interval);
            self.dropped += drops;
            if drops > 0 {
                self.drop_times.push((elapsed, drops));
            }
            if let Some(resized) = self.resizes.last()
                && now - *resized <= RESIZE_WINDOW
            {
                *self.resize_drops.last_mut().expect("one entry per resize") += drops;
            }
        }
    }

    /// Fire the scheduled resize or click once its time comes.
    fn act(&mut self, elapsed: f64, window: &mut Window) {
        if elapsed < self.next_action {
            return;
        }
        self.next_action += 2.0;
        if self.args.resize {
            self.wide = !self.wide;
            let (w, h) = if self.wide { WIDE_WINDOW } else { NARROW_WINDOW };
            window.resize(size(px(w), px(h)));
            self.resizes.push(Instant::now());
            self.resize_drops.push(0);
        }
        if self.args.click && self.click_sent.is_none() {
            self.click_sent = Some(Instant::now());
            post_click(window, TOGGLE_AT);
        }
    }

    /// A click counts as answered on the first render that shows its effect.
    fn observe_click(&mut self, now: Instant) {
        let Some(sent) = self.click_sent else { return };
        self.renders_since_click += 1;
        if self.toggled != self.shown_toggled {
            self.shown_toggled = self.toggled;
            self.clicks.push((now - sent, self.renders_since_click));
            self.click_sent = None;
            self.renders_since_click = 0;
        }
    }

    fn report(&self) {
        let budget = 1000.0 / self.args.fps;
        println!("--- spike A result (path 1: offscreen render + readback) ---");
        println!("target: {} fps for {} s after {} s warm-up, frame budget {:.2} ms", self.args.fps, self.args.seconds, self.args.warmup, budget);
        println!("frames produced: {}", self.work.len());
        println!("dropped frames: {} at (s, count): {:?}", self.dropped, self.drop_times);
        println!("frame time (upload+composite+readback+image): {}", stats::summary(&self.work));
        println!("  upload: {}", stats::summary(&self.upload));
        println!("  composite+readback: {}", stats::summary(&self.readback));
        println!("UI frame (render start to paint end, incl. atlas upload): {}", stats::summary(&self.ui_frame));
        println!("produced-frame interval: {}", stats::summary(&self.produce_intervals));
        println!("gpui render interval: {}", stats::summary(&self.render_intervals));
        if self.args.resize {
            println!("resizes: {} drops per resize: {:?} max {}", self.resizes.len(), self.resize_drops, self.resize_drops.iter().max().unwrap_or(&0));
        }
        if self.args.click {
            let latencies: Vec<Duration> = self.clicks.iter().map(|(d, _)| *d).collect();
            let max_renders = self.clicks.iter().map(|(_, r)| *r).max().unwrap_or(0);
            println!("clicks: {} latency {} max renders to show {}", self.clicks.len(), stats::summary(&latencies), max_renders);
        }
    }
}

/// A left click posted to this app's own AppKit event queue. It goes through
/// `NSApplication sendEvent:` and gpui's hit testing like a real click; a
/// system-wide `CGEventPost` would need Accessibility permission.
fn post_click(window: &Window, (x, y): (f32, f32)) {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Point {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect {
        origin: Point,
        size: Point,
    }
    const LEFT_MOUSE_DOWN: usize = 1;
    const LEFT_MOUSE_UP: usize = 2;

    let RawWindowHandle::AppKit(handle) = HasWindowHandle::window_handle(window).expect("window handle").as_raw() else {
        panic!("spike A runs on macOS only");
    };
    // SAFETY: the handle comes from a live gpui window on the main thread, and
    // every message below is a documented AppKit selector with matching types.
    unsafe {
        let view = handle.ns_view.as_ptr() as *mut Object;
        let ns_window: *mut Object = msg_send![view, window];
        let number: isize = msg_send![ns_window, windowNumber];
        let frame: Rect = msg_send![view, frame];
        // AppKit window coordinates start at the bottom left.
        let location = Point { x: f64::from(x), y: frame.size.y - f64::from(y) };
        let app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        for kind in [LEFT_MOUSE_DOWN, LEFT_MOUSE_UP] {
            let event: *mut Object = msg_send![class!(NSEvent),
                mouseEventWithType: kind
                location: location
                modifierFlags: 0usize
                timestamp: 0.0f64
                windowNumber: number
                context: std::ptr::null_mut::<Object>()
                eventNumber: 0isize
                clickCount: 1isize
                pressure: 1.0f32];
            let _: () = msg_send![app, postEvent: event atStart: false];
        }
    }
}

fn pane(label: &'static str) -> gpui::Div {
    div().p_2().text_color(rgb(0xc8c8c8)).text_sm().child(label)
}

impl Render for Spike {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let now = Instant::now();
        let elapsed = (now - self.start).as_secs_f64();
        if let Some(last) = self.last_render.replace(now)
            && elapsed >= self.args.warmup
        {
            self.render_intervals.push(now - last);
            if let Some(painted) = self.painted.take() {
                self.ui_frame.push(painted - last);
            }
        }
        if !self.done && elapsed >= self.args.warmup + self.args.seconds {
            self.done = true;
            self.report();
            cx.quit();
        }
        if !self.done {
            self.observe_click(now);
            self.tick(now, window);
            self.act(elapsed, window);
            window.request_animation_frame();
        }

        let inspector_width = if self.toggled { 420.0 } else { 280.0 };
        let preview = div()
            .flex_1()
            .h_full()
            .bg(rgb(0x000000))
            .flex()
            .items_center()
            .justify_center()
            .children(self.frame.clone().map(|frame| img(frame).size_full().object_fit(ObjectFit::Contain)));

        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(0x1b1b1f))
            .child(
                div().h(px(40.)).flex().items_center().px_2().bg(rgb(0x26262b)).child(
                    div()
                        .id("toggle")
                        .w(px(120.))
                        .h(px(26.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded_md()
                        .bg(if self.toggled { rgb(0x3d6fd9) } else { rgb(0x3a3a42) })
                        .text_color(rgb(0xffffff))
                        .text_sm()
                        .child(SharedString::from(if self.toggled { "Inspector: wide" } else { "Inspector: narrow" }))
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|this, _, _, cx| {
                                this.toggled = !this.toggled;
                                cx.notify();
                            }),
                        ),
                ),
            )
            .child(
                div()
                    .flex_1()
                    .flex()
                    .min_h_0()
                    .child(pane("Browser").w(px(260.)).h_full().bg(rgb(0x202025)))
                    .child(preview)
                    .child(pane("Inspector").w(px(inspector_width)).h_full().bg(rgb(0x202025))),
            )
            .child(
                div()
                    .h(px(160.))
                    .flex()
                    .flex_col()
                    .gap_1()
                    .p_2()
                    .bg(rgb(0x17171a))
                    .children((0..4).map(|track| div().h(px(28.)).w(gpui::relative(0.35 + 0.15 * track as f32)).rounded_sm().bg(rgb(0x2f4f7f)))),
            )
            .child({
                let painted = self.painted.clone();
                gpui::canvas(|_, _, _| {}, move |_, _, _, _| painted.set(Some(Instant::now()))).size_0()
            })
    }
}

fn main() {
    let args = args();
    Application::new().run(move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(WIDE_WINDOW.0), px(WIDE_WINDOW.1)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                // gpui stops drawing an occluded window; keep it above others while measuring.
                kind: WindowKind::PopUp,
                ..Default::default()
            },
            |_, cx| cx.new(|_| Spike::new(args)),
        )
        .expect("open window");
        cx.activate(true);
    });
}
