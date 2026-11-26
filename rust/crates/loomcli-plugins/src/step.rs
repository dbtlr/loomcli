//! The step view marks a stage of the work with a pointer and bold text.

use loomcli_core::{Glyph, View, ViewContext};

use crate::layout::{blank, continuation, wrapped_lines};

/// A bare view over marked text. It wraps at the terminal width less the pointer's gutter,
/// aligns continuation lines under the text, and ends a drawn step with a line break. Text that
/// resolves to no characters draws nothing. A step written through `Out::info` is hidden by `-q`.
pub fn step<D: AsRef<str> + ?Sized + 'static>() -> View<D> {
    View::new(|text: &D, context: &ViewContext| {
        let text = text.as_ref();
        if blank(text, context) {
            return String::new();
        }
        let pointer = Glyph::Pointer.to_string();
        let inset = context.width(&pointer) + 1;
        let indent = " ".repeat(inset);
        let bold = |line: &str| {
            if blank(line, context) {
                line.to_owned()
            } else {
                context.style.bold().apply(line)
            }
        };
        let lines = wrapped_lines(text, context, inset);
        let mut lines = lines.iter();
        let first = lines.next().map_or("", String::as_str);
        let mut drawn = format!(
            "{} {}\n",
            context.style.primary().apply(&pointer),
            bold(first)
        );
        for line in lines {
            drawn.push_str(&continuation(&bold(line), &indent, context));
            drawn.push('\n');
        }
        drawn
    })
}
