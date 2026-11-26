//! Views, declared views, overrides, and the view context.

use std::any::TypeId;
use std::sync::Arc;

use crate::failures::{Error, Failure, FailureClass, FailureKey, FailureView, FailureViewContext};
use crate::marks::Background;
use crate::style::{ContextualStyle, Glyph, Renderer};

use super::{RowSource, messages};

/// What a view reads beside its data: the destination's width, background, and style, and the
/// measuring and laying-out operations of the destination it renders for.
#[derive(Clone)]
#[non_exhaustive]
pub struct ViewContext {
    /// The terminal's background, when settled.
    pub background: Option<Background>,
    /// The destination's width in columns, read just before the call; `None` for a pipe.
    pub columns: Option<u16>,
    /// The style, resolved for the destination.
    pub style: ContextualStyle,
    /// The destination's capabilities and palette, which the operations below measure under.
    pub(crate) renderer: Renderer,
}

impl ViewContext {
    /// A context over one destination's renderer, with its width and the run's background.
    pub(crate) fn new(
        background: Option<Background>,
        columns: Option<u16>,
        style: ContextualStyle,
        renderer: Renderer,
    ) -> Self {
        Self {
            background,
            columns,
            style,
            renderer,
        }
    }

    /// Expands tabs to the next tab stop, a multiple of eight counted from each line's start.
    #[must_use]
    pub fn expand_tabs(&self, text: &str) -> String {
        self.renderer.expand_tabs(text)
    }

    /// `text` without its style markup: no color, modifier, hyperlink, or terminal control, with the
    /// destination's glyph forms.
    #[must_use]
    pub fn plain(&self, text: &str) -> String {
        self.renderer.plain(text)
    }

    /// The display width of `text`, markup excluded: its widest line.
    #[must_use]
    pub fn width(&self, text: &str) -> usize {
        self.renderer.width(text)
    }

    /// `text` wrapped to `columns`, or unwrapped when `None`. Zero columns leave it unwrapped too.
    #[must_use]
    pub fn wrap(&self, text: &str, columns: Option<u16>) -> String {
        match columns.filter(|columns| *columns > 0) {
            None => text.to_owned(),
            Some(columns) => self
                .renderer
                .wrap(text, Some(usize::from(columns)))
                .unwrap_or_else(|_| text.to_owned()),
        }
    }
}

/// What a render function returns: the text, as a `String`, or a `Result` of it whose `Err` is
/// the view's failure. A view that fails takes the ordinary failure path from the write site that
/// called it: `out.render` and `out.text` return the error, and a failure view or encoder that fails
/// is a defect after core wrote the failure's default text.
pub trait IntoRendered {
    /// The text, or the view's failure.
    fn into_rendered(self) -> Result<String, Error>;
}

impl IntoRendered for String {
    fn into_rendered(self) -> Result<String, Error> {
        Ok(self)
    }
}

impl<E: Into<Error>> IntoRendered for Result<String, E> {
    fn into_rendered(self) -> Result<String, Error> {
        self.map_err(Into::into)
    }
}

/// A view: renders data of type `D` as marked text.
#[must_use]
pub struct View<D: ?Sized> {
    pub(crate) render: crate::__private::RenderFn<D, ViewContext>,
    pub(crate) media_type: Option<String>,
}

impl<D: ?Sized + 'static> View<D> {
    /// A view from its render function, which returns the text or a `Result` of it.
    pub fn new<T: IntoRendered>(
        render: impl Fn(&D, &ViewContext) -> T + Send + Sync + 'static,
    ) -> Self {
        Self {
            render: Arc::new(move |data, context| render(data, context).into_rendered()),
            media_type: None,
        }
    }

    /// Declares the media type of the text it writes, such as `application/json`.
    pub fn media_type(mut self, media_type: impl Into<String>) -> Self {
        self.media_type = Some(media_type.into());
        self
    }
}

impl<D: ?Sized> View<D> {
    /// Calls the view's own render function with `data` and `context`, as a test of the view does
    /// with a context `loomcli_testing::view_context` builds. No view registry is read and nothing
    /// is written: the result is the function's text or its `Err`.
    pub fn render(&self, data: &D, context: &ViewContext) -> Result<String, Error> {
        (self.render)(data, context)
    }
}

