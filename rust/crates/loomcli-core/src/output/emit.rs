//! The run's output: its two destinations and their order, the lanes' verbosity, rendering under
//! each destination's policy, sequences, results, and the incomplete-result lines a run holds until
//! it settles.
//!
//! Every write to one destination takes that destination's turn, so writes keep the order their
//! calls were made in. A sequence holds the turn from its first piece to its last, so a later write
//! to the same destination lands after it, and a write to the other destination, one its source
//! makes included, does not wait. A stdout write that fails because its reader closed the pipe
//! cancels the run with `ClosedPipe`; any other failed write leaves a broken destination, which the
//! run reports and which forces exit 1.
//!
//! On a terminal stderr every text write passes the live regions: core erases the stack before it
//! and draws it again after it. When stdout is a second terminal stream, a stdout write issued
//! while a region is open joins stderr's order, and the two streams take one turn to send, so the
//! screen sees one order. Writes a caller cannot await, such as a region's close or a log hook's
//! record, take their place in stderr's order at the call: behind every write already waiting for
//! stderr's turn and ahead of every write called after them. The first caller to take stderr's turn
//! from a later place sends them, or a task core spawns does.

use std::collections::{BTreeMap, VecDeque};
use std::future::Future;
use std::io;
use std::sync::atomic::{AtomicBool, AtomicI8, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde::Serialize;

use crate::commands::declaration::DeclaredResult;
use crate::diagnostics::{
    DiagnosticParts,
    rules::{RESULT_TRANSFORM, RESULT_TRANSFORM_CORRECTION},
};
use crate::failures::{Error, InternalError, ResultError, ResultFault};
use crate::host::{Host, OutputStream};
use crate::signals::{CancellationSource, RunSignal};
use crate::style::{
    Capabilities, Palette, Renderer, RenderingPolicy, Style, capabilities, effective_columns,
    under_ci,
};

use super::log_line::{LogLine, LogLineLevel, log_line};
use super::region::{CloseWork, ProgressEvent, RegionCloser, Regions, ScreenOp};
use super::registry::ViewRegistry;
use super::results::{ResultTransform, ResultView, RowSource, RowViewEntry};
use super::screen::{Frame, Measure, Screen, ends_line};
use super::view::{IncompleteResult, incomplete_result, lanes};
use super::{DeclaredView, Message, RowView, View, ViewContext, WholeView};
use super::{LogEvent, messages};

/// Whoever observes a run's progress events.
pub(crate) type ProgressObserver = Arc<dyn Fn(&ProgressEvent) + Send + Sync>;

/// The two streams every write site names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Stream {
    Stdout,
    Stderr,
}

/// The level of each semantic method, with its default view.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Lane {
    Print,
    Info,
    Success,
    Warn,
    Error,
}

impl Lane {
    /// The lowest verbosity the lane writes at: `info` and `success` from the default, so one quiet
    /// step hides them, and the rest at every verbosity.
    fn shown_from(self) -> i8 {
        match self {
            Lane::Print | Lane::Warn | Lane::Error => i8::MIN,
            Lane::Info | Lane::Success => 0,
        }
    }

    /// The lane's declared view.
    fn view(self) -> DeclaredView<str> {
        match self {
            Lane::Print => lanes::print(),
            Lane::Info => lanes::info(),
            Lane::Success => lanes::success(),
            Lane::Warn => lanes::warn(),
            Lane::Error => lanes::error(),
        }
    }
}

/// What a write rejects with once a closed reader on stdout cancelled the run: the cancellation
/// echo, which ends the action silently when it lets it propagate.
#[derive(Debug)]
pub(crate) struct CancellationEcho;

impl std::fmt::Display for CancellationEcho {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(messages::RUN_CANCELLED)
    }
}

impl std::error::Error for CancellationEcho {}

/// Whether `error` is the cancellation echo a refused write returned.
pub(crate) fn is_echo(error: &Error) -> bool {
    error
        .foreign()
        .is_some_and(|foreign| foreign.is::<CancellationEcho>())
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What one destination's writes meet: nothing refused yet, a failed write the run reports as a
/// broken destination, or a reader that closed the run's stdout, which cancelled the run.
#[derive(Clone)]
enum WriteState {
    Ok,
    Failed {
        kind: io::ErrorKind,
        message: String,
    },
    Closed,
}

/// One stream's queue: its turn, which orders every write to it, and what its writes met.
struct Destination {
    stream: Arc<dyn OutputStream>,
    turn: tokio::sync::Mutex<()>,
    state: Mutex<WriteState>,
    /// Whether a closed reader ends the run: the run's own stdout alone.
    ends_run: bool,
}

impl Destination {
    fn new(stream: Arc<dyn OutputStream>, ends_run: bool) -> Self {
        Self {
            stream,
            turn: tokio::sync::Mutex::new(()),
            state: Mutex::new(WriteState::Ok),
            ends_run,
        }
    }

    /// What a write to a destination that refused one before rejects with.
    fn refusal(&self) -> Option<Error> {
        match &*locked(&self.state) {
            WriteState::Ok => None,
            WriteState::Closed => Some(CancellationEcho.into()),
            WriteState::Failed { kind, message } => Some(Error::destination_write(io::Error::new(
                *kind,
                message.clone(),
            ))),
        }
    }

    fn failed(&self) -> Option<(io::ErrorKind, String)> {
        match &*locked(&self.state) {
            WriteState::Failed { kind, message } => Some((*kind, message.clone())),
            WriteState::Ok | WriteState::Closed => None,
        }
    }
}

/// How many rows a sequence's source produced, and how many of them core wrote.
#[derive(Clone, Copy, Default)]
struct Counts {
    yielded: usize,
    written: usize,
}

/// The view one sequence writes through: a row view writes each row as the source yields it; a
/// whole view collects every row and renders once at the end of the source.
pub(crate) enum SequenceView<R> {
    Rows(RowView<R>),
    Whole(View<[R]>),
    /// A whole view that takes the collected rows by value, so a view over one JSON array reads
    /// the rows it was handed without copying them.
    WholeOwned(OwnedRender<R>),
}

/// A whole view's render function over rows it owns.
pub(crate) type OwnedRender<R> =
    Arc<dyn Fn(Vec<R>, &ViewContext) -> Result<String, Error> + Send + Sync>;

/// The result one action's channel promises, with the run's view and transform selection.
pub(crate) struct ResultBinding {
    pub(crate) declared: DeclaredResult,
    pub(crate) path: Vec<String>,
    /// The view a middleware selected, or `None` for the declaration's default.
    pub(crate) selected: Option<String>,
    pub(crate) transform: Option<(Arc<str>, ResultTransform)>,
}

impl ResultBinding {
    fn apply<T: Send + 'static>(&self, value: T) -> Result<T, Error> {
        match &self.transform {
            Some((plugin, transform)) => self.apply_transform(plugin, transform, value),
            None => Ok(value),
        }
    }

    fn apply_json<T: Serialize + Send + 'static>(
        &self,
        value: T,
    ) -> Result<serde_json::Value, Error> {
        if let Some((plugin, transform)) = &self.transform
            && transform.json
        {
            return self.apply_transform(plugin, transform, to_json_data(&value)?);
        }
        to_json_data(&self.apply(value)?)
    }

    fn apply_transform<T: Send + 'static>(
        &self,
        plugin: &str,
        transform: &ResultTransform,
        value: T,
    ) -> Result<T, Error> {
        transform.apply(value).unwrap_or_else(|| {
            Err(InternalError::without_cause(
                RESULT_TRANSFORM,
                DiagnosticParts::new(messages::incompatible_transform(plugin, &self.path))
                    .correction(RESULT_TRANSFORM_CORRECTION),
            )
            .into())
        })
    }
}

