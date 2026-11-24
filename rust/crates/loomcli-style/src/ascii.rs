//! The ASCII lane: marked text whose decoded characters are printable ASCII and LF, framed by
//! style, padding, no-wrap, and glyph frames, resolved and measured in one pass over the input.
//!
//! Every such character is a grapheme cluster of one column, no ANSI command can occur, and no tab
//! or carriage return needs a stop or an atom, so the full pipeline's layout reduces to counting
//! bytes and its output to the same units in the same order: each run of characters with its
//! scope's attributes, each padding frame's spaces with the attributes it opened under, including
//! the empty run a padding frame inserts on an aligned side, and each line ending. Any input
//! outside the lane answers `None`, and the caller takes the full pipeline.

use std::rc::Rc;

use crate::rendering::Capabilities;
use crate::state::{Attributes, apply_operations, transition};
use crate::style::{Alignment, CLOSE, CORE_TOKENS, HEADER_END, OPEN};
use crate::theme::Palette;
use crate::wire::{Header, Padding, canonical_header, parse_header};

/// What one laid-out unit writes.
#[derive(Debug, Clone, Copy)]
enum Piece {
    /// Input bytes `start..end`, printable ASCII.
    Input(usize, usize),
    /// A glyph's form, printable ASCII.
    Form(&'static str),
    /// Spaces a padding frame inserts, possibly none.
    Spaces(usize),
    /// A line ending, LF.
    Ending,
}

/// One laid-out unit and the attributes it is written with.
#[derive(Debug, Clone)]
struct Item {
    piece: Piece,
    attributes: Rc<Attributes>,
}

impl Item {
    fn columns(&self) -> usize {
        match self.piece {
            Piece::Input(start, end) => end - start,
            Piece::Form(form) => form.len(),
            Piece::Spaces(count) => count,
            Piece::Ending => 0,
        }
    }
}

/// A frame open in the input.
enum Open {
    Style {
        previous: Rc<Attributes>,
    },
    Pad {
        start: usize,
        padding: Padding,
        attributes: Rc<Attributes>,
    },
    Nowrap,
}

/// Whether a glyph form or a run is printable ASCII, the lane's only characters.
fn printable(text: &str) -> bool {
    text.bytes().all(|byte| (0x20..0x7f).contains(&byte))
}

/// The units of one padding frame's content padded as the full layout pads them: each line short
/// of the width, except a trailing line with no text, gains spaces before and after it by the
/// alignment, both sides present even when one is empty. A frame every line already fills is left
/// as it is.
fn pad_items(content: Vec<Item>, padding: Padding, attributes: &Rc<Attributes>) -> Vec<Item> {
    if padding.width == 0 {
        return content;
    }
    let mut lines: Vec<(usize, usize, usize, bool)> = Vec::new();
    let mut start = 0;
    let mut columns = 0;
    for (index, item) in content.iter().enumerate() {
        if matches!(item.piece, Piece::Ending) {
            lines.push((start, index, columns, true));
            start = index + 1;
            columns = 0;
        } else {
            columns += item.columns();
        }
    }
    lines.push((start, content.len(), columns, false));
    let count = lines.len();
    // A trailing line with no text: in this lane a line has text exactly when it has columns.
    let trailing_empty =
        |index: usize, columns: usize| index > 0 && index + 1 == count && columns == 0;
    let minimum = lines
        .iter()
        .enumerate()
        .filter(|(index, line)| !trailing_empty(*index, line.2))
        .map(|(_, line)| line.2)
        .min()
        .unwrap_or(usize::MAX);
    if minimum >= padding.width {
        return content;
    }
    let mut padded = Vec::with_capacity(content.len() + 2 * count);
    for (index, &(start, end, columns, ending)) in lines.iter().enumerate() {
        let missing = padding.width.saturating_sub(columns);
        let line = content.get(start..end).unwrap_or_default();
        if trailing_empty(index, columns) || missing == 0 {
            padded.extend_from_slice(line);
        } else {
            let before = match padding.align {
                Alignment::Left => 0,
                Alignment::Right => missing,
                Alignment::Center => missing / 2,
            };
            padded.push(Item {
                piece: Piece::Spaces(before),
                attributes: Rc::clone(attributes),
            });
            padded.extend_from_slice(line);
            padded.push(Item {
                piece: Piece::Spaces(missing - before),
                attributes: Rc::clone(attributes),
            });
        }
        if ending {
            if let Some(item) = content.get(end) {
                padded.push(item.clone());
            }
        }
    }
    padded
}

/// Marked text laid out in the lane, or `None` when the input leaves it.
fn lay_out(input: &str, palette: &Palette, main_glyphs: bool) -> Option<Vec<Item>> {
    let known = |name: &str| CORE_TOKENS.contains(&name) || palette.contains(name);
    let mut items: Vec<Item> = Vec::new();
    let mut stack: Vec<Open> = Vec::new();
    let mut active = Rc::new(Attributes::default());
    let bytes = input.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let byte = bytes.get(cursor).copied().unwrap_or(0);
        if (0x20..0x7f).contains(&byte) {
            let end = bytes
                .get(cursor..)
                .unwrap_or_default()
                .iter()
                .position(|byte| !(0x20..0x7f).contains(byte))
                .map_or(bytes.len(), |offset| cursor + offset);
            items.push(Item {
                piece: Piece::Input(cursor, end),
                attributes: Rc::clone(&active),
            });
            cursor = end;
            continue;
        }
        if byte == b'\n' {
            items.push(Item {
                piece: Piece::Ending,
                attributes: Rc::clone(&active),
            });
            cursor += 1;
            continue;
        }
        let character = input.get(cursor..)?.chars().next()?;
        let after = cursor + character.len_utf8();
        if character == CLOSE && !stack.is_empty() {
            close(stack.pop(), &mut items, &mut active);
            cursor = after;
            continue;
        }
        // A literal delimiter, an escape, and any other character leave the lane.
        if character != OPEN {
            return None;
        }
        let end = after + input.get(after..)?.find(HEADER_END)?;
        let spelled = input.get(after..end)?;
        cursor = end + HEADER_END.len_utf8();
        let header = canonical_header(spelled, &known).unwrap_or_else(|| {
            let header: Vec<char> = spelled.chars().collect();
            parse_header(&header, &known)
        });
        match header? {
            Header::Glyph(glyph) => {
                if !input.get(cursor..)?.starts_with(CLOSE) {
                    return None;
                }
                let form = if main_glyphs {
                    glyph.main_form()
                } else {
                    glyph.compatibility_form()
                };
                if !printable(form) {
                    return None;
                }
                items.push(Item {
                    piece: Piece::Form(form),
                    attributes: Rc::clone(&active),
                });
                cursor += CLOSE.len_utf8();
            }
            Header::Nowrap => stack.push(Open::Nowrap),
            Header::Style(operations) => {
                let next = Rc::new(apply_operations(&active, &operations, palette));
                stack.push(Open::Style {
                    previous: std::mem::replace(&mut active, next),
                });
            }
            Header::Pad(padding) => stack.push(Open::Pad {
                start: items.len(),
                padding,
                attributes: Rc::clone(&active),
            }),
        }
    }
    while !stack.is_empty() {
        close(stack.pop(), &mut items, &mut active);
    }
    Some(items)
}

