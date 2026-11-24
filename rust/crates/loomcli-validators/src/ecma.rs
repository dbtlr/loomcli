//! Reads an ECMAScript `u`-flag pattern as the `regex` crate matches it, so the validator accepts
//! exactly the tokens the published `pattern` accepts.

use crate::js::JS_SPACE_CLASS;

/// The `regex` source that matches as `pattern` does under a JavaScript `u`-flag `RegExp`, or
/// `Err(())` for syntax a `u`-flag `RegExp` rejects: inline flags, `(?P<..>)`, `\A`, `\z`, a
/// letter escape outside the ECMAScript set, `\p` without braces, and an empty class `[]` or
/// `[^]`. An unescaped `[` inside a class is a literal, as in ECMAScript.
///
/// `\d`, `\w`, `\s`, and `\b` read as ECMAScript reads them (ASCII digits and word characters, the
/// ECMAScript whitespace set), and `.` leaves out the four line terminators.
pub(crate) fn to_regex(pattern: &str) -> Result<String, ()> {
    let chars: Vec<char> = pattern.chars().collect();
    let space = &JS_SPACE_CLASS[1..JS_SPACE_CLASS.len() - 1];
    let mut out = String::with_capacity(pattern.len() * 2);
    let mut in_class = false;
    let mut previous: Option<char> = None;
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        index += 1;
        let before = previous.take();
        match c {
            '\\' => {
                let escaped = *chars.get(index).ok_or(())?;
                index += 1;
                match escaped {
                    'd' => out.push_str("[0-9]"),
                    'D' => out.push_str("[^0-9]"),
                    'w' => out.push_str("[A-Za-z0-9_]"),
                    'W' => out.push_str("[^A-Za-z0-9_]"),
                    's' => out.push_str(&format!("[{space}]")),
                    'S' => out.push_str(&format!("[^{space}]")),
                    'b' if in_class => out.push_str("\\x08"),
                    'b' => out.push_str("(?-u:\\b)"),
                    'B' if !in_class => out.push_str("(?-u:\\B)"),
                    'p' | 'P' => {
                        if chars.get(index) != Some(&'{') {
                            return Err(());
                        }
                        out.push('\\');
                        out.push(escaped);
                    }
                    'x' => {
                        let hex = |at: usize| chars.get(at).is_some_and(char::is_ascii_hexdigit);
                        if !(hex(index) && hex(index + 1)) {
                            return Err(());
                        }
                        out.push_str("\\x");
                    }
                    'f' | 'n' | 'r' | 't' | 'v' | 'u' | '0' => {
                        out.push('\\');
                        out.push(escaped);
                    }
                    '-' if in_class => out.push_str("\\-"),
                    '-' => return Err(()),
                    other if other.is_ascii_alphanumeric() => return Err(()),
                    other => {
                        out.push('\\');
                        out.push(other);
                    }
                }
            }
            '[' if in_class => out.push_str("\\["),
            '[' => {
                in_class = true;
                out.push('[');
                if chars.get(index) == Some(&'^') {
                    out.push('^');
                    index += 1;
                }
                if chars.get(index) == Some(&']') {
                    return Err(());
                }
            }
            ']' if in_class => {
                in_class = false;
                out.push(']');
            }
            // The regex crate reads these doubled inside a class as set operators.
            '&' | '~' | '-' if in_class && before == Some(c) => {
                out.push('\\');
                out.push(c);
            }
            '.' if !in_class => out.push_str("[^\\n\\r\\x{2028}\\x{2029}]"),
            '(' if !in_class => {
                out.push('(');
                if chars.get(index) == Some(&'?') {
                    match (chars.get(index + 1), chars.get(index + 2)) {
                        (Some(':'), _) => {
                            out.push_str("?:");
                            index += 2;
                        }
                        (Some('<'), Some(next)) if !matches!(next, '=' | '!') => {
                            out.push_str("?<");
                            index += 2;
                        }
                        _ => return Err(()),
                    }
                }
            }
            other => {
                out.push(other);
                previous = Some(other);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use regex::Regex;

    fn matches(pattern: &str, token: &str) -> bool {
        Regex::new(&to_regex(pattern).unwrap())
            .unwrap()
            .is_match(token)
    }

    #[test]
    fn classes_read_as_ecmascript_reads_them() {
        assert!(matches(r"^\d+$", "123"));
        assert!(!matches(r"^\d+$", "\u{663}\u{664}"));
        assert!(!matches(r"^\w+$", "caf\u{e9}"));
        assert!(matches(r"^\s$", "\u{feff}"));
        assert!(!matches(r"^.$", "\u{2028}"));
        assert!(!matches(r"^[^\d]+$", "a1"));
    }

    #[test]
    fn regex_only_syntax_is_refused() {
        for pattern in [
            "(?i)a",
            "(?P<n>a)",
            r"\Aa",
            r"a\z",
            "[[:alpha:]]x[]",
            r"\pL",
            r"a\-",
        ] {
            assert!(to_regex(pattern).is_err(), "{pattern}");
        }
    }
}
