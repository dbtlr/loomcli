//! The heading view: a section heading over its text, at one of two levels.
//!
//! Both levels style the text `dim`; level 1 adds an underline of `glyph.line` as wide as the
//! widest line of the text, and level 2 is the text alone. On a terminal the text expands its tabs
//! and wraps at `columns`, and the underline matches the widest wrapped line. A text that resolves
//! to no character prints nothing. Nothing is installed: the value is a bare pack view.

use loomcli_core::{View, ViewContext};

use crate::layout::{blank, heading_lines, wrapped_lines};

/// A heading's level.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum HeadingLevel {
    /// The text with an underline.
    #[default]
    One,
    /// The text alone.
    Two,
}

/// The heading view's configuration.
#[derive(Clone, Debug, Default)]
#[must_use]
pub struct HeadingConfig {
    level: HeadingLevel,
}

impl HeadingConfig {
    /// Level 1.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the level.
    pub fn level(self, level: HeadingLevel) -> Self {
        Self { level }
    }
}

/// A view that renders a heading over its text, marked text its author owns. `D` is `str` for
/// `out.render`, or `String` for the views of a `ValueResult<String>`.
pub fn heading<D: AsRef<str> + ?Sized + 'static>(config: HeadingConfig) -> View<D> {
    let underlined = config.level == HeadingLevel::One;
    View::new(move |text: &D, context: &ViewContext| {
        let text = text.as_ref();
        if blank(text, context) {
            return String::new();
        }
        let lines = heading_lines(&wrapped_lines(text, context, 0), underlined, context);
        format!("{}\n", lines.join("\n"))
    })
}
