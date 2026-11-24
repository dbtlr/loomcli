//! Progress lines: a spinner while the work has no known size and a bar once it has a total, drawn
//! in a live region, animated on the line's own timer, and reported as progress events. Off a
//! terminal a line writes one start line and one end line through the lanes.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use loomcli_core::{
    BoxFuture, CommandGraph, CommandTarget, Context, EndState, Error, Extension, MiddlewareContext,
    Out, Plugin, ProgressReport, Region, RegionCloser, RegionOptions, read_extension,
};
use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::views::{BarCells, ProgressLine, ProgressState, progress_line};

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A spinner in the shape of a cli-spinners entry: frames drawn in turn, one each interval.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Spinner {
    /// The frames, plain text.
    pub frames: Vec<String>,
    /// Milliseconds between frames.
    pub interval: u64,
}

impl Spinner {
    /// A spinner of these frames, one every `interval` milliseconds.
    #[must_use]
    pub fn new(frames: impl IntoIterator<Item = impl Into<String>>, interval: u64) -> Self {
        Self {
            frames: frames.into_iter().map(Into::into).collect(),
            interval,
        }
    }
}

/// cli-spinners' `circleHalves`, every 80 milliseconds.
fn default_spinner() -> Spinner {
    Spinner::new(["◐", "◓", "◑", "◒"], 80)
}

fn default_bar() -> BarCells {
    BarCells::new("▰", "▱")
}

/// The settings of a progress line.
#[must_use]
pub struct ProgressSettings {
    pub(crate) label: String,
    pub(crate) total: Option<f64>,
    pub(crate) spinner: Option<Spinner>,
}

impl ProgressSettings {
    /// A progress line with this label, a marked string.
    pub fn new(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            total: None,
            spinner: None,
        }
    }

    /// The total the count runs to: a bar with counts; without it, a spinner.
    pub fn total(self, total: f64) -> Self {
        Self {
            total: Some(total),
            ..self
        }
    }

    /// This line's own spinner, over the application's style.
    pub fn spinner(self, spinner: Spinner) -> Self {
        Self {
            spinner: Some(spinner),
            ..self
        }
    }
}

/// An update to a progress line. A field left unset keeps its value.
#[derive(Clone, Debug, Default)]
#[must_use]
pub struct ProgressUpdate {
    pub(crate) completed: Option<f64>,
    pub(crate) total: Option<f64>,
    pub(crate) label: Option<String>,
}

impl ProgressUpdate {
    /// An update that changes nothing yet.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets how much is done.
    pub fn completed(self, completed: f64) -> Self {
        Self {
            completed: Some(completed),
            ..self
        }
    }

    /// Sets the total, which turns a spinner into a bar.
    pub fn total(self, total: f64) -> Self {
        Self {
            total: Some(total),
            ..self
        }
    }

    /// Replaces the label.
    pub fn label(self, label: impl Into<String>) -> Self {
        Self {
            label: Some(label.into()),
            ..self
        }
    }
}

/// A message built from what tracked work settled with.
type Message<V> = Box<dyn FnOnce(&V) -> String + Send>;

/// The messages tracked work ends a line with; each defaults to the label.
#[must_use]
pub struct TrackMessages<V> {
    done: Option<Message<V>>,
    failed: Option<Message<Error>>,
}

impl<V> Default for TrackMessages<V> {
    fn default() -> Self {
        Self {
            done: None,
            failed: None,
        }
    }
}

impl<V> TrackMessages<V> {
    /// No messages: the line ends with its label.
    pub fn new() -> Self {
        Self::default()
    }

    /// The success message, a function of the work's value.
    pub fn done(self, done: impl FnOnce(&V) -> String + Send + 'static) -> Self {
        Self {
            done: Some(Box::new(done)),
            ..self
        }
    }

    /// The failure message, a function of the work's error.
    pub fn failed(self, failed: impl FnOnce(&Error) -> String + Send + 'static) -> Self {
        Self {
            failed: Some(Box::new(failed)),
            ..self
        }
    }
}

