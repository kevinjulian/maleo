//! One canvas: its view and the gesture in progress, behind the D2 handle.
//!
//! Each input event comes in with the playhead time and the selection, and
//! one result goes out: the overlay to draw, a selection action (a click or a
//! shift-click), the command for the gesture's current state (`preview`, the
//! transient change the host shows and does not record) and, on release, the
//! command to apply (`commit`, one undo step). A cancelled gesture, a release
//! without a change and a gesture on a locked element make no command.

use maleo_editor_core::schema::EditScope;
use serde_json::{Map, Value};

use super::edit::{LayoutPatch, combine, edit_command, valid_mask};
use super::geometry::{Element, element};
use super::gesture::{Arrow, Mode, corner_patch, move_patch, nudge_patch, rotate_patch};
use super::group::{Member, group_frame, group_move, group_pinch, group_resize, group_rotate};
use super::hit::{Hit, SelectionBox, handle_points, pick, pick_toggle};
use super::mask::{MaskRegion, mask_box, mask_from_box};
use super::view::View;
use super::{Frame, Guides, Patch, Point, Size, Source, Target, num, object};

/// What one event sends.
#[derive(Clone, Debug, PartialEq)]
pub struct Context {
    pub time: f64,
    pub targets: Vec<Target>,
    /// Mask editing is on for the selected element.
    pub mask: bool,
    pub shift: bool,
    pub alt: bool,
}

fn flag(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// `scene:1`, `video:2`, `text:3` in a selection's multi-select set.
fn parse_key(key: &str) -> Option<Target> {
    let (source, id) = key.split_once(':')?;
    Some(Target::new(Source::parse(source)?, id.parse().ok()?))
}

/// The canvas elements a selection holds: the multi-select set when it has two
/// or more, else the primary (a video overlay, then text, then the scene).
pub fn targets_of(selection: &Value) -> Vec<Target> {
    let mut set: Vec<Target> = Vec::new();
    for target in selection.get("freeIds").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).filter_map(parse_key) {
        if !set.contains(&target) {
            set.push(target);
        }
    }
    if set.len() >= 2 {
        return set;
    }
    let id = |key: &str| selection.get(key).and_then(Value::as_f64);
    let primary = id("videoOverlayId")
        .map(|id| Target::new(Source::Video, id))
        .or_else(|| id("overlayId").map(|id| Target::new(Source::Text, id)))
        .or_else(|| id("sceneId").map(|id| Target::new(Source::Scene, id)));
    primary.or_else(|| set.pop()).into_iter().collect()
}

impl Context {
    /// `{"time", "selection"? | "targets"?, "visual"?: {"sceneId", "visualId"}, "mask"?, "shift"?, "alt"?}`.
    pub fn from_value(value: &Value) -> Result<Self, String> {
        let time = value.get("time").and_then(Value::as_f64).ok_or("an event needs a numeric `time`")?;
        let mut targets = match (value.get("targets"), value.get("selection")) {
            (Some(targets), _) => targets.as_array().ok_or("`targets` is not an array")?.iter().map(Target::from_value).collect::<Result<_, _>>()?,
            (None, Some(selection)) => targets_of(selection),
            (None, None) => Vec::new(),
        };
        if let Some(visual) = value.get("visual").filter(|v| !v.is_null()) {
            let scene = visual.get("sceneId").and_then(Value::as_f64);
            let id = visual.get("visualId").and_then(Value::as_str);
            for target in targets.iter_mut().filter(|t| t.source == Source::Scene && Some(t.id) == scene) {
                target.visual_id = id.map(str::to_owned);
            }
        }
        Ok(Self { time, targets, mask: flag(value, "mask"), shift: flag(value, "shift"), alt: flag(value, "alt") })
    }
}

/// A selected element, as a gesture holds it.
#[derive(Clone, Debug, PartialEq)]
struct Selected {
    element: Element,
    /// The playhead to key at, for an animated element.
    at: Option<f64>,
}

/// The mask an element's mask box edits.
#[derive(Clone, Debug, PartialEq)]
struct MaskEdit {
    mask: Value,
    region: Frame,
}

/// The selection a gesture or an overlay works on.
#[derive(Clone, Debug, PartialEq)]
struct Working {
    members: Vec<Selected>,
    mask: Option<MaskEdit>,
}

