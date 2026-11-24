//! A Command's Markdown details in roff's own way: man fills a paragraph and wraps it to the
//! reader's width, so the author's line breaks inside a paragraph are not kept, while code keeps
//! every line. The details are parsed with the parser help uses.

use super::roff::{self, Fill, Font, Run, request, text_line, write_runs};
use crate::markdown::{Block, BlockKind, Inline, Item, ListMarker, parse_markdown};

/// The fonts that surround an inline construct.
#[derive(Clone, Copy)]
struct Modifiers {
    bold: bool,
    italic: bool,
}

const REGULAR: Modifiers = Modifiers {
    bold: false,
    italic: false,
};
const STRONG: Modifiers = Modifiers {
    bold: true,
    italic: false,
};

/// The width of a bullet item's marker and its space.
const BULLET_WIDTH: usize = 2;
const BULLET_MARKER: &str = "\\(bu";
const QUOTE_INDENT: usize = 4;

/// The space after an ordered marker, which its width counts.
const MARKER_SPACE: usize = 1;

/// Whether a block is prose that man fills: a paragraph or a run of table rows.
fn is_filled_text(block: Option<&Block>) -> bool {
    matches!(
        block.map(|block| &block.kind),
        Some(BlockKind::Paragraph { .. } | BlockKind::Table { .. })
    )
}

/// The lines of a paragraph or table block.
fn text_lines(kind: &BlockKind) -> Option<&Vec<Vec<Inline>>> {
    match kind {
        BlockKind::Paragraph { lines } | BlockKind::Table { lines } => Some(lines),
        _ => None,
    }
}

/// The blocks as the man page reads them. Man fills every paragraph, so a run of table rows reads
/// as paragraph text: rows join the paragraph they follow directly, with no blank line between,
/// and so does a paragraph that follows them.
fn filled(blocks: &[Block]) -> Vec<Block> {
    let mut result: Vec<Block> = Vec::new();
    let mut after_table = false;
    for block in blocks {
        let is_table = matches!(block.kind, BlockKind::Table { .. });
        let joins = is_filled_text(Some(block))
            && is_filled_text(result.last())
            && !block.blank_before
            && (after_table || is_table);
        if joins {
            if let (Some(previous), Some(lines)) = (result.last_mut(), text_lines(&block.kind)) {
                let mut held = text_lines(&previous.kind).cloned().unwrap_or_default();
                held.extend(lines.iter().cloned());
                previous.kind = BlockKind::Paragraph { lines: held };
            }
        } else if let BlockKind::Table { lines } = &block.kind {
            result.push(Block {
                blank_before: block.blank_before,
                kind: BlockKind::Paragraph {
                    lines: lines.clone(),
                },
            });
        } else {
            result.push(block.clone());
        }
        after_table = is_table;
    }
    result
}

/// The font the modifiers combine to.
fn font_of(modifiers: Modifiers) -> Font {
    match (modifiers.bold, modifiers.italic) {
        (true, true) => Font::BoldItalic,
        (true, false) => Font::Bold,
        (false, true) => Font::Italic,
        (false, false) => Font::Regular,
    }
}

/// The text runs print without their fonts, which a link compares with its destination.
fn plain(runs: &[Run]) -> String {
    runs.iter().map(|run| run.text.as_str()).collect()
}

/// The runs of one line of inline constructs. Emphasis is italic, strong emphasis is bold, and a
/// code span is bold without its backticks; the fonts combine.
fn inline_runs(nodes: &[Inline], modifiers: Modifiers) -> Vec<Run> {
    nodes
        .iter()
        .flat_map(|node| match node {
            Inline::Text(text) | Inline::Address(text) => {
                vec![Run::new(text.clone(), font_of(modifiers))]
            }
            Inline::Code { content, .. } => {
                let code = Modifiers {
                    bold: true,
                    italic: modifiers.italic,
                };
                vec![Run::new(content.clone(), font_of(code))]
            }
            Inline::Emphasis { children, strong } => inline_runs(
                children,
                Modifiers {
                    bold: modifiers.bold || *strong,
                    italic: modifiers.italic || !*strong,
                },
            ),
            Inline::Link {
                children,
                destination,
            }
            | Inline::Image {
                children,
                destination,
            } => link_runs(children, destination, modifiers),
        })
        .collect()
}

