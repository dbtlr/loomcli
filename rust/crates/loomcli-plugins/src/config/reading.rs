//! Reading one file's text: the parser its extension chooses, the place where a file breaks, and
//! the clause that says why a file cannot be used.

use super::document::Value;
use super::json;

/// A place in a file's text, as an editor shows it: its line and its column, each counted from 1.
/// A line ends at LF, at CRLF, or at a lone CR, and a column counts characters, one per code
/// point, so the place reads the same whichever parser found it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Position {
    pub(crate) line: usize,
    pub(crate) column: usize,
}

/// The position of a byte offset in a text. An offset inside a character, or past the end, counts
/// to the end of the text before it.
pub(crate) fn position_at(text: &str, offset: usize) -> Position {
    let mut line = 1;
    let mut column = 1;
    let mut characters = text.char_indices().peekable();
    while let Some((at, character)) = characters.next() {
        if at >= offset {
            break;
        }
        match character {
            '\r' => {
                // A CRLF ends one line, at its LF.
                if characters
                    .peek()
                    .is_some_and(|(next, after)| *after == '\n' && *next < offset)
                {
                    continue;
                }
                line += 1;
                column = 1;
            }
            '\n' => {
                line += 1;
                column = 1;
            }
            _ => column += 1,
        }
    }
    Position { line, column }
}

/// The byte offset of a character index in a text, or the text's length past its end.
#[cfg(feature = "config-yaml")]
pub(crate) fn offset_of_character(text: &str, index: usize) -> usize {
    text.char_indices()
        .nth(index)
        .map_or(text.len(), |(offset, _)| offset)
}

/// The clause that says why a file cannot be used, after its name in a warning or a failure.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Clause {
    DoesNotExist,
    CouldNotBeRead,
    InvalidJson,
    NotJsonObject,
    #[cfg_attr(not(feature = "config-toml"), allow(dead_code))]
    InvalidToml,
    #[cfg_attr(not(feature = "config-yaml"), allow(dead_code))]
    InvalidYaml,
    #[cfg_attr(not(feature = "config-yaml"), allow(dead_code))]
    NotYamlMapping,
    Unread(ReaderFormat),
}

/// What reading one file found: its top-level object, or the clause that says why it is skipped,
/// with the position where it stops parsing when the parser names one.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Reading {
    Usable(Value),
    Unusable {
        clause: Clause,
        at: Option<Position>,
    },
}

impl Reading {
    /// A file that does not parse, at a byte offset of its text.
    pub(crate) fn broken(clause: Clause, text: &str, offset: usize) -> Self {
        Reading::Unusable {
            clause,
            at: Some(position_at(text, offset)),
        }
    }

    /// The reading of a parsed value: usable when it is an object, and otherwise the clause given.
    pub(crate) fn of(value: Value, not_object: Clause) -> Self {
        match value {
            Value::Object(_) => Reading::Usable(value),
            _ => Reading::Unusable {
                clause: not_object,
                at: None,
            },
        }
    }
}

/// A path split at the last `.` of its last segment, where segments split on `/` and `\`: the stem
/// before the dot and the extension after it. The dot never starts the name, so `.textstatrc` and
/// `.toml` have no extension.
pub(crate) fn split_extension(path: &str) -> Option<(&str, &str)> {
    let name_start = path.rfind(['/', '\\']).map_or(0, |at| at + 1);
    let name = &path[name_start..];
    let dot = name.rfind('.')?;
    if dot == 0 {
        return None;
    }
    let at = name_start + dot;
    Some((&path[..at], &path[at + 1..]))
}

/// A format that needs a reader. JSON is built in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReaderFormat {
    Toml,
    Yaml,
}

impl ReaderFormat {
    /// Reader formats in the order the plugin uses.
    pub(crate) const ORDER: [Self; 2] = [Self::Toml, Self::Yaml];

    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Toml => "TOML",
            Self::Yaml => "YAML",
        }
    }
}

type Parser = fn(&str) -> Reading;

/// An optional configuration file reader. Pass `toml::TOML` or `yaml::YAML` to the
/// configuration settings to accept files in its format.
#[derive(Clone, Copy, Debug)]
pub struct ConfigurationReader {
    pub(crate) format: ReaderFormat,
    pub(crate) parse: Parser,
}

