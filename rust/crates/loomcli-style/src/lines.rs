//! Splitting marked text at its line breaks into lines that each stand alone.

use crate::ansi::{AnsiCommand, CommandKind, command, hyperlink_opens, scan_ansi};
use crate::layout::{is_flat, layout};
use crate::renderer::Renderer;
use crate::rendering::Capabilities;
use crate::style::{CLOSE, ESCAPE, HEADER_END, OPEN, escape, frame};
use crate::wire::{FrameMark, ParseOptions, ParsedText, WireTrace, parse_text};
use crate::wrap::EMPTY_PALETTE;

/// One frame open at a point of the text, outermost first, with the SGR commands set inside it.
#[derive(Clone)]
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

impl Default for State {
    fn default() -> Self {
        Self {
            levels: vec![Level {
                header: String::new(),
                scoped: true,
                sgr: Vec::new(),
            }],
            link: None,
            sgr: false,
        }
    }
}

impl State {
    fn command(&mut self, decoded: &[char], begin: usize, found: &AnsiCommand) {
        if found.kind == CommandKind::Sgr {
            if let Some(level) = self.levels.last_mut() {
                level.sgr.push(decoded[begin..found.end].iter().collect());
            }
            self.sgr = true;
        } else if let Some(opens) = hyperlink_opens(decoded, found) {
            self.link = opens.then(|| decoded[begin..found.end].iter().collect());
        }
    }
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
    let mut state = State::default();
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
            state.command(decoded, index, &found);
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

/// What a streamed message carries across a split at a completed line.
#[doc(hidden)]
#[derive(Default)]
pub struct LineCarry {
    state: State,
    preserved: Option<String>,
}

/// Whether a candidate split is valid for the message's layout and resolution.
#[doc(hidden)]
pub enum Carried {
    /// Completed lines and the state they leave open.
    Ready(LineCarry),
    /// A later line can finish the current frame header or control string.
    Wait,
    /// The palette and line walker disagree about a token's frame.
    Stop,
}

impl LineCarry {
    /// The marked text that reopens this state at the start of the synthetic first line.
    #[must_use]
    pub fn opening(&self) -> String {
        let mut opening = self
            .preserved
            .as_deref()
            .map_or_else(String::new, |raw| frame("[\"style\",[]]", &escape(raw)));
        opening.push_str(&reopening(&self.state));
        opening
    }

