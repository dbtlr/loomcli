//! Reference expansion: how a value reads `$NAME`, `${NAME}`, `${NAME:-default}`, and `\$`.

/// How a value was written, which decides what the plugin does with `$` and backslashes in it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ValueQuote {
    Double,
    Single,
    Unquoted,
}

/// The value a name holds at the point a reference reads it, or `None` when nothing set it.
pub(super) type Lookup<'a> = &'a dyn Fn(&str) -> Option<String>;

/// What one place in a value reads as, and how many characters of the value it consumes.
struct Step {
    text: String,
    width: usize,
}

fn is_name_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_'
}

fn starts_with_at(text: &[char], offset: usize, pattern: &str) -> bool {
    pattern
        .chars()
        .enumerate()
        .all(|(index, expected)| text.get(offset + index) == Some(&expected))
}

fn slice(text: &[char], from: usize, to: usize) -> String {
    text[from..to].iter().collect()
}

/// How one place before the closing brace moves the nesting depth, and how wide it is.
fn brace_step(text: &[char], offset: usize) -> (isize, usize) {
    if starts_with_at(text, offset, "\\$") {
        (0, 2)
    } else if starts_with_at(text, offset, "${") {
        (1, 2)
    } else if text.get(offset) == Some(&'}') {
        (-1, 1)
    } else {
        (0, 1)
    }
}

/// The index of the brace that closes the `${` before `from`, matching nested `${`.
fn closing_brace(text: &[char], from: usize) -> Option<usize> {
    let mut depth: isize = 1;
    let mut offset = from;
    while offset < text.len() {
        let (delta, width) = brace_step(text, offset);
        depth += delta;
        if depth == 0 {
            return Some(offset);
        }
        offset += width;
    }
    None
}

/// A `$NAME` at `offset`, or `None` when no name follows the dollar.
fn bare_reference(text: &[char], offset: usize, lookup: Lookup<'_>) -> Option<Step> {
    let name: String = text[offset + 1..]
        .iter()
        .copied()
        .take_while(|character| is_name_character(*character))
        .collect();
    if name.is_empty() {
        return None;
    }
    Some(Step {
        width: 1 + name.chars().count(),
        text: lookup(&name).unwrap_or_default(),
    })
}

/// A `${` construct read as its own text, through its closing brace or the end of the value.
fn literal_construct(text: &[char], offset: usize, close: Option<usize>) -> Step {
    let end = close.map_or(text.len(), |close| close + 1);
    Step {
        text: slice(text, offset, end),
        width: end - offset,
    }
}

/// The name and the optional default of the text inside a `${...}`, when it is `NAME` or
/// `NAME:-default`.
fn braced_parts(inside: &[char]) -> Option<(String, Option<String>)> {
    let length = inside
        .iter()
        .take_while(|character| is_name_character(**character))
        .count();
    if length == 0 {
        return None;
    }
    let name = slice(inside, 0, length);
    match inside.get(length..) {
        Some([]) | None => Some((name, None)),
        Some([':', '-', fallback @ ..]) => Some((name, Some(fallback.iter().collect()))),
        Some(_) => None,
    }
}

/// A `${NAME}` or `${NAME:-default}` at `offset`. A `${` whose inside is neither, or that never
/// closes, reads as its own text through its closing brace or the end of the value, so no reference
/// inside it expands, as Bun reads it.
fn braced_reference(text: &[char], offset: usize, quote: ValueQuote, lookup: Lookup<'_>) -> Step {
    let inside = offset + 2;
    let close = closing_brace(text, inside);
    let parts = close.and_then(|close| braced_parts(&text[inside..close]));
    let (Some(close), Some((name, fallback))) = (close, parts) else {
        return literal_construct(text, offset, close);
    };
    let replacement = lookup(&name).unwrap_or_else(|| {
        fallback.map_or_else(String::new, |fallback| {
            expand_value(&fallback, quote, lookup)
        })
    });
    Step {
        text: replacement,
        width: close + 1 - offset,
    }
}

/// A backslash that escapes the character after it, or `None` when it is a plain backslash.
fn escape(text: &[char], offset: usize, quote: ValueQuote) -> Option<Step> {
    let replacement = match text.get(offset + 1)? {
        '$' => '$',
        'n' if quote == ValueQuote::Double => '\n',
        'r' if quote == ValueQuote::Double => '\r',
        't' if quote == ValueQuote::Double => '\t',
        '"' if quote == ValueQuote::Double => '"',
        '\\' if quote == ValueQuote::Double => '\\',
        _ => return None,
    };
    Some(Step {
        text: replacement.to_string(),
        width: 2,
    })
}

/// A reference or an escape at `offset`, or `None` when the character reads as itself.
fn special_at(text: &[char], offset: usize, quote: ValueQuote, lookup: Lookup<'_>) -> Option<Step> {
    match text[offset] {
        '\\' => escape(text, offset, quote),
        '$' if text.get(offset + 1) == Some(&'{') => {
            Some(braced_reference(text, offset, quote, lookup))
        }
        '$' => bare_reference(text, offset, lookup),
        _ => None,
    }
}

/// A value's text as the plugin reads it: `\$` reads as a dollar, a double-quoted value decodes its
/// escapes, and `$NAME`, `${NAME}`, and `${NAME:-default}` read what `lookup` gives their name. A
/// single-quoted value is literal. An expanded value is never scanned again.
pub(super) fn expand_value(text: &str, quote: ValueQuote, lookup: Lookup<'_>) -> String {
    if quote == ValueQuote::Single {
        return text.to_owned();
    }
    let characters: Vec<char> = text.chars().collect();
    let mut result = String::new();
    let mut offset = 0;
    while offset < characters.len() {
        match special_at(&characters, offset, quote, lookup) {
            Some(step) => {
                result.push_str(&step.text);
                offset += step.width;
            }
            None => {
                result.push(characters[offset]);
                offset += 1;
            }
        }
    }
    result
}
