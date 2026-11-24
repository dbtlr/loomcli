//! Results: what a Command promises to emit, its named views, and row sources.

use std::marker::PhantomData;
use std::pin::Pin;

use futures_core::Stream;
use serde::Serialize;

use std::sync::Arc;

use crate::commands::declaration::{ResultCall, ResultCallKind, ViewEntry};
use crate::failures::Error;

use super::{RowView, View};

/// The result a declaration carries, at the type level: none, one value, or rows.
pub trait ResultKind: Send + Sync + 'static {}

/// No declared result.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoResult;

/// A result of one value of type `V`.
pub struct ValueResult<V>(PhantomData<fn() -> V>);

/// A result of rows of type `R`.
pub struct RowsResult<R>(PhantomData<fn() -> R>);

impl ResultKind for NoResult {}
impl<V: 'static> ResultKind for ValueResult<V> {}
impl<R: 'static> ResultKind for RowsResult<R> {}

/// The named whole views of a value result. The first view is the default unless
/// [`ResultViews::default_view`] names another.
#[must_use]
pub struct ResultViews<V: ?Sized> {
    pub(crate) views: Vec<(String, View<V>)>,
    pub(crate) default: Option<String>,
}

impl<V: ?Sized + Serialize + 'static> ResultViews<V> {
    /// No views yet.
    pub fn new() -> Self {
        Self {
            views: Vec::new(),
            default: None,
        }
    }

    /// Adds a view under `name`.
    #[track_caller]
    pub fn view(mut self, name: &str, view: View<V>) -> Self {
        match self.views.iter_mut().find(|(known, _)| known == name) {
            Some(entry) => entry.1 = view,
            None => self.views.push((name.to_owned(), view)),
        }
        self
    }

    /// Names the default view. A name the record does not hold fails where the result renders.
    #[track_caller]
    pub fn default_view(mut self, name: &str) -> Self {
        self.default = Some(name.to_owned());
        self
    }

    /// The record as one result call of `kind`.
    pub(crate) fn call(self, kind: ResultCallKind) -> ResultCall {
        ResultCall {
            kind,
            entries: self
                .views
                .into_iter()
                .map(|(key, view)| ViewEntry {
                    key,
                    media_type: view.media_type.clone(),
                    view: Arc::new(view),
                })
                .collect(),
            default: self.default,
        }
    }
}

impl<V: ?Sized + Serialize + 'static> Default for ResultViews<V> {
    fn default() -> Self {
        Self::new()
    }
}

/// A view a rows result names: a whole view over all rows, or a row view.
#[non_exhaustive]
pub enum RowViewEntry<R> {
    /// A whole view over the collected rows.
    Whole(View<[R]>),
    /// A row view.
    Row(RowView<R>),
}

impl<R> From<View<[R]>> for RowViewEntry<R> {
    fn from(view: View<[R]>) -> Self {
        RowViewEntry::Whole(view)
    }
}

impl<R> From<RowView<R>> for RowViewEntry<R> {
    fn from(view: RowView<R>) -> Self {
        RowViewEntry::Row(view)
    }
}

/// The named views of a rows result.
#[must_use]
pub struct RowViews<R> {
    pub(crate) views: Vec<(String, RowViewEntry<R>)>,
    pub(crate) default: Option<String>,
}

impl<R: Serialize + 'static> RowViews<R> {
    /// No views yet.
    pub fn new() -> Self {
        Self {
            views: Vec::new(),
            default: None,
        }
    }

    /// Adds a view under `name`.
    #[track_caller]
    pub fn view(mut self, name: &str, view: impl Into<RowViewEntry<R>>) -> Self {
        let view = view.into();
        match self.views.iter_mut().find(|(known, _)| known == name) {
            Some(entry) => entry.1 = view,
            None => self.views.push((name.to_owned(), view)),
        }
        self
    }

    /// Names the default view.
    #[track_caller]
    pub fn default_view(mut self, name: &str) -> Self {
        self.default = Some(name.to_owned());
        self
    }

    /// The record as one result call of `kind`.
    pub(crate) fn call(self, kind: ResultCallKind) -> ResultCall {
        ResultCall {
            kind,
            entries: self
                .views
                .into_iter()
                .map(|(key, view)| {
                    let media_type = match &view {
                        RowViewEntry::Whole(view) => view.media_type.clone(),
                        RowViewEntry::Row(view) => view.media_type.clone(),
                    };
                    ViewEntry {
                        key,
                        media_type,
                        view: Arc::new(view),
                    }
                })
                .collect(),
            default: self.default,
        }
    }
}

