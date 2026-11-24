//! Block parsing: normalized lines into paragraphs, headings, code, quotes, breaks, lists, and
//! table rows, with the author's blank-line separators recorded on every block.

use super::inline::{Inline, parse_inline};
use super::text::{blank, skip, split_lines, trim, trim_end, trim_start};

const CODE_INDENT: usize = 4;
const TAB_STOP: usize = 4;
const MAX_MARKER_INDENT: usize = 3;
const MAX_HEADING_LEVEL: usize = 6;
const MAX_ORDERED_DIGITS: usize = 9;

/// What a block holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockKind {
    /// Consecutive text lines, each read inline on its own and trimmed.
    Paragraph {
        /// One inline sequence per authored line.
        lines: Vec<Vec<Inline>>,
    },
    /// Consecutive lines whose text starts with `|`. The table is not parsed into cells.
    Table {
        /// One inline sequence per authored line.
        lines: Vec<Vec<Inline>>,
    },
    /// An ATX heading with a nonempty title.
    Heading {
        /// One to six.
        level: usize,
        /// The title, closing `#` run removed.
        text: Vec<Inline>,
    },
    /// Fenced or indented code, uninterpreted, with its indentation removed.
    Code {
        /// The code lines, interior empty lines kept.
        lines: Vec<String>,
    },
    /// A thematic break.
    Break {
        /// The authored marker line, trimmed.
        text: String,
    },
    /// A block quote.
    Quote {
        /// The quote's content.
        blocks: Vec<Block>,
    },
    /// A list; consecutive compatible items share one list.
    List {
        /// The first item's marker, which names the list's bullet or delimiter and start.
        marker: ListMarker,
        /// The items, in order.
        items: Vec<Item>,
    },
}

/// A block and the author's separator before it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    /// True when at least one blank line precedes the block inside its container.
    pub blank_before: bool,
    /// The block's content.
    pub kind: BlockKind,
}

/// One list item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    /// True when a blank line separates the item from the previous one. Never true for the first.
    pub blank_before: bool,
    /// The item's content blocks.
    pub blocks: Vec<Block>,
}

/// A list's identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListMarker {
    /// `-`, `+`, or `*`; a change of character starts a new list.
    Bullet {
        /// The authored character.
        character: char,
    },
    /// A number and `.` or `)`; a change of delimiter starts a new list.
    Ordered {
        /// The authored `.` or `)`.
        delimiter: char,
        /// The first item's number, which later items count up from.
        start: u32,
    },
}

/// Expands whitespace in a container prefix to source columns; tabs in text stay literal.
fn expanded_whitespace(prefix: &str, whitespace: &str) -> String {
    let mut expanded = prefix.to_owned();
    for character in whitespace.chars() {
        if character == '\t' {
            let width = TAB_STOP - (expanded.chars().count() % TAB_STOP);
            expanded.extend(std::iter::repeat_n(' ', width));
        } else {
            expanded.push(character);
        }
    }
    expanded
}

/// The byte length of a quote or list marker at the start of `rest`.
fn container_marker(rest: &str) -> Option<usize> {
    let bytes = rest.as_bytes();
    let ends = |index: usize| matches!(bytes.get(index), None | Some(b' ' | b'\t'));
    match bytes.first()? {
        b'>' => Some(1),
        b'-' | b'+' | b'*' => ends(1).then_some(1),
        b'0'..=b'9' => {
            let digits = bytes.iter().take_while(|b| b.is_ascii_digit()).count();
            let delimited = matches!(bytes.get(digits), Some(b'.' | b')'));
            (digits <= MAX_ORDERED_DIGITS && delimited && ends(digits + 1)).then_some(digits + 1)
        }
        _ => None,
    }
}

/// Expands only whitespace before text and between container markers.
fn expand_tabs(line: &str) -> String {
    let mut prefix = String::new();
    let mut index = 0;
    while index < line.len() {
        let rest = &line[index..];
        let whitespace = rest
            .bytes()
            .take_while(|b| matches!(b, b' ' | b'\t'))
            .count();
        prefix = expanded_whitespace(&prefix, &rest[..whitespace]);
        index += whitespace;
        match container_marker(&line[index..]) {
            None => {
                prefix.push_str(&line[index..]);
                return prefix;
            }
            Some(width) => {
                prefix.push_str(&line[index..index + width]);
                index += width;
            }
        }
    }
    prefix
}