/// The extension and its reader format, if this is an extension JSON does not read.
pub(crate) fn reader_format(path: &str) -> Option<(&str, ReaderFormat)> {
    let (_, extension) = split_extension(path)?;
    let format = match extension {
        "toml" => ReaderFormat::Toml,
        "yaml" | "yml" => ReaderFormat::Yaml,
        _ => return None,
    };
    Some((extension, format))
}

pub(crate) fn has_reader(readers: &[ConfigurationReader], format: ReaderFormat) -> bool {
    readers.iter().any(|reader| reader.format == format)
}

/// Selects the parser from the path, before the plugin reads the file.
pub(crate) fn choose_parser(path: &str, readers: &[ConfigurationReader]) -> Result<Parser, Clause> {
    let Some((_, format)) = reader_format(path) else {
        return Ok(json::read_json);
    };
    readers
        .iter()
        .find(|reader| reader.format == format)
        .map(|reader| reader.parse)
        .ok_or(Clause::Unread(format))
}

/// Parses the file's text with a leading byte order mark ignored.
pub(crate) fn parse_text(parser: Parser, text: &str) -> Reading {
    parser(text.strip_prefix('\u{feff}').unwrap_or(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_position_counts_characters_and_every_line_ending() {
        assert_eq!(position_at("", 0), Position { line: 1, column: 1 });
        assert_eq!(
            position_at("{ \"é😀\": x }", "{ \"é😀\": ".len()),
            Position { line: 1, column: 9 }
        );
        assert_eq!(
            position_at("{\r\n\"a\": 1,\r\n\"b\": x}", 17),
            Position { line: 3, column: 6 }
        );
        assert_eq!(
            position_at("{\r\"a\": x}", 7),
            Position { line: 2, column: 6 }
        );
        // An offset between CR and LF counts the CR as a line ending of its own.
        assert_eq!(position_at("a\r\nb", 2), Position { line: 2, column: 1 });
    }

    // config-formats.test.ts: a .jsonc file and a file of any other name read comments the same
    // way, and a leading byte order mark is not a column.
    #[test]
    fn every_other_name_reads_as_json_with_comments_and_a_byte_order_mark_is_no_column() {
        for path in [".app.jsonc", ".apprc", "config.cfg"] {
            let Ok(parser) = choose_parser(path, &[]) else {
                panic!("{path} uses the JSON parser");
            };
            let Reading::Usable(value) = parse_text(parser, "{ \"minBytes\": 1, // note\n }")
            else {
                panic!("{path} reads");
            };
            assert_eq!(value.get("minBytes"), Some(&Value::Number(1.0)), "{path}");
        }
        assert_eq!(
            parse_text(json::read_json, "\u{feff}{ x }"),
            Reading::Unusable {
                clause: Clause::InvalidJson,
                at: Some(Position { line: 1, column: 3 })
            }
        );
    }

    #[test]
    fn mixed_line_endings_and_an_astral_character_count_as_one_position_rule() {
        assert_eq!(
            parse_text(json::read_json, "{\r\n\"😀\": 1,\r\"b\": x}"),
            Reading::Unusable {
                clause: Clause::InvalidJson,
                at: Some(Position { line: 3, column: 6 }),
            }
        );
    }

    #[test]
    fn an_extension_follows_the_last_dot_of_the_name_unless_it_starts_the_name() {
        assert_eq!(split_extension(".app.json"), Some((".app", "json")));
        assert_eq!(split_extension(".apprc"), None);
        assert_eq!(split_extension(".toml"), None);
        assert_eq!(split_extension("dir.d/.toml"), None);
        assert_eq!(split_extension("a\\b.c"), Some(("a\\b", "c")));
        assert_eq!(split_extension(".app."), Some((".app", "")));
        assert_eq!(reader_format(".app.TOML"), None);
        assert_eq!(reader_format("config.cfg"), None);
        assert_eq!(reader_format(".app.yml"), Some(("yml", ReaderFormat::Yaml)));
    }
}
