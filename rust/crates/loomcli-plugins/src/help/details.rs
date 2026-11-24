//! Details and epilogs: the Markdown subset rendered as page lines, each authored line one page
//! line off a terminal, and paragraphs reflowed to the width on one.

use loomcli_core::style::{nowrap, split_lines};
use loomcli_core::{Style, ViewContext};

use super::layout::{
    Hang, hang_lines, heading_lines, item_line, item_markers, on_terminal, prose_room, signed,
    terminal_wrap,
};
use crate::markdown::{Block, BlockKind, Inline, Item, ListMarker, parse_markdown};

/// The colors an inline run takes from its block: `primary`, or none, so a heading's `dim` shows
/// through its text.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Body {
    Primary,
    Plain,
}

/// The style an inline run carries from its block and the emphasis around it.
#[derive(Clone, Copy)]
struct Modifiers {
    bold: bool,
    italic: bool,
    body: Body,
}

const ORDINARY: Modifiers = Modifiers {
    bold: false,
    italic: false,
    body: Body::Primary,
};

const HEADING_TEXT: Modifiers = Modifiers {
    bold: false,
    italic: false,
    body: Body::Plain,
};

/// The semantic color a styled fragment takes.
#[derive(Clone, Copy)]
enum Token {
    Body(Body),
    Highlight,
    Dim,
}

/// How a block renders: the view context, and the columns left for the block's text after the page
/// indent and its containers' markers, defined exactly on a terminal.
#[derive(Clone, Copy)]
struct Layout<'a> {
    context: &'a ViewContext,
    width: Option<i64>,
}

/// The indent of every page line of a Details or epilog block.
const PAGE_INDENT: &str = "  ";

/// The columns a quote's `> ` takes.
const QUOTE_PREFIX_WIDTH: i64 = 2;

/// JavaScript's `\s`, which `trimEnd` drops.
fn is_space(character: char) -> bool {
    (character.is_whitespace() && character != '\u{85}') || character == '\u{feff}'
}

/// Escaped text with the surrounding modifiers and no color.
fn plain_text(value: String, modifiers: Modifiers, style: &Style) -> String {
    match (modifiers.bold, modifiers.italic) {
        (true, true) => style.bold().italic().apply(&value),
        (true, false) => style.bold().apply(&value),
        (false, true) => style.italic().apply(&value),
        (false, false) => value,
    }
}

/// Applies a semantic color and the surrounding modifiers after escaping an authored fragment.
fn styled(text: &str, token: Token, modifiers: Modifiers, style: &Style) -> String {
    let value = style.escape(text);
    let color = match token {
        Token::Body(Body::Plain) => return plain_text(value, modifiers, style),
        Token::Body(Body::Primary) => style.primary(),
        Token::Highlight => style.highlight(),
        Token::Dim => style.dim(),
    };
    match (modifiers.bold, modifiers.italic) {
        (true, true) => color.bold().italic().apply(&value),
        (true, false) => color.bold().apply(&value),
        (false, true) => color.italic().apply(&value),
        (false, false) => color.apply(&value),
    }
}

impl Layout<'_> {
    /// The layout of a container's content, which has `used` fewer columns than the container.
    fn within(self, used: i64) -> Self {
        Self {
            width: self.width.map(|width| width - used),
            ..self
        }
    }

    /// One rendered authored line as a terminal shows it, its tabs expanded from the line's start.
    fn expanded(&self, line: &str) -> String {
        if on_terminal(self.context) {
            self.context.expand_tabs(line)
        } else {
            line.to_owned()
        }
    }

    /// Rendered authored lines as one text, joined with one space after each expands its tabs.
    fn joined(&self, lines: &[String]) -> String {
        lines
            .iter()
            .map(|line| self.expanded(line))
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Text that reflows: each authored line one page line off a terminal, joined with one space
    /// and wrapped at the width left for them on one.
    fn reflow(&self, lines: Vec<String>) -> Vec<String> {
        let Some(width) = self.width else {
            return lines;
        };
        split_lines(&terminal_wrap(
            &self.joined(&lines),
            self.context,
            prose_room(width),
        ))
    }
}

/// The rendered lines of a block that reflows, a paragraph or a heading, or none for another.
fn reflowing(block: Option<&Block>, layout: Layout<'_>) -> Option<Vec<String>> {
    match &block?.kind {
        BlockKind::Paragraph { lines } => Some(
            lines
                .iter()
                .map(|line| inline(line, ORDINARY, layout))
                .collect(),
        ),
        BlockKind::Heading { text, .. } => Some(vec![inline(text, HEADING_TEXT, layout)]),
        _ => None,
    }
}