impl<D: ?Sized> Clone for View<D> {
    fn clone(&self) -> Self {
        Self {
            render: Arc::clone(&self.render),
            media_type: self.media_type.clone(),
        }
    }
}

type RowFn<R> = Arc<dyn Fn(&R, usize, &ViewContext) -> Result<String, Error> + Send + Sync>;
type HeadFn = Arc<dyn Fn(&ViewContext) -> Result<String, Error> + Send + Sync>;
type TailFn = Arc<dyn Fn(usize, &ViewContext) -> Result<String, Error> + Send + Sync>;

/// A row view: renders a sequence one row at a time, with an optional head and tail.
#[must_use]
pub struct RowView<R> {
    pub(crate) row: RowFn<R>,
    pub(crate) head: Option<HeadFn>,
    pub(crate) tail: Option<TailFn>,
    pub(crate) media_type: Option<String>,
}

impl<R: 'static> RowView<R> {
    /// A row view from its row function, which receives the row and its index and returns the text
    /// or a `Result` of it.
    pub fn new<T: IntoRendered>(
        row: impl Fn(&R, usize, &ViewContext) -> T + Send + Sync + 'static,
    ) -> Self {
        Self {
            row: Arc::new(move |data, index, context| row(data, index, context).into_rendered()),
            head: None,
            tail: None,
            media_type: None,
        }
    }

    /// Writes `head` before the first row.
    pub fn head<T: IntoRendered>(
        mut self,
        head: impl Fn(&ViewContext) -> T + Send + Sync + 'static,
    ) -> Self {
        self.head = Some(Arc::new(move |context| head(context).into_rendered()));
        self
    }

    /// Writes `tail`, which receives the row count, after the last row.
    pub fn tail<T: IntoRendered>(
        mut self,
        tail: impl Fn(usize, &ViewContext) -> T + Send + Sync + 'static,
    ) -> Self {
        self.tail = Some(Arc::new(move |count, context| {
            tail(count, context).into_rendered()
        }));
        self
    }

    /// Declares the media type of the text it writes.
    pub fn media_type(mut self, media_type: impl Into<String>) -> Self {
        self.media_type = Some(media_type.into());
        self
    }
}

impl<R> RowView<R> {
    /// Calls the view's head function with `context`; the empty string for a view that declares no
    /// head, which writes nothing. No view registry is read.
    pub fn render_head(&self, context: &ViewContext) -> Result<String, Error> {
        self.head
            .as_ref()
            .map_or_else(|| Ok(String::new()), |head| head(context))
    }

    /// Calls the view's row function with `row`, its index in the sequence, and `context`.
    pub fn render_row(
        &self,
        row: &R,
        index: usize,
        context: &ViewContext,
    ) -> Result<String, Error> {
        (self.row)(row, index, context)
    }

    /// Calls the view's tail function with the row count and `context`; the empty string for a view
    /// that declares no tail.
    pub fn render_tail(&self, count: usize, context: &ViewContext) -> Result<String, Error> {
        self.tail
            .as_ref()
            .map_or_else(|| Ok(String::new()), |tail| tail(count, context))
    }
}

impl<R> Clone for RowView<R> {
    fn clone(&self) -> Self {
        Self {
            row: Arc::clone(&self.row),
            head: self.head.clone(),
            tail: self.tail.clone(),
            media_type: self.media_type.clone(),
        }
    }
}

/// A view with an identity, which an application or a plugin can override.
#[must_use]
pub struct DeclaredView<D: ?Sized> {
    pub(crate) identity: Arc<str>,
    pub(crate) view: View<D>,
}

impl<D: ?Sized> DeclaredView<D> {
    /// The identity.
    #[must_use]
    pub fn identity(&self) -> &str {
        &self.identity
    }

    /// Calls the declared render function, as [`View::render`] does: an application's override of
    /// this identity is not read, because a test of the view holds no registry.
    pub fn render(&self, data: &D, context: &ViewContext) -> Result<String, Error> {
        self.view.render(data, context)
    }
}

impl<D: ?Sized> Clone for DeclaredView<D> {
    fn clone(&self) -> Self {
        Self {
            identity: Arc::clone(&self.identity),
            view: self.view.clone(),
        }
    }
}

