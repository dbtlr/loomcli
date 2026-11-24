//! Text rules shared by the block and inline parsers: JavaScript's whitespace set and the pack's
//! line terminators, so a port reads the same characters as the reference.

/// True for a character JavaScript's `\s`, `trim`, and `trimStart` treat as whitespace.
///
/// This is Unicode White_Space without U+0085 (NEL, a line terminator here and never inside a
/// line) and with U+FEFF added.
pub(super) fn is_space(character: char) -> bool {
    (character.is_whitespace() && character != '\u{85}') || character == '\u{feff}'
}

/// True when a line holds no character other than whitespace.
pub(super) fn blank(line: &str) -> bool {
    line.chars().all(is_space)
}

/// The text without whitespace at both ends.
pub(super) fn trim(text: &str) -> &str {
    text.trim_matches(is_space)
}

/// The text without whitespace at its start.
pub(super) fn trim_start(text: &str) -> &str {
    text.trim_start_matches(is_space)
}

/// The text without whitespace at its end.
pub(super) fn trim_end(text: &str) -> &str {
    text.trim_end_matches(is_space)
}

/// The text after its first `count` characters, or empty when it has fewer.
pub(super) fn skip(text: &str, count: usize) -> &str {
    text.char_indices()
        .nth(count)
        .map_or("", |(index, _)| &text[index..])
}

/// True for the characters that end a line: LF, VT, FF, CR, NEL, LS, and PS.
fn is_terminator(character: char) -> bool {
    matches!(
        character,
        '\n' | '\u{b}' | '\u{c}' | '\r' | '\u{85}' | '\u{2028}' | '\u{2029}'
    )
}

/// Splits a text at CRLF and at each single terminator, keeping empty lines.
pub(super) fn split_lines(source: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut start = 0;
    let mut characters = source.char_indices().peekable();
    while let Some((index, character)) = characters.next() {
        if !is_terminator(character) {
            continue;
        }
        lines.push(&source[start..index]);
        start = index + character.len_utf8();
        if character == '\r' && characters.peek().is_some_and(|(_, next)| *next == '\n') {
            characters.next();
            start += 1;
        }
    }
    lines.push(&source[start..]);
    lines
}
