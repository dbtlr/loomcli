//! The box view: text, or the output of another view, inside a rounded frame with an optional
//! title. `box` is a Rust keyword, so the module and the factory are `boxed`.
//!
//! A top border, one line per content line, and a bottom border, every border piece `dim`, with the
//! title `primary` and `bold` in the top border. With no content the box frames its text, wrapped
//! on a terminal at `columns` minus 4. With content the box renders the content's view with
//! `columns` narrowed by the frame, so a table framed in a box shrinks to fit inside it. Text, or
//! content, that resolves to no character prints nothing. Nothing is installed: the value is a
//! bare pack view.

use std::fmt;

use loomcli_core::style::{Alignment, Glyph, split_lines};
use loomcli_core::{DeclaredView, View, ViewContext};

use crate::layout::{NARROWEST, blank, line_glyphs, padded, terminal_wrap};

/// The columns a frame takes from a line: a border and a space on each side.
const FRAME: u16 = 4;
/// The columns beside a content line's width that run between the corners: one space each side.
const SIDES: usize = 2;
/// The columns a title adds to the inner width: the space after it and at least one line.
const TITLE_ROOM: usize = 2;
/// The columns a title takes from the top border besides its own: a line, a space, and a space.
const TITLE_FRAME: usize = 3;

/// What a box frames: a bare view, or a declared view's own default, which no override reaches
/// inside a box.
pub trait BoxContent<D: ?Sized> {
    /// The view the box calls.
    fn into_view(self) -> View<D>;
}

impl<D: ?Sized> BoxContent<D> for View<D> {
    fn into_view(self) -> View<D> {
        self
    }
}

impl<D: ?Sized + 'static> BoxContent<D> for DeclaredView<D>
where
    DeclaredView<D>: Send + Sync,
{
    fn into_view(self) -> View<D> {
        View::new(move |data: &D, context: &ViewContext| self.render(data, context))
    }
}

/// The box view's configuration: the title and the content view. `D` is the data the box renders,
/// `str` for a box that frames its text.
#[must_use]
pub struct BoxConfig<D: ?Sized = str> {
    title: Option<String>,
    content: View<D>,
}

impl BoxConfig<str> {
    /// No title, framing its text, for `out.render`.
    pub fn new() -> Self {
        Self::text()
    }
}

impl<D: AsRef<str> + ?Sized + 'static> BoxConfig<D> {
    /// No title, framing its text: `BoxConfig::<String>::text()` for the views of a
    /// `ValueResult<String>`, where [`BoxConfig::new`] frames a `str`.
    pub fn text() -> Self {
        Self {
            title: None,
            content: framed_text(),
        }
    }
}

impl Default for BoxConfig<str> {
    fn default() -> Self {
        Self::new()
    }
}

impl<D: ?Sized> BoxConfig<D> {
    /// Sets the title, marked text its author owns, which the box styles `primary` and `bold`.
    pub fn title(self, title: impl Into<String>) -> Self {
        Self {
            title: Some(title.into()),
            ..self
        }
    }

    /// Frames the output of `content`, a bare view or a declared view, over the content's data.
    pub fn content<E: ?Sized>(self, content: impl BoxContent<E>) -> BoxConfig<E> {
        BoxConfig {
            title: self.title,
            content: content.into_view(),
        }
    }
}

impl<D: ?Sized> Clone for BoxConfig<D> {
    fn clone(&self) -> Self {
        Self {
            title: self.title.clone(),
            content: self.content.clone(),
        }
    }
}

impl<D: ?Sized> fmt::Debug for BoxConfig<D> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("BoxConfig")
            .field("title", &self.title)
            .finish_non_exhaustive()
    }
}

/// The text a box with no content frames. On a terminal its tabs expand and it wraps at the
/// columns the box offers.
fn framed_text<D: AsRef<str> + ?Sized + 'static>() -> View<D> {
    View::new(|text: &D, context: &ViewContext| {
        terminal_wrap(text.as_ref(), context, context.columns.map(i64::from))
    })
}

/// The context a box hands its content: its own, with `columns` narrowed by the frame.
fn inner_context(context: &ViewContext) -> ViewContext {
    let mut inner = context.clone();
    inner.columns = context.columns.map(|columns| {
        columns
            .saturating_sub(FRAME)
            .max(u16::try_from(NARROWEST).unwrap_or(1))
    });
    inner
}

/// The top border, which carries the title, when there is one, styled `primary` and `bold`.
fn top_border(context: &ViewContext, inner: usize, title: Option<&str>) -> String {
    let dim = context.style.dim();
    let Some(title) = title else {
        return dim.apply(&format!(
            "{}{}{}",
            Glyph::LineDownRightArc,
            line_glyphs(inner + SIDES),
            Glyph::LineDownLeftArc
        ));
    };
    let rest = (inner + SIDES).saturating_sub(TITLE_FRAME + context.width(title));
    format!(
        "{}{}{}",
        dim.apply(&format!("{}{} ", Glyph::LineDownRightArc, Glyph::Line)),
        context.style.primary().bold().apply(title),
        dim.apply(&format!(" {}{}", line_glyphs(rest), Glyph::LineDownLeftArc)),
    )
}

/// Rendered content in its frame. On a terminal its tabs expand before it is measured, and off one
/// each line's `pad` frame expands them from the line's start, so the right border keeps its
/// column. The inner width is the widest line, or the title's width and two when that is wider.
fn framed(rendered: &str, context: &ViewContext, title: Option<&str>) -> String {
    let laid = terminal_wrap(rendered, context, None);
    let lines = split_lines(&laid);
    let inner = title
        .map_or(0, |title| context.width(title) + TITLE_ROOM)
        .max(context.width(&laid));
    let dim = context.style.dim();
    let side = dim.apply(&Glyph::LineVertical.marked());
    let bottom = dim.apply(&format!(
        "{}{}{}",
        Glyph::LineUpRightArc,
        line_glyphs(inner + SIDES),
        Glyph::LineUpLeftArc
    ));
    let mut written = vec![top_border(context, inner, title)];
    written.extend(
        lines
            .iter()
            .map(|line| format!("{side} {} {side}", padded(line, inner, Alignment::Left))),
    );
    written.push(bottom);
    format!("{}\n", written.join("\n"))
}

/// A view that frames a string, or with [`BoxConfig::content`] the output of another view, in a
/// rounded border with an optional title. `boxed(BoxConfig::new())` frames its text;
/// `boxed(BoxConfig::new().content(table(...)))` frames a table over the table's rows.
pub fn boxed<D: ?Sized + 'static>(config: BoxConfig<D>) -> View<D> {
    let BoxConfig { title, content } = config;
    View::new(move |data: &D, context: &ViewContext| {
        let rendered = content.render(data, &inner_context(context))?;
        Ok::<_, loomcli_core::Error>(if blank(&rendered, context) {
            String::new()
        } else {
            framed(&rendered, context, title.as_deref())
        })
    })
}
