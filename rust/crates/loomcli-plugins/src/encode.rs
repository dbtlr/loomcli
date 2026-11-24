//! The JSON text both views and both failure encoders write: `JSON.stringify`'s bytes, with the
//! characters from U+007F to U+009F escaped.

use std::cell::Cell;
use std::fmt;
use std::io;

use serde::Serialize;
use serde_json::ser::{CompactFormatter, Formatter, PrettyFormatter};

/// The sentence both encode failures start with. The engine's reason differs between libraries and
/// can hold data, so it stays on the error's source and out of the message.
const ENCODE_FAILURE: &str =
    "The value cannot be encoded as JSON. Emit plain JSON data from the action.";

/// The failure of a value that cannot be written as JSON, such as a map keyed by a non-string. Its
/// message is fixed; the serializer's error is its `source`.
#[derive(Debug)]
pub(crate) struct EncodeError {
    source: serde_json::Error,
}

impl fmt::Display for EncodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(ENCODE_FAILURE)
    }
}

impl std::error::Error for EncodeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.source)
    }
}

impl From<serde_json::Error> for EncodeError {
    fn from(source: serde_json::Error) -> Self {
        Self { source }
    }
}

/// Writes floats as ECMAScript's `Number.prototype.toString` does, over serde_json's compact or
/// two-space pretty layout, which already match `JSON.stringify` for every other token.
enum JsFormatter {
    Compact(CompactFormatter),
    Pretty(PrettyFormatter<'static>),
}

/// Forwards a layout call to whichever layout the formatter holds.
macro_rules! layout {
    ($self:ident, $method:ident($($argument:expr),*)) => {
        match $self {
            JsFormatter::Compact(inner) => inner.$method($($argument),*),
            JsFormatter::Pretty(inner) => inner.$method($($argument),*),
        }
    };
}

impl Formatter for JsFormatter {
    fn write_f64<W: ?Sized + io::Write>(&mut self, writer: &mut W, value: f64) -> io::Result<()> {
        writer.write_all(js_float_text(value).as_bytes())
    }

    fn write_f32<W: ?Sized + io::Write>(&mut self, writer: &mut W, value: f32) -> io::Result<()> {
        writer.write_all(js_float_text(f64::from(value)).as_bytes())
    }

    fn begin_array<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        layout!(self, begin_array(writer))
    }

    fn end_array<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        layout!(self, end_array(writer))
    }

    fn begin_array_value<W: ?Sized + io::Write>(
        &mut self,
        writer: &mut W,
        first: bool,
    ) -> io::Result<()> {
        layout!(self, begin_array_value(writer, first))
    }

    fn end_array_value<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        layout!(self, end_array_value(writer))
    }

    fn begin_object<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        layout!(self, begin_object(writer))
    }

    fn end_object<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        layout!(self, end_object(writer))
    }

    fn begin_object_key<W: ?Sized + io::Write>(
        &mut self,
        writer: &mut W,
        first: bool,
    ) -> io::Result<()> {
        layout!(self, begin_object_key(writer, first))
    }

    fn end_object_key<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        layout!(self, end_object_key(writer))
    }

    fn begin_object_value<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        layout!(self, begin_object_value(writer))
    }

    fn end_object_value<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        layout!(self, end_object_value(writer))
    }
}

