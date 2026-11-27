//! Progress lines: a spinner while the work has no known size and a bar once it has a total, drawn
//! in a live region, animated on the line's own timer, and reported as progress events. Off a
//! terminal a line writes one start line and one end line through the lanes.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use loomcli_core::{
    BoxFuture, CommandGraph, CommandTarget, Context, Error, Extension, Host, MiddlewareContext,
    Out, Plugin, Stream, read_extension,
};
use serde::{Deserialize, Serialize};
use tokio::runtime::Handle;

use crate::height::Layout;
use crate::progress_log::{ProgressLog, ProgressLogOutput};
use crate::tree::{End, Tree};
use crate::views::BarCells;

pub(crate) fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
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
pub(crate) fn default_spinner() -> Spinner {
    Spinner::new(["◐", "◓", "◑", "◒"], 80)
}

pub(crate) fn default_bar() -> BarCells {
    BarCells::new("▰", "▱")
}

/// The settings of a progress line.
#[must_use]
pub struct ProgressSettings {
    pub(crate) label: String,
    pub(crate) total: Option<f64>,
    pub(crate) spinner: Option<Spinner>,
    pub(crate) estimate: bool,
    pub(crate) unit: Option<String>,
    pub(crate) log_rows: usize,
    pub(crate) log_limit: usize,
    pub(crate) keep_tasks: bool,
}

