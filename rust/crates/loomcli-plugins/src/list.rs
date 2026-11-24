//! The list view: items, one per line, with a bullet or a number.
//!
//! [`list`] returns a whole view over the collected items, `View<[T]>`, because an ordered list
//! right-aligns its numbers against the widest among its siblings. Each item is its marker, `dim`,
//! one space, then its text, then its nested items, which start at its text column. On a terminal
//! an item's text wraps and hangs under itself. Nothing is installed: the value is a bare pack
//! view.

use std::fmt;
use std::sync::Arc;

use loomcli_core::{Error, IntoRendered, View, ViewContext};
use serde::Serialize;

use crate::layout::data::text_value;
use crate::layout::{continuation, data_text, item_line, item_markers, wrapped_lines};

/// An item's text function: the item, its index among its siblings, and the context.
type FormatFn<T> = Arc<dyn Fn(&T, usize, &ViewContext) -> Result<String, Error> + Send + Sync>;

/// An item's nested items.
type ChildrenFn<T> = Arc<dyn for<'a> Fn(&'a T) -> &'a [T] + Send + Sync>;

/// The list view's configuration: numbering, an item's text, and an item's nested items. Every
/// part is optional, so `ListConfig::new()` lists strings as they are.
#[must_use]
pub struct ListConfig<T> {
    ordered: bool,
    format: Option<FormatFn<T>>,
    children: Option<ChildrenFn<T>>,
}

impl<T> ListConfig<T> {
    /// Bulleted items, each its `String(item)` escaped and styled `primary`, with no nested items.
    pub fn new() -> Self {
        Self {
            ordered: false,
            format: None,
            children: None,
        }
    }

    /// Numbers the items from 1 at every depth, right-aligned to the widest number among the
    /// siblings, in place of bullets.
    pub fn ordered(self, ordered: bool) -> Self {
        Self { ordered, ..self }
    }

    /// Renders one item's text from the item, its index among its siblings counting from 0, and
    /// the context. The result is marked text its author owns, which the view neither escapes nor
    /// styles; an `Err` fails the view.
    pub fn format<R: IntoRendered>(
        self,
        format: impl Fn(&T, usize, &ViewContext) -> R + Send + Sync + 'static,
    ) -> Self {
        Self {
            format: Some(Arc::new(move |item, index, context| {
                format(item, index, context).into_rendered()
            })),
            ..self
        }
    }

    /// Names an item's nested items; an empty slice is none.
    pub fn children(
        self,
        children: impl for<'a> Fn(&'a T) -> &'a [T] + Send + Sync + 'static,
    ) -> Self {
        Self {
            children: Some(Arc::new(children)),
            ..self
        }
    }
}

impl<T> Default for ListConfig<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> Clone for ListConfig<T> {
    fn clone(&self) -> Self {
        Self {
            ordered: self.ordered,
            format: self.format.clone(),
            children: self.children.clone(),
        }
    }
}

impl<T> fmt::Debug for ListConfig<T> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ListConfig")
            .field("ordered", &self.ordered)
            .field("format", &self.format.is_some())
            .field("children", &self.children.is_some())
            .finish()
    }
}

/// One item's text: the configured `format`, or the default data text.
fn item_text<T: Serialize>(
    config: &ListConfig<T>,
    item: &T,
    index: usize,
    context: &ViewContext,
) -> Result<String, Error> {
    match &config.format {
        Some(format) => format(item, index, context),
        None => Ok(data_text(Some(&text_value(item)?), context)),
    }
}

/// One level of siblings as lines, each item's nested items after it. Markers right-align to the
/// widest among the siblings, and every line of an item's text after its first hangs at the text
/// column, except a blank one, which stays bare. A nested level starts at its parent's text column.
fn level_lines<T: Serialize>(
    items: &[T],
    indent: usize,
    config: &ListConfig<T>,
    context: &ViewContext,
) -> Result<Vec<String>, Error> {
    let markers = item_markers(items.len(), config.ordered.then_some(1), context);
    let margin = " ".repeat(indent);
    let text_column = indent + markers.text_offset;
    let hang = " ".repeat(text_column);
    let mut lines = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let text = item_text(config, item, index, context)?;
        let mut wrapped = wrapped_lines(&text, context, text_column).into_iter();
        let first = wrapped.next().unwrap_or_default();
        let marker = markers.markers.get(index).map_or("", String::as_str);
        lines.push(format!("{margin}{}", item_line(marker, &first, context)));
        lines.extend(wrapped.map(|line| continuation(&line, &hang, context)));
        if let Some(children) = &config.children {
            let nested = children(item);
            if !nested.is_empty() {
                lines.extend(level_lines(nested, text_column, config, context)?);
            }
        }
    }
    Ok(lines)
}

/// A whole view over items, bulleted or numbered, with nested items under their parent's text and
/// every item's text wrapped under itself on a terminal. A default item's text is read from its
/// serialized form. An empty sequence prints nothing. The returned value is a bare pack view and
/// installs nothing.
pub fn list<T: Serialize + 'static>(config: ListConfig<T>) -> View<[T]> {
    View::new(move |items: &[T], context: &ViewContext| {
        let lines = level_lines(items, 0, &config, context)?;
        Ok::<_, Error>(if lines.is_empty() {
            String::new()
        } else {
            format!("{}\n", lines.join("\n"))
        })
    })
}