/// A float as ECMAScript writes it: `null` for a value JSON cannot hold, `0` for either zero, plain
/// decimal for magnitudes from 1e-6 up to (not including) 1e21, and exponent form beyond.
fn js_float_text(value: f64) -> String {
    if !value.is_finite() {
        return "null".to_owned();
    }
    if value == 0.0 {
        return "0".to_owned();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    // The shortest round-trip digits, as `d.ddde<exp>`.
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific
        .split_once('e')
        .unwrap_or((scientific.as_str(), "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let exponent: i32 = exponent.parse().unwrap_or(0);
    // ECMAScript's `n`: the value is 0.digits * 10^n.
    let n = exponent + 1;
    let k = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    let body = if k <= n && n <= 21 {
        format!(
            "{digits}{}",
            "0".repeat(usize::try_from(n - k).unwrap_or(0))
        )
    } else if 0 < n && n <= 21 {
        let (whole, fraction) = digits.split_at(usize::try_from(n).unwrap_or(0));
        format!("{whole}.{fraction}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat(usize::try_from(-n).unwrap_or(0)))
    } else {
        let power = n - 1;
        let sign_of_power = if power < 0 { '-' } else { '+' };
        let (first, rest) = digits.split_at(1);
        let fraction = if rest.is_empty() {
            String::new()
        } else {
            format!(".{rest}")
        };
        format!("{first}{fraction}e{sign_of_power}{}", power.abs())
    };
    format!("{sign}{body}")
}

/// `JSON.stringify(value)` when `indent` is false, and `JSON.stringify(value, null, 2)` when it is
/// true.
pub(crate) fn stringify<T: Serialize + ?Sized>(
    value: &T,
    indent: bool,
) -> Result<String, EncodeError> {
    let formatter = if indent {
        JsFormatter::Pretty(PrettyFormatter::with_indent(b"  "))
    } else {
        JsFormatter::Compact(CompactFormatter)
    };
    let mut bytes = Vec::new();
    let mut serializer = serde_json::Serializer::with_formatter(&mut bytes, formatter);
    value.serialize(&mut serializer)?;
    // serde_json writes valid UTF-8 and the formatter writes ASCII.
    String::from_utf8(bytes).map_err(|_| {
        EncodeError::from(<serde_json::Error as serde::ser::Error>::custom(
            "the serializer wrote invalid UTF-8",
        ))
    })
}

/// Writes a value compactly, with a top-level array laid out as one element per line and no
/// brackets or commas of its own. It tracks how deep the writer is, so only the outermost array
/// changes its layout.
struct LinesFormatter<'a> {
    /// The arrays and objects open around the token being written.
    depth: usize,
    /// Whether the value itself is an array, shared with the caller, which reads it once the value
    /// is written.
    lines: &'a Cell<bool>,
}

impl LinesFormatter<'_> {
    /// Whether the token being written is an element of the outermost array.
    fn at_element(&self) -> bool {
        self.lines.get() && self.depth == 1
    }
}

impl Formatter for LinesFormatter<'_> {
    fn write_f64<W: ?Sized + io::Write>(&mut self, writer: &mut W, value: f64) -> io::Result<()> {
        writer.write_all(js_float_text(value).as_bytes())
    }

    fn write_f32<W: ?Sized + io::Write>(&mut self, writer: &mut W, value: f32) -> io::Result<()> {
        writer.write_all(js_float_text(f64::from(value)).as_bytes())
    }

    fn begin_array<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.depth += 1;
        if self.depth == 1 {
            self.lines.set(true);
            return Ok(());
        }
        writer.write_all(b"[")
    }

    fn end_array<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.depth = self.depth.saturating_sub(1);
        if self.lines.get() && self.depth == 0 {
            return Ok(());
        }
        writer.write_all(b"]")
    }

    fn begin_array_value<W: ?Sized + io::Write>(
        &mut self,
        writer: &mut W,
        first: bool,
    ) -> io::Result<()> {
        if first || self.at_element() {
            return Ok(());
        }
        writer.write_all(b",")
    }

    fn end_array_value<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        if self.at_element() {
            return writer.write_all(b"\n");
        }
        Ok(())
    }

    fn begin_object<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.depth += 1;
        writer.write_all(b"{")
    }

    fn end_object<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.depth = self.depth.saturating_sub(1);
        writer.write_all(b"}")
    }
}