impl ProgressSettings {
    /// A progress line with this label, a marked string.
    pub fn new(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            total: None,
            spinner: None,
            estimate: false,
            unit: None,
            log_rows: 5,
            log_limit: 1000,
            keep_tasks: false,
        }
    }

    /// The total the count runs to: a bar with counts; without it, a spinner.
    pub fn total(self, total: f64) -> Self {
        Self {
            total: Some(total),
            ..self
        }
    }

    /// Shows the rate and time left while this line runs.
    pub fn estimate(self) -> Self {
        Self {
            estimate: true,
            ..self
        }
    }

    /// Names the unit in the rate, as marked text.
    pub fn unit(self, unit: impl Into<String>) -> Self {
        Self {
            unit: Some(unit.into()),
            ..self
        }
    }

    /// Sets the maximum number of log rows shown while the line runs, default 5.
    pub fn log_rows(self, rows: usize) -> Self {
        Self {
            log_rows: rows,
            ..self
        }
    }

    /// Sets the maximum number of log lines kept at a failure, warning, or cancellation, default 1000.
    pub fn log_limit(self, limit: usize) -> Self {
        Self {
            log_limit: limit,
            ..self
        }
    }

    /// Keeps this group's tasks when it succeeds or is skipped.
    pub fn keep_tasks(self) -> Self {
        Self {
            keep_tasks: true,
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

/// Starts a write in the current call, finishing it on the run's runtime if it has to wait.
pub(crate) fn drive<F: Future<Output = Result<(), Error>> + Send + 'static>(
    runtime: Option<&Handle>,
    future: F,
) {
    let _runtime = runtime.map(Handle::enter);
    let mut future: Pin<Box<F>> = Box::pin(future);
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    // The first poll must take its place in stderr's order even if the caller used its budget.
    let started = Pin::new(&mut tokio::task::unconstrained(future.as_mut())).poll(&mut context);
    if started.is_pending()
        && let Some(runtime) = runtime
    {
        drop(runtime.spawn(future));
    }
}

/// A progress line an action drives. Clones share the line, which stays open when a handle drops.
///
/// An end takes effect at the call. Its future waits for the queued writes.
#[derive(Clone)]
pub struct Progress {
    tree: Arc<Tree>,
    id: Option<usize>,
    log: Arc<ProgressLog>,
}

impl Progress {
    /// Changes what the line shows, reports the change, and draws the next frame.
    /// An omitted field keeps its value. A closed line ignores updates.
    pub fn update(&self, update: ProgressUpdate) {
        if let Some(id) = self.id {
            self.tree.update(id, update);
        }
    }

    /// Opens a line under this one. The caller can schedule its work independently.
    /// A closed parent returns a closed handle.
    #[expect(
        clippy::must_use_candidate,
        reason = "opening a task has effects without a retained handle"
    )]
    pub fn task(&self, settings: ProgressSettings) -> Self {
        let (id, log) = self
            .id
            .and_then(|id| self.tree.open_task(id, settings))
            .map_or_else(|| (None, self.closed_log()), |(id, log)| (Some(id), log));
        Self {
            tree: self.tree.clone(),
            id,
            log,
        }
    }

    fn closed_log(&self) -> Arc<ProgressLog> {
        let log = ProgressLog::new(0, 0);
        log.close(false);
        log
    }

    fn finish(&self, end: End, label: Option<&str>) -> BoxFuture<'static, Result<(), Error>> {
        match self.id {
            Some(id) => self.tree.finish(id, end, label),
            None => Box::pin(std::future::ready(Ok(()))),
        }
    }

    /// Ends the line with its label, leaving its success line in scrollback.
    pub fn end(&self) -> BoxFuture<'static, Result<(), Error>> {
        self.finish(End::Success, None)
    }

    /// Ends the line with `message` in place of its label, on the line and its end event.
    pub fn end_with(&self, message: &str) -> BoxFuture<'static, Result<(), Error>> {
        self.finish(End::Success, Some(message))
    }

    /// Ends the line as failed, with its label.
    pub fn fail(&self) -> BoxFuture<'static, Result<(), Error>> {
        self.finish(End::Failure, None)
    }

    /// Ends the line as failed with `message` in place of its label.
    pub fn fail_with(&self, message: &str) -> BoxFuture<'static, Result<(), Error>> {
        self.finish(End::Failure, Some(message))
    }

    /// Ends the line as skipped, with its label.
    pub fn skip(&self) -> BoxFuture<'static, Result<(), Error>> {
        self.finish(End::Skip, None)
    }

    /// Ends the line as skipped with `message` in place of its label.
    pub fn skip_with(&self, message: &str) -> BoxFuture<'static, Result<(), Error>> {
        self.finish(End::Skip, Some(message))
    }

    /// Ends the line with a warning, using its label.
    pub fn warn(&self) -> BoxFuture<'static, Result<(), Error>> {
        self.finish(End::Warn, None)
    }

    /// Ends the line with a warning and `message` in place of its label.
    pub fn warn_with(&self, message: &str) -> BoxFuture<'static, Result<(), Error>> {
        self.finish(End::Warn, Some(message))
    }

    /// Removes the live line and its tasks and reports an ended event with its last label.
    pub fn clear(&self) -> BoxFuture<'static, Result<(), Error>> {
        self.finish(End::Clear, None)
    }

    /// Adds marked text to this line's log. The next frame shows its newest lines.
    pub fn log(&self, text: &str) {
        self.log.add(text);
    }

    /// Reads a stream of marked text through its end, even when this line has ended.
    pub fn log_stream(
        &self,
        chunks: impl Stream<Item = Result<String, Error>> + Send + 'static,
    ) -> BoxFuture<'static, Result<(), Error>> {
        self.log.stream(chunks, self.tree.runtime.as_ref())
    }

    /// Opens a progress log destination for one child program pipe.
    #[must_use]
    pub fn log_output(&self) -> ProgressLogOutput {
        self.log.output()
    }

    /// Awaits `work`: its value ends the line with `done`, and its error fails the line with
    /// `failed` and returns the same error. A line already closed only returns the outcome.
    pub async fn track<V, F: Future<Output = Result<V, Error>>>(
        &self,
        work: F,
        messages: TrackMessages<V>,
    ) -> Result<V, Error> {
        let outcome = work.await;
        let running = self.id.is_some_and(|id| self.tree.running(id));
        match outcome {
            Ok(value) => {
                if running {
                    let message = messages.done.map(|done| done(&value));
                    self.finish(End::Success, message.as_deref()).await?;
                }
                Ok(value)
            }
            Err(error) => {
                if running {
                    let message = messages.failed.map(|failed| failed(&error));
                    let _ = self.finish(End::Failure, message.as_deref()).await;
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

mod sealed {
    /// Closes [`super::ProgressContext`] to the contexts core builds.
    pub trait Sealed {}
}

/// The context a progress line opens from. Action and middleware contexts supply the graph,
/// output, and terminal facts of their run.
pub trait ProgressContext: sealed::Sealed {
    #[doc(hidden)]
    fn progress_parts(&self) -> ProgressParts;
}

/// The parts of a context a line holds.
#[doc(hidden)]
pub struct ProgressParts {
    graph: Arc<CommandGraph>,
    out: Out,
    host: Arc<Host>,
    layout: Arc<Mutex<Layout>>,
}

impl<I, R: 'static> sealed::Sealed for Context<I, R> {}

impl<I, R: 'static> ProgressContext for Context<I, R> {
    fn progress_parts(&self) -> ProgressParts {
        ProgressParts {
            graph: Arc::clone(&self.graph),
            out: self.out.__progress_out(),
            host: self.host.clone(),
            layout: self.out.__progress_layout(),
        }
    }
}

impl<O> sealed::Sealed for MiddlewareContext<O> {}

impl<O> ProgressContext for MiddlewareContext<O> {
    fn progress_parts(&self) -> ProgressParts {
        ProgressParts {
            graph: Arc::clone(&self.graph),
            out: self.out.__progress_out(),
            host: self.host.clone(),
            layout: self.out.__progress_layout(),
        }
    }
}

/// Opens a progress line in a region of the context's output: it reports its start, draws its
/// first frame, and returns at once. An action, and a middleware around the run, each open lines
/// with their own context.
pub fn progress(context: &impl ProgressContext, settings: ProgressSettings) -> Progress {
    let ProgressParts {
        graph,
        out,
        host,
        layout,
    } = context.progress_parts();
    let style = read_extension(&*graph.root, &PROGRESS_STYLE)
        .ok()
        .flatten()
        .unwrap_or_default();
    let (tree, log) = Tree::open(out, host, layout, style, settings);
    Progress {
        tree,
        id: Some(0),
        log,
    }
}
