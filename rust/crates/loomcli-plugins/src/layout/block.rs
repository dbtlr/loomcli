//! The records layout: a label column, a two-space gap, and a value that wraps under itself. The
//! records view prints each row in it, and the table prints its rows in it when its columns cannot
//! fit.

use loomcli_core::ViewContext;
use loomcli_core::style::{Alignment, split_lines};

use super::{blank, continuation, padded, terminal_wrap};

/// The space between the label column and the value.
const GAP: &str = "  ";

/// One labelled value of a record: the label as marked text, and the value to lay out.
pub(crate) struct RecordEntry {
    pub(crate) align: Alignment,
    pub(crate) label: String,
    pub(crate) value: String,
}

/// A value's lines placed within their own widest line, with no padding after any line and none on
/// a blank one.
fn align_lines(lines: Vec<String>, align: Alignment, context: &ViewContext) -> Vec<String> {
    if align == Alignment::Left {
        return lines;
    }
    let widest = lines
        .iter()
        .map(|text| context.width(text))
        .max()
        .unwrap_or(0);
    lines
        .into_iter()
        .map(|text| {
            if blank(&text, context) {
                return text;
            }
            let room = widest.saturating_sub(context.width(&text));
            let before = if align == Alignment::Right {
                room
            } else {
                room / 2
            };
            format!("{}{text}", " ".repeat(before))
        })
        .collect()
}

/// One value's lines. Off a terminal the value is one unit with its authored breaks. On a terminal
/// its tabs expand to spaces from the value's start, so the label column cannot move a tab stop,
/// then it wraps at `room` columns, when any are left, and every line is its own.
fn value_lines(entry: &RecordEntry, room: i64, context: &ViewContext) -> Vec<String> {
    if context.columns.is_none() {
        return vec![entry.value.clone()];
    }
    let wrapped = terminal_wrap(&entry.value, context, (room > 0).then_some(room));
    align_lines(split_lines(&wrapped), entry.align, context)
}

/// The first line of one entry: its label, padded to the label column, the gap, and the value's
/// first line. On a terminal a value line that resolves to no character leaves the line ending at
/// the label, unpadded and with no gap, so the line ends in no space.
fn label_line(
    entry: &RecordEntry,
    label_width: usize,
    text: &str,
    context: &ViewContext,
) -> String {
    let dim = context.style.dim();
    if context.columns.is_some() && blank(text, context) {
        return format!("{}{text}", dim.apply(&entry.label));
    }
    format!(
        "{}{GAP}{text}",
        dim.apply(&padded(&entry.label, label_width, Alignment::Left))
    )
}

/// One record as a block of `LABEL  value` lines, ending with a newline, or the empty string when
/// it has no entry. The labels pad to the widest and style `dim`. On a terminal each value wraps at
/// the columns left after the label column and its gap, every continuation line, authored or
/// wrapped, starts under the value, and a line whose value is empty ends at its label.
pub(crate) fn record_block(entries: &[RecordEntry], context: &ViewContext) -> String {
    if entries.is_empty() {
        return String::new();
    }
    let label_width = entries
        .iter()
        .map(|entry| context.width(&entry.label))
        .max()
        .unwrap_or(0);
    let indent = " ".repeat(label_width + GAP.len());
    let room = i64::from(context.columns.unwrap_or(0))
        - i64::try_from(label_width + GAP.len()).unwrap_or(i64::MAX);
    let lines: Vec<String> = entries
        .iter()
        .flat_map(|entry| {
            value_lines(entry, room, context)
                .into_iter()
                .enumerate()
                .map(|(index, text)| {
                    if index == 0 {
                        label_line(entry, label_width, &text, context)
                    } else {
                        continuation(&text, &indent, context)
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect();
    format!("{}\n", lines.join("\n"))
}
