//! Splitting marked text at its line breaks into lines that each stand alone.

use crate::ansi::{CommandKind, command, hyperlink_opens, scan_ansi};
use crate::layout::{is_flat, layout};
use crate::rendering::Capabilities;
use crate::style::{CLOSE, escape, frame};
use crate::wire::{FrameMark, ParseOptions, ParsedText, WireTrace, parse_text};
use crate::wrap::EMPTY_PALETTE;

/// One frame open at a point of the text, outermost first, with the SGR commands set inside it.
struct Level {
    header: String,
    scoped: bool,
    sgr: Vec<String>,
}

/// What a line carries in from the lines above it, and what it sets itself.
struct State {
    levels: Vec<Level>,
    link: Option<String>,
    sgr: bool,
}

const HYPERLINK_CLOSE: &str = "\u{1b}]8;;\u{1b}\\";

/// The frames that open and close through `through`, applied to the open levels. A style frame
/// that closes takes its SGR commands with it, because its scope restores the style around it. A
/// padding or no-wrap frame is no scope, so its commands stay set in the level around it.
fn apply_marks(state: &mut State, marks: &[FrameMark], from: usize, through: usize) -> usize {
    let mut next = from;
    while let Some(mark) = marks.get(next).filter(|mark| mark.at() <= through) {
        match mark {
            FrameMark::Open { header, scoped, .. } => state.levels.push(Level {
                header: header.iter().collect(),
                scoped: *scoped,
                sgr: Vec::new(),
            }),
            FrameMark::Close { .. } => {
                if state.levels.len() > 1 {
                    if let Some(ended) = state.levels.pop() {
                        if !ended.scoped {
                            if let Some(outer) = state.levels.last_mut() {
                                outer.sgr.extend(ended.sgr);
                            }
                        }
                    }
                }
            }
        }
        next += 1;
    }
    next
}

/// The text that sets a line up as the open levels and the open hyperlink leave it.
fn reopening(state: &State) -> String {
    let mut out = String::new();
    for level in &state.levels {
        out.push_str(&level.header);
        for sgr in &level.sgr {
            out.push_str(&escape(sgr));
        }
    }
    if let Some(link) = &state.link {
        out.push_str(&escape(link));
    }
    out
}

/// One finished line: the text carried in, its own input, then a close for the open hyperlink and
/// for each open frame. A line that sets an SGR attribute sits in an empty style frame, whose scope
/// ends every attribute at the line's end without a byte of its own in the output.
fn finished(state: &State, opening: &str, body: &[char]) -> String {
    let mut line = String::from(opening);
    line.extend(body);
    if state.link.is_some() {
        line.push_str(HYPERLINK_CLOSE);
    }
    for _ in 1..state.levels.len() {
        line.push(CLOSE);
    }
    if state.sgr {
        frame("[\"style\",[]]", &line)
    } else {
        line
    }
}

/// Whether the last line of decoded text resolves to any character, as padding counts lines.
pub(crate) fn last_line_has_text(parsed: &ParsedText<'_>) -> bool {
    let view = parsed.view();
    if is_flat(&view) {
        return !parsed.text.is_empty() && parsed.text.last() != Some(&'\n');
    }
    layout(scan_ansi(view, &Capabilities::PLAIN))
        .lines
        .last()
        .is_some_and(|line| line.content.text)
}

/// Marked text split at its line breaks, LF and CRLF, into lines that each stand alone. Every
/// frame open at a line's end, a style, a padding frame, or a no-wrap frame, closes there and opens
/// again at the start of the next line in its nesting order, and an embedded SGR attribute or OSC 8
/// hyperlink ends at each line's end and starts again on the next, so lines can sit beside other
/// text without leaking into it. The line breaks are dropped. A trailing line break adds no empty
/// line, a blank line inside the text is a line, a line break inside a control string is no break,
/// and text without a break comes back as one line.
#[must_use]
pub fn split_lines(text: &str) -> Vec<String> {
    let input: Vec<char> = text.chars().collect();
    let mut trace = WireTrace {
        frames: Some(Vec::new()),
        ..WireTrace::default()
    };
    let parsed = parse_text(
        &input,
        &EMPTY_PALETTE,
        ParseOptions {
            any_token: true,
            main_glyphs: true,
            trace: Some(&mut trace),
        },
    );
    let marks = trace.frames.take().unwrap_or_default();
    let origins = &trace.origins;
    let decoded = &parsed.text;
    let mut state = State {
        levels: vec![Level {
            header: String::new(),
            scoped: true,
            sgr: Vec::new(),
        }],
        link: None,
        sgr: false,
    };
    let mut lines = Vec::new();
    let mut marked = 0;
    let mut start = 0;
    let mut opening = String::new();
    let mut break_at = |state: &mut State,
                        marked: &mut usize,
                        start: &mut usize,
                        opening: &mut String,
                        end: usize,
                        after: usize| {
        lines.push(finished(
            state,
            opening,
            input.get(*start..end).unwrap_or_default(),
        ));
        *marked = apply_marks(state, &marks, *marked, after);
        *opening = reopening(state);
        state.sgr = state.levels.iter().any(|level| !level.sgr.is_empty());
        *start = origins.get(after).copied().unwrap_or(end) + 1;
    };
    let mut index = 0;
    while index < decoded.len() {
        marked = apply_marks(&mut state, &marks, marked, index);
        if let Some(found) = command(decoded, index) {
            marked = apply_marks(&mut state, &marks, marked, found.end.saturating_sub(1));
            let raw: String = decoded
                .get(index..found.end)
                .unwrap_or_default()
                .iter()
                .collect();
            if found.kind == CommandKind::Sgr {
                if let Some(level) = state.levels.last_mut() {
                    level.sgr.push(raw);
                }
                state.sgr = true;
            } else if let Some(opens) = hyperlink_opens(decoded, &found) {
                state.link = opens.then_some(raw);
            }
            index = found.end.max(index + 1);
        } else if decoded.get(index) == Some(&'\r') && decoded.get(index + 1) == Some(&'\n') {
            let end = origins.get(index).copied().unwrap_or(input.len());
            break_at(
                &mut state,
                &mut marked,
                &mut start,
                &mut opening,
                end,
                index + 1,
            );
            index += 2;
        } else if decoded.get(index) == Some(&'\n') {
            let end = origins.get(index).copied().unwrap_or(input.len());
            break_at(
                &mut state,
                &mut marked,
                &mut start,
                &mut opening,
                end,
                index,
            );
            index += 1;
        } else {
            index += 1;
        }
    }
    apply_marks(&mut state, &marks, marked, decoded.len());
    if lines.is_empty() || last_line_has_text(&parsed) {
        lines.push(finished(
            &state,
            &opening,
            input.get(start..).unwrap_or_default(),
        ));
    }
    lines
}
