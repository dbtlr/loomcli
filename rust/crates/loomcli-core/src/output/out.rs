//! The output handle an action, a middleware, a provider, and a source write through.

use std::future::Future;
use std::marker::PhantomData;
use std::sync::Arc;

use crate::failures::{Error, FatalError};

use super::emit::{Channel, Lane, Output, Stream};
use super::region::{Region, RegionOptions};
use super::results::{RowSource, RowsResult, ValueResult};
use super::{NoResult, Render, View, WholeView};

/// A borrowed text message with an optional whole view over its text.
#[must_use]
pub struct Message<'a> {
    pub(super) text: &'a str,
    pub(super) look: Option<(Option<&'a str>, &'a View<str>)>,
}

impl<'a> Message<'a> {
    /// A message drawn by its method's lane view.
    pub fn new(text: &'a str) -> Self {
        Self { text, look: None }
    }

    /// Draws this message with the supplied view. A declared view resolves through the registry.
    pub fn view(mut self, view: &'a impl WholeView<str>) -> Self {
        self.look = Some(view.whole());
        self
    }
}

impl<'a, T: AsRef<str> + ?Sized> From<&'a T> for Message<'a> {
    fn from(text: &'a T) -> Self {
        Self::new(text.as_ref())
    }
}

/// Writes a run's output. Every method resolves through the view registry, under the destination's
/// rendering policy.
///
/// | Method | Destination |
/// | --- | --- |
/// | `print` | stdout; stderr from the action of a Command that declares a result |
/// | `info`, `success`, `warn`, `error` | stderr; `info` and `success` hidden at verbosity -1 |
/// | `render` | as `print` |
/// | `draw` | stderr |
/// | `region` | stderr |
/// | `lend_terminal` | none; holds the live regions while the work runs |
/// | `text` | none; returns the text `render` would write |
/// | `results` | stdout; only on a Command that declares a result |
/// | `fatal` | the failure path |
///
/// `print`, `info`, `success`, `warn`, and `error` accept borrowed text or a [`Message`] with its
/// own view. The method sets the message's destination and verbosity. A message whose drawn text
/// lacks a final line break gains one.
///
/// `R` is the result the Command declares, so `results` takes exactly its type. Writes to one
/// destination keep the order their calls were made in. A write the run's stdout refuses because its
/// reader closed the pipe cancels the run with the reason `ClosedPipe`, and the run exits 141; the
/// call returns the cancellation echo, which ends the action silently when it propagates. Any other
/// failed write returns its error, and the run exits 1.
pub struct Out<R = NoResult> {
    pub(crate) run: Arc<crate::__private::RunState>,
    pub(crate) channel: Arc<Channel>,
    pub(crate) _result: PhantomData<fn() -> R>,
}

impl<R> Clone for Out<R> {
    fn clone(&self) -> Self {
        Self {
            run: Arc::clone(&self.run),
            channel: Arc::clone(&self.channel),
            _result: PhantomData,
        }
    }
}

impl<R> Out<R> {
    fn output(&self) -> &Arc<Output> {
        &self.run.output
    }