/// The column of a line's first character that is not a space; a line of spaces gives its length.
fn indentation(line: &str) -> usize {
    line.bytes().take_while(|b| *b == b' ').count()
}

/// Only up to three spaces precede a block marker after its container's indentation.
fn marker_text(line: &str) -> Option<&str> {
    (indentation(line) <= MAX_MARKER_INDENT).then(|| trim_start(line))
}

/// An opening code fence.
#[derive(Debug, Clone, Copy)]
struct Fence {
    character: char,
    indent: usize,
    length: usize,
}

fn fence(line: &str) -> Option<Fence> {
    let text = marker_text(line)?;
    let character = text.chars().next().filter(|c| matches!(c, '`' | '~'))?;
    let length = text.chars().take_while(|c| *c == character).count();
    if length < 3 || (character == '`' && text[length..].contains('`')) {
        return None;
    }
    Some(Fence {
        character,
        indent: indentation(line),
        length,
    })
}

/// An ATX heading's level and title.
struct Title {
    level: usize,
    text: String,
}

/// The title without a closing run of `#` that whitespace separates from it.
fn without_closing_run(rest: &str) -> &str {
    let trimmed = trim_end(rest);
    let before = trimmed.trim_end_matches('#');
    if before.len() != trimmed.len()
        && before
            .chars()
            .next_back()
            .is_some_and(super::text::is_space)
    {
        trim(before)
    } else {
        trim(rest)
    }
}

fn heading(line: &str) -> Option<Title> {
    let text = marker_text(line)?;
    let level = text.bytes().take_while(|b| *b == b'#').count();
    if level == 0 || level > MAX_HEADING_LEVEL {
        return None;
    }
    let rest = &text[level..];
    if !rest.is_empty() && !rest.starts_with(super::text::is_space) {
        return None;
    }
    Some(Title {
        level,
        text: without_closing_run(rest).to_owned(),
    })
}

fn quote(line: &str) -> Option<&str> {
    let text = marker_text(line)?.strip_prefix('>')?;
    Some(text.strip_prefix(' ').unwrap_or(text))
}

/// A table row: a line whose text starts with `|`.
fn table_row(line: &str) -> bool {
    marker_text(line).is_some_and(|text| text.starts_with('|'))
}

fn thematic(line: &str) -> bool {
    let Some(text) = marker_text(line) else {
        return false;
    };
    let Some(character) = text.chars().next().filter(|c| matches!(c, '-' | '*' | '_')) else {
        return false;
    };
    text.chars()
        .all(|c| c == character || c == ' ' || c == '\t')
        && text.chars().filter(|c| *c == character).count() >= 3
}

/// A list marker line: its content column, its content, and its list's identity.
struct Opening {
    column: usize,
    content: String,
    marker: ListMarker,
}

fn list_item(line: &str) -> Option<Opening> {
    let text = marker_text(line)?;
    let width = match text.as_bytes().first()? {
        b'-' | b'+' | b'*' => 1,
        b'0'..=b'9' => {
            let digits = text.bytes().take_while(u8::is_ascii_digit).count();
            let delimited = matches!(text.as_bytes().get(digits), Some(b'.' | b')'));
            if digits > MAX_ORDERED_DIGITS || !delimited {
                return None;
            }
            digits + 1
        }
        _ => return None,
    };
    let rest = &text[width..];
    let whitespace = rest.bytes().take_while(|b| *b == b' ').count();
    if (whitespace == 0 && !rest.is_empty()) || thematic(line) {
        return None;
    }
    let empty = blank(rest);
    let padding = if empty || whitespace > CODE_INDENT {
        1
    } else {
        whitespace
    };
    let column = indentation(line) + width + padding;
    let content = if empty {
        String::new()
    } else {
        skip(line, column).to_owned()
    };
    Some(Opening {
        column,
        content,
        marker: list_marker(&text[..width]),
    })
}

/// List identity is the bullet character or the ordered delimiter, independently of numbering.
fn list_marker(spelling: &str) -> ListMarker {
    let last = spelling.chars().next_back().unwrap_or('-');
    if matches!(last, '.' | ')') {
        ListMarker::Ordered {
            delimiter: last,
            start: spelling[..spelling.len() - 1].parse().unwrap_or_default(),
        }
    } else {
        ListMarker::Bullet { character: last }
    }
}