/// A row view with an identity.
#[must_use]
pub struct DeclaredRowView<R> {
    pub(crate) identity: Arc<str>,
    pub(crate) view: RowView<R>,
}

impl<R> DeclaredRowView<R> {
    /// The identity.
    #[must_use]
    pub fn identity(&self) -> &str {
        &self.identity
    }

    /// Calls the declared head function, as [`RowView::render_head`] does; no override is read.
    pub fn render_head(&self, context: &ViewContext) -> Result<String, Error> {
        self.view.render_head(context)
    }

    /// Calls the declared row function, as [`RowView::render_row`] does; no override is read.
    pub fn render_row(
        &self,
        row: &R,
        index: usize,
        context: &ViewContext,
    ) -> Result<String, Error> {
        self.view.render_row(row, index, context)
    }

    /// Calls the declared tail function, as [`RowView::render_tail`] does; no override is read.
    pub fn render_tail(&self, count: usize, context: &ViewContext) -> Result<String, Error> {
        self.view.render_tail(count, context)
    }
}

impl<R> Clone for DeclaredRowView<R> {
    fn clone(&self) -> Self {
        Self {
            identity: Arc::clone(&self.identity),
            view: self.view.clone(),
        }
    }
}

/// A view definition that `view()` can declare: a whole view or a row view.
pub trait Declare {
    /// The declared form.
    type Declared;
    /// Declares it under `identity`.
    fn declare(self, identity: &str) -> Self::Declared;
}

impl<D: ?Sized + 'static> Declare for View<D> {
    type Declared = DeclaredView<D>;
    fn declare(self, identity: &str) -> DeclaredView<D> {
        DeclaredView {
            identity: Arc::from(identity),
            view: self,
        }
    }
}

impl<R: 'static> Declare for RowView<R> {
    type Declared = DeclaredRowView<R>;
    fn declare(self, identity: &str) -> DeclaredRowView<R> {
        DeclaredRowView {
            identity: Arc::from(identity),
            view: self,
        }
    }
}

/// Declares a view under `identity`, so it can be overridden. The identity follows the plugin
/// identity convention, such as `@loomcli/plugins/help/page`. A declared view is its identity and its
/// shape and data type: two declarations of one identity with one view type are one view, so an
/// override keyed by either reaches both.
#[track_caller]
pub fn view<V: Declare>(identity: &str, definition: V) -> V::Declared {
    definition.declare(identity)
}

/// A declared view of either shape with its data type erased, as a plugin's `views` list holds it:
/// its identity, and the type of the view it declares, which tells two copies of one identity apart.
#[derive(Clone)]
pub struct AnyDeclaredView {
    pub(crate) identity: Arc<str>,
    pub(crate) data: TypeId,
}

impl<D: ?Sized + 'static> From<DeclaredView<D>> for AnyDeclaredView {
    fn from(view: DeclaredView<D>) -> Self {
        Self {
            identity: view.identity,
            data: TypeId::of::<View<D>>(),
        }
    }
}

impl<R: 'static> From<DeclaredRowView<R>> for AnyDeclaredView {
    fn from(view: DeclaredRowView<R>) -> Self {
        Self {
            identity: view.identity,
            data: TypeId::of::<RowView<R>>(),
        }
    }
}

/// A failure view with its class erased: it renders a failure of its class or of a class that
/// extends it, reading the failure as its own class.
pub(crate) type ErasedFailureView =
    Arc<dyn Fn(&dyn Failure, &FailureViewContext) -> Option<Result<String, Error>> + Send + Sync>;

/// A replacement view for one key, made by [`override_view`].
#[derive(Clone)]
pub struct ViewOverride {
    pub(crate) key: OverrideIdentity,
    pub(crate) replacement: Arc<dyn std::any::Any + Send + Sync>,
}

/// What one override replaces: a declared view, by its identity and the type of the view it
/// declares, or a failure class, with its view erased for the failure path.
#[derive(Clone)]
pub(crate) enum OverrideIdentity {
    View {
        identity: Arc<str>,
        data: TypeId,
    },
    Failure {
        class: &'static FailureClass,
        render: ErasedFailureView,
    },
}

/// A key `override_view` replaces: a declared view, a declared row view, or a failure class.
pub trait OverrideKey {
    /// The view that replaces it.
    type Replacement;
    #[doc(hidden)]
    fn override_with(self, replacement: Self::Replacement) -> ViewOverride;
}