/// A link prints its text, a space, and its destination in angle brackets. When the text prints
/// exactly as the destination, the text alone prints, in its own fonts; when it prints nothing but
/// whitespace, the destination alone prints, so no line starts with the space, which roff reads as
/// a break. An image prints as a link with the same text.
fn link_runs(children: &[Inline], destination: &str, modifiers: Modifiers) -> Vec<Run> {
    let mut text = inline_runs(children, modifiers);
    let printed = plain(&text);
    let font = font_of(modifiers);
    if printed == destination {
        return text;
    }
    if printed.trim().is_empty() {
        return vec![Run::new(destination, font)];
    }
    text.push(Run::new(format!(" <{destination}>"), font));
    text
}

/// One line of inline constructs as a roff text line.
fn inline_line(nodes: &[Inline], modifiers: Modifiers) -> String {
    text_line(&write_runs(&inline_runs(nodes, modifiers)))
}

/// Code lines in no-fill text: the blank lines at its ends dropped, each line without the
/// whitespace at its end, and an empty line written `\&`, so the page holds no blank line.
fn code_lines(lines: &[String]) -> Vec<String> {
    let content: Vec<&str> = lines.iter().map(|line| line.trim_end()).collect();
    let Some(first) = content.iter().position(|line| !line.is_empty()) else {
        return Vec::new();
    };
    let end = content
        .iter()
        .rposition(|line| !line.is_empty())
        .map_or(first, |last| last + 1);
    content[first..end]
        .iter()
        .map(|line| {
            if line.is_empty() {
                "\\&".to_owned()
            } else {
                text_line(&roff::escape_text(line, Fill::NoFill))
            }
        })
        .collect()
}

/// The state of one container: the lines it wrote, whether a block precedes the next one, and
/// whether it is the top level of the details, where a heading is an `.SS`.
struct Container {
    lines: Vec<String>,
    preceded: bool,
    top_level: bool,
}

impl Container {
    /// The `.PP` a block writes when a block precedes it in its container.
    fn paragraph_break(&self) -> Vec<String> {
        if self.preceded {
            vec![".PP".to_owned()]
        } else {
            Vec::new()
        }
    }

    /// A block's lines after its `.PP`, or none for a block that prints nothing.
    fn opened(&self, lines: Vec<String>) -> Vec<String> {
        if lines.is_empty() {
            lines
        } else {
            self.paragraph_break().into_iter().chain(lines).collect()
        }
    }
}

/// Code lines in no-fill text, or none for code with no other line.
fn wrapped_code(lines: &[String]) -> Vec<String> {
    let code = code_lines(lines);
    if code.is_empty() {
        return code;
    }
    let mut wrapped = vec![".nf".to_owned()];
    wrapped.extend(code);
    wrapped.push(".fi".to_owned());
    wrapped
}

/// The lines of blocks inside an `.RS`, where the first block writes no paragraph request.
fn nested_lines(blocks: &[Block]) -> Vec<String> {
    let mut nested = Container {
        lines: Vec::new(),
        preceded: false,
        top_level: false,
    };
    for block in filled(blocks) {
        write_block(&mut nested, &block);
    }
    nested.lines
}

/// Lines indented in `.RS` and `.RE`, or none when there are none to indent.
fn indented(width: usize, lines: Vec<String>) -> Vec<String> {
    if lines.is_empty() {
        return lines;
    }
    let mut wrapped = vec![format!(".RS {width}")];
    wrapped.extend(lines);
    wrapped.push(".RE".to_owned());
    wrapped
}

/// The lines of an item's first block when it is a paragraph, or a heading printed in bold.
fn lead_lines(kind: &BlockKind) -> Vec<String> {
    match kind {
        BlockKind::Paragraph { lines } => lines
            .iter()
            .map(|line| inline_line(line, REGULAR))
            .collect(),
        BlockKind::Heading { text, .. } => vec![inline_line(text, STRONG)],
        _ => Vec::new(),
    }
}