/// One caller's output channel: where its `print`, `render`, and `text` go, and, for the action of
/// a Command that declares a result, that result and how many times the action emitted it.
pub(crate) struct Channel {
    pub(crate) destination: Stream,
    pub(crate) result: Option<ResultBinding>,
    calls: AtomicUsize,
    /// The regions this caller opened, which close when it settles.
    pub(crate) regions: Mutex<Vec<u64>>,
}

impl Channel {
    /// The channel of a writer that is not an action, which keeps stdout on every Command: an
    /// environment hook's, a source's, and a middleware's or a provider's `out`.
    pub(crate) fn plain() -> Self {
        Self {
            destination: Stream::Stdout,
            result: None,
            calls: AtomicUsize::new(0),
            regions: Mutex::new(Vec::new()),
        }
    }

    /// The channel of an action. On a Command that declares a result nothing the action writes but
    /// the result reaches stdout, so `print` and `render` move to stderr with their view context.
    pub(crate) fn action(result: Option<ResultBinding>) -> Self {
        Self {
            destination: if result.is_some() {
                Stream::Stderr
            } else {
                Stream::Stdout
            },
            result,
            calls: AtomicUsize::new(0),
            regions: Mutex::new(Vec::new()),
        }
    }

    /// The regions this caller opened.
    pub(crate) fn regions(&self) -> Vec<u64> {
        locked(&self.regions).clone()
    }

    /// Whether the action emitted its result.
    pub(crate) fn emitted(&self) -> bool {
        self.calls.load(Ordering::SeqCst) > 0
    }
}

/// The run's output: everything every `out` of one run writes through.
pub(crate) struct Output {
    host: Arc<Host>,
    policy: RenderingPolicy,
    palette: Palette,
    style: Style,
    /// The views declared views resolve through: the application's overrides until the graph has
    /// built, then every contributor's.
    registry: Mutex<Arc<ViewRegistry>>,
    /// The environment output capabilities read on each emission: the captured one, with each
    /// environment hook's additions merged once preparation has run.
    env: Mutex<Arc<crate::host::Env>>,
    verbosity: AtomicI8,
    signal: RunSignal,
    stdout: Destination,
    stderr: Destination,
    held: Mutex<Vec<IncompleteResult>>,
    log_view_errors: Mutex<Vec<Error>>,
    route: Mutex<Vec<String>>,
    pipe_closed: AtomicBool,
    /// Whether stdout and stderr are one stream, whose writes share one order.
    shared: bool,
    /// Whether stderr is a terminal, which holds the live regions.
    stderr_tty: bool,
    /// The plain switch, fixed from the captured argv and environment.
    plain: bool,
    /// Whether stdout is a second terminal stream beside stderr, so both show on one screen.
    coordinated: bool,
    /// The turn the two terminal streams take to send, when they are coordinated.
    send_turn: tokio::sync::Mutex<()>,
    /// How many sequences hold a place in stdout's order.
    stdout_sequences: AtomicUsize,
    /// The stack of open live regions as stderr shows it.
    screen: Mutex<Screen>,
    queue: Mutex<WriteQueue>,
    end_flushed: tokio::sync::Notify,
    runtime: Option<tokio::runtime::Handle>,
    /// The live regions this run opened.
    regions: Mutex<Regions>,
    /// How many lends of the terminal have not settled.
    lends: Mutex<usize>,
    lends_settled: tokio::sync::Notify,
    progress: Option<ProgressObserver>,
    /// The run's place in its signal source's lane, which the live regions hold their suspend and
    /// resume handlers through.
    place: Mutex<Option<crate::signals::lane::Place>>,
    /// How many live regions are open, and the suspend and resume handlers they hold while any is.
    live: Mutex<LiveHold>,
}

/// The live regions' hold on suspend and resume: how many are open, and the handlers the first one
/// registered, which go when the last one closes.
#[derive(Default)]
struct LiveHold {
    open: usize,
    held: Vec<crate::signals::Registration>,
}

/// The bytes that show the cursor again.
const SHOW_CURSOR: &str = "\u{1b}[?25h";

/// Output remains pending until each part is handed to its stream. Detached work is owned by
/// the stderr queue. The other writes are owned by their polled futures.
#[derive(Default)]
struct WriteQueue {
    next: u64,
    pending: BTreeMap<u64, WriteWork>,
    detached: VecDeque<u64>,
    draining: bool,
    ended: bool,
    post_end_log: bool,
}

impl WriteQueue {
    fn place(&mut self) -> u64 {
        let place = self.next;
        self.next += 1;
        place
    }

    fn insert(&mut self, work: WriteWork) -> u64 {
        let place = self.place();
        self.pending.insert(place, work);
        place
    }
}

struct WriteWork {
    stream: Stream,
    job: WriteJob,
    close: Option<CloseWork>,
}

enum WriteJob {
    Text(String),
    Screen(Vec<ScreenOp>),
    Reclaim,
    Parts(VecDeque<(Stream, String)>),
}

/// A dropped write future releases its unsent work. When the process-end flush has already
/// drained the work, the future's turn finds it gone.
struct WritePlace<'a> {
    output: &'a Output,
    number: u64,
}

impl Drop for WritePlace<'_> {
    fn drop(&mut self) {
        locked(&self.output.queue).pending.remove(&self.number);
    }
}

/// Keeps writes queued during the end behind the draining writes, even on an embedding host
/// that keeps its runtime alive after the exit event.
struct EndDrain<'a>(&'a Output);

impl Drop for EndDrain<'_> {
    fn drop(&mut self) {
        locked(&self.0.queue).draining = false;
        self.0.end_flushed.notify_waiters();
    }
}

/// Acknowledge a region close after the bytes have reached stderr.
fn wake_close(work: CloseWork, result: Result<(), Error>) {
    for cell in &work.wake {
        cell.wake();
    }
    if let Some(written) = work.written {
        let _ = written.send(result);
    }
}

/// The bytes a run of screen operations writes, applied to the screen in order.
fn apply_ops(screen: &mut Screen, measure: &dyn Measure, ops: Vec<ScreenOp>) -> String {
    let mut text = String::new();
    for op in ops {
        match op {
            ScreenOp::Open(id, input) => screen.open(id, input),
            ScreenOp::Draw(id, frame) => text.push_str(&screen.draw(measure, id, frame)),
            ScreenOp::Close(id) => text.push_str(&screen.close(measure, id)),
            ScreenOp::Resume => text.push_str(&screen.resume(measure)),
        }
    }
    text
}

/// How the screen measures at stderr's current width: rows as a drawn frame counts them, with its
/// control sequences kept, and the column visible text leaves.
struct StderrMeasure {
    renderer: Renderer,
    columns: Option<usize>,
}

impl Measure for StderrMeasure {
    fn rows(&self, marked: &str) -> usize {
        self.renderer.drawn_rows(marked, self.columns)
    }

    fn column(&self, shown: &str, column: usize) -> usize {
        crate::style::next_column(shown, self.columns, column)
    }
}

/// Counts one place a stdout sequence holds while it lasts.
struct SequencePlace<'a>(Option<&'a AtomicUsize>);