impl<D: ?Sized + 'static> OverrideKey for DeclaredView<D> {
    type Replacement = View<D>;
    fn override_with(self, replacement: View<D>) -> ViewOverride {
        ViewOverride {
            key: OverrideIdentity::View {
                identity: self.identity,
                data: TypeId::of::<View<D>>(),
            },
            replacement: Arc::new(replacement),
        }
    }
}

impl<R: 'static> OverrideKey for DeclaredRowView<R> {
    type Replacement = RowView<R>;
    fn override_with(self, replacement: RowView<R>) -> ViewOverride {
        ViewOverride {
            key: OverrideIdentity::View {
                identity: self.identity,
                data: TypeId::of::<RowView<R>>(),
            },
            replacement: Arc::new(replacement),
        }
    }
}

impl<F: Failure> OverrideKey for FailureKey<F> {
    type Replacement = FailureView<F>;
    fn override_with(self, replacement: FailureView<F>) -> ViewOverride {
        let render = Arc::clone(&replacement.render);
        let erased: ErasedFailureView = Arc::new(move |failure, context| {
            failure
                .downcast_ref::<F>()
                .map(|failure| render(failure, context))
        });
        ViewOverride {
            key: OverrideIdentity::Failure {
                class: F::failure_class(),
                render: erased,
            },
            replacement: Arc::new(replacement),
        }
    }
}

/// Replaces the view of `key`: a declared view's function, or the view of a failure class and the
/// classes that extend it. One operation for every key kind; the key decides the replacement's type.
#[track_caller]
pub fn override_view<K: OverrideKey>(key: K, replacement: K::Replacement) -> ViewOverride {
    key.override_with(replacement)
}

/// One entry of a plugin's `views` list: a view it declares, or an override it makes.
#[derive(Clone)]
#[non_exhaustive]
pub enum ViewContribution {
    /// A declared view, which puts its identity on the graph for the duplicate rule.
    Declared(AnyDeclaredView),
    /// An override.
    Override(ViewOverride),
}

impl From<ViewOverride> for ViewContribution {
    fn from(value: ViewOverride) -> Self {
        ViewContribution::Override(value)
    }
}

impl<D: ?Sized + 'static> From<DeclaredView<D>> for ViewContribution {
    fn from(value: DeclaredView<D>) -> Self {
        ViewContribution::Declared(value.into())
    }
}

impl<R: 'static> From<DeclaredRowView<R>> for ViewContribution {
    fn from(value: DeclaredRowView<R>) -> Self {
        ViewContribution::Declared(value.into())
    }
}

/// A whole view over `D`: a bare view or a declared one. `out.draw`, `out.text`, and a region take it.
pub trait WholeView<D: ?Sized> {
    #[doc(hidden)]
    fn whole(&self) -> (Option<&str>, &View<D>);
}

impl<D: ?Sized> WholeView<D> for View<D> {
    fn whole(&self) -> (Option<&str>, &View<D>) {
        (None, self)
    }
}

impl<D: ?Sized> WholeView<D> for DeclaredView<D> {
    fn whole(&self) -> (Option<&str>, &View<D>) {
        (Some(&self.identity), &self.view)
    }
}

/// What `out.render` takes: a whole view with a reference to its data, or a row view with a row
/// source. One operation over both shapes.
pub trait Render<Data> {
    #[doc(hidden)]
    fn prepare(
        &self,
        data: Data,
        site: &crate::__private::RenderSite<'_>,
    ) -> crate::__private::Prepared;
}

impl<'a, D: ?Sized + Sync + 'static> Render<&'a D> for View<D> {
    fn prepare(
        &self,
        data: &'a D,
        site: &crate::__private::RenderSite<'_>,
    ) -> crate::__private::Prepared {
        site.whole(None, self, data)
    }
}

impl<'a, D: ?Sized + Sync + 'static> Render<&'a D> for DeclaredView<D> {
    fn prepare(
        &self,
        data: &'a D,
        site: &crate::__private::RenderSite<'_>,
    ) -> crate::__private::Prepared {
        site.whole(Some(&self.identity), &self.view, data)
    }
}