impl Working {
    fn of(scope: &EditScope, context: &Context, canvas: Size) -> Self {
        let members: Vec<Selected> = context
            .targets
            .iter()
            .filter_map(|target| element(scope, target, context.time))
            .map(|element| {
                let at = element.resolved.animated().then_some(context.time);
                Selected { element, at }
            })
            .collect();
        let mask = match (context.mask, members.as_slice()) {
            (true, [only]) => only.element.layout.get("mask").and_then(|mask| {
                let region = MaskRegion::of(&valid_mask(mask)?)?;
                Some(MaskEdit { mask: mask.clone(), region: mask_box(only.element.frame, region, canvas, only.element.scale) })
            }),
            _ => None,
        };
        Self { members, mask }
    }

    fn locked(&self) -> bool {
        self.members.iter().any(|m| m.element.locked)
    }

    fn group_members(&self) -> Vec<Member> {
        self.members.iter().map(|m| Member { frame: m.element.frame, scale: m.element.scale }).collect()
    }

    /// The box the selection is edited through, if any.
    fn selection_box(&self, canvas: Size) -> Option<SelectionBox> {
        let locked = self.locked();
        match (&self.mask, self.members.as_slice()) {
            (Some(mask), _) => Some(SelectionBox { frame: mask.region, scale: 1.0, local: true, locked }),
            (None, []) => None,
            (None, [only]) => Some(SelectionBox { frame: only.element.frame, scale: only.element.scale, local: false, locked }),
            (None, _) => Some(SelectionBox { frame: group_frame(&self.group_members(), canvas), scale: 1.0, local: false, locked }),
        }
    }

    /// The command for one patch per member (or one mask region patch).
    fn command(&self, scope: &EditScope, patches: &[Patch], canvas: Size) -> Value {
        if let (Some(mask), [only], [patch]) = (&self.mask, self.members.as_slice(), patches) {
            let region = mask_from_box(only.element.frame, mask.region.with(patch), canvas, only.element.scale);
            let mut set = Map::new();
            set.insert("mask".to_owned(), region.write(&mask.mask));
            return edit_command(scope, &only.element.target, &LayoutPatch::set(set), only.at);
        }
        combine(self.members.iter().zip(patches).map(|(m, p)| edit_command(scope, &m.element.target, &LayoutPatch::set(p.to_map()), m.at)).collect())
    }

    /// Whether the patches change anything (`clip-box.tsx` `up`).
    fn changes(&self, patches: &[Patch]) -> bool {
        match &self.mask {
            Some(mask) => patches.first().is_some_and(|p| p.changes(mask.region)),
            None => self.members.iter().zip(patches).any(|(m, p)| p.changes(m.element.frame)),
        }
    }
}

/// A gesture in progress.
#[derive(Clone, Debug, PartialEq)]
struct Active {
    mode: Mode,
    /// A two-finger pinch or twist rather than a pointer drag.
    pinch: bool,
    /// Where it started, in canvas pixels from the canvas's top-left corner.
    start: Point,
    working: Working,
    patches: Option<Vec<Patch>>,
    guides: Guides,
    factor: f64,
    angle: f64,
    /// The group box's offset, factor and angle so far, for drawing it.
    group: (Point, f64, f64),
}

/// The canvas handle's state (D2).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Session {
    view: Option<View>,
    active: Option<Active>,
}

/// One call's result before it is written as JSON.
#[derive(Default)]
struct Outcome {
    select: Option<Value>,
    commit: Option<Value>,
    handled: bool,
}

fn action(kind: &str, target: &Target) -> Value {
    match target.source {
        Source::Scene if kind == "selectClip" => object(vec![("type", Value::from("selectScene")), ("sceneId", num(target.id))]),
        source => object(vec![("type", Value::from(kind)), ("source", Value::from(source.name())), ("refId", num(target.id))]),
    }
}

fn point(value: &Value) -> Result<Point, String> {
    let read = |key: &str| value.get(key).and_then(Value::as_f64).ok_or_else(|| format!("a pointer event needs a numeric `{key}`"));
    Ok(Point { x: read("x")?, y: read("y")? })
}

impl Session {
    pub fn set_view(&mut self, value: &Value) -> Result<(), String> {
        self.view = Some(View::from_value(value)?);
        Ok(())
    }

    fn view(&self) -> Result<View, String> {
        self.view.ok_or_else(|| "the canvas has no view: call canvas_view first".to_owned())
    }

