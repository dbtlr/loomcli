//! The JSON a frame header holds: a writer that spells values as `JSON.stringify` does, and a
//! reader that accepts what `JSON.parse` accepts, for the small values a header carries.

/// One parsed JSON value. An object keeps its members in order, a repeated key included; a lookup
/// reads the last one, as `JSON.parse` keeps the last.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl Json {
    /// The string this value holds, if it is one.
    pub(crate) fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(text) => Some(text),
            _ => None,
        }
    }

    /// The members of an array, if this value is one.
    pub(crate) fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Array(items) => Some(items),
            _ => None,
        }
    }

    /// The number this value holds, if it is one.
    pub(crate) fn as_number(&self) -> Option<f64> {
        match self {
            Json::Number(value) => Some(*value),
            _ => None,
        }
    }
}

/// The deepest nesting the reader follows. A valid header nests four levels, so anything deeper is
/// rejected as `JSON.parse` followed by header validation would reject it.
const DEEPEST: usize = 32;

/// Reads one JSON text, or `None` when it is not JSON. A string holding a lone surrogate escape is
/// rejected too: no name a header may reference holds one, so its header would be rejected anyway.
pub(crate) fn parse(text: &[char]) -> Option<Json> {
    let mut reader = Reader { text, at: 0 };
    let value = reader.value(0)?;
    reader.blank();
    (reader.at == text.len()).then_some(value)
}

struct Reader<'a> {
    text: &'a [char],
    at: usize,
}

impl Reader<'_> {
    fn peek(&self) -> Option<char> {
        self.text.get(self.at).copied()
    }

    fn blank(&mut self) {
        while matches!(self.peek(), Some(' ' | '\t' | '\n' | '\r')) {
            self.at += 1;
        }
    }

    fn eat(&mut self, expected: char) -> Option<()> {
        (self.peek()? == expected).then(|| self.at += 1)
    }

    fn word(&mut self, word: &str, value: Json) -> Option<Json> {
        for expected in word.chars() {
            self.eat(expected)?;
        }
        Some(value)
    }

    fn value(&mut self, depth: usize) -> Option<Json> {
        if depth > DEEPEST {
            return None;
        }
        self.blank();
        match self.peek()? {
            '[' => self.array(depth),
            '{' => self.object(depth),
            '"' => self.string().map(Json::String),
            't' => self.word("true", Json::Bool(true)),
            'f' => self.word("false", Json::Bool(false)),
            'n' => self.word("null", Json::Null),
            _ => self.number().map(Json::Number),
        }
    }

    fn array(&mut self, depth: usize) -> Option<Json> {
        self.eat('[')?;
        let mut items = Vec::new();
        self.blank();
        if self.eat(']').is_some() {
            return Some(Json::Array(items));
        }
        loop {
            items.push(self.value(depth + 1)?);
            self.blank();
            match self.peek()? {
                ',' => self.at += 1,
                ']' => {
                    self.at += 1;
                    return Some(Json::Array(items));
                }
                _ => return None,
            }
        }
    }

    fn object(&mut self, depth: usize) -> Option<Json> {
        self.eat('{')?;
        let mut members = Vec::new();
        self.blank();
        if self.eat('}').is_some() {
            return Some(Json::Object(members));
        }
        loop {
            self.blank();
            let key = self.string()?;
            self.blank();
            self.eat(':')?;
            let value = self.value(depth + 1)?;
            members.push((key, value));
            self.blank();
            match self.peek()? {
                ',' => self.at += 1,
                '}' => {
                    self.at += 1;
                    return Some(Json::Object(members));
                }
                _ => return None,
            }
        }
    }

    fn hex4(&mut self) -> Option<u32> {
        let mut value = 0;
        for _ in 0..4 {
            let digit = self.peek()?.to_digit(16)?;
            value = value * 16 + digit;
            self.at += 1;
        }
        Some(value)
    }

    fn string(&mut self) -> Option<String> {
        self.eat('"')?;
        let mut text = String::new();
        loop {
            let character = self.peek()?;
            self.at += 1;
            match character {
                '"' => return Some(text),
                '\\' => {
                    let escaped = self.peek()?;
                    self.at += 1;
                    match escaped {
                        '"' => text.push('"'),
                        '\\' => text.push('\\'),
                        '/' => text.push('/'),
                        'b' => text.push('\u{8}'),
                        'f' => text.push('\u{c}'),
                        'n' => text.push('\n'),
                        'r' => text.push('\r'),
                        't' => text.push('\t'),
                        'u' => text.push(self.unicode_escape()?),
                        _ => return None,
                    }
                }
                '\u{0}'..='\u{1f}' => return None,
                other => text.push(other),
            }
        }
    }

    /// The character a `\u` escape names, joining a surrogate pair; a lone surrogate is `None`.
    fn unicode_escape(&mut self) -> Option<char> {
        let first = self.hex4()?;
        if (0xd800..0xdc00).contains(&first) {
            self.eat('\\')?;
            self.eat('u')?;
            let second = self.hex4()?;
            if !(0xdc00..0xe000).contains(&second) {
                return None;
            }
            return char::from_u32(0x1_0000 + ((first - 0xd800) << 10) + (second - 0xdc00));
        }
        char::from_u32(first)
    }

    /// A JSON number, read with the grammar JSON fixes and converted as `JSON.parse` converts it.
    fn number(&mut self) -> Option<f64> {
        let start = self.at;
        if self.peek() == Some('-') {
            self.at += 1;
        }
        match self.peek()? {
            '0' => self.at += 1,
            '1'..='9' => self.digits(),
            _ => return None,
        }
        if self.peek() == Some('.') {
            self.at += 1;
            if !self.peek()?.is_ascii_digit() {
                return None;
            }
            self.digits();
        }
        if matches!(self.peek(), Some('e' | 'E')) {
            self.at += 1;
            if matches!(self.peek(), Some('+' | '-')) {
                self.at += 1;
            }
            if !self.peek()?.is_ascii_digit() {
                return None;
            }
            self.digits();
        }
        let spelled: String = self.text.get(start..self.at)?.iter().collect();
        spelled.parse().ok()
    }

    fn digits(&mut self) {
        while self
            .peek()
            .is_some_and(|character| character.is_ascii_digit())
        {
            self.at += 1;
        }
    }
}

