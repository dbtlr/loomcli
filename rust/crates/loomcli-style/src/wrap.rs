//! Line breaking and tab expansion over marked or plain text. Both read the wire with the shared
//! parser and ANSI recognizer, and edit the input in place, so every frame header, escape, and
//! command keeps its bytes.

use std::collections::BTreeMap;

use crate::ansi::{command, scan_ansi};
use crate::layout::{block_width, layout, tab_advances};
use crate::rendering::Capabilities;
use crate::resolve::plain_arena;
use crate::style::{MAX_SAFE_INTEGER, StyleError};
use crate::theme::Palette;
use crate::width::cluster_columns;
use crate::wire::{
    Boundaries, Boundary, ParseOptions, ParsedText, ParsedView, ROOT, WireTrace, parse_text,
};

/// The palette of plain text, which names no token.
pub(crate) static EMPTY_PALETTE: Palette = Palette::new();

/// One input line of decoded text: its content, without the line ending, and that ending.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Line {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) crlf: bool,
}

/// A break opportunity: the spaces between two words, with any zero-width command among them.
#[derive(Debug, Clone)]
pub(crate) struct Run {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) spaces: Vec<usize>,
}

/// One text as line breaking reads it: decoded, traced to its input, and its commands marked.
#[derive(Debug)]
pub(crate) struct Breakable<'p> {
    pub(crate) parsed: ParsedText<'p>,
    pub(crate) trace: WireTrace,
    pub(crate) commands: Vec<bool>,
    pub(crate) caps: Capabilities,
}

/// Each decoded character inside an ANSI command, found the way the ANSI scanner finds them.
pub(crate) fn command_characters(text: &[char]) -> Vec<bool> {
    let mut inside = vec![false; text.len()];
    let mut cursor = 0;
    while cursor < text.len() {
        let Some(found) = command(text, cursor) else {
            cursor += 1;
            continue;
        };
        for slot in inside.iter_mut().take(found.end).skip(cursor) {
            *slot = true;
        }
        cursor = found.end.max(cursor + 1);
    }
    inside
}

/// The input lines: each LF outside a command ends one, and a CR before it makes it CRLF.
pub(crate) fn lines_of(text: &Breakable<'_>) -> Vec<Line> {
    let decoded = &text.parsed.text;
    let mut lines = Vec::new();
    let mut start = 0;
    for (index, character) in decoded.iter().enumerate() {
        if *character == '\n' && !text.commands.get(index).copied().unwrap_or(false) {
            let crlf = index > start && decoded.get(index - 1) == Some(&'\r');
            lines.push(Line {
                start,
                end: if crlf { index - 1 } else { index },
                crlf,
            });
            start = index + 1;
        }
    }
    lines.push(Line {
        start,
        end: decoded.len(),
        crlf: false,
    });
    lines
}

/// A U+0020 that line breaking may break at: literal, outside every whole frame and command.
fn break_space(text: &Breakable<'_>, index: usize) -> bool {
    text.parsed.text.get(index) == Some(&' ')
        && !text.trace.whole.get(index).copied().unwrap_or(false)
        && !text.commands.get(index).copied().unwrap_or(false)
}

/// The break opportunities of one line. A line's leading spaces stay with its first word and its
/// trailing spaces stay with its last word, so neither is a run, and both count toward the fit.
pub(crate) fn runs_of(text: &Breakable<'_>, line: Line) -> Vec<Run> {
    let mut runs = Vec::new();
    let mut seen = false;
    let mut open: Option<Vec<usize>> = None;
    for index in line.start..line.end {
        if break_space(text, index) {
            open.get_or_insert_with(Vec::new).push(index);
        } else if !text.commands.get(index).copied().unwrap_or(false) {
            if let Some(spaces) = open.take() {
                if seen {
                    let start = spaces.first().copied().unwrap_or(index);
                    let end = spaces.last().copied().unwrap_or(index) + 1;
                    runs.push(Run { start, end, spaces });
                }
            }
            seen = true;
        }
    }
    runs
}

