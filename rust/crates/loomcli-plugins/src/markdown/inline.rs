//! Inline parsing: one authored line into text, code spans, addresses, links, images, and
//! emphasis. Syntax never spans lines; opaque nodes isolate their delimiters.

use std::sync::OnceLock;

use regex::Regex;

use super::text::is_space;

/// One inline node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Inline {
    /// Literal text, with escapes resolved.
    Text(String),
    /// A code span: its content and the length of its authored backtick run.
    Code {
        /// The characters between the delimiters, uninterpreted.
        content: String,
        /// The number of backticks in each delimiter.
        backtick_length: usize,
    },
    /// An autolink's address without its angle brackets.
    Address(String),
    /// `[text](destination)`.
    Link {
        /// The link text, read without nested links.
        children: Vec<Inline>,
        /// The text between the parentheses.
        destination: String,
    },
    /// `![text](destination)`.
    Image {
        /// The alternative text.
        children: Vec<Inline>,
        /// The text between the parentheses.
        destination: String,
    },
    /// `*text*`, `_text_`, `**text**`, or `__text__`.
    Emphasis {
        /// The emphasized nodes.
        children: Vec<Inline>,
        /// True for a pair of markers (strong), false for one (emphasis).
        strong: bool,
    },
}

/// A scanner token: a finished node, or an opening delimiter that may yet be closed.
enum Token {
    Node(Inline),
    Delimiter(String),
}

fn alphanumeric(text: &str) -> bool {
    static PATTERN: OnceLock<Option<Regex>> = OnceLock::new();
    PATTERN
        .get_or_init(|| Regex::new(r"[\p{L}\p{N}]").ok())
        .as_ref()
        .is_some_and(|pattern| pattern.is_match(text))
}

/// Appends literal text, merging it into a preceding text token.
fn literal(tokens: &mut Vec<Token>, text: &str) {
    if let Some(Token::Node(Inline::Text(last))) = tokens.last_mut() {
        last.push_str(text);
    } else if !text.is_empty() {
        tokens.push(Token::Node(Inline::Text(text.to_owned())));
    }
}

fn push_text(nodes: &mut Vec<Inline>, text: &str) {
    if let Some(Inline::Text(last)) = nodes.last_mut() {
        last.push_str(text);
    } else if !text.is_empty() {
        nodes.push(Inline::Text(text.to_owned()));
    }
}

/// Unmatched opening delimiters become literal characters, including inside a closed pair.
fn materialize(tokens: Vec<Token>) -> Vec<Inline> {
    let mut nodes = Vec::new();
    for token in tokens {
        match token {
            Token::Delimiter(marker) => push_text(&mut nodes, &marker),
            Token::Node(Inline::Text(text)) => push_text(&mut nodes, &text),
            Token::Node(node) => nodes.push(node),
        }
    }
    nodes
}

/// A code span opened at `start`: the next backtick run of equal length closes it.
fn code_at(source: &str, start: usize) -> Option<(usize, Inline)> {
    let opening = source[start..].bytes().take_while(|b| *b == b'`').count();
    if opening == 0 {
        return None;
    }
    let bytes = source.as_bytes();
    let mut index = start + opening;
    while index < bytes.len() {
        if bytes[index] != b'`' {
            index += 1;
            continue;
        }
        let length = bytes[index..].iter().take_while(|b| **b == b'`').count();
        if length == opening {
            return Some((
                index + length,
                Inline::Code {
                    content: source[start + opening..index].to_owned(),
                    backtick_length: opening,
                },
            ));
        }
        index += length;
    }
    None
}

/// The end of an escape, code span, or autolink at `index`, which hide brackets from balancing.
fn bracket_skip(source: &str, index: usize) -> Option<usize> {
    let rest = &source[index..];
    if rest.starts_with('\\')
        && rest[1..]
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_punctuation())
    {
        return Some(index + 2);
    }
    if rest.starts_with('`') || rest.starts_with('<') {
        return protected_at(source, index).map(|(end, _)| end);
    }
    None
}

/// The index of the bracket closing link text opened just before `start`.
fn text_end(source: &str, start: usize) -> Option<usize> {
    let mut depth = 1_usize;
    let mut index = start;
    while index < source.len() {
        if let Some(skip) = bracket_skip(source, index) {
            index = skip;
            continue;
        }
        let character = source[index..].chars().next()?;
        match character {
            '[' => depth += 1,
            ']' => depth -= 1,
            _ => {}
        }
        if depth == 0 {
            return Some(index);
        }
        index += character.len_utf8();
    }
    None
}

