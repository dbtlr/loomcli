//! Resolution and measurement: marked text to the bytes a destination receives, its columns, and
//! the rows a drawn frame occupies.

use std::collections::BTreeMap;
use std::rc::Rc;

use crate::ansi::{UnitKind, scan_ansi};
use crate::layout::{block_width, is_flat, layout, rendered_units};
use crate::rendering::Capabilities;
use crate::state::{Attributes, transition};
use crate::theme::Palette;
use crate::width::{cluster_columns, grapheme_widths};
use crate::wire::{ParseOptions, ParsedView, ROOT, StyleScope, parse_text};

/// The width of a flat text: its widest line, each line the columns of the clusters between its
/// start and its line ending, which adds none.
fn flat_width(text: &[char]) -> usize {
    let before = cluster_columns(text).before;
    let column = |at: usize| before.get(at).copied().unwrap_or(0);
    let mut widest = 0;
    let mut start = 0;
    for (feed, _) in text.iter().enumerate().filter(|(_, c)| **c == '\n') {
        let end = if feed > 0 && text.get(feed - 1) == Some(&'\r') {
            feed - 1
        } else {
            feed
        };
        widest = widest.max(column(end).saturating_sub(column(start)));
        start = feed + 1;
    }
    widest.max(column(text.len()).saturating_sub(column(start)))
}

/// One complete string resolved for a destination: one state boundary, so no terminal attribute
/// survives the call.
pub(crate) fn resolve_text(text: &[char], palette: &Palette, caps: &Capabilities) -> String {
    let parsed = parse_text(
        text,
        palette,
        ParseOptions {
            any_token: false,
            main_glyphs: caps.main_glyphs,
            trace: None,
        },
    );
    let view = parsed.view();
    // With neither color nor modifiers to write, a flat text resolves to its characters alone.
    if !caps.color && !caps.modifiers && is_flat(&view) {
        return parsed.text.iter().collect();
    }
    let mut result = String::with_capacity(text.len());
    let empty = Rc::new(Attributes::default());
    let mut previous = Rc::clone(&empty);
    let mut preserved_sgr = false;
    for unit in rendered_units(&layout(scan_ansi(view, caps))) {
        preserved_sgr |= unit.kind == UnitKind::Sgr;
        // The same attributes need no transition, and most units share their neighbor's.
        if !Rc::ptr_eq(&unit.attributes, &previous) {
            result.push_str(&transition(&previous, &unit.attributes, caps));
            previous = Rc::clone(&unit.attributes);
        }
        result.extend(unit.text.iter());
    }
    result.push_str(&transition(&previous, &empty, caps));
    if preserved_sgr {
        result.push_str("\u{1b}[0m");
    }
    result
}

/// The columns of parsed text: its widest line, every command counting none.
pub(crate) fn parsed_width(view: ParsedView<'_>, caps: &Capabilities) -> usize {
    if is_flat(&view) {
        return flat_width(view.text);
    }
    block_width(&layout(scan_ansi(view, caps)))
}

/// The columns of marked text, as a view context measures it for its destination.
pub(crate) fn marked_width(text: &[char], palette: &Palette, caps: &Capabilities) -> usize {
    let parsed = parse_text(
        text,
        palette,
        ParseOptions {
            any_token: false,
            main_glyphs: caps.main_glyphs,
            trace: None,
        },
    );
    parsed_width(parsed.view(), caps)
}

/// The scope arena of plain text: the root scope alone.
pub(crate) fn plain_arena() -> Vec<StyleScope> {
    vec![StyleScope {
        attributes: Rc::new(Attributes::default()),
        parent: None,
        operations: Rc::from(Vec::new()),
    }]
}

/// The columns of text a stream received, as a view context's width counts them, with no
/// marked-string frame read: every terminal control sequence, an SGR style, an OSC 8 hyperlink,
/// and a cursor movement alike, is skipped and none is emulated, so text that moves the cursor back
/// and overwrites itself measures as if nothing were overwritten. It is the widest line, with LF
/// and CRLF as line breaks and tabs at stops of eight.
#[must_use]
pub fn width(text: &str) -> usize {
    let text: Vec<char> = text.chars().collect();
    let scopes = vec![ROOT; text.len()];
    let arena = plain_arena();
    let palette = Palette::new();
    let boundaries = BTreeMap::new();
    let view = ParsedView {
        text: &text,
        scopes: &scopes,
        arena: &arena,
        palette: &palette,
        boundaries: &boundaries,
    };
    parsed_width(view, &Capabilities::PLAIN)
}

/// Stands in for an unbounded terminal width.
const UNBOUNDED: i64 = i64::MAX / 4;

/// Where the cursor ends after visible text written from `from` on a terminal `columns` wide: the
/// rows it moved down, and its column. A row the text fills exactly leaves the column at
/// `columns`, because the terminal wraps only when the next character arrives.
fn walk(visible: &[char], columns: i64, from: i64) -> (i64, usize) {
    let mut rows = 0;
    let mut column = from;
    for grapheme in grapheme_widths(visible) {
        let segment = visible
            .get(grapheme.start..grapheme.end)
            .unwrap_or_default();
        if segment.last() == Some(&'\n') {
            rows += 1;
            column = 0;
            continue;
        }
        if segment == ['\r'] {
            column = 0;
            continue;
        }
        let width = i64::try_from(grapheme.width).unwrap_or(0);
        let cells = if segment == ['\t'] {
            (8 - column % 8).min(columns - column)
        } else {
            width.min(columns)
        };
        if cells > 0 && column + cells > columns {
            rows += 1;
            column = 0;
        }
        column += cells;
    }
    (column, rows)
}

/// The rows a drawn frame advances the cursor, leaving a final partial line on its row. With no
/// width, each line break is one row and nothing wraps.
pub(crate) fn drawn_rows(
    text: &[char],
    palette: &Palette,
    caps: &Capabilities,
    columns: Option<usize>,
) -> usize {
    let parsed = parse_text(
        text,
        palette,
        ParseOptions {
            any_token: false,
            main_glyphs: caps.main_glyphs,
            trace: None,
        },
    );
    let block = layout(scan_ansi(parsed.view(), caps));
    let Some(columns) = columns.filter(|columns| *columns > 0) else {
        return block.lines.len().saturating_sub(1);
    };
    let visible: Vec<char> = rendered_units(&block)
        .into_iter()
        .filter(|unit| {
            unit.kind == UnitKind::Text || (unit.kind == UnitKind::Control && *unit.text == ['\r'])
        })
        .flat_map(|unit| unit.text.iter().copied().collect::<Vec<_>>())
        .collect();
    walk(&visible, i64::try_from(columns).unwrap_or(UNBOUNDED), 0).1
}

/// The column the next character lands on after visible text written from `column` on a terminal
/// `columns` wide, measured as a drawn frame's rows are. A row the text fills exactly answers 0,
/// because the next character starts the row below. With no width, no row wraps.
#[must_use]
pub fn next_column(visible: &str, columns: Option<usize>, column: usize) -> usize {
    let visible: Vec<char> = visible.chars().collect();
    let limit = columns
        .filter(|columns| *columns > 0)
        .and_then(|columns| i64::try_from(columns).ok())
        .unwrap_or(UNBOUNDED);
    let (reached, _) = walk(&visible, limit, i64::try_from(column).unwrap_or(UNBOUNDED));
    let reached = usize::try_from(reached).unwrap_or(0);
    if Some(reached) == columns { 0 } else { reached }
}
