//! The prose view: paragraphs wrapped to the destination.
//!
//! The text prints as its author wrote it, with no styling added, its authored line breaks and
//! blank lines kept. On a terminal it expands its tabs and wraps at `columns`: an input line's
//! leading spaces stay on its first line, and its continuation lines start at column 0. Off a
//! terminal it prints as written, with `\n` added when it does not end in a line break. A text
//! that resolves to no character prints nothing. Nothing is installed: the value is a bare pack
//! view.

use loomcli_core::{View, ViewContext};

use crate::layout::{blank, wrapped_lines};

/// A view that wraps prose, marked text its author owns. `D` is `str` for `out.render`, or
/// `String` for the views of a `ValueResult<String>`.
pub fn prose<D: AsRef<str> + ?Sized + 'static>() -> View<D> {
    View::new(|text: &D, context: &ViewContext| {
        let text = text.as_ref();
        if blank(text, context) {
            return String::new();
        }
        if context.columns.is_none() {
            return if context.plain(text).ends_with('\n') {
                text.to_owned()
            } else {
                format!("{text}\n")
            };
        }
        format!("{}\n", wrapped_lines(text, context, 0).join("\n"))
    })
}