/// All supported marker blocks interrupt a paragraph; indented code alone does not.
fn interrupts(line: &str) -> bool {
    fence(line).is_some()
        || heading(line).is_some()
        || quote(line).is_some()
        || thematic(line)
        || table_row(line)
        || list_item(line).is_some()
}

/// A closing fence holds only a matching run and whitespace.
fn closes_fence(line: &str, opening: &Fence) -> bool {
    let Some(text) = marker_text(line) else {
        return false;
    };
    let Some(character) = text.chars().next().filter(|c| matches!(c, '`' | '~')) else {
        return false;
    };
    let length = text.chars().take_while(|c| *c == character).count();
    blank(&text[length..]) && character == opening.character && length >= opening.length
}

/// Fences consume only their current container and remove at most the opening indentation.
fn fenced(lines: &[String], start: usize, opening: &Fence) -> (usize, Vec<String>) {
    let mut content = Vec::new();
    let mut index = start + 1;
    while index < lines.len() {
        let line = &lines[index];
        if closes_fence(line, opening) {
            return (index + 1, content);
        }
        content.push(skip(line, indentation(line).min(opening.indent)).to_owned());
        index += 1;
    }
    (index, content)
}

/// Indented code keeps interior empty lines; trailing blanks belong to the following block.
fn indented(lines: &[String], start: usize) -> (usize, Vec<String>) {
    let mut content = Vec::new();
    for line in &lines[start..] {
        if !blank(line) && indentation(line) < CODE_INDENT {
            break;
        }
        content.push(skip(line, CODE_INDENT).to_owned());
    }
    while content.last().is_some_and(|line| blank(line)) {
        content.pop();
    }
    (start + content.len(), content)
}

/// The active block and final visible paragraph of a container, tracked without parsing it.
struct ParagraphState {
    blank: bool,
    block: ParagraphBlock,
    open: bool,
}

enum ParagraphBlock {
    Closed,
    Paragraph,
    Indented,
    Fence(Fence),
    List {
        column: usize,
        item: Box<ParagraphState>,
    },
}

fn paragraph_state(content: &str) -> ParagraphState {
    let mut state = ParagraphState {
        blank: false,
        block: ParagraphBlock::Closed,
        open: false,
    };
    if !content.is_empty() {
        track_paragraph(&mut state, content);
    }
    state
}

/// A lazy line belongs only to an open paragraph, never across a blank or an interrupting marker.
fn lazy(state: &ParagraphState, line: &str) -> bool {
    state.open && !state.blank && (table_row(line) || !interrupts(line))
}

/// Nested items use the same indentation and lazy rules as the item's actual container collector.
fn continue_list(column: usize, item: &mut ParagraphState, line: &str, separated: bool) -> bool {
    if indentation(line) >= column {
        if separated {
            track_paragraph(item, "");
        }
        track_paragraph(item, skip(line, column));
        return true;
    }
    if !separated && lazy(item, line) {
        track_paragraph(item, trim(line));
        return true;
    }
    false
}

fn continue_block(state: &mut ParagraphState, line: &str, separated: bool) -> bool {
    let ParagraphState { block, open, .. } = state;
    match block {
        ParagraphBlock::Fence(opening) => {
            if closes_fence(line, opening) {
                *block = ParagraphBlock::Closed;
            }
            true
        }
        ParagraphBlock::List { column, item } => {
            let continued = continue_list(*column, item, line, separated);
            if continued {
                *open = item.open;
            }
            continued
        }
        ParagraphBlock::Paragraph => !separated && !interrupts(line),
        ParagraphBlock::Indented => indentation(line) >= CODE_INDENT,
        ParagraphBlock::Closed => false,
    }
}

/// An empty heading closes the active block but leaves the last visible block's paragraph state.
fn start_block(state: &mut ParagraphState, line: &str) {
    if let Some(opening) = fence(line) {
        state.block = ParagraphBlock::Fence(opening);
        state.open = false;
    } else if let Some(title) = heading(line) {
        state.block = ParagraphBlock::Closed;
        state.open = title.text.is_empty() && state.open;
    } else {
        start_container(state, line);
    }
}

