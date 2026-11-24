//! JavaScript-compatible text rules the reference's messages and grammars depend on.

/// Whether `character` is whitespace as ECMAScript's `\s` and `String.prototype.trim` read it.
///
/// The set differs from Unicode `White_Space`: it includes U+FEFF and leaves out U+0085.
pub(crate) fn is_js_whitespace(character: char) -> bool {
    matches!(
        character,
        '\t' | '\n' | '\u{000B}' | '\u{000C}' | '\r' | ' ' | '\u{00A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// The regular-expression class of the same characters, for the crate's own matching.
pub(crate) const JS_SPACE_CLASS: &str = r"[\x{9}-\x{D} \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";

/// A number as JavaScript's `String(number)` writes it.
pub(crate) fn js_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value == 0.0 {
        return "0".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let count = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    // `point` is the position of the decimal point relative to the first digit.
    let point = exponent + 1;
    let body = if count <= point && point <= 21 {
        format!(
            "{digits}{}",
            "0".repeat(usize::try_from(point - count).unwrap_or(0))
        )
    } else if 0 < point && point <= 21 {
        let at = usize::try_from(point).unwrap_or(0);
        format!("{}.{}", &digits[..at], &digits[at..])
    } else if -6 < point && point <= 0 {
        format!(
            "0.{}{digits}",
            "0".repeat(usize::try_from(-point).unwrap_or(0))
        )
    } else {
        let power = point - 1;
        let marked = if power < 0 { '-' } else { '+' };
        let head = &digits[..1];
        let tail = &digits[1..];
        let fraction = if tail.is_empty() {
            String::new()
        } else {
            format!(".{tail}")
        };
        format!("{head}{fraction}e{marked}{}", power.abs())
    };
    format!("{sign}{body}")
}

/// A number as JSON writes it: a whole number without a fraction, any other finite number as the
/// shortest decimal that reads back, and `null` for a number JSON cannot hold.
pub(crate) fn json_number(value: f64) -> serde_json::Value {
    // A whole float below 2^63 (or, if positive, 2^64) converts to an integer exactly. Beyond
    // that it stays a float, which the manifest, MCP, and failure encoders write through the
    // formatter's `Number.prototype.toString` writer, so it prints as digits up to 1e21 there.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    if value.fract() == 0.0 {
        if value.abs() < 2f64.powi(63) {
            return serde_json::Value::from(value as i64);
        }
        if value > 0.0 && value < 2f64.powi(64) {
            return serde_json::Value::from(value as u64);
        }
    }
    serde_json::Number::from_f64(value).map_or(serde_json::Value::Null, serde_json::Value::Number)
}

/// Joins items as a sentence lists them: `a`, `a or b`, or `a, b, or c`.
pub(crate) fn listing<S: AsRef<str>>(items: &[S]) -> String {
    match items {
        [] => String::new(),
        [only] => only.as_ref().to_owned(),
        [first, second] => format!("{} or {}", first.as_ref(), second.as_ref()),
        [init @ .., last] => {
            let head: Vec<&str> = init.iter().map(AsRef::as_ref).collect();
            format!("{}, or {}", head.join(", "), last.as_ref())
        }
    }
}

/// Text as a pattern that matches it exactly under a JavaScript `u`-flag expression: each syntax
/// character, `^ $ \ . * + ? ( ) [ ] { } |`, escaped with a backslash and every other character
/// bare. A hyphen stays bare, because the `u` flag refuses `\-` outside a class.
pub(crate) fn escape_syntax(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        if "\\^$.*+?()[]{}|".contains(character) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_print_as_javascript_prints_them() {
        let cases = [
            (1.0, "1"),
            (-2.5, "-2.5"),
            (0.5, "0.5"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (1.5e-7, "1.5e-7"),
            (0.000_001, "0.000001"),
            (123_456.789, "123456.789"),
            (-0.0, "0"),
            (65_535.0, "65535"),
        ];
        for (value, printed) in cases {
            assert_eq!(js_number(value), printed, "{value}");
        }
    }

    #[test]
    fn lists_join_as_sentences_list_them() {
        assert_eq!(listing(&["a"]), "a");
        assert_eq!(listing(&["a", "b"]), "a or b");
        assert_eq!(listing(&["a", "b", "c"]), "a, b, or c");
    }

    #[test]
    fn syntax_characters_escape_and_a_hyphen_stays_bare() {
        assert_eq!(escape_syntax("a-b/c.d|e"), "a-b/c\\.d\\|e");
    }
}