/// One list item: `.IP` with its marker and width, then its blocks. A first paragraph or heading
/// follows the `.IP`, and the later blocks follow in `.PP` and `.RS`; otherwise every block is in
/// `.RS` right after the `.IP`.
fn item_lines(item: &Item, marker: &str, width: usize) -> Vec<String> {
    let mut lines = vec![format!(".IP {marker} {width}")];
    let blocks = filled(&item.blocks);
    let Some((first, rest)) = blocks.split_first() else {
        return lines;
    };
    if !matches!(
        first.kind,
        BlockKind::Paragraph { .. } | BlockKind::Heading { .. }
    ) {
        lines.extend(indented(width, nested_lines(&item.blocks)));
        return lines;
    }
    lines.extend(lead_lines(&first.kind));
    let later = indented(width, nested_lines(rest));
    if !later.is_empty() {
        lines.push(".PP".to_owned());
        lines.extend(later);
    }
    lines
}

/// A list's items, each marker counting up by one from the first ordered item's number.
fn list_lines(marker: &ListMarker, items: &[Item]) -> Vec<String> {
    items
        .iter()
        .enumerate()
        .flat_map(|(index, item)| match marker {
            ListMarker::Bullet { .. } => item_lines(item, BULLET_MARKER, BULLET_WIDTH),
            ListMarker::Ordered { delimiter, start } => {
                let number = u64::from(*start) + index as u64;
                let label = format!("{number}{delimiter}");
                item_lines(
                    item,
                    &roff::escape(&label),
                    label.chars().count() + MARKER_SPACE,
                )
            }
        })
        .collect()
}

/// The lines one block writes, its `.PP` included, or none for a block that prints nothing. A
/// paragraph, a code block, a quote, a thematic break, and a heading inside a list item or a quote
/// write their `.PP` when a block precedes them; a list item and a top-level heading space
/// themselves.
fn block_lines(container: &Container, block: &Block) -> Vec<String> {
    match &block.kind {
        BlockKind::Paragraph { .. } => container
            .paragraph_break()
            .into_iter()
            .chain(lead_lines(&block.kind))
            .collect(),
        BlockKind::Table { lines } => container
            .paragraph_break()
            .into_iter()
            .chain(lines.iter().map(|line| inline_line(line, REGULAR)))
            .collect(),
        BlockKind::Heading { text, .. } => {
            if container.top_level {
                let title = plain(&inline_runs(text, REGULAR));
                vec![request("SS", &[&title])]
            } else {
                container
                    .paragraph_break()
                    .into_iter()
                    .chain(lead_lines(&block.kind))
                    .collect()
            }
        }
        BlockKind::Code { lines } => container.opened(indented(QUOTE_INDENT, wrapped_code(lines))),
        BlockKind::Break { text } => container
            .paragraph_break()
            .into_iter()
            .chain([text_line(&roff::escape(text))])
            .collect(),
        BlockKind::List { marker, items } => list_lines(marker, items),
        BlockKind::Quote { blocks } => {
            container.opened(indented(QUOTE_INDENT, nested_lines(blocks)))
        }
    }
}

/// Writes one block into its container; after a top-level heading no block precedes the next.
fn write_block(container: &mut Container, block: &Block) {
    let lines = block_lines(container, block);
    if lines.is_empty() {
        return;
    }
    container.lines.extend(lines);
    container.preceded = !(container.top_level && matches!(block.kind, BlockKind::Heading { .. }));
}

/// Markdown sources written in order into one top-level container.
fn top_level_lines(sources: &[&str], preceded: bool) -> Vec<String> {
    let mut container = Container {
        lines: Vec::new(),
        preceded,
        top_level: true,
    };
    for source in sources {
        for block in filled(&parse_markdown(source)) {
            write_block(&mut container, &block);
        }
    }
    container.lines
}

/// The roff lines of a Command's details under DESCRIPTION. `preceded` says a paragraph, the
/// deprecation, already opens the section, so the first block writes its `.PP`.
pub(super) fn details_lines(source: &str, preceded: bool) -> Vec<String> {
    top_level_lines(&[source], preceded)
}

/// The roff lines of the epilogs under NOTES. Each is parsed on its own and its blocks follow the
/// blocks of the one before, so the paragraph-break rule decides each request between two epilogs.
pub(super) fn notes_lines(sources: &[String]) -> Vec<String> {
    let sources: Vec<&str> = sources.iter().map(String::as_str).collect();
    top_level_lines(&sources, false)
}
