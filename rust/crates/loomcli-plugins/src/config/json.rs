//! JSON with comments: `//` and `/* */` comments wherever JSON allows whitespace, and one comma
//! after the last item of an object or an array, as tsconfig reads its files. Nothing else of
//! JSON5 is read. The scan is hand-written so a file that does not parse names the first
//! character it cannot accept, or the end of a text that ends early. A text that passes builds the
//! value `JSON.parse` would: a number as a 64-bit float, a repeated key at its first position with
//! its last value.

use super::document::{ObjectBuilder, Value};
use super::reading::{Clause, Reading};

/// One token of the text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Space,
    Comment,
    String,
    Number,
    Literal,
    Punctuation,
}

/// One token: its kind and its byte range.
#[derive(Clone, Copy, Debug)]
struct Token {
    kind: Kind,
    start: usize,
    end: usize,
}

/// Where a token ends when one of its kind starts at `at`, or `None`.
fn space(bytes: &[u8], at: usize) -> Option<usize> {
    let length = bytes[at..]
        .iter()
        .take_while(|byte| matches!(byte, b' ' | b'\t' | b'\n' | b'\r'))
        .count();
    (length > 0).then_some(at + length)
}

fn comment(text: &str, at: usize) -> Option<usize> {
    let rest = &text[at..];
    if let Some(line) = rest.strip_prefix("//") {
        let length = line.find(['\n', '\r']).unwrap_or(line.len());
        return Some(at + 2 + length);
    }
    let block = rest.strip_prefix("/*")?;
    block.find("*/").map(|close| at + 2 + close + 2)
}

/// The end of a string's valid start: its opening quote and every character or escape its body
/// holds, up to the first that breaks it or the closing quote.
fn string_body(text: &str, at: usize) -> usize {
    let bytes = text.as_bytes();
    let mut index = at + 1;
    while index < bytes.len() {
        match bytes[index] {
            b'"' | 0x00..=0x1f => return index,
            b'\\' => {
                let escape = bytes.get(index + 1).copied();
                match escape {
                    Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => index += 2,
                    Some(b'u')
                        if bytes
                            .get(index + 2..index + 6)
                            .is_some_and(|digits| digits.iter().all(u8::is_ascii_hexdigit)) =>
                    {
                        index += 6;
                    }
                    _ => return index,
                }
            }
            _ => index += 1,
        }
    }
    index
}

fn string(text: &str, at: usize) -> Option<usize> {
    if text.as_bytes().get(at) != Some(&b'"') {
        return None;
    }
    let end = string_body(text, at);
    (text.as_bytes().get(end) == Some(&b'"')).then_some(end + 1)
}

fn digits(bytes: &[u8], at: usize) -> usize {
    bytes[at..]
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count()
}

/// `-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[Ee][+-]?\d+)?`, each optional part taken only when whole.
fn number(bytes: &[u8], at: usize) -> Option<usize> {
    let mut index = at;
    if bytes.get(index) == Some(&b'-') {
        index += 1;
    }
    match bytes.get(index) {
        Some(b'0') => index += 1,
        Some(b'1'..=b'9') => index += digits(bytes, index),
        _ => return None,
    }
    if bytes.get(index) == Some(&b'.') {
        let fraction = digits(bytes, index + 1);
        if fraction > 0 {
            index += 1 + fraction;
        }
    }
    if matches!(bytes.get(index), Some(b'e' | b'E')) {
        let sign = usize::from(matches!(bytes.get(index + 1), Some(b'+' | b'-')));
        let exponent = digits(bytes, index + 1 + sign);
        if exponent > 0 {
            index += 1 + sign + exponent;
        }
    }
    Some(index)
}

fn literal(text: &str, at: usize) -> Option<usize> {
    ["true", "false", "null"]
        .iter()
        .find(|word| text[at..].starts_with(*word))
        .map(|word| at + word.len())
}