/// The lanes a line writes through off a terminal, whatever result its `out` declares.
trait Lanes: Send + Sync {
    fn info(&self, message: String) -> BoxFuture<'static, Result<(), Error>>;
    fn success(&self, message: String) -> BoxFuture<'static, Result<(), Error>>;
    fn error(&self, message: String) -> BoxFuture<'static, Result<(), Error>>;
}

impl<R: 'static> Lanes for Out<R> {
    fn info(&self, message: String) -> BoxFuture<'static, Result<(), Error>> {
        let out = self.clone();
        Box::pin(async move { out.info(&message).await })
    }

    fn success(&self, message: String) -> BoxFuture<'static, Result<(), Error>> {
        let out = self.clone();
        Box::pin(async move { out.success(&message).await })
    }

    fn error(&self, message: String) -> BoxFuture<'static, Result<(), Error>> {
        let out = self.clone();
        Box::pin(async move { out.error(&message).await })
    }
}

/// Polls a write once, so it takes its place in stderr's order now, and finishes it on its own
/// task when it must wait.
fn drive<F: Future<Output = Result<(), Error>> + Send + 'static>(future: F) {
    let mut future: Pin<Box<F>> = Box::pin(future);
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    if future.as_mut().poll(&mut context).is_pending() {
        drop(tokio::spawn(future));
    }
}

/// What one line shows and how it changes.
struct LineState {
    state: ProgressState,
    label: String,
    completed: Option<f64>,
    total: Option<f64>,
    tick: usize,
}

/// What a line's handle, its timer, and its region's close share.
struct Line {
    region: Region,
    lanes: Arc<dyn Lanes>,
    spinner: Spinner,
    bar: BarCells,
    started: Instant,
    state: Mutex<LineState>,
    timer: Mutex<Option<JoinHandle<()>>>,
}

impl Line {
    fn frame(&self) -> ProgressLine {
        let state = locked(&self.state);
        let frame = if self.spinner.frames.is_empty() {
            String::new()
        } else {
            self.spinner.frames[state.tick % self.spinner.frames.len()].clone()
        };
        let elapsed = u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX);
        ProgressLine::new(state.state, state.label.clone())
            .counts(state.completed, state.total)
            .frame(frame)
            .bar(self.bar.clone())
            .elapsed(elapsed)
    }

    fn stop_timer(&self) {
        if let Some(timer) = locked(&self.timer).take() {
            timer.abort();
        }
    }

    async fn finish(&self, state: ProgressState, message: Option<&str>) -> Result<(), Error> {
        let label = {
            let mut line = locked(&self.state);
            if line.state != ProgressState::Running {
                return Ok(());
            }
            line.state = state;
            if let Some(message) = message {
                line.label = message.to_owned();
            }
            line.label.clone()
        };
        self.stop_timer();
        if self.region.live() {
            self.region.draw(&self.frame(), &progress_line()).await?;
        } else if state == ProgressState::Ended {
            self.lanes.success(label).await?;
        } else {
            self.lanes.error(label).await?;
        }
        let end = if state == ProgressState::Failed {
            EndState::Failed
        } else {
            EndState::Ended
        };
        self.region.end(end, message).await
    }
}

/// A progress line an action drives.
pub struct Progress {
    line: Arc<Line>,
}

impl Progress {
    /// Changes what the line shows, reports the change, and draws the next frame. An omitted field
    /// keeps its value. Once the line has closed it does nothing.
    pub fn update(&self, update: ProgressUpdate) {
        {
            let mut line = locked(&self.line.state);
            if line.state != ProgressState::Running {
                return;
            }
            if let Some(completed) = update.completed {
                line.completed = Some(completed);
            }
            if let Some(total) = update.total {
                line.total = Some(total);
            }
            if let Some(label) = &update.label {
                line.label.clone_from(label);
            }
        }
        let mut report = ProgressReport::new();
        if let Some(completed) = update.completed {
            report = report.completed(completed);
        }
        if let Some(label) = update.label {
            report = report.label(label);
        }
        if let Some(total) = update.total {
            report = report.total(total);
        }
        self.line.region.report(report);
        if self.line.region.live() {
            drive(self.line.region.draw(&self.line.frame(), &progress_line()));
        }
    }