    /// Advances from this state through the completed lines.
    #[must_use]
    pub fn through(&self, lines: &str, renderer: &Renderer) -> Carried {
        if !lines.contains([OPEN, CLOSE, ESCAPE])
            && !lines.chars().any(crate::ansi::is_control_except_layout)
        {
            // Plain text cannot change the state established before it.
            return Carried::Ready(Self {
                state: State {
                    levels: self.state.levels.clone(),
                    link: self.state.link.clone(),
                    sgr: self.state.sgr,
                },
                preserved: self.preserved.clone(),
            });
        }
        let before = self.opening();
        let offset = before.chars().count();
        let input: Vec<char> = before.chars().chain(lines.chars()).collect();
        let mut trace = WireTrace {
            frames: Some(Vec::new()),
            ..WireTrace::default()
        };
        let parsed = parse_text(
            &input,
            renderer.palette(),
            ParseOptions {
                any_token: false,
                main_glyphs: true,
                trace: Some(&mut trace),
            },
        );
        let mut permissive = WireTrace {
            frames: Some(Vec::new()),
            ..WireTrace::default()
        };
        parse_text(
            &input,
            &EMPTY_PALETTE,
            ParseOptions {
                any_token: true,
                main_glyphs: true,
                trace: Some(&mut permissive),
            },
        );
        if trace.frames != permissive.frames {
            return Carried::Stop;
        }
        if input
            .iter()
            .rposition(|&c| c == OPEN)
            .is_some_and(|start| !input[start..].contains(&HEADER_END))
        {
            return Carried::Wait;
        }

        let marks = trace.frames.unwrap_or_default();
        let mut state = State::default();
        let mut preserved = self.preserved.clone();
        let mut marked = 0;
        let mut index = 0;
        let mut sgr = false;
        while index < parsed.text.len() {
            marked = apply_marks(&mut state, &marks, marked, index);
            if let Some(found) = command(&parsed.text, index) {
                if found.kind == CommandKind::Incomplete && found.end == parsed.text.len() {
                    return Carried::Wait;
                }
                marked = apply_marks(&mut state, &marks, marked, found.end.saturating_sub(1));
                if found.kind == CommandKind::Sgr && trace.origins[index] >= offset {
                    sgr = true;
                    if preserved.is_none() {
                        let raw: String = parsed.text[index..found.end].iter().collect();
                        if !renderer.resolve(&escape(&raw)).is_empty() {
                            preserved = Some(raw);
                        }
                    }
                }
                state.command(&parsed.text, index, &found);
                index = found.end.max(index + 1);
            } else {
                index += 1;
            }
        }
        apply_marks(&mut state, &marks, marked, parsed.text.len());
        if state
            .link
            .as_ref()
            .is_some_and(|link| link.contains(['\r', '\n']))
        {
            return Carried::Wait;
        }
        if sgr {
            compact(&mut state.levels, renderer);
        }
        Carried::Ready(Self { state, preserved })
    }
}

/// The attributes the root and each enclosing frame would apply to one visible character.
fn attributes(levels: &[Level], renderer: &Renderer) -> String {
    let mut marked = String::new();
    for level in levels {
        marked.push_str(&level.header);
        for raw in &level.sgr {
            marked.push_str(&escape(raw));
        }
        marked.push('x');
    }
    renderer.resolve(&marked)
}

fn compact(levels: &mut [Level], renderer: &Renderer) {
    for index in 0..levels.len() {
        if levels[index].sgr.is_empty() {
            continue;
        }
        let expected = attributes(levels, renderer);
        let commands = std::mem::take(&mut levels[index].sgr);
        if attributes(levels, renderer) == expected {
            continue;
        }
        levels[index].sgr.extend(commands.last().cloned());
        if attributes(levels, renderer) == expected {
            continue;
        }
        levels[index].sgr = commands;
        let mut at = 0;
        while at < levels[index].sgr.len() {
            let raw = levels[index].sgr.remove(at);
            if !renderer.resolve(&escape(&raw)).is_empty()
                || attributes(levels, renderer) != expected
            {
                levels[index].sgr.insert(at, raw);
                at += 1;
            }
        }
    }
}

/// The byte offset of an ANSI escape sequence that is still incomplete at the end of marked text.
#[doc(hidden)]
#[must_use]
pub fn unfinished_sequence(text: &str) -> Option<usize> {
    if !text.contains([
        '\u{1b}', '\u{90}', '\u{98}', '\u{9b}', '\u{9d}', '\u{9e}', '\u{9f}',
    ]) {
        return None;
    }
    let input: Vec<char> = text.chars().collect();
    let mut trace = WireTrace::default();
    let parsed = parse_text(
        &input,
        &EMPTY_PALETTE,
        ParseOptions {
            any_token: true,
            main_glyphs: true,
            trace: Some(&mut trace),
        },
    );
    let mut index = 0;
    while index < parsed.text.len() {
        if let Some(found) = command(&parsed.text, index) {
            if found.kind == CommandKind::Incomplete && found.end == parsed.text.len() {
                return text
                    .char_indices()
                    .nth(trace.origins[index])
                    .map(|(byte, _)| byte);
            }
            index = found.end.max(index + 1);
        } else {
            index += 1;
        }
    }
    None
}

/// Terminal controls after the last standalone LF that contribute no row of their own.
#[doc(hidden)]
#[must_use]
pub fn controls_after_last_line(resolved: &str) -> String {
    let input: Vec<char> = resolved.chars().collect();
    let mut index = 0;
    let mut line = false;
    let mut only_controls = false;
    let mut kept = String::new();
    while index < input.len() {
        if let Some(found) = command(&input, index) {
            if only_controls
                && found.kind != CommandKind::Sgr
                && hyperlink_opens(&input, &found).is_none()
            {
                kept.extend(&input[index..found.end]);
            }
            index = found.end.max(index + 1);
        } else {
            if input[index] == '\n' {
                line = true;
                only_controls = true;
                kept.clear();
            } else {
                only_controls = false;
            }
            index += 1;
        }
    }
    if line && only_controls {
        kept
    } else {
        String::new()
    }
}

/// The resolved bytes after a row's already-written visible prefix and its new visible length.
/// Controls after the final visible character wait while the row is still growing.
#[doc(hidden)]
#[must_use]
pub fn resolved_row_suffix(row: &str, from: usize, growing: bool) -> (String, usize) {
    let input: Vec<char> = row.chars().collect();
    let mut position = 0;
    let mut shown = 0;
    let mut suffix = String::new();
    let mut visible_end = 0;
    while position < input.len() {
        if let Some(found) = command(&input, position) {
            if shown >= from {
                suffix.extend(&input[position..found.end]);
            }
            position = found.end.max(position + 1);
        } else {
            if shown >= from {
                suffix.push(input[position]);
                visible_end = suffix.len();
            }
            shown += 1;
            position += 1;
        }
    }
    if growing {
        suffix.truncate(visible_end);
    }
    (suffix, shown.max(from))
}