/// The padding frames open before each line start, read once from the start of the text.
pub(crate) struct PadTracker {
    open: Vec<Boundary>,
    walked: usize,
}

impl PadTracker {
    pub(crate) fn new() -> PadTracker {
        PadTracker {
            open: Vec::new(),
            walked: 0,
        }
    }

    pub(crate) fn at(&mut self, boundaries: &Boundaries, index: usize) -> Vec<Boundary> {
        if self.walked < index {
            for (_, found) in boundaries.range(self.walked..index) {
                for boundary in found {
                    match boundary {
                        Boundary::Open { .. } => self.open.push(boundary.clone()),
                        Boundary::Close => {
                            self.open.pop();
                        }
                    }
                }
            }
            self.walked = index;
        }
        self.open.clone()
    }
}

/// A span of one line, as `measure` takes it.
#[derive(Debug, Clone)]
pub(crate) struct Span {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) enclosing: Vec<Boundary>,
}

/// The width of decoded characters `start` to `end` laid out as one line, as `width()` measures
/// them. The padding frames `enclosing` names reopen at `start`, and any still open close at
/// `end`. It lays the span out afresh, so it reads every character of it.
pub(crate) fn measure(text: &Breakable<'_>, span: &Span) -> usize {
    let parsed = &text.parsed;
    let mut boundaries = Boundaries::new();
    let mut depth = i64::try_from(span.enclosing.len()).unwrap_or(0);
    for at in span.start..=span.end {
        let mut here = if at == span.start {
            span.enclosing.clone()
        } else {
            Vec::new()
        };
        for boundary in parsed.boundaries.get(&at).into_iter().flatten() {
            depth += if matches!(boundary, Boundary::Open { .. }) {
                1
            } else {
                -1
            };
            here.push(boundary.clone());
        }
        if at == span.end {
            while depth > 0 {
                here.push(Boundary::Close);
                depth -= 1;
            }
        }
        if !here.is_empty() {
            boundaries.insert(at - span.start, here);
        }
    }
    let view = ParsedView {
        text: parsed.text.get(span.start..span.end).unwrap_or_default(),
        scopes: parsed.scopes.get(span.start..span.end).unwrap_or_default(),
        arena: &parsed.arena,
        palette: parsed.palette,
        boundaries: &boundaries,
    };
    block_width(&layout(scan_ansi(view, &text.caps)))
}

/// The decoded text without its ANSI commands, which is all the width of a plain line reads.
pub(crate) struct Visible {
    text: Vec<char>,
    /// For each decoded index, and one past the last, how many visible characters precede it.
    before: Vec<usize>,
}

/// The visible characters of a text, and where each decoded index falls among them.
pub(crate) fn visible_of(text: &Breakable<'_>) -> Visible {
    let decoded = &text.parsed.text;
    let mut before = Vec::with_capacity(decoded.len() + 1);
    let mut visible = Vec::with_capacity(decoded.len());
    for (index, character) in decoded.iter().enumerate() {
        before.push(visible.len());
        if !text.commands.get(index).copied().unwrap_or(false) {
            visible.push(*character);
        }
    }
    before.push(visible.len());
    Visible {
        text: visible,
        before,
    }
}

/// How one line answers the width of its spans.
pub(crate) enum Measurer<'v> {
    /// Lay each span out afresh.
    Exact,
    /// Answer from one reading of the line's clusters.
    Clusters {
        first: usize,
        before: Vec<usize>,
        boundary: Vec<bool>,
        visible_before: &'v [usize],
    },
}