impl Drop for SequencePlace<'_> {
    fn drop(&mut self) {
        if let Some(count) = self.0 {
            count.fetch_sub(1, Ordering::SeqCst);
        }
    }
}

/// One lend of the terminal, counted from its call until it settles or is dropped. A lend dropped
/// after it began draws the stack it held again.
struct LendPlace {
    output: Arc<Output>,
    begun: bool,
    ended: bool,
}

impl Drop for LendPlace {
    fn drop(&mut self) {
        if self.begun && !self.ended {
            self.output.enqueue(WriteJob::Reclaim, None);
            self.output.wake_drainer();
        }
        let mut lends = locked(&self.output.lends);
        *lends = lends.saturating_sub(1);
        if *lends == 0 {
            self.output.lends_settled.notify_waiters();
        }
    }
}

impl Output {
    /// The output of a run over `host`, under its settled policy and the theme's palette, resolving
    /// declared views through `registry`. Verbosity starts at 0 and settles after graph build.
    pub(crate) fn new(
        host: Arc<Host>,
        signal: RunSignal,
        policy: RenderingPolicy,
        palette: Palette,
        registry: ViewRegistry,
        progress: Option<ProgressObserver>,
        plain_spelling: bool,
    ) -> Self {
        let stdout = host.stdout();
        let stderr = host.stderr();
        let env = host.env.clone();
        let plain = plain_spelling || crate::marks::plain::accessible(&env);
        let shared = std::ptr::addr_eq(Arc::as_ptr(&stdout), Arc::as_ptr(&stderr));
        let stderr_tty = host.terminal.stderr().is_tty;
        let coordinated = stderr_tty && host.terminal.stdout().is_tty && !shared;
        Self {
            stdout: Destination::new(stdout, !shared),
            stderr: Destination::new(stderr, false),
            host,
            policy,
            palette,
            style: crate::style::style(),
            registry: Mutex::new(Arc::new(registry)),
            env: Mutex::new(Arc::new(env)),
            verbosity: AtomicI8::new(0),
            signal,
            held: Mutex::new(Vec::new()),
            log_view_errors: Mutex::default(),
            route: Mutex::new(Vec::new()),
            pipe_closed: AtomicBool::new(false),
            shared,
            stderr_tty,
            plain,
            coordinated,
            send_turn: tokio::sync::Mutex::new(()),
            stdout_sequences: AtomicUsize::new(0),
            screen: Mutex::new(Screen::default()),
            queue: Mutex::new(WriteQueue::default()),
            end_flushed: tokio::sync::Notify::new(),
            runtime: tokio::runtime::Handle::try_current().ok(),
            regions: Mutex::new(Regions::default()),
            lends: Mutex::new(0),
            lends_settled: tokio::sync::Notify::new(),
            progress,
            place: Mutex::new(None),
            live: Mutex::new(LiveHold::default()),
        }
    }

    /// The run's place in its lane, which a live region's suspend and resume handlers join.
    pub(crate) fn use_place(&self, place: crate::signals::lane::Place) {
        *locked(&self.place) = Some(place);
    }

    /// A live region opened: the first one makes a suspend erase the regions and the resume draw
    /// them again, through handlers on the run's place whose failures are dropped.
    pub(crate) fn enter_live(self: &Arc<Self>) {
        let place = locked(&self.place).clone();
        let mut live = locked(&self.live);
        live.open += 1;
        if live.open > 1 {
            return;
        }
        let Some(place) = place else {
            return;
        };
        let suspending = Arc::downgrade(self);
        let resuming = Arc::downgrade(self);
        live.held = vec![
            place.on_suspend(
                Arc::new(move || {
                    if let Some(output) = suspending.upgrade() {
                        output.suspend_regions();
                    }
                }),
                None,
            ),
            place.on_resume(
                Arc::new(move || {
                    if let Some(output) = resuming.upgrade() {
                        output.resume_regions();
                    }
                }),
                None,
            ),
        ];
    }

    /// A live region closed: once none is open, a suspend has nothing to erase.
    pub(crate) fn leave_live(&self) {
        let held = {
            let mut live = locked(&self.live);
            live.open = live.open.saturating_sub(1);
            if live.open > 0 {
                return;
            }
            std::mem::take(&mut live.held)
        };
        for registration in held {
            registration.remove();
        }
    }

    /// A suspend: every region frame still queued, then the erase of the open regions and the
    /// cursor shown, straight to the terminal, because the process stops as the suspend handlers
    /// return. A lent terminal is the child's, so nothing is erased while one is lent.
    fn suspend_regions(&self) {
        self.flush_composed(|screen, measure| {
            if screen.lending() > 0 {
                String::new()
            } else {
                format!("{}{}", screen.suspend(measure), self.cursor_shown())
            }
        });
    }

    /// A resume: the regions are drawn again in stderr's order, after every write queued before
    /// it, starting at the start of a row.
    fn resume_regions(self: &Arc<Self>) {
        self.queue_screen(CloseWork {
            ops: vec![ScreenOp::Resume],
            ..CloseWork::default()
        });
        self.wake_drainer();
    }

    /// Sends the rest of each pending write in its queue order before restoring the terminal.
    pub(crate) fn flush_at_end(&self) {
        let pending = {
            let mut queue = locked(&self.queue);
            if queue.ended || queue.draining {
                return;
            }
            queue.draining = true;
            queue.ended = true;
            queue.detached.clear();
            std::mem::take(&mut queue.pending)
        };
        let drain = EndDrain(self);
        let mut closed = Vec::new();
        for (_, mut work) in pending {
            let measure = self.stderr_tty.then(|| self.measure());
            for (stream, text) in self.parts(work.stream, work.job, measure.as_ref()) {
                self.send_at_end(stream, &text);
            }
            closed.extend(work.close.take());
        }
        if self.stderr_tty {
            let measure = self.measure();
            let text = locked(&self.screen).finish_lends(&measure);
            self.send_at_end(Stream::Stderr, &format!("{text}{}", self.cursor_shown()));
        }
        for work in closed {
            wake_close(work, Ok(()));
        }
        drop(drain);
        self.flush_after_end();
    }

    /// Writes everything queued after the end, including the log write that asked for the
    /// drain. The terminal's last frame is already on screen and the cursor is visible.
    fn flush_after_end(&self) {
        loop {
            let pending = {
                let mut queue = locked(&self.queue);
                if queue.draining || !queue.post_end_log {
                    return;
                }
                queue.post_end_log = false;
                queue.draining = true;
                queue.detached.clear();
                std::mem::take(&mut queue.pending)
            };
            let _drain = EndDrain(self);
            for (_, work) in pending {
                for (stream, text) in self.parts(work.stream, work.job, None) {
                    self.send_at_end(stream, &text);
                }
                if let Some(close) = work.close {
                    wake_close(close, Ok(()));
                }
            }
        }
    }

    /// The stream is offered each part just once. An end cannot wait for a stream to become ready.
    fn send_at_end(&self, stream: Stream, text: &str) {
        let destination = self.destination(stream);
        if !text.is_empty() && destination.refusal().is_none() {
            let _ = crate::support::poll_once(destination.stream.write(text.as_bytes()));
        }
    }