/// One `JSON.stringify(element)` line per element when the value serializes as an array, nothing
/// for an empty one, and one `JSON.stringify(value)` line for any other value. The value is written
/// in one pass, with no copy of it built first.
pub(crate) fn stringify_lines<T: Serialize + ?Sized>(value: &T) -> Result<String, EncodeError> {
    let mut bytes = Vec::new();
    let lines = Cell::new(false);
    let mut serializer = serde_json::Serializer::with_formatter(
        &mut bytes,
        LinesFormatter {
            depth: 0,
            lines: &lines,
        },
    );
    value.serialize(&mut serializer)?;
    if !lines.get() {
        bytes.push(b'\n');
    }
    // serde_json writes valid UTF-8 and the formatter writes ASCII.
    String::from_utf8(bytes).map_err(|_| {
        EncodeError::from(<serde_json::Error as serde::ser::Error>::custom(
            "the serializer wrote invalid UTF-8",
        ))
    })
}

/// The text with DEL and every C1 control, U+007F through U+009F, replaced by its four-digit
/// lowercase `\uXXXX` escape, so none reaches a terminal. JSON escapes the C0 controls itself and
/// leaves these raw.
pub(crate) fn escape_controls(text: &str) -> String {
    // DEL is the byte 0x7F, and every C1 control encodes with the lead byte 0xC2, so text with
    // neither byte holds nothing to escape.
    if !text.bytes().any(|byte| byte == 0x7f || byte == 0xc2) {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        if ('\u{7f}'..='\u{9f}').contains(&character) {
            out.push_str(&format!("\\u{:04x}", u32::from(character)));
        } else {
            out.push(character);
        }
    }
    out
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // A test fails by panicking.
mod lines_tests {
    use super::{stringify, stringify_lines};
    use serde_json::{Value, json};

    /// The lines the view wrote before it wrote in one pass: the value read as JSON data, then one
    /// `JSON.stringify` line per element of an array, or one line for any other value.
    fn element_by_element(value: &Value) -> String {
        let mut text = String::new();
        match value {
            Value::Array(elements) => {
                for element in elements {
                    text.push_str(&stringify(element, false).unwrap());
                    text.push('\n');
                }
            }
            other => {
                text.push_str(&stringify(other, false).unwrap());
                text.push('\n');
            }
        }
        text
    }

    #[test]
    fn one_pass_writes_the_lines_an_element_by_element_write_does() {
        let values = [
            json!([]),
            json!([{"kind": "string", "path": "user.name"}, {"kind": "null", "path": "x"}]),
            json!([[1, 2, [3, [4]]], [], [[]], {"a": [1, {"b": [2, 3]}]}]),
            json!([1, 2.5, -0.0, 1e21, 1e-7, 3.0, "text", true, null]),
            json!({"rows": [1, 2, 3], "nested": {"list": [[1], [2]]}}),
            json!("one string"),
            json!(42),
            json!(null),
            json!([{"quote": "a \"quoted\" word", "control": "tab\there", "wide": "\u{4e2d}"}]),
        ];
        for value in values {
            assert_eq!(
                stringify_lines(&value).unwrap(),
                element_by_element(&value),
                "{value}"
            );
        }
    }

    #[test]
    fn typed_rows_write_one_line_each() {
        #[derive(serde::Serialize)]
        struct Row {
            path: &'static str,
            tags: Vec<u8>,
            score: f64,
        }
        let rows = vec![
            Row {
                path: "a",
                tags: vec![1, 2],
                score: 1.5,
            },
            Row {
                path: "b",
                tags: Vec::new(),
                score: 3.0,
            },
        ];
        assert_eq!(
            stringify_lines(&rows).unwrap(),
            "{\"path\":\"a\",\"tags\":[1,2],\"score\":1.5}\n{\"path\":\"b\",\"tags\":[],\"score\":3}\n"
        );
        assert_eq!(stringify_lines(&(1, "two")).unwrap(), "1\n\"two\"\n");
    }
}