impl<R: Serialize + 'static> Default for RowViews<R> {
    fn default() -> Self {
        Self::new()
    }
}

/// A result view with its data type erased, which a lifecycle hook adds to any Command's result:
/// it renders the result as JSON data, so it serves every result type.
#[derive(Clone)]
#[non_exhaustive]
pub enum ResultView {
    /// A whole view over the result's JSON data.
    Whole(View<serde_json::Value>),
    /// A row view over each row's JSON data.
    Row(RowView<serde_json::Value>),
}

impl ResultView {
    /// The media type the view declares.
    pub(crate) fn media_type(&self) -> Option<String> {
        match self {
            ResultView::Whole(view) => view.media_type.clone(),
            ResultView::Row(view) => view.media_type.clone(),
        }
    }
}

impl From<View<serde_json::Value>> for ResultView {
    fn from(view: View<serde_json::Value>) -> Self {
        ResultView::Whole(view)
    }
}

impl From<RowView<serde_json::Value>> for ResultView {
    fn from(view: RowView<serde_json::Value>) -> Self {
        ResultView::Row(view)
    }
}

/// The rows an action emits or renders through a row view, the reference's `Iterable<Row>` or
/// `AsyncIterable<Row>`: any iterator of rows, a `Vec` included, which converts through `From`; an
/// iterator of `Result` rows through [`RowSource::try_iter`]; or a [`Stream`] of `Result` rows
/// through [`RowSource::stream`]. An `Err` item stops the sequence and fails the action, which
/// takes the incomplete-result path when rows were already written.
pub enum RowSource<R> {
    /// Rows from an iterator.
    Iter(Box<dyn Iterator<Item = R> + Send>),
    /// Rows from a stream; an `Err` item stops the sequence and fails the action.
    Stream(Pin<Box<dyn Stream<Item = Result<R, Error>> + Send>>),
}

impl<R: Send + 'static> RowSource<R> {
    /// Rows from any iterator that cannot fail, such as `notes.into_iter().filter(…)`. The same
    /// as the `From` conversion `out.results(rows)` makes.
    pub fn iter<I>(rows: I) -> Self
    where
        I: IntoIterator<Item = R>,
        I::IntoIter: Send + 'static,
    {
        RowSource::Iter(Box::new(rows.into_iter()))
    }

    /// Rows from an iterator whose items may fail, such as lines read one by one: an `Err` item
    /// stops the sequence and fails the action, as a throwing iterator does in the reference.
    pub fn try_iter<I>(rows: I) -> Self
    where
        I: IntoIterator<Item = Result<R, Error>>,
        I::IntoIter: Send + 'static,
    {
        RowSource::stream(TryIter(Box::new(rows.into_iter())))
    }

    /// Rows from a stream, read as the sequence asks for them. [`Stream`] is re-exported from this
    /// crate, so a streaming author needs no other dependency.
    pub fn stream(stream: impl Stream<Item = Result<R, Error>> + Send + 'static) -> Self {
        RowSource::Stream(Box::pin(stream))
    }
}

impl<R: Send + 'static, I> From<I> for RowSource<R>
where
    I: IntoIterator<Item = R>,
    I::IntoIter: Send + 'static,
{
    fn from(rows: I) -> Self {
        RowSource::iter(rows)
    }
}

/// An iterator of `Result` rows read as a stream, each item ready when it is asked for.
struct TryIter<R>(Box<dyn Iterator<Item = Result<R, Error>> + Send>);

impl<R> Stream for TryIter<R> {
    type Item = Result<R, Error>;

    fn poll_next(
        self: Pin<&mut Self>,
        _context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        std::task::Poll::Ready(self.get_mut().0.next())
    }
}