/// Quotes and thematic breaks cannot end in a lazy paragraph; list content can.
fn start_container(state: &mut ParagraphState, line: &str) {
    if quote(line).is_some() || thematic(line) {
        state.block = ParagraphBlock::Closed;
        state.open = false;
    } else if let Some(opening) = list_item(line) {
        let item = paragraph_state(&opening.content);
        state.open = item.open;
        state.block = ParagraphBlock::List {
            column: opening.column,
            item: Box::new(item),
        };
    } else {
        state.open = indentation(line) < CODE_INDENT;
        state.block = if state.open {
            ParagraphBlock::Paragraph
        } else {
            ParagraphBlock::Indented
        };
    }
}

/// Blank separators are deferred until a following line proves they belong to a nested item.
fn track_paragraph(state: &mut ParagraphState, line: &str) {
    if blank(line) {
        state.blank = true;
        return;
    }
    let separated = state.blank;
    state.blank = false;
    if !continue_block(state, line, separated) {
        start_block(state, line);
    }
}

/// The index of the next nonblank line at or after `start`.
fn nonblank(lines: &[String], start: usize) -> usize {
    lines[start.min(lines.len())..]
        .iter()
        .position(|line| !blank(line))
        .map_or(lines.len(), |offset| start + offset)
}

/// The next line of an item's container, if the line belongs to it. A blank line advances one at a
/// time, so the caller sees each separator.
fn item_continuation(
    lines: &[String],
    index: usize,
    column: usize,
    paragraph: &ParagraphState,
) -> Option<(usize, String)> {
    let candidate = nonblank(lines, index);
    let line = lines.get(candidate)?;
    if candidate > index {
        return (indentation(line) >= column).then(|| (index + 1, String::new()));
    }
    if indentation(line) >= column {
        return Some((index + 1, skip(line, column).to_owned()));
    }
    lazy(paragraph, line).then(|| (index + 1, trim(line).to_owned()))
}

/// Collects one item's container, leaving separators for the list or its following block.
fn item_lines(lines: &[String], start: usize, opening: &Opening) -> (usize, Vec<String>) {
    let mut content = if opening.content.is_empty() {
        Vec::new()
    } else {
        vec![opening.content.clone()]
    };
    let mut paragraph = paragraph_state(&opening.content);
    let mut index = start + 1;
    while let Some((next, text)) = item_continuation(lines, index, opening.column, &paragraph) {
        track_paragraph(&mut paragraph, &text);
        content.push(text);
        index = next;
    }
    (index, content)
}

fn same_list(left: ListMarker, right: ListMarker) -> bool {
    match (left, right) {
        (ListMarker::Bullet { character: a }, ListMarker::Bullet { character: b }) => a == b,
        (ListMarker::Ordered { delimiter: a, .. }, ListMarker::Ordered { delimiter: b, .. }) => {
            a == b
        }
        _ => false,
    }
}

/// A compatible item after any blanks; the blank is kept only when this item follows it.
fn following_item(
    lines: &[String],
    start: usize,
    identity: ListMarker,
) -> Option<(bool, usize, Opening)> {
    let index = nonblank(lines, start);
    let opening = list_item(lines.get(index)?)?;
    same_list(identity, opening.marker).then_some((index > start, index, opening))
}

/// Consecutive compatible items share numbering even when the author separates them.
fn list(lines: &[String], start: usize, first: Opening) -> (usize, Vec<Item>) {
    let identity = first.marker;
    let mut items = Vec::new();
    let mut next = Some((false, start, first));
    let mut index = start;
    while let Some((blank_before, at, opening)) = next {
        let (end, content) = item_lines(lines, at, &opening);
        items.push(Item {
            blank_before,
            blocks: parse_blocks(&content),
        });
        index = end;
        next = following_item(lines, index, identity);
    }
    (index, items)
}

/// Reads code before all other markers, without interpreting its authored contents. Indented code
/// does not open directly after table rows: that line reads as paragraph text.
fn code_block(lines: &[String], start: usize, after_rows: bool) -> Option<(BlockKind, usize)> {
    let line = &lines[start];
    let (index, code) = if let Some(opening) = fence(line) {
        fenced(lines, start, &opening)
    } else if !after_rows && indentation(line) >= CODE_INDENT {
        indented(lines, start)
    } else {
        return None;
    };
    Some((BlockKind::Code { lines: code }, index))
}