    /// Ends the line with its label, leaving its success line in scrollback.
    pub async fn end(&self) -> Result<(), Error> {
        self.line.finish(ProgressState::Ended, None).await
    }

    /// Ends the line with `message` in place of its label, on the line and its end event.
    pub async fn end_with(&self, message: &str) -> Result<(), Error> {
        self.line.finish(ProgressState::Ended, Some(message)).await
    }

    /// Ends the line as failed, with its label.
    pub async fn fail(&self) -> Result<(), Error> {
        self.line.finish(ProgressState::Failed, None).await
    }

    /// Ends the line as failed with `message` in place of its label.
    pub async fn fail_with(&self, message: &str) -> Result<(), Error> {
        self.line.finish(ProgressState::Failed, Some(message)).await
    }

    /// Awaits `work`: its value ends the line with `done`, and its error fails the line with
    /// `failed` and returns the same error. A line already closed only returns the outcome.
    pub async fn track<V, F: Future<Output = Result<V, Error>>>(
        &self,
        work: F,
        messages: TrackMessages<V>,
    ) -> Result<V, Error> {
        let outcome = work.await;
        let running = locked(&self.line.state).state == ProgressState::Running;
        match outcome {
            Ok(value) => {
                if running {
                    let message = messages.done.map(|done| done(&value));
                    self.line
                        .finish(ProgressState::Ended, message.as_deref())
                        .await?;
                }
                Ok(value)
            }
            Err(error) => {
                if running {
                    let message = messages.failed.map(|failed| failed(&error));
                    self.line
                        .finish(ProgressState::Failed, message.as_deref())
                        .await?;
                }
                Err(error)
            }
        }
    }
}

/// The style one application sets, carried on the root Command.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct ProgressStyleSettings {
    /// The spinner every line draws unless its own settings name one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spinner: Option<Spinner>,
    /// The bar's cells.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bar: Option<BarCells>,
}

impl ProgressStyleSettings {
    /// The defaults: cli-spinners' `circleHalves` and a bar of `▰` and `▱`.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the spinner.
    #[must_use]
    pub fn spinner(mut self, spinner: Spinner) -> Self {
        self.spinner = Some(spinner);
        self
    }

    /// Sets the bar's cells.
    #[must_use]
    pub fn bar(mut self, bar: BarCells) -> Self {
        self.bar = Some(bar);
        self
    }
}

/// `@loomcli/prompts/progress-style`, which the plugin adds to the root Command alone.
const PROGRESS_STYLE: Extension<CommandTarget, ProgressStyleSettings> =
    Extension::new("@loomcli/prompts/progress-style");

/// The plugin that sets how every progress line of the application looks. Each setting it omits
/// keeps the library's default.
pub fn progress_style(settings: ProgressStyleSettings) -> Plugin {
    Plugin::new("@loomcli/prompts")
        .extensions([PROGRESS_STYLE])
        .on_command_attach(move |command| {
            if command.name().is_none() {
                command.extend([PROGRESS_STYLE.value(settings.clone())])?;
            }
            Ok(())
        })
}

fn closed_state(closer: Option<RegionCloser>) -> ProgressState {
    match closer {
        Some(RegionCloser::Cancellation) => ProgressState::Cancelled,
        Some(RegionCloser::Failure) => ProgressState::Failed,
        _ => ProgressState::Ended,
    }
}

mod sealed {
    /// Closes [`super::ProgressContext`] to the contexts core builds.
    pub trait Sealed {}
}

