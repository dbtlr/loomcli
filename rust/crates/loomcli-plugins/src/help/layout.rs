//! How help lays prose out against its view context's columns: the line layout every wrap shares,
//! and the hanging indents that continue a text where its first line started.
//!
//! Off a terminal `columns` is `None`, and every page keeps the bytes it prints with no width. On a
//! terminal each prose text wraps through the context's own `wrap`, so the floor a row set measures
//! and the wrap agree on every unit.

use loomcli_core::ViewContext;
use loomcli_core::style::{Alignment, Glyph, pad, split_lines};

/// The narrowest width text wraps at, so a room that leaves less still breaks at every space.
const NARROWEST: i64 = 1;

/// A padding frame around `text`. The width is a measured display width, which no text reaches
/// `2^53` with, so `pad`'s only failure cannot happen; the text unpadded stands in all the same.
pub(super) fn padded(text: &str, width: usize, align: Alignment) -> String {
    pad(text, width, align).unwrap_or_else(|_| text.to_owned())
}

/// The context's columns, when the destination is a terminal that reports them.
pub(super) fn columns(context: &ViewContext) -> Option<i64> {
    context.columns.map(i64::from)
}

/// Whether help lays its page out against a width.
pub(super) fn on_terminal(context: &ViewContext) -> bool {
    context.columns.is_some()
}

/// A count as a signed width.
pub(super) fn signed(count: usize) -> i64 {
    i64::try_from(count).unwrap_or(i64::MAX)
}

/// Spaces, `count` of them, or none for a count below one.
pub(super) fn spaces(count: i64) -> String {
    " ".repeat(usize::try_from(count).unwrap_or(0))
}

/// Whether a line resolves to no character at all, whatever frames it holds.
pub(super) fn blank(text: &str, context: &ViewContext) -> bool {
    context.plain(text).is_empty()
}

/// A continuation line placed under the text it continues, except a blank one, which stays bare.
pub(super) fn continuation(text: &str, indent: &str, context: &ViewContext) -> String {
    if blank(text, context) {
        text.to_owned()
    } else {
        format!("{indent}{text}")
    }
}

/// `text` wrapped at `room` columns through the context's own `wrap`.
fn wrap_at(text: &str, room: i64, context: &ViewContext) -> String {
    let room = u16::try_from(room.max(NARROWEST)).unwrap_or(u16::MAX);
    context.wrap(text, Some(room))
}

/// The widest unit `wrap` keeps whole in a text: a word, with an input line's leading spaces on
/// its first word and its trailing spaces on its last, or a `pad` or `nowrap` frame. It reads
/// `wrap` itself at one column, so the floor and the wrap agree on every unit.
pub(super) fn unit_width(text: &str, context: &ViewContext) -> i64 {
    signed(context.width(&wrap_at(text, NARROWEST, context)))
}

/// Marked text laid out for its destination. On a terminal its tabs expand from the start of each
/// input line, then it wraps at `room` columns, and at 1 when that leaves less, or stays unwrapped
/// when `room` is `None`. Off a terminal it comes back untouched, tabs and all.
pub(super) fn terminal_wrap(text: &str, context: &ViewContext, room: Option<i64>) -> String {
    if context.columns.is_none() {
        return text.to_owned();
    }
    let expanded = context.expand_tabs(text);
    match room {
        None => expanded,
        Some(room) => wrap_at(&expanded, room, context),
    }
}

/// The room help hands [`terminal_wrap`] for prose with `width` columns left: none when less than
/// one column is left, so the text keeps its own lines and does not wrap.
pub(super) fn prose_room(width: i64) -> Option<i64> {
    (width >= NARROWEST).then_some(width)
}

/// Where a hanging text sits: the column its first line starts at, its block's base, and the
/// width it wraps within.
pub(super) struct Hang {
    pub(super) base: i64,
    pub(super) columns: i64,
    pub(super) lead: i64,
}

/// A hanging text's first line, its continuation lines, and the indent they start at.
pub(super) struct HungLines {
    pub(super) first: String,
    pub(super) indent: i64,
    pub(super) rest: Vec<String>,
}