    /// The bytes that show the cursor again, on a terminal that redraws in place or when the
    /// policy preserves terminal controls; otherwise nothing hid it.
    fn cursor_shown(&self) -> &'static str {
        let preserved = self.policy.terminal_controls_setting()
            == Some(crate::style::TerminalControls::Preserve);
        if self.redraws() || preserved {
            SHOW_CURSOR
        } else {
            ""
        }
    }

    /// A suspend sends detached screen work before its final screen change. Other writes retain
    /// their turns.
    fn flush_composed(&self, after: impl FnOnce(&mut Screen, &dyn Measure) -> String) {
        let works = {
            let mut queue = locked(&self.queue);
            let mut works = Vec::new();
            for place in std::mem::take(&mut queue.detached) {
                let screen = queue.pending.get(&place).is_some_and(|work| {
                    matches!(work.job, WriteJob::Screen(_) | WriteJob::Reclaim)
                });
                if screen {
                    works.extend(queue.pending.remove(&place));
                } else {
                    queue.detached.push_back(place);
                }
            }
            works
        };
        let measure = self.measure();
        let mut closed = Vec::new();
        let mut text = String::new();
        for work in works {
            for (_, part) in self.parts(work.stream, work.job, Some(&measure)) {
                text.push_str(&part);
            }
            closed.extend(work.close);
        }
        text.push_str(&after(&mut locked(&self.screen), &measure));
        self.send_at_end(Stream::Stderr, &text);
        for work in closed {
            wake_close(work, Ok(()));
        }
    }

    /// The registry declared views resolve through now.
    pub(crate) fn views(&self) -> Arc<ViewRegistry> {
        Arc::clone(&locked(&self.registry))
    }

    /// Resolves declared views through `registry` from here on: every contributor's, once the
    /// graph has built.
    pub(crate) fn use_views(&self, registry: ViewRegistry) {
        *locked(&self.registry) = Arc::new(registry);
    }

    /// The environment output reads now.
    fn env(&self) -> Arc<crate::host::Env> {
        Arc::clone(&locked(&self.env))
    }

    /// Reads `env` from here on: the environment with every hook's additions merged.
    pub(crate) fn set_env(&self, env: crate::host::Env) {
        *locked(&self.env) = Arc::new(env);
    }

    /// The run's verbosity, which decides which lanes write from here on.
    pub(crate) fn set_verbosity(&self, verbosity: i8) {
        self.verbosity.store(verbosity, Ordering::SeqCst);
    }

    /// The path routing walked, which an incomplete sequence names.
    pub(crate) fn set_route(&self, path: Vec<String>) {
        *locked(&self.route) = path;
    }

    /// The path routing walked so far: empty before routing, the partial path before an unknown
    /// Command, and the routed path after.
    pub(crate) fn route(&self) -> Vec<String> {
        locked(&self.route).clone()
    }

    /// Marked text resolved as plain text for stderr, as an invocation by name resolves its captured
    /// text: no color, modifier, or hyperlink, whatever the policy or `FORCE_COLOR` says, and the
    /// policy's own terminal controls. A failure form reads its message and hints through it.
    pub(crate) fn plain(&self, text: &str) -> String {
        let capabilities = Capabilities {
            color: false,
            modifiers: false,
            hyperlinks: false,
            ..self.capabilities(Stream::Stderr)
        };
        Renderer::new(capabilities, self.palette.clone()).resolve(text)
    }

    /// The order a write to `stream` takes: stderr's for stdout too when the two are one stream.
    fn lane(&self, stream: Stream) -> Stream {
        if self.shared { Stream::Stderr } else { stream }
    }

    /// Whether the run's signal has been cancelled.
    pub(crate) fn cancelled(&self) -> bool {
        self.signal.is_cancelled()
    }

    fn moves_cursor(&self, env: &crate::host::Env) -> bool {
        !self.plain && env.get("TERM").map(String::as_str) != Some("dumb")
    }

    /// Whether a terminal destination moves its cursor and is outside CI.
    fn redraws(&self) -> bool {
        let env = self.env();
        self.moves_cursor(&env) && !under_ci(&*env)
    }

    /// Whether stderr is a terminal, whose input regions take turns even when they cannot draw.
    pub(crate) fn terminal_input_regions(&self) -> bool {
        self.stderr_tty
    }

    /// Whether a region opened now draws on stderr.
    pub(crate) fn region_live(&self, input: bool) -> bool {
        self.stderr_tty
            && if input {
                self.moves_cursor(&self.env())
            } else {
                self.verbosity.load(Ordering::SeqCst) >= 0 && self.redraws()
            }
    }

    /// The run's regions.
    pub(crate) fn regions(&self) -> MutexGuard<'_, Regions> {
        locked(&self.regions)
    }

    /// A region that opened, which takes no rows until it draws.
    pub(crate) fn screen_open(&self, id: u64, input: bool) {
        locked(&self.screen).open(id, input);
    }

    /// Hands one progress event to whoever observes the run.
    pub(crate) fn deliver_progress(&self, event: &ProgressEvent) {
        if let Some(observer) = &self.progress {
            observer(event);
        }
    }

    /// The capabilities a drawn frame resolves under: stderr's, with its control sequences kept
    /// when `controls` is true.
    fn draw_caps(&self, controls: bool) -> Capabilities {
        let mut caps = self.capabilities(Stream::Stderr);
        caps.terminal_controls |= controls;
        caps
    }

    /// How the screen measures now: at stderr's real width, with a frame's controls kept.
    fn measure(&self) -> StderrMeasure {
        StderrMeasure {
            renderer: Renderer::new(self.draw_caps(self.stderr_tty), self.palette.clone()),
            columns: self.host.terminal.stderr().columns.map(usize::from),
        }
    }

    /// One frame of a region: the view the registry resolves, called now with stderr's context,
    /// its marked text kept so the screen counts its rows at the width of each later erase, and its
    /// control sequences kept on a terminal.
    pub(crate) fn frame<D: ?Sized + 'static>(
        &self,
        identity: Option<&str>,
        view: &View<D>,
        data: &D,
    ) -> Result<Frame, Error> {
        let view = self.views().whole(identity, view);
        let marked = (view.render)(data, &self.context(Stream::Stderr))?;
        let text =
            Renderer::new(self.draw_caps(self.stderr_tty), self.palette.clone()).resolve(&marked);
        Ok(Frame::new(marked, text))
    }

    /// Queues a region's screen work on stderr. A close with nothing to write wakes its waiting
    /// draws at once.
    pub(crate) fn queue_screen(&self, mut work: CloseWork) {
        if work.ops.is_empty() {
            wake_close(work, Ok(()));
        } else {
            let ops = std::mem::take(&mut work.ops);
            self.enqueue(WriteJob::Screen(ops), Some(work));
        }
    }

    /// Queues work on stderr that no caller drives.
    fn enqueue(&self, job: WriteJob, close: Option<CloseWork>) {
        let mut queue = locked(&self.queue);
        let place = queue.insert(WriteWork {
            stream: Stream::Stderr,
            job,
            close,
        });
        queue.detached.push_back(place);
    }

    /// Keeps a polled write's work available for process-end draining while it waits for its turn.
    fn track(&self, stream: Stream, job: WriteJob) -> WritePlace<'_> {
        let number = locked(&self.queue).insert(WriteWork {
            stream,
            job,
            close: None,
        });
        WritePlace {
            output: self,
            number,
        }
    }

    /// Once a row is ready, it takes the position of its sequence, ahead of writes waiting for
    /// the sequence's turn. The queue still contains only the bytes the view already rendered.
    fn track_piece(&self, number: u64, stream: Stream, text: String) -> WritePlace<'_> {
        locked(&self.queue).pending.insert(
            number,
            WriteWork {
                stream,
                job: WriteJob::Text(text),
                close: None,
            },
        );
        WritePlace {
            output: self,
            number,
        }
    }

    pub(super) fn shows_log(&self, level: LogLineLevel) -> bool {
        self.verbosity.load(Ordering::SeqCst) >= level.shown_from()
    }

    /// Shows a log event through the declared view before offering it to the hooks.
    pub(super) fn show_log(self: &Arc<Self>, event: Arc<LogEvent>, level: LogLineLevel) {
        let line = LogLine::from_event(event, level);
        let declared = log_line();
        let (identity, view) = declared.whole();
        match self.render_whole(Stream::Stderr, identity, view, &line) {
            Ok(mut text) if !text.is_empty() => {
                if !ends_line(&text) {
                    text.push('\n');
                }
                self.carry(text);
            }
            Ok(_) => {}
            Err(error) => locked(&self.log_view_errors).push(error),
        }
    }

    /// The failures of unawaited log-line views, in call order.
    pub(crate) fn take_log_view_errors(&self) -> Vec<Error> {
        std::mem::take(&mut *locked(&self.log_view_errors))
    }

    /// Text a log hook wrote to its destination's stderr.
    pub(crate) fn carry(self: &Arc<Self>, text: String) {
        if text.is_empty() {
            return;
        }
        let (ended, idle) = {
            let mut queue = locked(&self.queue);
            let idle = !queue.draining
                && !queue
                    .pending
                    .values()
                    .any(|work| work.stream == Stream::Stderr || self.coordinated)
                && (!self.coordinated || self.stdout_sequences.load(Ordering::SeqCst) == 0);
            let place = queue.insert(WriteWork {
                stream: Stream::Stderr,
                job: WriteJob::Text(text),
                close: None,
            });
            queue.detached.push_back(place);
            queue.post_end_log |= queue.ended;
            (queue.ended, idle)
        };
        if ended {
            self.flush_after_end();
        } else if idle && let Some(runtime) = self.runtime() {
            let _entered = runtime.enter();
            let output = Arc::clone(self);
            let mut drain = Box::pin(async move { output.flush().await });
            // Retain the same write future if the stream needs a waker before it can finish.
            if crate::support::poll_once(tokio::task::unconstrained(drain.as_mut())).is_none() {
                drop(runtime.spawn(drain));
            }
        } else {
            self.wake_drainer();
        }
    }

    /// Lets a task send detached work even when no other write follows.
    pub(crate) fn wake_drainer(self: &Arc<Self>) {
        if locked(&self.queue).detached.is_empty() {
            return;
        }
        if let Some(runtime) = self.runtime() {
            let output = Arc::clone(self);
            drop(runtime.spawn(async move { output.flush().await }));
        }
    }

    fn runtime(&self) -> Option<tokio::runtime::Handle> {
        tokio::runtime::Handle::try_current()
            .ok()
            .or_else(|| self.runtime.clone())
    }

    /// Sends everything queued on stderr, in its turn.
    pub(crate) async fn flush(&self) {
        let _turn = self.stderr_turn().await;
    }

    async fn stderr_turn(&self) -> tokio::sync::MutexGuard<'_, ()> {
        let place = locked(&self.queue).place();
        self.stderr_turn_before(place).await
    }

    /// Takes stderr's turn and sends the detached work that queued ahead of this place.
    async fn stderr_turn_before(&self, place: u64) -> tokio::sync::MutexGuard<'_, ()> {
        let turn = self.stderr.turn.lock().await;
        loop {
            let next = {
                let mut queue = locked(&self.queue);
                if queue.detached.front().is_some_and(|at| *at < place) {
                    queue.detached.pop_front()
                } else {
                    None
                }
            };
            let Some(number) = next else {
                break;
            };
            let _ = self
                .deliver(WritePlace {
                    output: self,
                    number,
                })
                .await;
        }
        turn
    }

    /// The turn both terminal streams take to send, when they show on one screen.
    async fn send_turn(&self) -> Option<tokio::sync::MutexGuard<'_, ()>> {
        if self.coordinated {
            Some(self.send_turn.lock().await)
        } else {
            None
        }
    }

    /// Text composed from the screen when it reaches stderr, sent as it is, outside the passage.
    /// The caller holds stderr's turn.
    async fn compose(
        &self,
        produce: impl FnOnce(&mut Screen, &dyn Measure) -> String,
    ) -> Result<(), Error> {
        let _send = self.send_turn().await;
        if let Some(refusal) = self.stderr.refusal() {
            return Err(refusal);
        }
        let text = {
            let measure = self.measure();
            produce(&mut locked(&self.screen), &measure)
        };
        self.send(&self.stderr, &text).await
    }

    /// Lays out a write for its stream. On a shared terminal, a stdout write keeps its erase
    /// and redraw on stderr, with only the message itself on stdout.
    fn parts(
        &self,
        stream: Stream,
        job: WriteJob,
        measure: Option<&StderrMeasure>,
    ) -> VecDeque<(Stream, String)> {
        match job {
            WriteJob::Text(text) => {
                let Some(measure) = measure
                    .filter(|_| !text.is_empty() && (stream == Stream::Stderr || self.coordinated))
                else {
                    return [(stream, text)].into();
                };
                let mut screen = locked(&self.screen);
                if stream == Stream::Stderr {
                    let (before, after) = screen.around(measure, &text);
                    [(stream, format!("{before}{text}{after}"))].into()
                } else if screen.holding() {
                    let (before, after) = screen.around(measure, &text);
                    [
                        (Stream::Stderr, before),
                        (stream, text),
                        (Stream::Stderr, after),
                    ]
                    .into()
                } else {
                    screen.note(measure, &text);
                    [(stream, text)].into()
                }
            }
            WriteJob::Screen(ops) => {
                let text = measure.map_or_else(String::new, |measure| {
                    apply_ops(&mut locked(&self.screen), measure, ops)
                });
                [(Stream::Stderr, text)].into()
            }
            WriteJob::Reclaim => {
                let text = measure
                    .map_or_else(String::new, |measure| locked(&self.screen).reclaim(measure));
                [(Stream::Stderr, text)].into()
            }
            WriteJob::Parts(parts) => parts,
        }
    }

    /// Composes the terminal operations at the write's turn. An exit that claimed the work has
    /// already taken responsibility for composing and writing it.
    async fn begin_delivery(&self, place: u64) -> Option<Stream> {
        loop {
            let flushed = self.end_flushed.notified();
            let measure = self.stderr_tty.then(|| self.measure());
            {
                let mut queue = locked(&self.queue);
                let draining = queue.draining;
                let work = queue.pending.get_mut(&place)?;
                if !draining {
                    let job = std::mem::replace(&mut work.job, WriteJob::Parts(VecDeque::new()));
                    work.job = WriteJob::Parts(
                        if work.stream == Stream::Stderr && self.stderr.refusal().is_some() {
                            [(work.stream, String::new())].into()
                        } else {
                            self.parts(work.stream, job, measure.as_ref())
                        },
                    );
                    return Some(work.stream);
                }
            }
            flushed.await;
        }
    }

    /// Takes one part at handoff, leaving the rest in the queue if the stream holds its answer.
    /// When the end already sent the work, the place is gone and the write has nothing to send.
    async fn deliver(&self, place: WritePlace<'_>) -> Result<(), Error> {
        let _send = self.send_turn().await;
        let Some(stream) = self.begin_delivery(place.number).await else {
            return Ok(());
        };
        let mut result = Ok(());
        loop {
            let next = locked(&self.queue)
                .pending
                .get_mut(&place.number)
                .and_then(|work| {
                    if let WriteJob::Parts(parts) = &mut work.job {
                        parts.pop_front()
                    } else {
                        None
                    }
                });
            let Some((destination, text)) = next else {
                break;
            };
            let sent = self.send(self.destination(destination), &text).await;
            if destination == stream {
                result = sent;
            }
        }
        let close = locked(&self.queue)
            .pending
            .remove(&place.number)
            .and_then(|work| work.close);
        if let Some(close) = close {
            wake_close(close, result);
            return Ok(());
        }
        result
    }

    fn destination(&self, stream: Stream) -> &Destination {
        match stream {
            Stream::Stdout => &self.stdout,
            Stream::Stderr => &self.stderr,
        }
    }

    /// One region frame, written in stderr's order.
    pub(crate) async fn draw_region(&self, id: u64, frame: Frame) -> Result<(), Error> {
        let place = self.track(
            Stream::Stderr,
            WriteJob::Screen(vec![ScreenOp::Draw(id, frame)]),
        );
        let _turn = self.stderr_turn_before(place.number).await;
        self.deliver(place).await
    }

    /// Lends the terminal to `work`. The lend counts from the call, so a report waits for it even
    /// when its caller has not polled it yet. Once every write queued before it has reached the
    /// terminal, core ends the row the last write left the cursor on; once `work` settles, core
    /// writes a line break and draws the held stack below what the work wrote.
    pub(crate) fn lend<'w, T, Fut>(
        self: &Arc<Self>,
        work: impl FnOnce() -> Fut + Send + 'w,
    ) -> impl Future<Output = T> + Send + 'w
    where
        Fut: Future<Output = T> + Send + 'w,
        T: Send + 'w,
    {
        *locked(&self.lends) += 1;
        let mut place = LendPlace {
            output: Arc::clone(self),
            begun: false,
            ended: false,
        };
        async move {
            let output = Arc::clone(&place.output);
            if output.stderr_tty {
                let _turn = output.stderr_turn().await;
                place.begun = true;
                let _ = output.compose(|screen, _| screen.lend()).await;
            }
            let value = work().await;
            if output.stderr_tty {
                let _turn = output.stderr_turn().await;
                place.ended = true;
                let _ = output
                    .compose(|screen, measure| screen.reclaim(measure))
                    .await;
            }
            drop(place);
            value
        }
    }

    /// Waits until every lend of the terminal has settled.
    pub(crate) async fn wait_for_lends(&self) {
        loop {
            let settled = self.lends_settled.notified();
            if *locked(&self.lends) == 0 {
                return;
            }
            settled.await;
        }
    }

    /// Closes the regions `channel`'s caller opened that are still open, and sends their last
    /// frames.
    pub(crate) async fn close_channel(self: &Arc<Self>, channel: &Channel, closer: RegionCloser) {
        let opened = channel.regions();
        self.close_regions(closer, Some(&opened));
        self.flush().await;
    }

    fn is_tty(&self, stream: Stream) -> bool {
        match stream {
            Stream::Stdout => self.host.terminal.stdout().is_tty,
            Stream::Stderr => self.host.terminal.stderr().is_tty,
        }
    }

    /// What `stream` renders under the run's policy, read from the run's environment now.
    fn capabilities(&self, stream: Stream) -> Capabilities {
        capabilities(&*self.env(), self.is_tty(stream), &self.policy)
    }

    fn renderer(&self, stream: Stream) -> Renderer {
        Renderer::new(self.capabilities(stream), self.palette.clone())
    }

    /// A fresh context for one render call, holding the destination's width read now.
    pub(crate) fn context(&self, stream: Stream) -> ViewContext {
        self.context_over(stream, self.renderer(stream))
    }

    /// A fresh context for one render call of a sequence, over the renderer the sequence resolves
    /// through, holding the destination's width read now.
    fn context_over(&self, stream: Stream, renderer: Renderer) -> ViewContext {
        let terminal = match stream {
            Stream::Stdout => self.host.terminal.stdout(),
            Stream::Stderr => self.host.terminal.stderr(),
        };
        // Off a terminal there is no width, so the environment is not read.
        let columns = if terminal.is_tty {
            effective_columns(&*self.env(), true, terminal.columns.map(u64::from))
                .map(|columns| u16::try_from(columns).unwrap_or(u16::MAX))
        } else {
            None
        };
        ViewContext::new(
            self.host.terminal.background,
            columns,
            self.style.clone(),
            renderer,
        )
    }

    /// The bytes `stream` receives for marked text.
    fn resolve(&self, stream: Stream, marked: &str) -> String {
        self.renderer(stream).resolve(marked)
    }

    /// The bytes one whole view renders for `stream`: the view the registry resolves `identity` to,
    /// called now with a fresh context, its marked text resolved for the destination.
    pub(crate) fn render_whole<D: ?Sized + 'static>(
        &self,
        stream: Stream,
        identity: Option<&str>,
        view: &View<D>,
        data: &D,
    ) -> Result<String, Error> {
        let view = self.views().whole(identity, view);
        let marked = (view.render)(data, &self.context(stream))?;
        Ok(self.resolve(stream, &marked))
    }

    /// The row view `view` resolves to through the registry.
    pub(crate) fn resolve_rows<R: 'static>(
        &self,
        identity: Option<&str>,
        view: &RowView<R>,
    ) -> RowView<R> {
        self.views().rows(identity, view)
    }

    /// Writes a semantic message, adding a line break if the view's drawn text lacks one.
    /// A call the run's verbosity hides never renders its view.
    pub(crate) async fn emit(
        &self,
        lane: Lane,
        message: Message<'_>,
        stream: Stream,
    ) -> Result<(), Error> {
        if self.verbosity.load(Ordering::SeqCst) < lane.shown_from() {
            return Ok(());
        }
        let default;
        let (identity, view) = if let Some(look) = message.look {
            look
        } else {
            default = lane.view();
            default.whole()
        };
        let mut text = self.render_whole(stream, identity, view, message.text)?;
        if !ends_line(&text) {
            text.push('\n');
        }
        self.write(stream, text).await
    }

    /// One `out.draw` call: rendered with stderr's context, its control sequences kept when stderr
    /// is a terminal that redraws in place, written in stderr's order, and answering the terminal
    /// rows it took at stderr's real width.
    pub(crate) async fn draw<D: ?Sized + 'static>(
        &self,
        identity: Option<&str>,
        view: &View<D>,
        data: &D,
    ) -> Result<usize, Error> {
        let (text, rows) = {
            let view = self.views().whole(identity, view);
            let marked = (view.render)(data, &self.context(Stream::Stderr))?;
            let terminal = self.host.terminal.stderr();
            // A terminal that does not redraw keeps the Application's setting, as a pipe does.
            let renderer = Renderer::new(
                self.draw_caps(terminal.is_tty && self.redraws()),
                self.palette.clone(),
            );
            (
                renderer.resolve(&marked),
                renderer.drawn_rows(&marked, terminal.columns.map(usize::from)),
            )
        };
        self.write(Stream::Stderr, text).await?;
        Ok(rows)
    }

    /// One text write, queued in `stream`'s order. A stdout write issued while a region is open on
    /// the same screen joins stderr's order too, unless a sequence holds a place in stdout's order,
    /// which a stdout write then waits behind alone.
    pub(crate) async fn write(&self, stream: Stream, text: String) -> Result<(), Error> {
        let stream = self.lane(stream);
        let place = self.track(stream, WriteJob::Text(text));
        match stream {
            Stream::Stderr => {
                let _turn = self.stderr_turn_before(place.number).await;
                self.deliver(place).await
            }
            Stream::Stdout => {
                let joins = self.coordinated
                    && self.stdout_sequences.load(Ordering::SeqCst) == 0
                    && locked(&self.screen).holding();
                let _turn = self.stdout.turn.lock().await;
                let _joined = if joins {
                    Some(self.stderr_turn_before(place.number).await)
                } else {
                    None
                };
                self.deliver(place).await
            }
        }
    }

    /// Sends text inside a turn this caller holds, recording any failure.
    async fn send(&self, destination: &Destination, text: &str) -> Result<(), Error> {
        if let Some(refusal) = destination.refusal() {
            return Err(refusal);
        }
        if text.is_empty() {
            return Ok(());
        }
        match destination.stream.write(text.as_bytes()).await {
            Ok(()) => Ok(()),
            Err(error) => Err(self.refused(destination, error)),
        }
    }

    /// What one failed write rejects with, once the failure is recorded. A closed reader on the
    /// run's stdout cancels the run with `ClosedPipe`, and that write and every later one to it
    /// reject with the cancellation echo; any other failure leaves a broken destination.
    fn refused(&self, destination: &Destination, error: io::Error) -> Error {
        let closed = matches!(
            error.kind(),
            io::ErrorKind::BrokenPipe | io::ErrorKind::NotConnected
        );
        let mut state = locked(&destination.state);
        if destination.ends_run && closed {
            self.signal.abort(
                CancellationSource::ClosedPipe,
                Some(Arc::from(error.to_string())),
            );
            self.pipe_closed.store(true, Ordering::SeqCst);
            *state = WriteState::Closed;
            return CancellationEcho.into();
        }
        if matches!(*state, WriteState::Ok) {
            *state = WriteState::Failed {
                kind: error.kind(),
                message: error.to_string(),
            };
        }
        Error::destination_write(error)
    }

    /// The first destination that failed a write, with what it failed with, if any did.
    pub(crate) fn failed(&self) -> Option<io::Error> {
        self.stdout
            .failed()
            .or_else(|| self.stderr.failed())
            .map(|(kind, message)| io::Error::new(kind, message))
    }

    /// A failure report: core's text or a view's, resolved for stderr and queued in its order. Its
    /// own failure is recorded on the destination.
    pub(crate) async fn report(&self, text: &str) {
        let resolved = self.resolve(Stream::Stderr, text);
        let _ = self.write(Stream::Stderr, resolved).await;
    }

    /// A failure encoder's text, written to stderr in its order as it is: no markup is resolved and
    /// nothing is escaped or appended. Its own failure is recorded on the destination.
    pub(crate) async fn encoded(&self, text: &str) {
        let _ = self.write(Stream::Stderr, text.to_owned()).await;
    }

    /// Drops the incomplete-result lines the run holds: a failure an encoder wrote is the only
    /// failure text the run writes.
    pub(crate) fn drop_incomplete(&self) {
        locked(&self.held).clear();
    }

    /// The plain fallback path: one write straight to stderr, outside its order and every override,
    /// as plain text. A failed write ends reporting.
    pub(crate) async fn report_plainly(&self, text: &str) {
        let plain = self.renderer(Stream::Stderr).plain(text);
        if !plain.is_empty() {
            let _ = self.host.stderr().write(plain.as_bytes()).await;
        }
    }

    /// Writes each incomplete-result line the run holds, in the order its sequences stopped, ahead
    /// of whatever the run reports next, through the registry like any other rendered output. A
    /// reader that closed stdout stopped reading on purpose, so then no line is written. A stderr
    /// that failed already takes each line through the plain fallback path. Answers what the first
    /// line whose view failed raised, which no code can catch.
    pub(crate) async fn write_incomplete(&self) -> Option<Error> {
        // The line waits until every lend of the terminal has settled.
        self.wait_for_lends().await;
        let held = std::mem::take(&mut *locked(&self.held));
        if self.pipe_closed.load(Ordering::SeqCst) {
            return None;
        }
        let declared = incomplete_result();
        let mut fault = None;
        for facts in held {
            if self.stderr.failed().is_some() {
                let context = self.context(Stream::Stderr);
                if let Ok(text) = (declared.view.render)(&facts, &context) {
                    let _ = self.host.stderr().write(text.as_bytes()).await;
                }
                continue;
            }
            match self.render_whole(
                Stream::Stderr,
                Some(declared.identity()),
                &declared.view,
                &facts,
            ) {
                Ok(text) => {
                    let _ = self.write(Stream::Stderr, text).await;
                }
                Err(error) => {
                    fault.get_or_insert(error);
                }
            }
        }
        fault
    }

    /// Whether the run stopped wanting rows: its signal was cancelled.
    fn halted(&self) -> bool {
        self.signal.is_cancelled()
    }

    /// One sequence, which holds its place in `stream`'s order from its first piece until its
    /// last. A stop before the end retracts nothing, writes no closing piece, and holds one
    /// incomplete-result line for the run to write before its report. A cancelled run stops the
    /// sequence quietly; a source, view, or write failure stops it and is the call's failure.
    pub(crate) async fn sequence<R: Send + 'static, D: Send>(
        &self,
        stream: Stream,
        mut source: RowSource<R>,
        view: SequenceView<D>,
        map: impl Fn(R) -> Result<D, Error> + Send + Sync,
    ) -> Result<(), Error> {
        let lane = self.lane(stream);
        let place = SequencePlace((lane == Stream::Stdout).then(|| {
            self.stdout_sequences.fetch_add(1, Ordering::SeqCst);
            &self.stdout_sequences
        }));
        let number = locked(&self.queue).place();
        let turn = match lane {
            Stream::Stderr => self.stderr_turn_before(number).await,
            Stream::Stdout => self.stdout.turn.lock().await,
        };
        let mut counts = Counts::default();
        let outcome = self
            .pieces(stream, &mut source, view, number, &mut counts, map)
            .await;
        // The source is told the writer wants no more rows: dropping it runs its own cleanup.
        drop(source);
        drop(turn);
        drop(place);
        if !matches!(outcome, Ok(true)) {
            let path = locked(&self.route).clone();
            locked(&self.held).push(IncompleteResult {
                path,
                yielded: counts.yielded,
                written: counts.written,
            });
        }
        outcome.map(|_| ())
    }

    /// Every piece of one sequence, each written before the next row is requested, so a slow
    /// destination applies back-pressure to the source. Answers whether the sequence completed.
    async fn pieces<R: Send, D: Send>(
        &self,
        stream: Stream,
        source: &mut RowSource<R>,
        view: SequenceView<D>,
        number: u64,
        counts: &mut Counts,
        map: impl Fn(R) -> Result<D, Error> + Send + Sync,
    ) -> Result<bool, Error> {
        if self.halted() {
            return Ok(false);
        }
        // One sequence is one emission: its capabilities are read once, at its start, and each
        // render call still gets a fresh context with the width read at that call.
        let renderer = self.renderer(stream);
        let context = || self.context_over(stream, renderer.clone());
        match view {
            SequenceView::Rows(view) => {
                if let Some(head) = &view.head {
                    let marked = head(&context());
                    self.piece(&renderer, stream, number, marked).await?;
                }
                loop {
                    if self.halted() {
                        return Ok(false);
                    }
                    let Some(next) = pull(source).await else {
                        break;
                    };
                    let row = next?;
                    if !self.row_delivered(counts).await {
                        return Ok(false);
                    }
                    let marked = (view.row)(&map(row)?, counts.yielded - 1, &context());
                    self.piece(&renderer, stream, number, marked).await?;
                    counts.written += 1;
                }
                if self.halted() {
                    return Ok(false);
                }
                if let Some(tail) = &view.tail {
                    let marked = tail(counts.written, &context());
                    self.piece(&renderer, stream, number, marked).await?;
                }
            }
            SequenceView::Whole(view) => {
                let Some(rows) = self.collect(source, counts).await? else {
                    return Ok(false);
                };
                let rows = rows.into_iter().map(map).collect::<Result<Vec<_>, _>>()?;
                let marked = (view.render)(rows.as_slice(), &context());
                self.piece(&renderer, stream, number, marked).await?;
            }
            SequenceView::WholeOwned(render) => {
                let Some(rows) = self.collect(source, counts).await? else {
                    return Ok(false);
                };
                let rows = rows.into_iter().map(map).collect::<Result<Vec<_>, _>>()?;
                let marked = render(rows, &context());
                self.piece(&renderer, stream, number, marked).await?;
            }
        }
        Ok(true)
    }

    /// Every row of a source, for a whole view, or `None` when the run stopped before the source
    /// ended: a run cancelled once the source ended never writes the closing piece either.
    async fn collect<R: Send>(
        &self,
        source: &mut RowSource<R>,
        counts: &mut Counts,
    ) -> Result<Option<Vec<R>>, Error> {
        let mut rows = Vec::new();
        loop {
            if self.halted() {
                return Ok(None);
            }
            let Some(next) = pull(source).await else {
                break;
            };
            let row = next?;
            if !self.row_delivered(counts).await {
                return Ok(None);
            }
            rows.push(row);
        }
        if self.halted() {
            return Ok(None);
        }
        Ok(Some(rows))
    }

    async fn row_delivered(&self, counts: &mut Counts) -> bool {
        counts.yielded += 1;
        // Ready pulls may never yield to another Tokio task. A row delivered during
        // cancellation counts even when it never reaches the view.
        tokio::task::consume_budget().await;
        !self.halted()
    }

    /// One piece: the marked text a view function returned, resolved through the sequence's
    /// renderer and sent in the sequence's turn.
    async fn piece(
        &self,
        renderer: &Renderer,
        stream: Stream,
        number: u64,
        marked: Result<String, Error>,
    ) -> Result<(), Error> {
        let text = renderer.resolve(&marked?);
        let place = self.track_piece(number, self.lane(stream), text);
        self.deliver(place).await
    }

    /// The view an emission renders through: the one a middleware selected, else the declaration's
    /// default. A second call writes nothing and rejects with `ResultError`; a selection no view
    /// answers fails as a broken view does.
    fn selected<'b>(
        &self,
        channel: &'b Channel,
    ) -> Result<(&'b ResultBinding, &'b ViewEntryRef), Error> {
        let Some(binding) = &channel.result else {
            return Err(Error::from_foreign(messages::RESULTS_NOT_DECLARED.into()));
        };
        if channel.calls.fetch_add(1, Ordering::SeqCst) > 0 {
            return Err(ResultError::new(ResultFault::Repeated, binding.path.clone()).into());
        }
        let name = binding
            .selected
            .as_deref()
            .unwrap_or(&binding.declared.default);
        binding
            .declared
            .views
            .iter()
            .find(|entry| entry.key == name)
            .map(|entry| (binding, &entry.view))
            .ok_or_else(|| Error::from_foreign(messages::view_not_declared(name).into()))
    }

    /// One `out.results` call under a value result: the selected view over the value, written to
    /// stdout with no line break added. A result's views carry no identity, so no override reaches
    /// them.
    pub(crate) async fn results_value<V: Serialize + Send + Sync + 'static>(
        &self,
        channel: &Channel,
        value: V,
    ) -> Result<(), Error> {
        let text = {
            let (binding, view) = self.selected(channel)?;
            if let Some(view) = view.downcast_ref::<View<V>>() {
                self.render_whole(Stream::Stdout, None, view, &binding.apply(value)?)?
            } else {
                match view.downcast_ref::<ResultView>() {
                    Some(ResultView::Whole(view)) => {
                        let data = binding.apply_json(value)?;
                        self.render_whole(Stream::Stdout, None, view, &data)?
                    }
                    _ => {
                        return Err(Error::from_foreign(messages::VIEW_RENDERS_ROWS.into()));
                    }
                }
            }
        };
        self.write(Stream::Stdout, text).await
    }

    /// One `out.results` call under a rows result: a sequence on stdout through the selected view,
    /// row by row under a row view and once at the end of the source under a whole view.
    pub(crate) async fn results_rows<R: Serialize + Send + Sync + 'static>(
        &self,
        channel: &Channel,
        source: RowSource<R>,
    ) -> Result<(), Error> {
        let (binding, view) = self.selected(channel)?;
        if let Some(entry) = view.downcast_ref::<RowViewEntry<R>>() {
            let view = match entry {
                RowViewEntry::Whole(view) => SequenceView::Whole(view.clone()),
                RowViewEntry::Row(view) => SequenceView::Rows(view.clone()),
            };
            return self
                .sequence(Stream::Stdout, source, view, |row| binding.apply(row))
                .await;
        }
        let view = match view.downcast_ref::<ResultView>() {
            Some(ResultView::Row(view)) => SequenceView::Rows(view.clone()),
            Some(ResultView::Whole(view)) => SequenceView::WholeOwned(json_rows_view(view)),
            None => {
                return Err(Error::from_foreign(messages::VIEW_RENDERS_VALUE.into()));
            }
        };
        self.sequence(Stream::Stdout, source, view, |row| binding.apply_json(row))
            .await
    }
}

