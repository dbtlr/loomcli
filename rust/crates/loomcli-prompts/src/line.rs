//! A typed line: the text typed so far and a cursor that never bisects a grapheme.

use std::sync::LazyLock;

use loomcli_core::style::graphemes as segments;

use crate::reader::Key;

/// The graphemes of `text`, the unit of both editing and drawing.
pub(crate) fn graphemes(text: &str) -> Vec<&str> {
    segments(text)
}

/// A grapheme whose first code point is a letter or a number, general category `L` or `N`.
static WORD: LazyLock<Option<regex::Regex>> =
    LazyLock::new(|| regex::Regex::new(r"^[\p{L}\p{N}]").ok());

fn is_word(part: &str) -> bool {
    WORD.as_ref().is_some_and(|word| word.is_match(part))
}

fn is_whitespace(part: &str) -> bool {
    part.chars().next().is_some_and(char::is_whitespace)
}

/// One editable line, with its cursor as a grapheme index.
#[derive(Clone, Debug, Default)]
pub(crate) struct TypedLine {
    pub(crate) value: String,
    pub(crate) cursor: usize,
}

impl TypedLine {
    /// Replaces the line, with the cursor at its end.
    pub(crate) fn set(&mut self, value: &str) {
        self.value = value.to_owned();
        self.cursor = graphemes(value).len();
    }

    /// Applies one key: a move, a deletion, or an insertion of `inserted`.
    pub(crate) fn edit(&mut self, key: &Key) {
        let parts: Vec<String> = graphemes(&self.value)
            .into_iter()
            .map(str::to_owned)
            .collect();
        let count = parts.len();
        let word = |index: usize| parts.get(index).is_some_and(|part| is_word(part));
        let whitespace = |index: usize| parts.get(index).is_some_and(|part| is_whitespace(part));
        let cursor = self.cursor.min(count);
        let before = |space: bool| {
            let mut index = cursor;
            while index > 0
                && (if space {
                    whitespace(index - 1)
                } else {
                    !word(index - 1)
                })
            {
                index -= 1;
            }
            while index > 0
                && (if space {
                    !whitespace(index - 1)
                } else {
                    word(index - 1)
                })
            {
                index -= 1;
            }
            index
        };
        let mut start = cursor;
        let mut end = cursor;
        let mut inserted = "";
        match key {
            Key::Left => {
                self.cursor = cursor.saturating_sub(1);
                return;
            }
            Key::Right => {
                self.cursor = count.min(cursor + 1);
                return;
            }
            Key::Home => {
                self.cursor = 0;
                return;
            }
            Key::End => {
                self.cursor = count;
                return;
            }
            Key::WordLeft => {
                self.cursor = before(false);
                return;
            }
            Key::WordRight => {
                let mut index = cursor;
                while index < count && !word(index) {
                    index += 1;
                }
                while index < count && word(index) {
                    index += 1;
                }
                self.cursor = index;
                return;
            }
            Key::Backspace => start = start.saturating_sub(1),
            Key::Delete | Key::Eof => end = count.min(end + 1),
            Key::KillWhitespace => start = before(true),
            Key::KillWord => start = before(false),
            Key::KillStart => start = 0,
            Key::KillEnd => end = count,
            Key::Text(text) | Key::Paste(text) => inserted = text,
            _ => return,
        }
        let mut prefix: String = parts[..start].concat();
        prefix.push_str(inserted);
        let mut value = prefix.clone();
        value.push_str(&parts[end..].concat());
        let mut offset = 0;
        let mut position = 0;
        for part in graphemes(&value) {
            if offset >= prefix.len() {
                break;
            }
            offset += part.len();
            position += 1;
        }
        self.value = value;
        self.cursor = position;
    }
}