impl<'v> Measurer<'v> {
    /// A measurer for one line. A text with no padding frame and a line with no tab measure as the
    /// sum of their clusters' widths, so the measurer reads the line's clusters once and answers a
    /// span that starts and ends at cluster boundaries from them. No break state carries into a
    /// span's first cluster: a span starts at a line start or after a U+0020, whose break property
    /// is Other. Any other span, and any other line, is laid out as `measure` does.
    pub(crate) fn new(text: &Breakable<'_>, line: Line, visible: &'v Visible) -> Measurer<'v> {
        let at = |index: usize| visible.before.get(index).copied().unwrap_or(0);
        let first = at(line.start);
        let own = visible.text.get(first..at(line.end)).unwrap_or_default();
        if !text.parsed.boundaries.is_empty() || own.contains(&'\t') {
            return Measurer::Exact;
        }
        let columns = cluster_columns(own);
        Measurer::Clusters {
            first,
            before: columns.before,
            boundary: columns.boundary,
            visible_before: &visible.before,
        }
    }

    pub(crate) fn width(&self, text: &Breakable<'_>, span: &Span) -> usize {
        let Measurer::Clusters {
            first,
            before,
            boundary,
            visible_before,
        } = self
        else {
            return measure(text, span);
        };
        let at = |index: usize| {
            visible_before
                .get(index)
                .copied()
                .unwrap_or(0)
                .saturating_sub(*first)
        };
        let (from, to) = (at(span.start), at(span.end));
        if !boundary.get(from).copied().unwrap_or(false)
            || !boundary.get(to).copied().unwrap_or(false)
        {
            return measure(text, span);
        }
        before
            .get(to)
            .copied()
            .unwrap_or(0)
            .saturating_sub(before.get(from).copied().unwrap_or(0))
    }
}

/// Where greedy fitting breaks one text: each run it breaks at, mapped from the input offset of
/// each of its spaces to what replaces it, the line break for the first and nothing for the rest.
fn breaks(text: &Breakable<'_>, columns: usize) -> BTreeMap<usize, &'static str> {
    let mut edits = BTreeMap::new();
    let mut pads = PadTracker::new();
    let mut visible: Option<Visible> = None;
    for line in lines_of(text) {
        let runs = runs_of(text, line);
        if runs.is_empty() {
            continue;
        }
        let enclosing = pads.at(&text.parsed.boundaries, line.start);
        let visible: &Visible = visible.get_or_insert_with(|| visible_of(text));
        let measurer = Measurer::new(text, line, visible);
        let whole = Span {
            start: line.start,
            end: line.end,
            enclosing: enclosing.clone(),
        };
        if measurer.width(text, &whole) <= columns {
            continue;
        }
        let mut from = line.start;
        for (index, run) in runs.iter().enumerate() {
            let next = runs.get(index + 1).map_or(line.end, |next| next.start);
            let span = Span {
                start: from,
                end: next,
                enclosing: if from == line.start {
                    enclosing.clone()
                } else {
                    Vec::new()
                },
            };
            if measurer.width(text, &span) <= columns {
                continue;
            }
            for (position, space) in run.spaces.iter().enumerate() {
                let origin = text.trace.origins.get(*space).copied().unwrap_or(*space);
                let replacement = match (position, line.crlf) {
                    (0, true) => "\r\n",
                    (0, false) => "\n",
                    _ => "",
                };
                edits.insert(origin, replacement);
            }
            from = run.end;
        }
    }
    edits
}

/// The input with each edited offset replaced, every other character kept as it was.
fn edited<S: AsRef<str>>(input: &[char], edits: &BTreeMap<usize, S>) -> String {
    let mut out = String::with_capacity(input.len() + edits.len());
    let mut from = 0;
    for (offset, replacement) in edits {
        out.extend(input.get(from..*offset).unwrap_or_default());
        out.push_str(replacement.as_ref());
        from = offset + 1;
    }
    out.extend(input.get(from..).unwrap_or_default());
    out
}

/// A wrap width: a positive safe integer.
fn wrap_width(columns: usize) -> Result<usize, StyleError> {
    let safe = u64::try_from(columns).is_ok_and(|value| value <= MAX_SAFE_INTEGER);
    if columns == 0 || !safe {
        return Err(StyleError::WrapWidth);
    }
    Ok(columns)
}

/// Marked text as line breaking reads it: decoded for the destination, and traced to its input.
pub(crate) fn breakable_marked<'p>(
    text: &[char],
    caps: &Capabilities,
    palette: &'p Palette,
) -> Breakable<'p> {
    let mut trace = WireTrace::default();
    let parsed = parse_text(
        text,
        palette,
        ParseOptions {
            any_token: false,
            main_glyphs: caps.main_glyphs,
            trace: Some(&mut trace),
        },
    );
    let commands = command_characters(&parsed.text);
    Breakable {
        parsed,
        trace,
        commands,
        caps: *caps,
    }
}