/// A block's reflowed lines as they print: a heading `dim`, with an underline at level 1.
fn headed(block: &Block, lines: Vec<String>, context: &ViewContext) -> Vec<String> {
    match &block.kind {
        BlockKind::Heading { level, .. } => heading_lines(&lines, *level, context),
        _ => lines,
    }
}

/// A paragraph's or a heading's reflowed lines as they print.
fn reflowed(block: &Block, layout: Layout<'_>) -> Vec<String> {
    let lines = reflowing(Some(block), layout).unwrap_or_default();
    headed(block, layout.reflow(lines), layout.context)
}

/// A code span with its authored backtick run around its uninterpreted content.
fn code_span(content: &str, backtick_length: usize) -> String {
    let backticks = "`".repeat(backtick_length);
    format!("{backticks}{content}{backticks}")
}

/// The printable text of inline nodes, independently of markup and theme.
fn plain(nodes: &[Inline]) -> String {
    nodes
        .iter()
        .map(|node| match node {
            Inline::Emphasis { children, .. } => plain(children),
            Inline::Link {
                children,
                destination,
            }
            | Inline::Image {
                children,
                destination,
            } => {
                let text = plain(children);
                if text == *destination {
                    text
                } else {
                    format!("{text} ({destination})")
                }
            }
            Inline::Code {
                content,
                backtick_length,
            } => code_span(content, *backtick_length),
            Inline::Text(text) | Inline::Address(text) => text.clone(),
        })
        .collect()
}

/// Inline nodes as help prints them: emphasis adds its modifier, a code span is `highlight` and
/// stays whole on a terminal, and a link prints its text and its destination.
fn inline(nodes: &[Inline], modifiers: Modifiers, layout: Layout<'_>) -> String {
    let style = &layout.context.style;
    nodes
        .iter()
        .map(|node| match node {
            Inline::Text(text) | Inline::Address(text) => {
                styled(text, Token::Body(modifiers.body), modifiers, style)
            }
            Inline::Code {
                content,
                backtick_length,
            } => {
                let span = styled(
                    &code_span(content, *backtick_length),
                    Token::Highlight,
                    modifiers,
                    style,
                );
                if on_terminal(layout.context) {
                    nowrap(&span)
                } else {
                    span
                }
            }
            Inline::Emphasis { children, strong } => inline(
                children,
                Modifiers {
                    body: modifiers.body,
                    bold: modifiers.bold || *strong,
                    italic: modifiers.italic || !*strong,
                },
                layout,
            ),
            Inline::Link {
                children,
                destination,
            }
            | Inline::Image {
                children,
                destination,
            } => link(children, destination, modifiers, layout),
        })
        .collect()
}

/// A link or an image: its destination alone when its text prints as the destination, otherwise
/// its text, a space, and its destination in parentheses, `dim`.
fn link(
    children: &[Inline],
    destination: &str,
    modifiers: Modifiers,
    layout: Layout<'_>,
) -> String {
    let style = &layout.context.style;
    if plain(children) == destination {
        return styled(destination, Token::Body(modifiers.body), modifiers, style);
    }
    let text = inline(children, modifiers, layout);
    let space = style.escape(" ");
    let separator = if modifiers.bold {
        style.bold().apply(&space)
    } else {
        space
    };
    let separator = if modifiers.italic {
        style.italic().apply(&separator)
    } else {
        separator
    };
    format!(
        "{text}{separator}{}",
        styled(&format!("({destination})"), Token::Dim, modifiers, style)
    )
}

/// Code lines without empty edges and trailing whitespace, each one `highlight` value indented two
/// more spaces. Code never wraps, and on a terminal each line's tabs expand from its own start.
fn code_lines(lines: &[String], layout: Layout<'_>) -> Vec<String> {
    let mut content: Vec<&str> = lines
        .iter()
        .map(|line| line.trim_end_matches(is_space))
        .collect();
    while content.first() == Some(&"") {
        content.remove(0);
    }
    while content.last() == Some(&"") {
        content.pop();
    }
    let style = &layout.context.style;
    content
        .iter()
        .map(|line| {
            if line.is_empty() {
                String::new()
            } else {
                format!(
                    "  {}",
                    layout.expanded(&styled(line, Token::Highlight, ORDINARY, style))
                )
            }
        })
        .collect()
}

/// A list's items with the markers the List view prints: bullets, or numbers counting from the
/// authored start with a period.
fn list_lines(marker: &ListMarker, items: &[Item], layout: Layout<'_>) -> Vec<String> {
    let start = match marker {
        ListMarker::Ordered { start, .. } => Some(u64::from(*start)),
        ListMarker::Bullet { .. } => None,
    };
    let markers = item_markers(items.len(), start, layout.context);
    let mut lines = Vec::new();
    for (index, item) in items.iter().enumerate() {
        if item.blank_before && index > 0 {
            lines.push(String::new());
        }
        let marker = markers.markers.get(index).map_or("", String::as_str);
        lines.extend(item_lines(marker, markers.text_offset, item, layout));
    }
    lines
}

