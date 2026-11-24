//! Printing a JSON value as `JSON.stringify` writes it.

use serde_json::{Map, Value};

/// Every command prints its result here, as `JSON.stringify(value, undefined, 2)` writes the value
/// `JSON.parse` read: objects and arrays indented by two spaces, scalars compact, each object's
/// members in JavaScript's order (see [`object_entries`]), and each number in JavaScript's form (see
/// [`javascript_number`]).
#[must_use]
pub fn format_json(value: &Value) -> String {
    let mut text = String::new();
    write_json(&mut text, value, 0);
    text
}

fn write_json(text: &mut String, value: &Value, depth: usize) {
    const INDENT: usize = 2;
    let open = |text: &mut String, depth: usize| {
        text.push('\n');
        text.push_str(&" ".repeat((depth + 1) * INDENT));
    };
    match value {
        Value::Null => text.push_str("null"),
        Value::Bool(flag) => text.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => text.push_str(&javascript_number(number.as_f64().unwrap_or(0.0))),
        Value::String(string) => text.push_str(&quote(string)),
        Value::Array(items) if items.is_empty() => text.push_str("[]"),
        Value::Array(items) => {
            text.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    text.push(',');
                }
                open(text, depth);
                write_json(text, item, depth + 1);
            }
            text.push('\n');
            text.push_str(&" ".repeat(depth * INDENT));
            text.push(']');
        }
        Value::Object(members) if members.is_empty() => text.push_str("{}"),
        Value::Object(members) => {
            text.push('{');
            for (index, (key, member)) in object_entries(members).into_iter().enumerate() {
                if index > 0 {
                    text.push(',');
                }
                open(text, depth);
                text.push_str(&quote(key));
                text.push_str(": ");
                write_json(text, member, depth + 1);
            }
            text.push('\n');
            text.push_str(&" ".repeat(depth * INDENT));
            text.push('}');
        }
    }
}

/// A string as `JSON.stringify` quotes it: `serde_json` escapes the same characters, the two-letter
/// escapes and every other control character as a lowercase `\u00xx`.
fn quote(string: &str) -> String {
    Value::String(string.to_owned()).to_string()
}

/// An object's members in the order a JavaScript object holds them, which `Object.entries` and
/// `JSON.stringify` read: the array-index keys (`"0"`, `"17"`, up to 4294967294, with no leading
/// zero) first, in ascending numeric order, then every other key in the order the document wrote it.
#[must_use]
pub fn object_entries(members: &Map<String, Value>) -> Vec<(&String, &Value)> {
    in_javascript_order(members.iter(), |(key, _)| key.as_str())
}

/// The members of an object it owns, in the order [`object_entries`] reads them, so a caller that
/// consumes the object moves each member out and copies none.
#[must_use]
pub fn object_members(members: Map<String, Value>) -> Vec<(String, Value)> {
    in_javascript_order(members.into_iter(), |(key, _)| key.as_str())
}

/// The array index a key spells, as JavaScript reads one: `"0"`, or digits with no leading zero, up
/// to 4294967294.
fn array_index(key: &str) -> Option<u32> {
    let canonical = key == "0" || (!key.starts_with('0') && !key.is_empty());
    if !canonical || !key.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    key.parse::<u32>().ok().filter(|index| *index < u32::MAX)
}

/// Members in JavaScript's property order: the array-index keys first, ascending, then every other
/// key in the order it was given.
fn in_javascript_order<M>(members: impl Iterator<Item = M>, key: impl Fn(&M) -> &str) -> Vec<M> {
    let mut indexed: Vec<(u32, M)> = Vec::new();
    let mut named = Vec::new();
    for member in members {
        match array_index(key(&member)) {
            Some(position) => indexed.push((position, member)),
            None => named.push(member),
        }
    }
    indexed.sort_by_key(|(position, _)| *position);
    indexed
        .into_iter()
        .map(|(_, member)| member)
        .chain(named)
        .collect()
}

/// A number as JavaScript's `Number.prototype.toString` writes it, since `JSON.parse` reads every
/// number as a double: the shortest digits that read back as the same double, in plain notation
/// from 1e-6 up to but not including 1e21 and in exponent notation (`1e+21`, `1.5e-7`) outside it,
/// with `-0` as `0`.
#[must_use]
pub fn javascript_number(number: f64) -> String {
    if number == 0.0 {
        return "0".to_owned();
    }
    if !number.is_finite() {
        return "null".to_owned();
    }
    let sign = if number < 0.0 { "-" } else { "" };
    // Rust's exponent form holds the shortest round-trip digits, as `d.ddde-7`.
    let exponent_form = format!("{:e}", number.abs());
    let (mantissa, exponent) = exponent_form
        .split_once('e')
        .unwrap_or((exponent_form.as_str(), "0"));
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let exponent: i32 = exponent.parse().unwrap_or(0);
    // `n` places the decimal point after the `n`th digit, as ECMAScript's Number::toString does.
    let count = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    let point = exponent + 1;
    let body = if count <= point && point <= 21 {
        format!(
            "{digits}{}",
            "0".repeat(usize::try_from(point - count).unwrap_or(0))
        )
    } else if 0 < point && point <= 21 {
        let (whole, fraction) = digits.split_at(usize::try_from(point).unwrap_or(0));
        format!("{whole}.{fraction}")
    } else if -6 < point && point <= 0 {
        format!(
            "0.{}{digits}",
            "0".repeat(usize::try_from(-point).unwrap_or(0))
        )
    } else {
        let (first, rest) = digits.split_at(1);
        let fraction = if rest.is_empty() {
            String::new()
        } else {
            format!(".{rest}")
        };
        let sign = if point - 1 < 0 { '-' } else { '+' };
        format!("{first}{fraction}e{sign}{}", (point - 1).abs())
    };
    format!("{sign}{body}")
}
