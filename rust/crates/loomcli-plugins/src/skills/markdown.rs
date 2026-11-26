//! CommonMark escaping for command references. Authored Markdown keeps its formatting.

use crate::help::cells::single_line;
use crate::help::extension::is_terminator;

pub(super) fn shown_text(text: &str, paragraph: bool) -> String {
    let flat = single_line(text);
    let text = flat.trim_matches([' ', '\t']);
    let ordered_marker = if paragraph {
        let first_word = text.bytes().take_while(u8::is_ascii_digit).count();
        (first_word > 0 && matches!(text.as_bytes().get(first_word), Some(b'.' | b')')))
            .then_some(first_word)
    } else {
        None
    };
    let mut previous = None;
    let mut chars = text.char_indices().peekable();
    let mut result = String::with_capacity(text.len());
    while let Some((index, character)) = chars.next() {
        let next = chars.peek().map(|&(_, character)| character);
        let block_start = paragraph
            && index == 0
            && (matches!(character, '#' | '>' | '+' | '-') || text.starts_with("~~~"));
        let escape = match character {
            '\\' | '\x60' | '*' | '[' | '<' => true,
            '_' => {
                !previous.is_some_and(|c: char| c.is_ascii_alphanumeric())
                    || !next.is_some_and(|c| c.is_ascii_alphanumeric())
            }
            '&' => next.is_some_and(|c| c == '#' || c.is_ascii_alphabetic()),
            _ => false,
        };
        if escape || block_start || ordered_marker == Some(index) {
            result.push('\\');
        }
        result.push(character);
        previous = Some(character);
    }
    result
}

pub(super) fn code_span(content: &str) -> String {
    let longest = content
        .split(|character| character != '\x60')
        .map(str::len)
        .max()
        .unwrap_or(0);
    let delimiter = "\x60".repeat(longest + 1);
    let padding = if content.starts_with('\x60') || content.ends_with('\x60') {
        " "
    } else {
        ""
    };
    format!("{delimiter}{padding}{content}{padding}{delimiter}")
}

pub(super) fn authored(source: &str) -> String {
    let normalized = source.replace("\r\n", "\n").replace(is_terminator, "\n");
    let mut lines: Vec<_> = normalized.split('\n').collect();
    if let Some(last) = lines
        .iter()
        .rposition(|line| !line.trim_matches([' ', '\t']).is_empty())
    {
        lines.truncate(last + 1);
    }
    lines
        .into_iter()
        .skip_while(|line| line.trim_matches([' ', '\t']).is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