    /// A screen point in canvas pixels from the canvas's top-left corner.
    fn canvas_px(view: &View, screen: Point) -> Point {
        let [x, y, _, _] = view.canvas_rect();
        let p = view.logical(screen);
        Point { x: p.x - x, y: p.y - y }
    }

    /// Draw what is selected, with no event.
    pub fn overlay(&self, scope: &EditScope, context: &Context) -> Result<Value, String> {
        let view = self.view()?;
        Ok(self.overlay_value(scope, context, &view))
    }

    /// One input event: `{"type": "down" | "move" | "up" | "cancel" | "key" | "pinch" | "twist", …}` plus the context.
    pub fn input(&mut self, scope: &EditScope, event: &Value) -> Result<Value, String> {
        let view = self.view()?;
        let context = Context::from_value(event)?;
        let kind = event.get("type").and_then(Value::as_str).ok_or("an event needs a string `type`")?;
        let outcome = match kind {
            "down" => self.down(scope, &context, &view, point(event)?),
            "move" => {
                self.drag(scope, &context, &view, point(event)?);
                Outcome::default()
            }
            "up" => self.release(scope, &context, &view),
            "cancel" => {
                self.active = None;
                Outcome::default()
            }
            "key" => self.key(scope, &context, &view, event),
            "pinch" | "twist" => {
                let value =
                    event.get(if kind == "pinch" { "scale" } else { "angle" }).and_then(Value::as_f64).ok_or("a pinch needs `scale`, a twist `angle`")?;
                self.pinch(scope, &context, &view, kind == "pinch", value);
                Outcome::default()
            }
            other => return Err(format!("unknown canvas event {other:?}")),
        };
        let preview = self.active.as_ref().and_then(|a| a.patches.as_ref().map(|p| a.working.command(scope, p, view.canvas_size())));
        Ok(object(vec![
            ("overlay", self.overlay_value(scope, &context, &view)),
            ("select", outcome.select.unwrap_or(Value::Null)),
            ("preview", preview.unwrap_or(Value::Null)),
            ("commit", outcome.commit.unwrap_or(Value::Null)),
            ("handled", Value::Bool(outcome.handled || self.active.is_some())),
        ]))
    }

    fn down(&mut self, scope: &EditScope, context: &Context, view: &View, screen: Point) -> Outcome {
        if self.active.is_some() {
            return Outcome { handled: true, ..Outcome::default() };
        }
        let canvas = view.canvas_size();
        let p = view.to_canvas(screen);
        if context.shift {
            let select = pick_toggle(scope, view, context.time, p).map(|target| action("toggleClip", &target));
            return Outcome { handled: select.is_some(), select, commit: None };
        }
        let working = Working::of(scope, context, canvas);
        let selection = working.selection_box(canvas);
        let mode = match pick(scope, view, selection.as_ref(), context.time, p) {
            Hit::Handle(mode) => mode,
            Hit::Inside if working.locked() => return Outcome { handled: true, ..Outcome::default() },
            Hit::Inside => Mode::Move,
            Hit::Element(target) => return Outcome { select: Some(action("selectClip", &target)), commit: None, handled: true },
            Hit::Scene(id) => return Outcome { select: Some(action("selectClip", &Target::new(Source::Scene, id))), commit: None, handled: true },
            Hit::Empty => return Outcome { select: Some(object(vec![("type", Value::from("clear"))])), commit: None, handled: false },
            Hit::Outside => return Outcome::default(),
        };
        self.active = Some(Active {
            mode,
            pinch: false,
            start: Self::canvas_px(view, screen),
            working,
            patches: None,
            guides: Guides::default(),
            factor: 1.0,
            angle: 0.0,
            group: (Point::default(), 1.0, 0.0),
        });
        Outcome { handled: true, ..Outcome::default() }
    }