/// A list view over `[T]` renders a `&Vec<T>` too, so `out.render(&rows, &view)` needs no
/// `.as_slice()`.
impl<'a, T: Sync + 'static> Render<&'a Vec<T>> for View<[T]> {
    fn prepare(
        &self,
        data: &'a Vec<T>,
        site: &crate::__private::RenderSite<'_>,
    ) -> crate::__private::Prepared {
        site.whole(None, self, data.as_slice())
    }
}

impl<'a, T: Sync + 'static> Render<&'a Vec<T>> for DeclaredView<[T]> {
    fn prepare(
        &self,
        data: &'a Vec<T>,
        site: &crate::__private::RenderSite<'_>,
    ) -> crate::__private::Prepared {
        site.whole(Some(&self.identity), &self.view, data.as_slice())
    }
}

impl<R: Send + 'static, S: Into<RowSource<R>>> Render<S> for RowView<R> {
    fn prepare(
        &self,
        data: S,
        site: &crate::__private::RenderSite<'_>,
    ) -> crate::__private::Prepared {
        site.rows(None, self, data.into())
    }
}

impl<R: Send + 'static, S: Into<RowSource<R>>> Render<S> for DeclaredRowView<R> {
    fn prepare(
        &self,
        data: S,
        site: &crate::__private::RenderSite<'_>,
    ) -> crate::__private::Prepared {
        site.rows(Some(&self.identity), &self.view, data.into())
    }
}

/// The identity prefix core's own views take, the package name by the plugin identity convention.
const CORE: &str = "@loomcli/core";

/// The message laid out right of a gutter `width` columns wide: on a terminal its tabs expand to
/// spaces first, so the gutter cannot move a tab stop, and it wraps at the columns right of the
/// gutter when any are left, each continuation line indented under the message. Off a terminal it
/// is unchanged.
fn under_gutter(message: &str, context: &ViewContext, width: usize) -> String {
    let Some(columns) = context.columns else {
        return indented(message, width);
    };
    let laid = context.expand_tabs(message);
    let room = usize::from(columns).saturating_sub(width);
    let wrapped = match u16::try_from(room) {
        Ok(room) if room > 0 => context.wrap(&laid, Some(room)),
        _ => laid,
    };
    indented(&wrapped, width)
}

/// `text` with `width` spaces after each line break that does not end it.
fn indented(text: &str, width: usize) -> String {
    let gutter = " ".repeat(width);
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('\n') {
        out.push_str(&rest[..=at]);
        rest = &rest[at + 1..];
        if !rest.is_empty() {
            out.push_str(&gutter);
        }
    }
    out.push_str(rest);
    out
}

/// The glyph and token one marked lane opens its first line with; `warn` marks it `warning`.
#[derive(Clone, Copy)]
enum Mark {
    Info,
    Success,
    Warning,
    Error,
}

/// The default function of a marked lane: the matching glyph and one space before the first line,
/// and continuation lines indented by the measured gutter without repeating the glyph. The semantic
/// method appends the newline, so the view returns none.
fn marked(mark: Mark) -> View<str> {
    View::new(move |message: &str, context: &ViewContext| {
        let (glyph, token) = match mark {
            Mark::Info => (Glyph::Info, context.style.info()),
            Mark::Success => (Glyph::Success, context.style.success()),
            Mark::Warning => (Glyph::Warning, context.style.warning()),
            Mark::Error => (Glyph::Error, context.style.error()),
        };
        let glyph = glyph.to_string();
        let body = under_gutter(message, context, context.width(&glyph) + 1);
        format!("{} {body}", token.apply(&glyph))
    })
}

/// The default function of the debug or the trace lane: the gutter's indent, its glyph, and one
/// space before the first line, continuation lines indented under the message, and the glyph and
/// the message both in the gutter's fade, so the line reads quieter than info. A trace line nests
/// one step under a debug line and fades past it, `faint` over `dim`.
fn guttered(trace: bool) -> View<str> {
    View::new(move |message: &str, context: &ViewContext| {
        let (indent, glyph, fade) = if trace {
            (2, Glyph::LineVerticalDashed0, context.style.dim().faint())
        } else {
            (0, Glyph::PointerSmall, context.style.dim())
        };
        let glyph = glyph.to_string();
        let body = under_gutter(message, context, indent + context.width(&glyph) + 1);
        format!(
            "{}{} {}",
            " ".repeat(indent),
            fade.apply(&glyph),
            fade.apply(&body)
        )
    })
}

