//! The rule view: a horizontal line across the destination that carries its text as a label.
//!
//! The rule is `columns` wide on a terminal and 80 wide off one. A text that resolves to no
//! character draws a bare line of `glyph.line`, `dim`. Any other text is the label: two
//! `glyph.line` and a space, `dim`, the label, then a space and `glyph.line` to the rule's width,
//! `dim`. On a terminal a long label wraps, its later lines start under it, and only its last line
//! carries the line after it. Nothing is installed: the value is a bare pack view.

use loomcli_core::{View, ViewContext};

use crate::layout::{blank, continuation, line_glyphs, wrapped_lines};

/// The rule's width where the destination states none.
const OFF_TERMINAL_WIDTH: usize = 80;
/// The line glyphs before a label.
const LEAD_LINES: usize = 2;
/// The space between the label and the line after it.
const TAIL_GAP: &str = " ";
/// The fewest line glyphs after a label.
const SHORTEST_TAIL: usize = 1;

/// A view that draws a rule, labelled by its text, marked text its author owns. `D` is `str` for
/// `out.render`, or `String` for the views of a `ValueResult<String>`.
pub fn rule<D: AsRef<str> + ?Sized + 'static>() -> View<D> {
    View::new(|text: &D, context: &ViewContext| {
        let text = text.as_ref();
        let width = context.columns.map_or(OFF_TERMINAL_WIDTH, usize::from);
        let dim = context.style.dim();
        if blank(text, context) {
            return format!("{}\n", dim.apply(&line_glyphs(width)));
        }
        let lead = dim.apply(&format!("{} ", line_glyphs(LEAD_LINES)));
        // The label's later lines start under it, as far in as the lead is wide.
        let indent = " ".repeat(context.width(&lead));
        // Each label line gives up the columns before it, and a gap and the shortest tail after it.
        let inset = indent.len() + TAIL_GAP.len() + SHORTEST_TAIL;
        let lines = wrapped_lines(text, context, inset);
        let last = lines.len().saturating_sub(1);
        let written: Vec<String> = lines
            .iter()
            .enumerate()
            .map(|(index, line)| {
                if index == 0 && index != last {
                    return format!("{lead}{line}");
                }
                if index != last {
                    return continuation(line, &indent, context);
                }
                let start = if index == 0 { &lead } else { &indent };
                let used = indent.len() + context.width(line) + TAIL_GAP.len();
                let tail = line_glyphs(SHORTEST_TAIL.max(width.saturating_sub(used)));
                format!("{start}{line}{}", dim.apply(&format!("{TAIL_GAP}{tail}")))
            })
            .collect();
        format!("{}\n", written.join("\n"))
    })
}