/// The token at a byte offset, or the offset where nothing matches: for a string that breaks, the
/// first character its body cannot hold.
fn token_at(text: &str, at: usize) -> Result<Token, usize> {
    let bytes = text.as_bytes();
    let found = space(bytes, at)
        .map(|end| (Kind::Space, end))
        .or_else(|| comment(text, at).map(|end| (Kind::Comment, end)))
        .or_else(|| string(text, at).map(|end| (Kind::String, end)))
        .or_else(|| number(bytes, at).map(|end| (Kind::Number, end)))
        .or_else(|| literal(text, at).map(|end| (Kind::Literal, end)))
        .or_else(|| {
            matches!(bytes[at], b'{' | b'}' | b'[' | b']' | b':' | b',')
                .then_some((Kind::Punctuation, at + 1))
        });
    match found {
        Some((kind, end)) => Ok(Token {
            kind,
            start: at,
            end,
        }),
        None if bytes[at] == b'"' => Err(string_body(text, at)),
        None => Err(at),
    }
}

/// What the scan expects next.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Expect {
    Value,
    Item,
    Member,
    Colon,
    After,
    End,
}

/// One open container, with what it holds so far.
enum Open {
    Array(Vec<Value>),
    Object {
        entries: ObjectBuilder,
        key: Option<String>,
    },
}

/// The scan's state: what it expects, the open containers, and the finished value.
struct Scanner {
    expect: Expect,
    open: Vec<Open>,
    done: Option<Value>,
}

impl Scanner {
    fn follows(&mut self, expected: &[Expect], next: Expect) -> bool {
        if !expected.contains(&self.expect) {
            return false;
        }
        self.expect = next;
        true
    }

    fn after_value(&self) -> Expect {
        if self.open.is_empty() {
            Expect::End
        } else {
            Expect::After
        }
    }

    /// Places a finished value in its container, or as the whole document.
    fn place(&mut self, value: Value) {
        match self.open.last_mut() {
            Some(Open::Array(items)) => items.push(value),
            Some(Open::Object { entries, key }) => {
                if let Some(key) = key.take() {
                    entries.insert(key, value);
                }
            }
            None => self.done = Some(value),
        }
    }

    /// Reads one token that is not space or a comment, and answers whether it may stand there.
    fn read(&mut self, text: &str, token: Token) -> bool {
        let source = &text[token.start..token.end];
        match source {
            "[" | "{" => {
                let array = source == "[";
                let next = if array { Expect::Item } else { Expect::Member };
                if !self.follows(&[Expect::Value, Expect::Item], next) {
                    return false;
                }
                self.open.push(if array {
                    Open::Array(Vec::new())
                } else {
                    Open::Object {
                        entries: ObjectBuilder::default(),
                        key: None,
                    }
                });
                true
            }
            "]" | "}" => self.closes(source),
            "," => {
                if self.open.is_empty() || !self.follows(&[Expect::After], Expect::After) {
                    return false;
                }
                self.expect = match self.open.last() {
                    Some(Open::Array(_)) => Expect::Item,
                    _ => Expect::Member,
                };
                true
            }
            ":" => self.follows(&[Expect::Colon], Expect::Value),
            _ if token.kind == Kind::String && self.expect == Expect::Member => {
                if let Some(Open::Object { key, .. }) = self.open.last_mut() {
                    *key = Some(decode_string(source));
                }
                self.expect = Expect::Colon;
                true
            }
            _ => {
                let next = self.after_value();
                if !self.follows(&[Expect::Value, Expect::Item], next) {
                    return false;
                }
                self.place(scalar(token.kind, source));
                true
            }
        }
    }

    /// A close after a value, right after the open, or after a trailing comma.
    fn closes(&mut self, source: &str) -> bool {
        let matches = match self.open.last() {
            Some(Open::Array(_)) => source == "]",
            Some(Open::Object { .. }) => source == "}",
            None => false,
        };
        if !matches
            || !self.follows(
                &[Expect::After, Expect::Item, Expect::Member],
                Expect::After,
            )
        {
            return false;
        }
        let value = match self.open.pop() {
            Some(Open::Array(items)) => Value::array(items),
            Some(Open::Object { entries, .. }) => entries.build(),
            None => return false,
        };
        self.expect = self.after_value();
        self.place(value);
        true
    }
}