/// One item: its marker and first line, then every later line indented by the marker's width and
/// one space, unless the item's opening text cannot hang after its marker.
fn item_lines(marker: &str, indent: usize, item: &Item, layout: Layout<'_>) -> Vec<String> {
    let content = block_lines(&item.blocks, layout.within(signed(indent)));
    let fallback = fallback_lines(item, indent, layout);
    let (opening, replaces) = match &fallback {
        Some((lines, replaces)) => (lines.clone(), *replaces),
        None => (content.iter().take(1).cloned().collect(), 1),
    };
    let mut opening = opening.into_iter();
    let first = opening.next().unwrap_or_default();
    let pad = " ".repeat(indent);
    std::iter::once(item_line(marker, &first, layout.context))
        .chain(opening)
        .chain(content.iter().skip(replaces).map(|line| {
            if line.is_empty() {
                String::new()
            } else {
                format!("{pad}{line}")
            }
        }))
        .collect()
}

/// An item's opening paragraph or heading when its hang after the marker cannot fit: its lines,
/// whose continuations start at the list's own indent, and the number of the item's lines they
/// stand in for. Otherwise none.
fn fallback_lines(item: &Item, indent: usize, layout: Layout<'_>) -> Option<(Vec<String>, usize)> {
    let opening = item.blocks.first()?;
    let lines = reflowing(Some(opening), layout)?;
    let width = layout.width?;
    let hung = hang_lines(
        &layout.joined(&lines),
        &Hang {
            base: 0,
            columns: width,
            lead: signed(indent),
        },
        layout.context,
    );
    if hung.indent == signed(indent) {
        return None;
    }
    let mut written = vec![hung.first];
    written.extend(hung.rest);
    Some((
        headed(opening, written, layout.context),
        render_block(opening, layout.within(signed(indent))).len(),
    ))
}

/// One block's container-relative lines; only authored separators introduce blanks.
fn render_block(block: &Block, layout: Layout<'_>) -> Vec<String> {
    let style = &layout.context.style;
    match &block.kind {
        BlockKind::Paragraph { .. } | BlockKind::Heading { .. } => reflowed(block, layout),
        BlockKind::Table { lines } => lines
            .iter()
            .map(|line| layout.expanded(&inline(line, ORDINARY, layout)))
            .collect(),
        BlockKind::Code { lines } => code_lines(lines, layout),
        BlockKind::Break { text } => {
            vec![layout.expanded(&styled(text, Token::Body(Body::Primary), ORDINARY, style))]
        }
        BlockKind::List { marker, items } => list_lines(marker, items, layout),
        BlockKind::Quote { blocks } => {
            let marker = styled(">", Token::Dim, ORDINARY, style);
            block_lines(blocks, layout.within(QUOTE_PREFIX_WIDTH))
                .into_iter()
                .map(|line| {
                    if line.is_empty() {
                        marker.clone()
                    } else {
                        format!("{marker} {line}")
                    }
                })
                .collect()
        }
    }
}

/// Blocks as lines. An empty rendered block adds no line, but its authored separator carries to
/// the next block that renders one.
fn block_lines(blocks: &[Block], layout: Layout<'_>) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut blank_before = false;
    for block in blocks {
        blank_before |= block.blank_before;
        let content = render_block(block, layout);
        if content.is_empty() {
            continue;
        }
        if blank_before && !lines.is_empty() {
            lines.push(String::new());
        }
        lines.extend(content);
        blank_before = false;
    }
    lines
}

/// A Details or epilog source as page lines: every line that is not blank indented two spaces, a
/// blank one empty. On a terminal the text wraps at the columns left after those two spaces and
/// its containers' markers.
pub(super) fn render_details(source: &str, context: &ViewContext) -> Vec<String> {
    let layout = Layout {
        context,
        width: super::layout::columns(context).map(|columns| columns - signed(PAGE_INDENT.len())),
    };
    block_lines(&parse_markdown(source), layout)
        .into_iter()
        .map(|line| {
            if line.is_empty() {
                line
            } else {
                format!("{PAGE_INDENT}{line}")
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use loomcli_testing::{ViewValues, view_context};

    use super::render_details;

    // Styled bytes merge adjacent runs of one style, so only the marked string shows that a plain
    // paragraph line is one value.
    #[test]
    fn a_plain_paragraph_line_is_one_primary_value_in_the_marked_string() {
        let context = view_context(ViewValues::new());
        let style = &context.style;
        assert_eq!(
            render_details("One plain line.", &context),
            [format!(
                "  {}",
                style.primary().apply(&style.escape("One plain line."))
            )]
        );
    }
}
