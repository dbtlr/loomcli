//! Test support: a plain-text renderer, compiled for the unit tests only.
//!
//! The renderer follows help's off-terminal layout with color and modifiers off: it indents lines
//! by two spaces, prints `●` and `N.` markers, underlines level 1 headings, and never wraps. It is
//! not the help renderer and is no API; help owns the real one.

pub use super::blocks::{Block, BlockKind, Item, ListMarker, parse_markdown};
pub use super::inline::{Inline, parse_inline};

const PAGE_INDENT: &str = "  ";

/// Renders Markdown source as the plain page lines help prints for Details.
#[must_use]
pub fn render_plain(source: &str) -> Vec<String> {
    block_lines(&parse_markdown(source))
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

/// The printable text of inline nodes: link equality compares this.
#[must_use]
pub fn plain_inline(nodes: &[Inline]) -> String {
    nodes
        .iter()
        .map(|node| match node {
            Inline::Text(text) | Inline::Address(text) => text.clone(),
            Inline::Code {
                content,
                backtick_length,
            } => {
                let ticks = "`".repeat(*backtick_length);
                format!("{ticks}{content}{ticks}")
            }
            Inline::Emphasis { children, .. } => plain_inline(children),
            Inline::Link {
                children,
                destination,
            }
            | Inline::Image {
                children,
                destination,
            } => {
                let text = plain_inline(children);
                if text == *destination {
                    text
                } else {
                    format!("{text} ({destination})")
                }
            }
        })
        .collect()
}

fn block_lines(blocks: &[Block]) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut blank_before = false;
    for block in blocks {
        blank_before |= block.blank_before;
        let content = render_block(block);
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

fn render_block(block: &Block) -> Vec<String> {
    match &block.kind {
        BlockKind::Paragraph { lines } | BlockKind::Table { lines } => {
            lines.iter().map(|line| plain_inline(line)).collect()
        }
        BlockKind::Heading { level, text } => {
            let line = plain_inline(text);
            let underline = "─".repeat(line.chars().count());
            if *level == 1 {
                vec![line, underline]
            } else {
                vec![line]
            }
        }
        BlockKind::Code { lines } => code_lines(lines),
        BlockKind::Break { text } => vec![text.clone()],
        BlockKind::Quote { blocks } => block_lines(blocks)
            .into_iter()
            .map(|line| {
                if line.is_empty() {
                    ">".to_owned()
                } else {
                    format!("> {line}")
                }
            })
            .collect(),
        BlockKind::List { marker, items } => list_lines(*marker, items),
    }
}

fn code_lines(lines: &[String]) -> Vec<String> {
    let mut content: Vec<&str> = lines.iter().map(|line| line.trim_end()).collect();
    while content.first() == Some(&"") {
        content.remove(0);
    }
    while content.last() == Some(&"") {
        content.pop();
    }
    content
        .into_iter()
        .map(|line| {
            if line.is_empty() {
                String::new()
            } else {
                format!("  {line}")
            }
        })
        .collect()
}

fn list_lines(marker: ListMarker, items: &[Item]) -> Vec<String> {
    let labels: Vec<String> = (0..items.len())
        .map(|index| match marker {
            ListMarker::Bullet { .. } => "●".to_owned(),
            ListMarker::Ordered { start, .. } => format!("{}.", u64::from(start) + index as u64),
        })
        .collect();
    let width = labels
        .iter()
        .map(|label| label.chars().count())
        .max()
        .unwrap_or(0);
    let mut lines = Vec::new();
    for (index, item) in items.iter().enumerate() {
        if item.blank_before && index > 0 {
            lines.push(String::new());
        }
        let label = format!("{:>width$}", labels[index]);
        let content = block_lines(&item.blocks);
        let first = content.first().cloned().unwrap_or_default();
        lines.push(if first.trim().is_empty() {
            label
        } else {
            format!("{label} {first}")
        });
        for line in content.iter().skip(1) {
            lines.push(if line.is_empty() {
                String::new()
            } else {
                format!("{}{line}", " ".repeat(width + 1))
            });
        }
    }
    lines
}
