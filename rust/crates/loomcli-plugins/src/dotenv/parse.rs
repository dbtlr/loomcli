//! The dotenv file format: lines, quotes, `export`, comments, and the malformed assignments that
//! warn without printing file text.

use super::expand::ValueQuote;

/// A malformed assignment's name and starting line (1-based), which a warning names.
pub(super) struct MalformedAssignment {
    pub(super) name: String,
    pub(super) line: usize,
}

/// One valid assignment, in file order, whose value the plugin has not yet expanded.
pub(super) struct DotenvAssignment {
    pub(super) name: String,
    pub(super) value: String,
    pub(super) quote: ValueQuote,
}

/// A file's valid assignments in order and its malformed ones.
#[derive(Default)]
pub(super) struct ParsedFile {
    pub(super) assignments: Vec<DotenvAssignment>,
    pub(super) malformed: Vec<MalformedAssignment>,
}

/// A value as written: its text before any `$` or backslash is read, how it was quoted, and the
/// index of the line after it. `value` is `None` when the value is malformed.
struct ParsedValue {
    value: Option<String>,
    quote: ValueQuote,
    next: usize,
}

/// One physical line of a quoted value: its text, and what follows the closing quote when it has one.
struct QuotedLine {
    value: String,
    tail: Option<String>,
}

fn is_blank(character: char) -> bool {
    character == ' ' || character == '\t'
}

/// Whether only whitespace and a comment follow a closing quote.
fn valid_tail(text: &str) -> bool {
    let rest = text.trim_start_matches(is_blank);
    rest.is_empty() || rest.starts_with('#')
}

/// One physical line inside a single-quoted value, which keeps every character and stops at a quote.
fn literal_line(text: &str, from: usize) -> QuotedLine {
    let rest = &text[from..];
    match rest.find('\'') {
        None => QuotedLine {
            value: rest.to_owned(),
            tail: None,
        },
        Some(end) => QuotedLine {
            value: rest[..end].to_owned(),
            tail: Some(rest[end + 1..].to_owned()),
        },
    }
}

/// One physical line inside a double-quoted value, stopping only at an unescaped quote. A backslash
/// and the character after it stay together, so an escaped quote never ends a value, and its
/// escapes stay undecoded, because a `\$` and a `$` read differently.
fn quoted_line(text: &str, from: usize) -> QuotedLine {
    let mut value = String::new();
    let mut characters = text[from..].chars();
    while let Some(character) = characters.next() {
        match character {
            '"' => {
                return QuotedLine {
                    value,
                    tail: Some(characters.collect()),
                };
            }
            '\\' => {
                value.push('\\');
                if let Some(escaped) = characters.next() {
                    value.push(escaped);
                }
            }
            other => value.push(other),
        }
    }
    QuotedLine { value, tail: None }
}

/// A quoted value, which may span physical lines in either quote, as the dotenv package, Node's
/// `--env-file`, and Bun read it. Quoted regions are consumed even for names the plugin does not
/// import, so their contents never become assignments, and an unterminated quote consumes the rest
/// of the file.
fn quoted(
    lines: &[&str],
    start: usize,
    first: &str,
    quote: ValueQuote,
    read_line: fn(&str, usize) -> QuotedLine,
) -> ParsedValue {
    let mut value = String::new();
    let mut line = start;
    let mut current = read_line(first, 1);
    while current.tail.is_none() && line + 1 < lines.len() {
        value.push_str(&current.value);
        value.push('\n');
        line += 1;
        current = read_line(lines[line], 0);
    }
    let value = match &current.tail {
        Some(tail) if valid_tail(tail) => {
            value.push_str(&current.value);
            Some(value)
        }
        _ => None,
    };
    ParsedValue {
        value,
        quote,
        next: line + 1,
    }
}

fn read_value(lines: &[&str], line: usize, text: &str) -> ParsedValue {
    if text.starts_with('\'') {
        return quoted(lines, line, text, ValueQuote::Single, literal_line);
    }
    if text.starts_with('"') {
        return quoted(lines, line, text, ValueQuote::Double, quoted_line);
    }
    let unquoted = text.find('#').map_or(text, |comment| &text[..comment]);
    ParsedValue {
        value: Some(unquoted.trim_end_matches(is_blank).to_owned()),
        quote: ValueQuote::Unquoted,
        next: line + 1,
    }
}

/// A variable name at the start of `text` that a space, a tab, an equals sign, or the end follows,
/// with the rest of the line after it.
fn name_at(text: &str) -> Option<(&str, &str)> {
    let mut characters = text.char_indices();
    let (_, first) = characters.next()?;
    if !(first.is_ascii_alphabetic() || first == '_') {
        return None;
    }
    let end = characters
        .find(|(_, character)| !(character.is_ascii_alphanumeric() || *character == '_'))
        .map_or(text.len(), |(index, _)| index);
    let rest = &text[end..];
    let delimited = rest.is_empty() || rest.starts_with(is_blank) || rest.starts_with('=');
    delimited.then(|| (&text[..end], rest))
}

/// An assignment's header: an optional `export`, the variable's name, and the rest of the line.
fn header(line: &str) -> Option<(&str, &str)> {
    let text = line.trim_start_matches(is_blank);
    let exported = text
        .strip_prefix("export")
        .filter(|after| after.starts_with(is_blank))
        .and_then(|after| name_at(after.trim_start_matches(is_blank)));
    exported.or_else(|| name_at(text))
}

/// The value text of `rest` when it is `= value`.
fn assignment_value(rest: &str) -> Option<&str> {
    let after = rest.trim_start_matches(is_blank).strip_prefix('=')?;
    Some(after.trim_start_matches(is_blank))
}

/// The assignment that starts on `line`: its name when the line has a header, and its value.
fn assignment_at<'a>(lines: &[&'a str], line: usize) -> (Option<&'a str>, ParsedValue) {
    let header = header(lines[line]);
    let value = header
        .and_then(|(_, rest)| assignment_value(rest))
        .map(|text| read_value(lines, line, text));
    let parsed = value.unwrap_or(ParsedValue {
        value: None,
        quote: ValueQuote::Unquoted,
        next: line + 1,
    });
    (header.map(|(name, _)| name), parsed)
}

/// A file's valid assignments in order, with secret-free warning locations for the malformed ones.
/// Every valid assignment is kept, because a reference reads names the plugin does not import.
pub(super) fn parse_dotenv(text: &str, imports: &dyn Fn(&str) -> bool) -> ParsedFile {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let text = text.replace("\r\n", "\n");
    let lines: Vec<&str> = text.split('\n').collect();
    let mut file = ParsedFile::default();
    let mut line = 0;
    while line < lines.len() {
        let (name, parsed) = assignment_at(&lines, line);
        if let Some(name) = name {
            match parsed.value {
                Some(value) if !value.contains('\0') => file.assignments.push(DotenvAssignment {
                    name: name.to_owned(),
                    value,
                    quote: parsed.quote,
                }),
                _ if imports(name) => file.malformed.push(MalformedAssignment {
                    name: name.to_owned(),
                    line: line + 1,
                }),
                _ => {}
            }
        }
        line = parsed.next;
    }
    file
}