    fn drag(&mut self, _scope: &EditScope, context: &Context, view: &View, screen: Point) {
        let canvas = view.canvas_size();
        let at = Self::canvas_px(view, screen);
        let Some(active) = self.active.as_mut().filter(|a| !a.pinch) else { return };
        let (dx, dy) = (at.x - active.start.x, at.y - active.start.y);
        let working = &active.working;
        let single = match (&working.mask, working.members.as_slice()) {
            (Some(mask), _) => Some((mask.region, 1.0)),
            (None, [only]) => Some((only.element.frame, only.element.scale)),
            _ => None,
        };
        let (patches, guides) = match single {
            Some((frame, scale)) => {
                let (patch, guides) = match active.mode {
                    Mode::Move => move_patch(frame, dx, dy, canvas, scale, context.alt),
                    Mode::Rotate => (rotate_patch(frame, canvas, active.start, at, context.alt), Guides::default()),
                    Mode::Resize(corner) => corner_patch(frame, corner, dx, dy, canvas, scale, context.alt, context.shift),
                };
                (vec![patch], guides)
            }
            None => {
                let members = working.group_members();
                match active.mode {
                    Mode::Move => {
                        let (patches, guides, offset) = group_move(&members, dx, dy, canvas, context.alt);
                        active.group = (offset, 1.0, 0.0);
                        (patches, guides)
                    }
                    Mode::Rotate => {
                        let (patches, angle) = group_rotate(&members, active.start, at, canvas, context.alt);
                        active.group = (Point::default(), 1.0, angle);
                        (patches, Guides::default())
                    }
                    Mode::Resize(corner) => {
                        let (patches, factor) = group_resize(&members, corner, dx, dy, canvas, context.alt);
                        active.group = (Point::default(), factor, 0.0);
                        (patches, Guides::default())
                    }
                }
            }
        };
        active.patches = Some(patches);
        active.guides = guides;
    }

    fn pinch(&mut self, scope: &EditScope, context: &Context, view: &View, scale: bool, value: f64) {
        let canvas = view.canvas_size();
        if self.active.is_none() {
            let working = Working { mask: None, ..Working::of(scope, context, canvas) };
            if working.members.is_empty() || working.locked() {
                return;
            }
            self.active = Some(Active {
                mode: Mode::Move,
                pinch: true,
                start: Point::default(),
                working,
                patches: None,
                guides: Guides::default(),
                factor: 1.0,
                angle: 0.0,
                group: (Point::default(), 1.0, 0.0),
            });
        }
        let Some(active) = self.active.as_mut().filter(|a| a.pinch) else { return };
        if scale {
            active.factor = value;
        } else {
            active.angle = value;
        }
        let (patches, factor, angle) = group_pinch(&active.working.group_members(), active.factor, active.angle, canvas, context.alt);
        active.group = (Point::default(), factor, angle);
        active.patches = Some(patches);
    }

    fn release(&mut self, scope: &EditScope, _context: &Context, view: &View) -> Outcome {
        let Some(active) = self.active.take() else { return Outcome::default() };
        let commit = active.patches.filter(|p| active.working.changes(p)).map(|p| active.working.command(scope, &p, view.canvas_size()));
        Outcome { commit: commit.filter(|c| c.get("type").and_then(Value::as_str) != Some("noop")), handled: true, select: None }
    }

    fn key(&mut self, scope: &EditScope, context: &Context, view: &View, event: &Value) -> Outcome {
        let key = event.get("key").and_then(Value::as_str).unwrap_or_default();
        if key == "Escape" && self.active.is_some() {
            self.active = None;
            return Outcome { handled: true, ..Outcome::default() };
        }
        let (Some(arrow), Some(mode)) = (Arrow::parse(key), event.get("handle").and_then(Value::as_str).and_then(Mode::parse)) else {
            return Outcome::default();
        };
        let canvas = view.canvas_size();
        let working = Working::of(scope, context, canvas);
        if working.members.is_empty() || working.locked() {
            return Outcome::default();
        }
        let patches = match (&working.mask, working.members.as_slice()) {
            (Some(mask), _) => vec![nudge_patch(mask.region, mode, arrow, context.shift)],
            (None, [only]) => vec![nudge_patch(only.element.frame, mode, arrow, context.shift)],
            (None, _) => {
                let members = working.group_members();
                let delta = arrow.delta(context.shift);
                match mode {
                    Mode::Move => {
                        let (dx, dy) = if arrow.horizontal() { (delta * canvas.w / 100.0, 0.0) } else { (0.0, delta * canvas.h / 100.0) };
                        group_move(&members, dx, dy, canvas, true).0
                    }
                    Mode::Rotate => group_pinch(&members, 1.0, delta, canvas, true).0,
                    Mode::Resize(_) => {
                        let g = group_frame(&members, canvas);
                        let side = if arrow.horizontal() { g.w } else { g.h };
                        group_pinch(&members, (side + delta) / side, 0.0, canvas, true).0
                    }
                }
            }
        };
        let commit = working.command(scope, &patches, canvas);
        let commit = (commit.get("type").and_then(Value::as_str) != Some("noop")).then_some(commit);
        Outcome { commit, handled: true, select: None }
    }