/// One lane view over the original message string, line breaks and authored styles included.
fn lane(name: &str, view: View<str>) -> DeclaredView<str> {
    view.declare(&format!("{CORE}/lanes/{name}"))
}

/// Core's seven lane views, declared once.
struct Lanes {
    print: DeclaredView<str>,
    info: DeclaredView<str>,
    success: DeclaredView<str>,
    warn: DeclaredView<str>,
    error: DeclaredView<str>,
    debug: DeclaredView<str>,
    trace: DeclaredView<str>,
}

static LANES: std::sync::LazyLock<Lanes> = std::sync::LazyLock::new(|| Lanes {
    print: lane(
        "print",
        View::new(|message: &str, _: &ViewContext| message.to_owned()),
    ),
    info: lane("info", marked(Mark::Info)),
    success: lane("success", marked(Mark::Success)),
    warn: lane("warn", marked(Mark::Warning)),
    error: lane("error", marked(Mark::Error)),
    debug: lane("debug", guttered(false)),
    trace: lane("trace", guttered(true)),
});

/// Core's lane views, each a declared view over the message, overridable like any other. An
/// application replaces the function of any of them through `overrides`, and the replacement owns
/// the gutter the default supplies. A lane view returns no line break: the semantic method appends
/// one after it.
pub mod lanes {
    use super::{DeclaredView, LANES};

    /// The `print` lane, `@loomcli/core/lanes/print`: the message unchanged.
    pub fn print() -> DeclaredView<str> {
        LANES.print.clone()
    }

    /// The `info` lane, `@loomcli/core/lanes/info`: the info glyph and one space.
    pub fn info() -> DeclaredView<str> {
        LANES.info.clone()
    }

    /// The `success` lane, `@loomcli/core/lanes/success`: the success glyph and one space.
    pub fn success() -> DeclaredView<str> {
        LANES.success.clone()
    }

    /// The `warn` lane, `@loomcli/core/lanes/warn`: the warning glyph and one space.
    pub fn warn() -> DeclaredView<str> {
        LANES.warn.clone()
    }

    /// The `error` lane, `@loomcli/core/lanes/error`: the error glyph and one space.
    pub fn error() -> DeclaredView<str> {
        LANES.error.clone()
    }

    /// The `debug` lane, `@loomcli/core/lanes/debug`: a dim pointer and message, from verbosity 1.
    pub fn debug() -> DeclaredView<str> {
        LANES.debug.clone()
    }

    /// The `trace` lane, `@loomcli/core/lanes/trace`: indented two columns, dim and faint, from
    /// verbosity 2.
    pub fn trace() -> DeclaredView<str> {
        LANES.trace.clone()
    }
}

/// The facts of a sequence that stopped early: the routed path, the rows yielded, and the rows
/// written.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct IncompleteResult {
    /// The routed path.
    pub path: Vec<String>,
    /// Rows the source yielded, one an in-flight request delivered after the stop included.
    pub yielded: usize,
    /// Rows written; zero under a whole view.
    pub written: usize,
}

static INCOMPLETE: std::sync::LazyLock<DeclaredView<IncompleteResult>> =
    std::sync::LazyLock::new(|| {
        View::new(|facts: &IncompleteResult, _: &ViewContext| {
            format!(
                "{}\n",
                messages::incomplete_output(&facts.path, facts.yielded, facts.written)
            )
        })
        .declare(&format!("{CORE}/results/incomplete"))
    });

/// The declared view of the line a sequence that stopped early writes on stderr,
/// `@loomcli/core/results/incomplete`. An override that returns the empty string silences it.
pub fn incomplete_result() -> DeclaredView<IncompleteResult> {
    INCOMPLETE.clone()
}

/// Every view core declares, so a registry holds their identities from the start.
pub(crate) fn core_views() -> Vec<AnyDeclaredView> {
    let lanes = &*LANES;
    vec![
        lanes.print.clone().into(),
        lanes.info.clone().into(),
        lanes.success.clone().into(),
        lanes.warn.clone().into(),
        lanes.error.clone().into(),
        lanes.debug.clone().into(),
        lanes.trace.clone().into(),
        INCOMPLETE.clone().into(),
    ]
}