/// A result view stored type-erased: a `View<V>`, a `RowViewEntry<R>`, or a hook's `ResultView`.
type ViewEntryRef = Arc<dyn std::any::Any + Send + Sync>;

/// A whole view over JSON data, read as a whole view over the JSON rows of a sequence.
fn json_rows_view(view: &View<serde_json::Value>) -> OwnedRender<serde_json::Value> {
    let render = Arc::clone(&view.render);
    Arc::new(move |rows: Vec<serde_json::Value>, context: &ViewContext| {
        render(&serde_json::Value::Array(rows), context)
    })
}

/// The failure of a result whose data cannot be read as JSON for a hook's view. The message is
/// fixed; the serializer's reason, which can hold data, stays on the source.
#[derive(Debug)]
struct JsonDataError(serde_json::Error);

impl std::fmt::Display for JsonDataError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(messages::NOT_JSON_DATA)
    }
}

impl std::error::Error for JsonDataError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.0)
    }
}

/// A result's data as JSON data, or the fixed encode failure.
fn to_json_data<T: Serialize + ?Sized>(data: &T) -> Result<serde_json::Value, Error> {
    serde_json::to_value(data)
        .map_err(|source| Error::from_foreign(Box::new(JsonDataError(source))))
}

/// The next row of a source: an iterator's at once, a stream's when it yields.
async fn pull<R>(source: &mut RowSource<R>) -> Option<Result<R, Error>> {
    match source {
        RowSource::Iter(rows) => rows.next().map(Ok),
        RowSource::Stream(rows) => {
            std::future::poll_fn(|context| rows.as_mut().poll_next(context)).await
        }
    }
}