    fn overlay_value(&self, scope: &EditScope, context: &Context, view: &View) -> Value {
        let canvas = view.canvas_size();
        let fresh;
        let (working, patches, guides) = match &self.active {
            Some(active) => (&active.working, active.patches.as_deref(), active.guides),
            None => {
                fresh = Working::of(scope, context, canvas);
                (&fresh, None, Guides::default())
            }
        };
        let patch_of = |i: usize| patches.and_then(|p| p.get(i)).copied().unwrap_or_default();
        let element_box = |m: &Selected, i: usize| {
            let frame = if working.mask.is_some() { m.element.frame } else { m.element.frame.with(&patch_of(i)) };
            let mut out = frame_value(frame, m.element.scale, m.element.locked);
            if let (Value::Object(out), Value::Object(target)) = (&mut out, m.element.target.to_value()) {
                out.extend(target);
            }
            out
        };
        let selection = working.selection_box(canvas);
        let interactive = match (&working.mask, working.members.as_slice(), selection) {
            (_, _, None) => Value::Null,
            (Some(mask), _, Some(sel)) => boxed(
                "mask",
                frame_value(mask.region.with(&patch_of(0)), 1.0, sel.locked),
                &SelectionBox { frame: mask.region.with(&patch_of(0)), ..sel },
                view,
            ),
            (None, [only], Some(sel)) => boxed("element", element_box(only, 0), &SelectionBox { frame: only.element.frame.with(&patch_of(0)), ..sel }, view),
            (None, _, Some(sel)) => {
                let frame = self.active.as_ref().map_or(sel.frame, |a| transformed(sel.frame, a.group, a.mode));
                boxed("group", frame_value(frame, 1.0, sel.locked), &SelectionBox { frame, ..sel }, view)
            }
        };
        let members: Vec<Value> = if working.members.len() > 1 && working.mask.is_none() {
            working.members.iter().enumerate().map(|(i, m)| element_box(m, i)).collect()
        } else {
            Vec::new()
        };
        object(vec![
            ("box", interactive),
            ("members", Value::Array(members)),
            ("guides", guides.to_value()),
            // Whether any selected element is animated, so the host follows the playhead only then.
            ("animated", Value::Bool(working.members.iter().any(|m| m.at.is_some()))),
        ])
    }
}

/// The group box as the gesture has carried it so far.
fn transformed(frame: Frame, (offset, factor, angle): (Point, f64, f64), mode: Mode) -> Frame {
    let mut next = Frame { x: frame.x + offset.x, y: frame.y + offset.y, rotation: angle, ..frame };
    if factor != 1.0 {
        let (w, h) = (frame.w * factor, frame.h * factor);
        let (ax, ay) = match mode {
            Mode::Resize(corner) => {
                let (sx, sy) = corner.signs();
                (if sx > 0.0 { frame.x } else { frame.x + frame.w - w }, if sy > 0.0 { frame.y } else { frame.y + frame.h - h })
            }
            _ => (frame.x + (frame.w - w) / 2.0, frame.y + (frame.h - h) / 2.0),
        };
        next = Frame { x: ax, y: ay, w, h, ..next };
    }
    next
}

fn frame_value(frame: Frame, scale: f64, locked: bool) -> Value {
    object(vec![
        ("xPct", num(frame.x)),
        ("yPct", num(frame.y)),
        ("widthPct", num(frame.w)),
        ("heightPct", num(frame.h)),
        ("rotationDeg", num(frame.rotation)),
        ("scale", num(scale)),
        ("locked", Value::Bool(locked)),
    ])
}

fn boxed(kind: &str, mut value: Value, selection: &SelectionBox, view: &View) -> Value {
    let handles: Vec<Value> = if selection.locked {
        Vec::new()
    } else {
        handle_points(selection, view)
            .into_iter()
            .rev()
            .map(|(mode, p)| object(vec![("id", Value::from(mode.name())), ("xPct", num(p.x)), ("yPct", num(p.y))]))
            .collect()
    };
    if let Some(out) = value.as_object_mut() {
        out.insert("kind".to_owned(), Value::from(kind));
        out.insert("handles".to_owned(), Value::Array(handles));
    }
    value
}