/// Appends a string spelled as `JSON.stringify` spells it.
pub(crate) fn write_string(out: &mut String, text: &str) {
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{0}'..='\u{1f}' => {
                out.push_str(&format!("\\u{:04x}", u32::from(character)));
            }
            other => out.push(other),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str) -> Option<Json> {
        parse(&text.chars().collect::<Vec<_>>())
    }

    #[test]
    fn reads_what_json_parse_reads() {
        assert_eq!(
            read(r#" ["a", 1.0, -0, 1e2, {"k": null, "k": true}] "#),
            Some(Json::Array(vec![
                Json::String("a".into()),
                Json::Number(1.0),
                Json::Number(-0.0),
                Json::Number(100.0),
                Json::Object(vec![
                    ("k".into(), Json::Null),
                    ("k".into(), Json::Bool(true))
                ]),
            ]))
        );
        assert_eq!(
            read(r#""\u0072\ud83d\ude00""#),
            Some(Json::String("r😀".into()))
        );
        assert_eq!(read("1e400"), Some(Json::Number(f64::INFINITY)));
    }

    #[test]
    fn rejects_what_json_parse_rejects() {
        for text in [
            "",
            "01",
            "+1",
            ".5",
            "1.",
            "[1,]",
            "{bad}",
            "[\"a\u{1}\"]",
            "\"\\x\"",
            "[] x",
            "tru",
            "\"\\ud800\"",
        ] {
            assert_eq!(read(text), None, "{text:?}");
        }
        assert_eq!(read(&"[".repeat(100)), None);
    }

    #[test]
    fn writes_what_json_stringify_writes() {
        let mut out = String::new();
        write_string(&mut out, "a\"\\\u{8}\u{c}\n\r\t\u{1}\u{7f}\u{2028}");
        assert_eq!(out, "\"a\\\"\\\\\\b\\f\\n\\r\\t\\u0001\u{7f}\u{2028}\"");
    }
}