fn heading_block(lines: &[String], start: usize) -> Option<(BlockKind, usize)> {
    let title = heading(&lines[start])?;
    Some((
        BlockKind::Heading {
            level: title.level,
            text: parse_inline(&title.text),
        },
        start + 1,
    ))
}

/// Every quote line must carry its own marker; an unmarked line ends its container.
fn quote_block(lines: &[String], start: usize) -> Option<(BlockKind, usize)> {
    let content: Vec<String> = lines[start..]
        .iter()
        .map_while(|line| quote(line).map(str::to_owned))
        .collect();
    if content.is_empty() {
        return None;
    }
    Some((
        BlockKind::Quote {
            blocks: parse_blocks(&content),
        },
        start + content.len(),
    ))
}

fn break_block(lines: &[String], start: usize) -> Option<(BlockKind, usize)> {
    let line = &lines[start];
    thematic(line).then(|| {
        (
            BlockKind::Break {
                text: trim(line).to_owned(),
            },
            start + 1,
        )
    })
}

fn list_block(lines: &[String], start: usize) -> Option<(BlockKind, usize)> {
    let opening = list_item(&lines[start])?;
    let marker = opening.marker;
    let (index, items) = list(lines, start, opening);
    Some((BlockKind::List { marker, items }, index))
}

/// Consecutive table rows form one block that keeps each authored line, read inline per line.
fn table_block(lines: &[String], start: usize) -> Option<(BlockKind, usize)> {
    let content: Vec<Vec<Inline>> = lines[start..]
        .iter()
        .take_while(|line| table_row(line))
        .map(|line| parse_inline(trim(line)))
        .collect();
    if content.is_empty() {
        return None;
    }
    let index = start + content.len();
    Some((BlockKind::Table { lines: content }, index))
}

/// Paragraphs preserve each authored line and end at a blank or a supported marker.
fn paragraph_block(lines: &[String], start: usize) -> (BlockKind, usize) {
    let mut content = vec![parse_inline(trim(&lines[start]))];
    let mut index = start + 1;
    while index < lines.len() && !blank(&lines[index]) && !interrupts(&lines[index]) {
        content.push(parse_inline(trim(&lines[index])));
        index += 1;
    }
    (BlockKind::Paragraph { lines: content }, index)
}

/// Marker precedence is shared by every nested container.
fn block_at(lines: &[String], start: usize, after_rows: bool) -> (BlockKind, usize) {
    code_block(lines, start, after_rows)
        .or_else(|| heading_block(lines, start))
        .or_else(|| quote_block(lines, start))
        .or_else(|| break_block(lines, start))
        .or_else(|| list_block(lines, start))
        .or_else(|| table_block(lines, start))
        .unwrap_or_else(|| paragraph_block(lines, start))
}

/// Parses a container's already normalized lines.
fn parse_blocks(lines: &[String]) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let start = nonblank(lines, index);
        if start >= lines.len() {
            break;
        }
        let after_rows = start == index
            && blocks
                .last()
                .is_some_and(|b| matches!(b.kind, BlockKind::Table { .. }));
        let (kind, end) = block_at(lines, start, after_rows);
        blocks.push(Block {
            blank_before: start > index,
            kind,
        });
        index = end;
    }
    without_empty_headings(blocks)
}

/// An empty heading is no block, but never erases a blank line authored before it.
fn without_empty_headings(blocks: Vec<Block>) -> Vec<Block> {
    let mut result = Vec::new();
    let mut blank_before = false;
    for block in blocks {
        blank_before |= block.blank_before;
        let empty = matches!(&block.kind, BlockKind::Heading { text, .. } if text.is_empty());
        if !empty {
            result.push(Block {
                blank_before,
                kind: block.kind,
            });
            blank_before = false;
        }
    }
    result
}

/// Parses Markdown source: splits it at the pack's line terminators, expands source-column tabs,
/// and reads the blocks.
#[must_use]
pub fn parse_markdown(source: &str) -> Vec<Block> {
    let lines: Vec<String> = split_lines(source).into_iter().map(expand_tabs).collect();
    parse_blocks(&lines)
}