/// What a progress line reads from the context that opens it: the graph its style sits on, a
/// region of its output, and the lanes it writes through off a terminal. An action's context and a
/// middleware's context are progress contexts.
pub trait ProgressContext: sealed::Sealed {
    #[doc(hidden)]
    fn progress_parts(&self) -> ProgressParts;
}

/// The parts of a context a line holds.
#[doc(hidden)]
pub struct ProgressParts {
    graph: Arc<CommandGraph>,
    region: Region,
    lanes: Arc<dyn Lanes>,
}

impl<I, R: 'static> sealed::Sealed for Context<I, R> {}

impl<I, R: 'static> ProgressContext for Context<I, R> {
    fn progress_parts(&self) -> ProgressParts {
        ProgressParts {
            graph: Arc::clone(&self.graph),
            region: self.out.region(RegionOptions::new()),
            lanes: Arc::new(self.out.clone()),
        }
    }
}

impl<O> sealed::Sealed for MiddlewareContext<O> {}

impl<O> ProgressContext for MiddlewareContext<O> {
    fn progress_parts(&self) -> ProgressParts {
        ProgressParts {
            graph: Arc::clone(&self.graph),
            region: self.out.region(RegionOptions::new()),
            lanes: Arc::new(self.out.clone()),
        }
    }
}

/// Opens a progress line in a region of the context's output: it reports its start, draws its
/// first frame, and returns at once. An action, and a middleware around the run, each open lines
/// with their own context.
pub fn progress(context: &impl ProgressContext, settings: ProgressSettings) -> Progress {
    let ProgressParts {
        graph,
        region,
        lanes,
    } = context.progress_parts();
    let style = read_extension(&*graph.root, &PROGRESS_STYLE)
        .ok()
        .flatten()
        .unwrap_or_default();
    let spinner = settings
        .spinner
        .or(style.spinner)
        .unwrap_or_else(default_spinner);
    let bar = style.bar.unwrap_or_else(default_bar);
    let line = Arc::new(Line {
        region: region.clone(),
        lanes,
        spinner,
        bar,
        started: Instant::now(),
        state: Mutex::new(LineState {
            state: ProgressState::Running,
            label: settings.label.clone(),
            completed: settings.total.map(|_| 0.0),
            total: settings.total,
            tick: 0,
        }),
        timer: Mutex::new(None),
    });
    let mut report = ProgressReport::new().label(settings.label.clone());
    if let Some(total) = settings.total {
        report = report.completed(0.0).total(total);
    }
    region.report(report);
    if region.closed_by().is_some() {
        // A region opened after the run's cancellation closed as it opened.
        locked(&line.state).state = closed_state(region.closed_by());
        return Progress { line };
    }
    if region.live() {
        drive(region.draw(&line.frame(), &progress_line()));
        let ticking = Arc::clone(&line);
        let signal = region.signal();
        let interval = Duration::from_millis(line.spinner.interval.max(1));
        *locked(&line.timer) = Some(tokio::spawn(async move {
            loop {
                let sleep = tokio::time::sleep(interval);
                if crate::reader::unless(&signal, sleep).await.is_none() {
                    return;
                }
                if locked(&ticking.state).state != ProgressState::Running {
                    return;
                }
                locked(&ticking.state).tick += 1;
                let _ = ticking
                    .region
                    .draw(&ticking.frame(), &progress_line())
                    .await;
            }
        }));
    } else {
        drive(line.lanes.info(settings.label));
    }
    let closing = Arc::clone(&line);
    region.on_close(move |region| {
        closing.stop_timer();
        let label = {
            let mut state = locked(&closing.state);
            if state.state != ProgressState::Running {
                return;
            }
            state.state = closed_state(region.closed_by());
            state.label.clone()
        };
        let state = locked(&closing.state).state;
        if region.live() {
            drop(region.draw(&closing.frame(), &progress_line()));
        } else if state == ProgressState::Ended {
            drive(closing.lanes.success(label));
        } else if state == ProgressState::Failed {
            drive(closing.lanes.error(label));
        }
    });
    Progress { line }
}