/// A scalar token's value: a number as a 64-bit float, which an overflowing literal turns into an
/// infinity, as `JSON.parse` reads one.
fn scalar(kind: Kind, source: &str) -> Value {
    match (kind, source) {
        (Kind::String, _) => Value::Text(decode_string(source)),
        (Kind::Number, _) => Value::Number(source.parse().unwrap_or(f64::NAN)),
        (_, "true") => Value::Bool(true),
        (_, "false") => Value::Bool(false),
        _ => Value::Null,
    }
}

/// A string token's text, its escapes decoded. A surrogate escape pairs with the next one; a lone
/// surrogate, which Rust's strings cannot hold, reads as U+FFFD.
fn decode_string(source: &str) -> String {
    let body = &source[1..source.len() - 1];
    let mut decoded = String::with_capacity(body.len());
    let mut units: Vec<u16> = Vec::new();
    let mut characters = body.chars();
    let flush = |units: &mut Vec<u16>, decoded: &mut String| {
        decoded.extend(char::decode_utf16(units.drain(..)).map(|unit| unit.unwrap_or('\u{fffd}')));
    };
    while let Some(character) = characters.next() {
        if character != '\\' {
            flush(&mut units, &mut decoded);
            decoded.push(character);
            continue;
        }
        let escaped = match characters.next() {
            Some('b') => '\u{8}',
            Some('f') => '\u{c}',
            Some('n') => '\n',
            Some('r') => '\r',
            Some('t') => '\t',
            Some('u') => {
                let hex: String = characters.by_ref().take(4).collect();
                units.push(u16::from_str_radix(&hex, 16).unwrap_or(0xfffd));
                continue;
            }
            Some(other) => other,
            None => break,
        };
        flush(&mut units, &mut decoded);
        decoded.push(escaped);
    }
    flush(&mut units, &mut decoded);
    decoded
}

