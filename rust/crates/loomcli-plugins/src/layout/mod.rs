//! The line layout the pack views share: wrapping a text into lines that stand alone, placing the
//! lines that continue it, measuring the widest unit a wrap keeps whole, a data value as the views
//! print it by default, and the marker column and underline that make a list and a heading look the
//! same wherever they print. The table, the records layout, the list, the heading, the rule, prose,
//! and the box have to agree on how text wraps and continues, so each of them reads it from here.

#[cfg(any(feature = "table", feature = "records"))]
pub(crate) mod block;
#[cfg(any(feature = "table", feature = "records", feature = "list"))]
pub(crate) mod data;
#[cfg(feature = "table")]
pub(crate) mod fit;

use loomcli_core::ViewContext;
use loomcli_core::style::{Alignment, Glyph, escape, pad, split_lines};
use serde_json::Value;

/// The narrowest width text wraps at, so a room that leaves less still breaks at every space.
pub(crate) const NARROWEST: usize = 1;

/// The space between a list marker and its item's text.
const MARKER_GAP: &str = " ";

/// A padding frame around `text`. The width is a measured display width, which no text reaches
/// `2^53` with, so `pad`'s only failure cannot happen; the text unpadded stands in all the same.
pub(crate) fn padded(text: &str, width: usize, align: Alignment) -> String {
    pad(text, width, align).unwrap_or_else(|_| text.to_owned())
}

/// Whether a line resolves to no character at all, whatever frames it holds.
pub(crate) fn blank(text: &str, context: &ViewContext) -> bool {
    context.plain(text).is_empty()
}

/// A continuation line placed under the text it continues, except a blank one, which stays bare.
pub(crate) fn continuation(text: &str, indent: &str, context: &ViewContext) -> String {
    if blank(text, context) {
        text.to_owned()
    } else {
        format!("{indent}{text}")
    }
}

/// `text` wrapped at `room` columns through the context's own `wrap`.
fn wrap_at(text: &str, room: usize, context: &ViewContext) -> String {
    context.wrap(text, Some(u16::try_from(room).unwrap_or(u16::MAX)))
}

/// The widest unit `wrap` keeps whole in a text: a word, with an input line's leading spaces on
/// its first word and its trailing spaces on its last, or a `pad` or `nowrap` frame. It reads
/// `wrap` itself at one column, so the floor and the wrap agree on every unit.
#[cfg(feature = "table")]
pub(crate) fn unit_width(text: &str, context: &ViewContext) -> usize {
    context.width(&wrap_at(text, NARROWEST, context))
}

/// Marked text laid out for its destination. On a terminal its tabs expand from the start of each
/// input line, then it wraps at `room` columns, and at 1 when that leaves less, or stays unwrapped
/// when `room` is `None`. Off a terminal it comes back untouched, tabs and all.
pub(crate) fn terminal_wrap(text: &str, context: &ViewContext, room: Option<i64>) -> String {
    if context.columns.is_none() {
        return text.to_owned();
    }
    let expanded = context.expand_tabs(text);
    match room {
        None => expanded,
        Some(room) => {
            let room = usize::try_from(room.max(1)).unwrap_or(NARROWEST);
            wrap_at(&expanded, room, context)
        }
    }
}

/// A block of marked text as lines that each stand alone, laid out by [`terminal_wrap`] at the
/// context's columns less `inset`, the columns placed before it. It is split with `split_lines` on
/// and off a terminal, so a style or a hyperlink never runs into what the caller places beside a
/// line, and a trailing line break adds no line.
pub(crate) fn wrapped_lines(text: &str, context: &ViewContext, inset: usize) -> Vec<String> {
    let room = context
        .columns
        .map(|columns| i64::from(columns) - i64::try_from(inset).unwrap_or(i64::MAX));
    split_lines(&terminal_wrap(text, context, room))
}