    /// Prints a message to stdout, or to stderr from the action of a Command that declares a result.
    pub fn print<'a>(
        &'a self,
        message: impl Into<Message<'a>>,
    ) -> impl Future<Output = Result<(), Error>> + Send + 'a {
        self.output()
            .emit(Lane::Print, message.into(), self.channel.destination)
    }

    /// Writes an informational message to stderr, hidden at verbosity -1.
    pub fn info<'a>(
        &'a self,
        message: impl Into<Message<'a>>,
    ) -> impl Future<Output = Result<(), Error>> + Send + 'a {
        self.output()
            .emit(Lane::Info, message.into(), Stream::Stderr)
    }

    /// Writes a success message to stderr, hidden at verbosity -1.
    pub fn success<'a>(
        &'a self,
        message: impl Into<Message<'a>>,
    ) -> impl Future<Output = Result<(), Error>> + Send + 'a {
        self.output()
            .emit(Lane::Success, message.into(), Stream::Stderr)
    }

    /// Writes a warning to stderr at every verbosity.
    pub fn warn<'a>(
        &'a self,
        message: impl Into<Message<'a>>,
    ) -> impl Future<Output = Result<(), Error>> + Send + 'a {
        self.output()
            .emit(Lane::Warn, message.into(), Stream::Stderr)
    }

    /// Writes an error message to stderr at every verbosity.
    pub fn error<'a>(
        &'a self,
        message: impl Into<Message<'a>>,
    ) -> impl Future<Output = Result<(), Error>> + Send + 'a {
        self.output()
            .emit(Lane::Error, message.into(), Stream::Stderr)
    }

    /// Renders `data` where `print` writes, adding no line break: a whole view with a reference to
    /// its data, rendered now, or a row view with a row source, written row by row as the source
    /// yields. The application's override applies to a declared view. A view's `Err` is this
    /// call's, and nothing is written for a whole view that fails; a sequence that stops early leaves
    /// the rows it wrote and an incomplete-result line on stderr.
    pub async fn render<Data, V: Render<Data>>(&self, data: Data, view: &V) -> Result<(), Error> {
        let site = crate::__private::RenderSite {
            output: Arc::clone(self.output()),
            destination: self.channel.destination,
            _call: PhantomData,
        };
        view.prepare(data, &site).0.await
    }

    /// Draws `data` on stderr through a whole view, adding no newline, and returns the terminal rows
    /// it took at stderr's real width: its line breaks, plus the rows each line wraps onto. On a
    /// terminal that redraws in place, the text's terminal control sequences are kept for this call.
    pub async fn draw<D: ?Sized + Sync + 'static, V: WholeView<D>>(
        &self,
        data: &D,
        view: &V,
    ) -> Result<usize, Error> {
        let (identity, view) = view.whole();
        self.output().draw(identity, view, data).await
    }

    /// The text `render` would write now, without writing it. A view whose render function returns
    /// an `Err` returns that error.
    pub fn text<D: ?Sized + 'static, V: WholeView<D>>(
        &self,
        data: &D,
        view: &V,
    ) -> Result<String, Error> {
        let (identity, view) = view.whole();
        self.output()
            .render_whole(self.channel.destination, identity, view, data)
    }

    /// Opens a live region at the bottom of stderr, below every region already open. A region the
    /// action opens and leaves open closes with `Completion` when the action returns, and with
    /// `Failure` when it fails.
    #[must_use]
    pub fn region(&self, options: RegionOptions) -> Region {
        Region::open(self.output(), options, Some(&self.channel.regions))
    }

    /// Lends the terminal to `work`, such as a child program that draws on it: core holds every live
    /// region's frame until the work settles, then draws the stack again below what it wrote.
    ///
    /// The lend takes its place in stderr's order when this is called, so a failure report and the
    /// incomplete-result line wait for it even before the returned future is first polled, as when
    /// the future is handed to `tokio::spawn`. Core ends the row the last write left the cursor on
    /// before it calls `work`, and once `work` settles it writes one line break and draws every
    /// open region below what the work wrote. A write through `out` during the lend is not held.
    /// The lend changes no terminal mode: the caller leaves raw mode and starts the child with
    /// inherited stdin.
    pub fn lend_terminal<'w, T, Fut>(
        &self,
        work: impl FnOnce() -> Fut + Send + 'w,
    ) -> impl Future<Output = T> + Send + 'w
    where
        Fut: Future<Output = T> + Send + 'w,
        T: Send + 'w,
    {
        self.output().lend(work)
    }

    /// The `FatalError` with `message`, for the action to return: `return Err(out.fatal(...))`.
    /// It writes nothing itself; the failure path prints its message once.
    pub fn fatal(&self, message: impl Into<String>) -> Error {
        FatalError::new(message).into()
    }
}

impl<V: serde::Serialize + Send + Sync + 'static> Out<ValueResult<V>> {
    /// Emits the declared result through the selected view, once, to stdout with no line break
    /// added. A second call writes nothing and returns `ResultError`.
    pub async fn results(&self, value: V) -> Result<(), Error> {
        self.output().results_value(&self.channel, value).await
    }
}

impl<Row: serde::Serialize + Send + Sync + 'static> Out<RowsResult<Row>> {
    /// Emits the declared rows through the selected view, once, to stdout: row by row under a row
    /// view, and once at the end of the source under a whole view. A second call writes nothing and
    /// returns `ResultError`.
    pub async fn results(&self, rows: impl Into<RowSource<Row>>) -> Result<(), Error> {
        self.output().results_rows(&self.channel, rows.into()).await
    }
}