/// Closes one frame: a style restores the attributes around it, a padding frame pads its content.
fn close(frame: Option<Open>, items: &mut Vec<Item>, active: &mut Rc<Attributes>) {
    match frame {
        Some(Open::Style { previous }) => *active = previous,
        Some(Open::Pad {
            start,
            padding,
            attributes,
        }) => {
            let content = items.split_off(start.min(items.len()));
            items.extend(pad_items(content, padding, &attributes));
        }
        Some(Open::Nowrap) | None => {}
    }
}

fn write_piece(result: &mut String, input: &str, piece: Piece) {
    match piece {
        Piece::Input(start, end) => result.push_str(input.get(start..end).unwrap_or_default()),
        Piece::Form(form) => result.push_str(form),
        Piece::Spaces(count) => result.extend(std::iter::repeat_n(' ', count)),
        Piece::Ending => result.push('\n'),
    }
}

/// Marked text resolved in the lane, or `None` when it leaves the lane.
pub(crate) fn resolve(input: &str, palette: &Palette, caps: &Capabilities) -> Option<String> {
    let items = lay_out(input, palette, caps.main_glyphs)?;
    let mut result = String::with_capacity(input.len());
    if !caps.color && !caps.modifiers {
        for item in &items {
            write_piece(&mut result, input, item.piece);
        }
        return Some(result);
    }
    let empty = Rc::new(Attributes::default());
    let mut previous = Rc::clone(&empty);
    for item in &items {
        if !Rc::ptr_eq(&item.attributes, &previous) {
            result.push_str(&transition(&previous, &item.attributes, caps));
            previous = Rc::clone(&item.attributes);
        }
        write_piece(&mut result, input, item.piece);
    }
    result.push_str(&transition(&previous, &empty, caps));
    Some(result)
}