/// The one JSON object a file's text holds, comments and trailing commas allowed, or where the
/// text breaks.
pub(crate) fn read_json(text: &str) -> Reading {
    let mut scanner = Scanner {
        expect: Expect::Value,
        open: Vec::new(),
        done: None,
    };
    let mut index = 0;
    while index < text.len() {
        let token = match token_at(text, index) {
            Ok(token) => token,
            Err(offset) => return Reading::broken(Clause::InvalidJson, text, offset),
        };
        if !matches!(token.kind, Kind::Space | Kind::Comment) && !scanner.read(text, token) {
            return Reading::broken(Clause::InvalidJson, text, token.start);
        }
        index = token.end;
    }
    match scanner.done {
        Some(value) if scanner.expect == Expect::End => Reading::of(value, Clause::NotJsonObject),
        _ => Reading::broken(Clause::InvalidJson, text, text.len()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::reading::Position;

    fn broken(line: usize, column: usize) -> Reading {
        Reading::Unusable {
            clause: Clause::InvalidJson,
            at: Some(Position { line, column }),
        }
    }

    fn object(entries: Vec<(&str, Value)>) -> Reading {
        let mut builder = ObjectBuilder::default();
        for (key, value) in entries {
            builder.insert(key.to_owned(), value);
        }
        Reading::Usable(builder.build())
    }

    fn text(value: &str) -> Value {
        Value::Text(value.to_owned())
    }

    // config-formats.test.ts: "a JSON file reads %s".
    #[test]
    fn a_json_file_reads_comments_and_trailing_commas() {
        let five = || object(vec![("minBytes", Value::Number(5.0))]);
        for (text, expected) in [
            ("{\n  // the threshold\n  \"minBytes\": 5\n}", five()),
            ("{ /* why */ \"minBytes\": /* bytes */ 5 }", five()),
            ("{ \"minBytes\": 5 } // done", five()),
            ("{ \"minBytes\": 5, }", five()),
            (
                "{ \"fields\": [\"a\", \"b\",] }",
                object(vec![(
                    "fields",
                    Value::array(vec![
                        super::super::document::Value::Text("a".into()),
                        Value::Text("b".into()),
                    ]),
                )]),
            ),
            (
                "{ \"fields\": [\"a\", // last\n] }",
                object(vec![(
                    "fields",
                    Value::array(vec![Value::Text("a".into())]),
                )]),
            ),
            (
                "{ \"url\": \"https://x/*y*/\" }",
                object(vec![("url", Value::Text("https://x/*y*/".into()))]),
            ),
        ] {
            assert_eq!(read_json(text), expected, "{text:?}");
        }
    }

    // config-formats.test.ts: "a JSON file with comments reads the values JSON.parse reads".
    #[test]
    fn a_json_file_reads_the_values_json_parse_reads_with_a_proto_key_as_an_own_key() {
        let text =
            r#"{ "__proto__": { "polluted": true }, "n": 1e2, "s": "é\n", /* c */ "x": null }"#;
        assert_eq!(
            read_json(text),
            object(vec![
                (
                    "__proto__",
                    match object(vec![("polluted", Value::Bool(true))]) {
                        Reading::Usable(value) => value,
                        Reading::Unusable { .. } => Value::Null,
                    }
                ),
                ("n", Value::Number(100.0)),
                ("s", text_value("é\n")),
                ("x", Value::Null),
            ])
        );
    }

    fn text_value(value: &str) -> Value {
        text(value)
    }

    // config-formats.test.ts: "a JSON file with %s names its line and column".
    #[test]
    fn a_json_file_that_breaks_names_its_line_and_column() {
        for (text, line, column) in [
            ("", 1, 1),
            ("{\"limits\": ", 1, 12),
            ("{\n  \"a\": 1,\n  \"b\": tru\n}", 3, 8),
            ("[,]", 1, 2),
            ("[1,,]", 1, 4),
            ("{,}", 1, 2),
            ("{ a: 1 }", 1, 3),
            ("{ \"a\" 1 }", 1, 7),
            ("[01]", 1, 3),
            ("[1.]", 1, 3),
            ("{ \"a\": \"x\ny\" }", 1, 10),
            (r#"{ "a": "\x" }"#, 1, 9),
            (r#"{ "a": "\u12" }"#, 1, 9),
            ("{ \"a\": \"x", 1, 10),
            ("{ \"a\": 1 /* never closed", 1, 10),
            ("{ \"a\": 1 / }", 1, 10),
            ("{} {}", 1, 4),
            ("{\u{a0}}", 1, 2),
            ("{ \"a\": [1} }", 1, 10),
            ("{ \"a\": 1", 1, 9),
        ] {
            assert_eq!(read_json(text), broken(line, column), "{text:?}");
        }
    }

    // config-formats.test.ts: a column counts characters, and every line ending ends a line.
    #[test]
    fn a_column_counts_characters_and_a_line_ends_at_lf_crlf_or_cr() {
        assert_eq!(read_json("{ \"é😀\": x }"), broken(1, 9));
        assert_eq!(read_json("{\r\n\"a\": 1,\r\n\"b\": x}"), broken(3, 6));
        assert_eq!(read_json("{\r\"a\": x}"), broken(2, 6));
    }

    // config-formats.test.ts: a JSON file whose top level is not an object has no position.
    #[test]
    fn a_top_level_that_is_not_an_object_has_no_position() {
        assert_eq!(
            read_json("[1] // a list"),
            Reading::Unusable {
                clause: Clause::NotJsonObject,
                at: None
            }
        );
    }

    #[test]
    fn an_overflowing_literal_reads_as_an_infinity_and_a_repeated_key_takes_its_last_value() {
        assert_eq!(
            read_json(r#"{"a": 1e400, "b": -1e400, "a": 2}"#),
            object(vec![
                ("a", Value::Number(2.0)),
                ("b", Value::Number(f64::NEG_INFINITY))
            ])
        );
        assert_eq!(
            read_json(r#"{"s": "😀 \ud800"}"#),
            object(vec![("s", text("😀 \u{fffd}"))])
        );
    }
}