/// A hanging text wrapped at `columns`. Its first line starts at `lead`, and its continuation lines
/// start under the first line's text, also at `lead`, unless that indent and the text's floor
/// exceed the columns. Then they start at `base`, the indent of the text's block. The first line
/// keeps its place either way: the wrap reads leading spaces that move the first line from `base`
/// to `lead`, which stay with its first word, and drops them from the line it returns.
pub(super) fn hang_lines(text: &str, hang: &Hang, context: &ViewContext) -> HungLines {
    let expanded = context.expand_tabs(text);
    let indent = if hang.lead + unit_width(&expanded, context) > hang.columns {
        hang.base
    } else {
        hang.lead
    };
    let offset = spaces(hang.lead - indent);
    let wrapped = terminal_wrap(
        &format!("{offset}{expanded}"),
        context,
        prose_room(hang.columns - indent),
    );
    let mut lines = split_lines(&wrapped).into_iter();
    let first = lines.next().unwrap_or_default();
    let first = first
        .strip_prefix(offset.as_str())
        .map_or_else(|| first.clone(), str::to_owned);
    HungLines {
        first,
        indent,
        rest: lines.collect(),
    }
}

/// Prose placed after `lead` and wrapped at the columns left after it, on a terminal. Each
/// continuation line starts under the text's first character, after unstyled spaces, or at `base`
/// when that hang cannot fit. Without a base the continuation lines always hang under the text.
pub(super) fn hanging(
    text: &str,
    base: Option<i64>,
    lead: &str,
    context: &ViewContext,
) -> Vec<String> {
    let start = signed(context.width(lead));
    let hung = hang_lines(
        text,
        &Hang {
            base: base.unwrap_or(start),
            columns: columns(context).unwrap_or(0),
            lead: start,
        },
        context,
    );
    let continued = spaces(hung.indent);
    std::iter::once(format!("{lead}{}", hung.first))
        .chain(
            hung.rest
                .iter()
                .map(|line| continuation(line, &continued, context)),
        )
        .collect()
}

/// Prose after a lead: one line off a terminal, and wrapped under a hanging indent on one,
/// continuing at `base` when that hang cannot fit.
pub(super) fn prose(
    text: &str,
    base: Option<i64>,
    lead: &str,
    context: &ViewContext,
) -> Vec<String> {
    if on_terminal(context) {
        hanging(text, base, lead, context)
    } else {
        vec![format!("{lead}{text}")]
    }
}

/// The markers of one level of list siblings, and where their items' text starts.
pub(super) struct ItemMarkers {
    /// Each item's marker, right-aligned to the widest marker and styled `dim`.
    pub(super) markers: Vec<String>,
    /// The columns from a marker's start to its item's text: the widest marker and the gap.
    pub(super) text_offset: usize,
}

/// The markers of `count` list siblings, bullets when `start` is `None` and numbers counting up
/// from `start` otherwise, right-aligned to the widest among them and styled `dim`.
pub(super) fn item_markers(count: usize, start: Option<u64>, context: &ViewContext) -> ItemMarkers {
    let labels: Vec<String> = (0..count)
        .map(|index| match start {
            None => Glyph::Bullet.marked(),
            Some(start) => format!("{}.", start + u64::try_from(index).unwrap_or(0)),
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
        text_offset: width + 1,
    }
}

/// An item's first line after its marker, or the marker alone when the line has no character.
pub(super) fn item_line(marker: &str, first: &str, context: &ViewContext) -> String {
    if blank(first, context) {
        marker.to_owned()
    } else {
        format!("{marker} {first}")
    }
}

/// A heading's wrapped lines styled `dim`. Level 1 adds a line of `glyph.line` as wide as the
/// widest of the lines, and any other level is the lines alone.
pub(super) fn heading_lines(lines: &[String], level: usize, context: &ViewContext) -> Vec<String> {
    let dim = context.style.dim();
    let mut written: Vec<String> = lines.iter().map(|line| dim.apply(line)).collect();
    if level == 1 {
        let widest = context.width(&lines.join("\n"));
        written.push(dim.apply(&Glyph::Line.marked().repeat(widest)));
    }
    written
}