/// The columns of marked text in the lane, its widest line, or `None` when it leaves the lane.
pub(crate) fn width(input: &str, palette: &Palette, caps: &Capabilities) -> Option<usize> {
    let items = lay_out(input, palette, caps.main_glyphs)?;
    let mut widest = 0;
    let mut columns = 0;
    for item in &items {
        if matches!(item.piece, Piece::Ending) {
            widest = widest.max(columns);
            columns = 0;
        } else {
            columns += item.columns();
        }
    }
    Some(widest.max(columns))
}

#[cfg(test)]
mod tests {
    use super::{resolve, width};
    use crate::color::{Ansi16Color, ColorDepth};
    use crate::glyph::Glyph;
    use crate::rendering::Capabilities;
    use crate::resolve::{marked_width, resolve_text};
    use crate::style::{Alignment, escape, nowrap, pad, style};
    use crate::theme::{Palette, Theme, ThemeMapping};

    /// A palette with colored, modified, resetting, and declared-but-empty tokens.
    fn palette() -> Palette {
        let mapping = ThemeMapping::new()
            .entry("dim", style().ansi256(245).faint())
            .entry("highlight", style().rgb(201, 123, 54).bold())
            .entry("primary", style().reset_foreground())
            .entry("error", style().red().underline().bg_ansi256(52))
            .declare("quiet");
        match Theme::build(&mapping) {
            Ok(theme) => theme.palette(None),
            Err(error) => unreachable!("the test theme is valid: {error}"),
        }
    }

    /// Every combination of the capabilities, at each color depth.
    fn every_capability() -> Vec<Capabilities> {
        let mut all = Vec::new();
        for depth in [
            ColorDepth::Ansi16,
            ColorDepth::Ansi256,
            ColorDepth::Truecolor,
        ] {
            for bits in 0_u8..32 {
                all.push(Capabilities {
                    color: bits & 1 != 0,
                    modifiers: bits & 2 != 0,
                    hyperlinks: bits & 4 != 0,
                    terminal_controls: bits & 8 != 0,
                    depth,
                    main_glyphs: bits & 16 != 0,
                });
            }
        }
        all
    }

    /// A linear congruential sequence, so the sample is the same on every run.
    struct Seeded(u64);

    impl Seeded {
        fn below(&mut self, count: usize) -> usize {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            usize::try_from(self.0 >> 33).unwrap_or(0) % count.max(1)
        }
    }

    /// Pieces inside the lane and at its edges: words, spaces, line endings, glyphs with ASCII
    /// compatibility forms, and the delimiters, escapes, controls, tabs, carriage returns, wide,
    /// combining, and other characters that leave it.
    const PIECES: [&str; 34] = [
        "a",
        "word",
        " ",
        "   ",
        "x y",
        "\n",
        "\n\n",
        "",
        "{}",
        "~!",
        "\u{e000}[\"bogus\"]\u{e001}",
        "\u{e000}[\"style\",[[\"token\",\"nope\"]]]\u{e001}",
        "\u{e000}[\"style\",[[\"modifier\",\"italic\"]]]\u{e001}",
        "\u{e000}[\"pad\",5,\"center\"]\u{e001}",
        "\u{e000}no header end",
        "\u{e002}",
        "\u{e001}",
        "\u{e003}E000",
        "\u{e003}zz",
        "\u{1b}[31m",
        "\u{1b}]8;;https://example.com\u{1b}\\",
        "\t",
        "a\tb",
        "\r\n",
        "\r",
        "\u{7}",
        "\u{9b}1m",
        "\u{65e5}\u{672c}",
        "e\u{301}",
        "\u{301}",
        "\u{1f600}",
        "caf\u{e9}",
        "\u{600}",
        "\u{7f}",
    ];