/// Marked text with line breaks inserted so each line fits `columns`, measured with the
/// destination's glyph forms. `None` returns the text unchanged.
pub(crate) fn wrap_marked(
    text: &str,
    columns: Option<usize>,
    caps: &Capabilities,
    palette: &Palette,
) -> Result<String, StyleError> {
    let Some(columns) = columns else {
        return Ok(text.to_owned());
    };
    let width = wrap_width(columns)?;
    let input: Vec<char> = text.chars().collect();
    Ok(edited(
        &input,
        &breaks(&breakable_marked(&input, caps, palette), width),
    ))
}

/// Marked text with each tab replaced by the spaces that reach the next multiple of eight, counted
/// from the start of its input line. A tab inside a padding frame is left to the frame.
pub(crate) fn expand_tabs_marked(text: &str, caps: &Capabilities, palette: &Palette) -> String {
    if !text.contains('\t') {
        return text.to_owned();
    }
    let input: Vec<char> = text.chars().collect();
    let mut trace = WireTrace::default();
    let parsed = parse_text(
        &input,
        palette,
        ParseOptions {
            any_token: false,
            main_glyphs: caps.main_glyphs,
            trace: Some(&mut trace),
        },
    );
    let advances = tab_advances(&layout(scan_ansi(parsed.view(), caps)));
    let commands = command_characters(&parsed.text);
    let mut edits: BTreeMap<usize, String> = BTreeMap::new();
    let mut padding: i64 = 0;
    let mut next = 0;
    for (index, character) in parsed.text.iter().enumerate() {
        for boundary in parsed.boundaries.get(&index).into_iter().flatten() {
            padding += if matches!(boundary, Boundary::Open { .. }) {
                1
            } else {
                -1
            };
        }
        if *character != '\t' || commands.get(index).copied().unwrap_or(false) || padding > 0 {
            continue;
        }
        let advance = advances.get(next).copied();
        next += 1;
        if let Some(advance) = advance {
            let origin = trace.origins.get(index).copied().unwrap_or(index);
            edits.insert(origin, " ".repeat(advance));
        }
    }
    edited(&input, &edits)
}

/// Plain text as line breaking reads it: literal characters, each traced to itself.
pub(crate) fn breakable_plain(text: &[char]) -> Breakable<'static> {
    let parsed = ParsedText {
        text: text.to_vec(),
        scopes: vec![ROOT; text.len()],
        arena: plain_arena(),
        palette: &EMPTY_PALETTE,
        boundaries: Boundaries::new(),
    };
    let trace = WireTrace {
        origins: (0..text.len()).collect(),
        whole: vec![false; text.len()],
        frames: None,
    };
    Breakable {
        commands: command_characters(text),
        parsed,
        trace,
        caps: Capabilities::PLAIN,
    }
}

/// Plain text, read as literal characters rather than marked text, with line breaks inserted by
/// the rules marked text wraps by, measured in terminal display columns: greedy, at U+0020 alone,
/// keeping authored line breaks and each word wider than `columns` whole. A Developer
/// Diagnostic's explanation wraps with it.
///
/// # Errors
///
/// [`StyleError::WrapWidth`] when `columns` is zero or above `2^53 - 1`.
pub fn wrap_plain(text: &str, columns: usize) -> Result<String, StyleError> {
    let width = wrap_width(columns)?;
    let input: Vec<char> = text.chars().collect();
    Ok(edited(&input, &breaks(&breakable_plain(&input), width)))
}
