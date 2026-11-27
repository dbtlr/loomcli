//! The configuration reader for TOML 1.1 files.
//!
//! Enable the `config-toml` Cargo feature and pass [`TOML`] to
//! [`ConfigurationSettings::formats`](super::ConfigurationSettings::formats) to read `.toml` files.

use ::toml::Spanned;
use ::toml::de::{DeTable, DeValue};

use super::document::{ObjectBuilder, Value};
use super::reading::{Clause, Reading};

/// Why one value could not be read, at a byte offset.
struct Unread(usize);

/// An integer's exact value from its digits and radix, or `None` beyond 128 bits.
fn integer(digits: &str, radix: u32) -> Option<i128> {
    i128::from_str_radix(digits, radix).ok()
}

/// One TOML value as the document holds it.
fn value_of(text: &str, spanned: &Spanned<DeValue<'_>>) -> Result<Value, Unread> {
    let span = spanned.span();
    Ok(match spanned.get_ref() {
        DeValue::String(string) => Value::Text(string.to_string()),
        DeValue::Integer(number) => {
            Value::Integer(integer(number.as_str(), number.radix()).ok_or(Unread(span.start))?)
        }
        DeValue::Float(number) => {
            Value::Number(number.as_str().parse().map_err(|_| Unread(span.start))?)
        }
        DeValue::Boolean(flag) => Value::Bool(*flag),
        DeValue::Datetime(_) => Value::Text(text.get(span.clone()).unwrap_or_default().to_owned()),
        DeValue::Array(items) => Value::array(
            items
                .iter()
                .map(|item| value_of(text, item))
                .collect::<Result<_, _>>()?,
        ),
        DeValue::Table(table) => table_of(text, table)?,
    })
}

/// A table as an object, its keys in the order the file wrote them.
fn table_of(text: &str, table: &DeTable<'_>) -> Result<Value, Unread> {
    let mut object = ObjectBuilder::default();
    for (key, value) in table {
        object.insert(key.get_ref().to_string(), value_of(text, value)?);
    }
    Ok(object.build())
}

/// The TOML configuration reader, available with the `config-toml` feature.
pub const TOML: super::reading::ConfigurationReader = super::reading::ConfigurationReader {
    format: super::reading::ReaderFormat::Toml,
    parse: read_toml,
};

/// The table a TOML document holds, which is always a table at its top level, or the place where
/// it breaks. An integer beyond 128 bits breaks at its own place.
pub(crate) fn read_toml(text: &str) -> Reading {
    match DeTable::parse(text) {
        Ok(table) => match table_of(text, table.get_ref()) {
            Ok(value) => Reading::Usable(value),
            Err(Unread(offset)) => Reading::broken(Clause::InvalidToml, text, offset),
        },
        Err(error) => match error.span() {
            Some(span) => Reading::broken(Clause::InvalidToml, text, span.start),
            None => Reading::Unusable {
                clause: Clause::InvalidToml,
                at: None,
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::reading::Position;

    fn broken(line: usize, column: usize) -> Reading {
        Reading::Unusable {
            clause: Clause::InvalidToml,
            at: Some(Position { line, column }),
        }
    }

    // config-formats.test.ts: "a TOML file that does not parse names its line and column".
    #[test]
    fn a_toml_file_that_does_not_parse_names_its_line_and_column() {
        assert_eq!(read_toml("a = 1\nb = \nc = 3\n"), broken(2, 5));
        assert_eq!(read_toml("a = 1\r\nb = \"é😀\" x\r\n"), broken(2, 10));
        assert_eq!(read_toml("title = "), broken(1, 9));
        assert_eq!(read_toml("title = 1979-13-45\n"), broken(1, 9));
        assert_eq!(read_toml("title = \"open\n"), broken(1, 14));
        assert_eq!(read_toml("a = 1\na = 2\n"), broken(2, 1));
    }

    #[test]
    fn a_date_reads_as_written_and_an_integer_reads_exact() {
        let Reading::Usable(value) = read_toml(
            "a = 1979-05-27 07:32:00\nb = 07:32\nc = 0x1F\nd = 123456789012345678901\ne = 1.0\n",
        ) else {
            panic!("the document parses");
        };
        assert_eq!(
            value.get("a"),
            Some(&Value::Text("1979-05-27 07:32:00".into()))
        );
        assert_eq!(value.get("b"), Some(&Value::Text("07:32".into())));
        assert_eq!(value.get("c"), Some(&Value::Integer(31)));
        assert_eq!(
            value.get("d"),
            Some(&Value::Integer(123_456_789_012_345_678_901))
        );
        assert_eq!(value.get("e"), Some(&Value::Number(1.0)));
    }

    #[test]
    fn an_empty_document_is_an_empty_table() {
        assert_eq!(read_toml(""), Reading::Usable(Value::empty_object()));
    }
}