    fn sample(next: &mut Seeded, depth: usize) -> String {
        let mut text = String::new();
        for _ in 0..1 + next.below(5) {
            let choice = next.below(if depth > 3 { 10 } else { 22 });
            let piece = match choice {
                // Most pieces stay in the lane, so most samples do too.
                0..=7 => ["a", "word", " ", "\n", "x y", "path.0"][next.below(6)].to_owned(),
                8 if next.below(3) == 0 => PIECES[next.below(PIECES.len())].to_owned(),
                8 => "words".to_owned(),
                9 => {
                    let glyph = Glyph::ALL[next.below(Glyph::ALL.len())];
                    glyph.to_string()
                }
                10 => style().token("dim").apply(&sample(next, depth + 1)),
                11 => style().token("highlight").apply(&sample(next, depth + 1)),
                12 => style().token("primary").apply(&sample(next, depth + 1)),
                13 => style()
                    .token("error")
                    .bold()
                    .apply(&sample(next, depth + 1)),
                14 => style().token("quiet").apply(&sample(next, depth + 1)),
                15 => style()
                    .green()
                    .italic()
                    .reset()
                    .bold()
                    .apply(&sample(next, depth + 1)),
                16 => style()
                    .faint()
                    .foreground(Ansi16Color::Blue)
                    .apply(&sample(next, depth + 1)),
                17 => nowrap(&sample(next, depth + 1)),
                18 => escape(&sample(next, depth + 1)),
                _ => {
                    let align =
                        [Alignment::Left, Alignment::Right, Alignment::Center][next.below(3)];
                    match pad(&sample(next, depth + 1), next.below(13), align) {
                        Ok(padded) => padded,
                        Err(error) => unreachable!("a small width pads: {error}"),
                    }
                }
            };
            text.push_str(&piece);
        }
        text
    }

    fn samples() -> Vec<String> {
        let mut next = Seeded(7);
        let mut texts: Vec<String> = (0..2000).map(|_| sample(&mut next, 0)).collect();
        texts.extend(
            [
                "",
                "plain",
                "\u{e000}[\"style\",[[\"token\",\"dim\"]]]\u{e001}\u{e000}[\"pad\",4,\"left\"]\u{e001}kind\u{e002}\u{e002}  \u{e000}[\"style\",[[\"token\",\"highlight\"]]]\u{e001}users.0\u{e002}\n",
                "\u{e000}[\"pad\",6,\"right\"]\u{e001}a\nbcd\n\u{e002}",
                "\u{e000}[\"pad\",6,\"center\"]\u{e001}\u{e000}[\"pad\",3,\"left\"]\u{e001}\u{e002}\nx\u{e002}",
                "\u{e000}[\"style\",[[\"modifier\",\"bold\"]]]\u{e001}\u{e000}[\"pad\",3,\"left\"]\u{e001}\u{e000}[\"style\",[[\"foreground\",\"red\"]]]\u{e001}x",
                "\u{e000}[\"glyph\",\"bullet\"]\u{e001}x",
                "\u{e000}[\"pad\",2,\"left\"]\u{e001}\u{e000}[\"glyph\",\"bullet\"]\u{e001}\u{e002}\u{e002}",
            ]
            .map(str::to_owned),
        );
        texts
    }

    #[test]
    fn the_lane_resolves_and_measures_as_the_full_pipeline_does() {
        let palette = palette();
        let mut accepted = 0;
        let mut found = Vec::new();
        let texts = samples();
        for text in &texts {
            let input: Vec<char> = text.chars().collect();
            for caps in every_capability() {
                if let Some(resolved) = resolve(text, &palette, &caps) {
                    accepted += 1;
                    if resolved != resolve_text(&input, &palette, &caps) {
                        found.push(format!("resolve {text:?} under {caps:?}"));
                    }
                }
                if let Some(columns) = width(text, &palette, &caps) {
                    if columns != marked_width(&input, &palette, &caps) {
                        found.push(format!("width {text:?} under {caps:?}"));
                    }
                }
            }
        }
        assert_eq!(found, Vec::<String>::new());
        let total = texts.len() * every_capability().len();
        assert!(accepted > total / 6, "{accepted} of {total} in the lane");
        assert!(accepted < total, "{accepted} of {total} in the lane");
    }

    #[test]
    fn text_outside_the_lane_takes_the_full_pipeline() {
        let palette = palette();
        let caps = Capabilities::PLAIN;
        for piece in [
            "\u{e002}",
            "\u{e003}E000",
            "\u{e000}[\"bogus\"]\u{e001}x",
            "\u{1b}[31m",
            "a\tb",
            "\r\n",
            "\u{301}",
            "caf\u{e9}",
            "\u{e000}[\"glyph\",\"bullet\"]\u{e001}x",
        ] {
            assert_eq!(resolve(piece, &palette, &caps), None, "{piece:?}");
        }
    }
}