/// A value as JavaScript's `String(value)` spells it: a number in its shortest form, an array's
/// members joined by commas with `null` as nothing, and an object as `[object Object]`.
pub(crate) fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => js_number(number),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| match item {
                Value::Null => String::new(),
                other => js_string(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// A JSON number as `String(value)` writes it. An integer prints all its digits, as a `bigint`
/// does, whatever its size: a Rust author's `u64` or `i64` is exact data, which a double would
/// round. A float prints as JavaScript's `String(number)` writes the double.
fn js_number(number: &serde_json::Number) -> String {
    if let Some(whole) = number.as_u64() {
        return whole.to_string();
    }
    if let Some(whole) = number.as_i64() {
        return whole.to_string();
    }
    number.as_f64().map_or_else(String::new, js_number_text)
}

/// A finite number as ECMAScript's `Number.prototype.toString` writes it: plain decimal for
/// magnitudes from 1e-6 up to (not including) 1e21, exponent form beyond, and `0` for either zero.
fn js_number_text(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific
        .split_once('e')
        .unwrap_or((scientific.as_str(), "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let n = exponent + 1;
    let k = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    let body = if k <= n && n <= 21 {
        format!(
            "{digits}{}",
            "0".repeat(usize::try_from(n - k).unwrap_or(0))
        )
    } else if 0 < n && n <= 21 {
        let (whole, fraction) = digits.split_at(usize::try_from(n).unwrap_or(0));
        format!("{whole}.{fraction}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat(usize::try_from(-n).unwrap_or(0)))
    } else {
        let power = n - 1;
        let sign_of_power = if power < 0 { '-' } else { '+' };
        let (first, rest) = digits.split_at(1);
        let fraction = if rest.is_empty() {
            String::new()
        } else {
            format!(".{rest}")
        };
        format!("{first}{fraction}e{sign_of_power}{}", power.abs())
    };
    format!("{sign}{body}")
}

/// The own keys of a serialized row with their values, in their order: an object's members, an
/// array's indexes, and a string's character positions, as `Object.keys(Object(row))` reads them.
#[cfg(any(feature = "table", feature = "records"))]
pub(crate) fn own_keys(row: &Value) -> Vec<String> {
    match row {
        Value::Object(members) => members.keys().cloned().collect(),
        Value::Array(items) => (0..items.len()).map(|index| index.to_string()).collect(),
        Value::String(text) => (0..text.chars().count())
            .map(|index| index.to_string())
            .collect(),
        _ => Vec::new(),
    }
}

/// The value a serialized row holds at `key`, as `row[key]` reads it, or `None` for `undefined`.
#[cfg(any(feature = "table", feature = "records"))]
pub(crate) fn field(row: &Value, key: &str) -> Option<Value> {
    match row {
        Value::Object(members) => members.get(key).cloned(),
        Value::Array(items) => key
            .parse::<usize>()
            .ok()
            .and_then(|index| items.get(index).cloned()),
        Value::String(text) => key
            .parse::<usize>()
            .ok()
            .and_then(|index| text.chars().nth(index))
            .map(|character| Value::String(character.to_string())),
        _ => None,
    }
}

/// A data value's text before styling: `String(value)`, with `null` and `undefined` printing as
/// the empty string.
pub(crate) fn data_string(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(other) => js_string(other),
    }
}

/// A data value as the pack's views print it by default: `String(value)` escaped and styled
/// `primary`, with `null` and `undefined` printing as the empty string.
pub(crate) fn data_text(value: Option<&Value>, context: &ViewContext) -> String {
    context.style.primary().apply(&escape(&data_string(value)))
}

/// The markers of one level of list siblings, and where their items' text starts.
#[cfg(feature = "list")]
pub(crate) struct ItemMarkers {
    /// Each item's marker, right-aligned to the widest marker and styled `dim`.
    pub(crate) markers: Vec<String>,
    /// The columns from a marker's start to its item's text: the widest marker and the gap.
    pub(crate) text_offset: usize,
}

/// The markers of `count` list siblings, bullets when `start` is `None` and numbers counting up
/// from `start` otherwise. They right-align to the widest among the siblings, so every item's text
/// starts in one column, and print `dim`.
#[cfg(feature = "list")]
pub(crate) fn item_markers(
    count: usize,
    start: Option<usize>,
    context: &ViewContext,
) -> ItemMarkers {
    let labels: Vec<String> = (0..count)
        .map(|index| match start {
            None => Glyph::Bullet.marked(),
            Some(start) => format!("{}.", start + index),
        })
        .collect();
    let width = context.width(&labels.join("\n"));
    ItemMarkers {
        markers: labels
            .iter()
            .map(|label| {
                context
                    .style
                    .dim()
                    .apply(&padded(label, width, Alignment::Right))
            })
            .collect(),
        text_offset: width + MARKER_GAP.len(),
    }
}

/// An item's first line after its marker, or the marker alone when the line has no character.
#[cfg(feature = "list")]
pub(crate) fn item_line(marker: &str, first: &str, context: &ViewContext) -> String {
    if blank(first, context) {
        marker.to_owned()
    } else {
        format!("{marker}{MARKER_GAP}{first}")
    }
}

/// `glyph.line` repeated `count` times.
pub(crate) fn line_glyphs(count: usize) -> String {
    Glyph::Line.marked().repeat(count)
}

/// A heading's wrapped lines styled `dim`. An underlined heading adds a line of `glyph.line` as
/// wide as the widest of the lines.
#[cfg(feature = "heading")]
pub(crate) fn heading_lines(
    lines: &[String],
    underlined: bool,
    context: &ViewContext,
) -> Vec<String> {
    let dim = context.style.dim();
    let mut written: Vec<String> = lines.iter().map(|line| dim.apply(line)).collect();
    if underlined {
        let widest = context.width(&lines.join("\n"));
        written.push(dim.apply(&line_glyphs(widest)));
    }
    written
}