/// The index of the parenthesis closing a destination: balanced, never empty or spaced.
fn destination_end(source: &str, start: usize) -> Option<usize> {
    let mut depth = 1_usize;
    for (offset, character) in source[start..].char_indices() {
        if is_space(character) {
            return None;
        }
        match character {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        if depth == 0 {
            return if offset == 0 {
                None
            } else {
                Some(start + offset)
            };
        }
    }
    None
}

/// A link or image starting at `start`.
fn link_at(source: &str, start: usize) -> Option<(usize, Inline)> {
    let bracket = if source[start..].starts_with("![") {
        start + 1
    } else {
        start
    };
    if !source[bracket..].starts_with('[') {
        return None;
    }
    let closing = text_end(source, bracket + 1)?;
    if !source[closing + 1..].starts_with('(') {
        return None;
    }
    let end = destination_end(source, closing + 2)?;
    let children = parse_inline_with(&source[bracket + 1..closing], false);
    let destination = source[closing + 2..end].to_owned();
    let node = if bracket == start {
        Inline::Link {
            children,
            destination,
        }
    } else {
        Inline::Image {
            children,
            destination,
        }
    };
    Some((end + 1, node))
}

/// The nearest surviving opener of `marker`.
fn matching_opener(tokens: &[Token], marker: &str) -> Option<usize> {
    tokens
        .iter()
        .rposition(|token| matches!(token, Token::Delimiter(open) if open == marker))
}

/// Closes the nearest matching opener, leaving intervening unmatched markers literal.
fn emphasis(tokens: &mut Vec<Token>, marker: &str, before: Option<char>, after: Option<char>) {
    let underscore = marker.starts_with('_');
    let after_alnum = after.is_some_and(|c| alphanumeric(c.encode_utf8(&mut [0; 4])));
    let before_alnum = before.is_some_and(|c| alphanumeric(c.encode_utf8(&mut [0; 4])));
    let closes = before.is_some_and(|c| !is_space(c)) && !(underscore && after_alnum);
    let opener = if closes {
        matching_opener(tokens, marker)
    } else {
        None
    };
    if let Some(opener) = opener {
        let children = materialize(tokens.drain(opener + 1..).collect());
        tokens[opener] = Token::Node(Inline::Emphasis {
            children,
            strong: marker.len() == 2,
        });
    } else if after.is_some_and(|c| !is_space(c)) && !(underscore && before_alnum) {
        tokens.push(Token::Delimiter(marker.to_owned()));
    } else {
        literal(tokens, marker);
    }
}

/// The autolink at `index`: `<http://...>`, `<https://...>`, or `<mailto:...>`.
fn address_at(source: &str, index: usize) -> Option<(usize, Inline)> {
    let rest = &source[index..];
    let prefix = ["<http://", "<https://", "<mailto:"]
        .iter()
        .find(|prefix| rest.starts_with(**prefix))?;
    let body = &rest[prefix.len()..];
    let length: usize = body
        .chars()
        .take_while(|c| !is_space(*c) && *c != '<' && *c != '>')
        .map(char::len_utf8)
        .sum();
    if length == 0 || !body[length..].starts_with('>') {
        return None;
    }
    let end = prefix.len() + length + 1;
    Some((index + end, Inline::Address(rest[1..end - 1].to_owned())))
}

/// A protected run is read as a whole, so an unclosed backtick run never starts at its middle.
fn protected_at(source: &str, index: usize) -> Option<(usize, Inline)> {
    let rest = &source[index..];
    match rest.chars().next()? {
        '\\' => {
            let escaped = rest[1..]
                .chars()
                .next()
                .filter(char::is_ascii_punctuation)?;
            Some((index + 2, Inline::Text(escaped.to_string())))
        }
        '`' => code_at(source, index).or_else(|| {
            let run = rest.bytes().take_while(|b| *b == b'`').count();
            Some((index + run, Inline::Text(rest[..run].to_owned())))
        }),
        '<' => address_at(source, index),
        _ => None,
    }
}

/// Inline atoms take precedence over delimiter matching, isolating every link's brackets.
fn atom_at(source: &str, index: usize, links: bool) -> Option<(usize, Inline)> {
    protected_at(source, index).or_else(|| {
        if links || source[index..].starts_with("![") {
            link_at(source, index)
        } else {
            None
        }
    })
}

/// Reads a run of emphasis characters; only runs of one or two can delimit emphasis.
fn delimiter_at(source: &str, index: usize, tokens: &mut Vec<Token>) -> usize {
    let first = source.as_bytes()[index];
    let length = source.as_bytes()[index..]
        .iter()
        .take_while(|b| **b == first)
        .count();
    let marker = &source[index..index + length];
    if length <= 2 {
        let before = source[..index].chars().next_back();
        let after = source[index + length..].chars().next();
        emphasis(tokens, marker, before, after);
    } else {
        literal(tokens, marker);
    }
    index + length
}

/// One scanner transition: an atom, a marker run, or one literal character.
fn read_inline(source: &str, index: usize, links: bool, tokens: &mut Vec<Token>) -> usize {
    if let Some((end, node)) = atom_at(source, index, links) {
        match node {
            Inline::Text(text) => literal(tokens, &text),
            node => tokens.push(Token::Node(node)),
        }
        return end;
    }
    let character = source[index..].chars().next().unwrap_or_default();
    if character == '*' || character == '_' {
        return delimiter_at(source, index, tokens);
    }
    literal(tokens, &source[index..index + character.len_utf8()]);
    index + character.len_utf8()
}

fn parse_inline_with(source: &str, links: bool) -> Vec<Inline> {
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < source.len() {
        index = read_inline(source, index, links, &mut tokens);
    }
    materialize(tokens)
}

/// Parses one authored line into inline nodes.
///
/// The line must hold no line terminator. Protected constructs (escapes, code spans, autolinks)
/// are read first, then links and images, then emphasis, from left to right.
#[must_use]
pub fn parse_inline(source: &str) -> Vec<Inline> {
    parse_inline_with(source, true)
}
