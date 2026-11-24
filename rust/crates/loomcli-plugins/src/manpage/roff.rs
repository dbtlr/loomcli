//! The one writer every string of a man page passes through: roff escapes, request arguments, the
//! characters a page keeps ASCII, and font runs. A page reads the same under man-db's groff and
//! under mandoc, whether or not the man program runs preconv.
//!
//! Not part of any contract: the module is public and hidden so the crate's integration tests
//! reach the writer.

use loomcli_core::escape_control_characters;

/// A font a run of text is written in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Font {
    Regular,
    Bold,
    Italic,
    BoldItalic,
}

/// Filled text, which man wraps and where a tab is a space, or no-fill text, which keeps a tab.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fill {
    Fill,
    NoFill,
}

/// One run of text in one font.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Run {
    pub text: String,
    pub font: Font,
}

impl Run {
    #[must_use]
    pub fn new(text: impl Into<String>, font: Font) -> Self {
        Self {
            text: text.into(),
            font,
        }
    }
}

/// The escape of an ASCII character roff would otherwise read or print as something else.
fn named(character: char) -> Option<&'static str> {
    match character {
        '"' => Some("\\(dq"),
        '\'' => Some("\\(aq"),
        '-' => Some("\\-"),
        '\\' => Some("\\e"),
        '^' => Some("\\(ha"),
        '`' => Some("\\(ga"),
        '~' => Some("\\(ti"),
        _ => None,
    }
}

/// The escape that opens a font other than the regular one.
fn opening(font: Font) -> &'static str {
    match font {
        Font::Regular => "",
        Font::Bold => "\\fB",
        Font::Italic => "\\fI",
        Font::BoldItalic => "\\f(BI",
    }
}

/// Whether a character is a control character or a line separator, which shows as its escape.
fn is_control(character: char) -> bool {
    matches!(
        character,
        '\u{0}'..='\u{1f}' | '\u{7f}'..='\u{9f}' | '\u{2028}' | '\u{2029}'
    )
}

/// A character outside printable ASCII as a page writes it: a control character or a line
/// separator as its `\uXXXX` escape with the backslash escaped, so it shows, and any other as its
/// code point in uppercase hexadecimal.
fn escape_code_point(character: char, out: &mut String) {
    if is_control(character) {
        out.push_str(
            &escape_control_characters(character.encode_utf8(&mut [0; 4])).replace('\\', "\\e"),
        );
    } else if u32::from(character) > 0x7f {
        out.push_str(&format!("\\[u{:04X}]", u32::from(character)));
    } else {
        out.push(character);
    }
}

/// Text as a page writes it: ASCII, with nothing roff reads as an escape or a request argument.
#[must_use]
pub fn escape_text(text: &str, fill: Fill) -> String {
    let mut written = String::with_capacity(text.len());
    for character in text.chars() {
        if character == '\t' {
            written.push(if fill == Fill::NoFill { '\t' } else { ' ' });
        } else if let Some(escape) = named(character) {
            written.push_str(escape);
        } else {
            escape_code_point(character, &mut written);
        }
    }
    written
}

/// Filled text, the usual case.
#[must_use]
pub fn escape(text: &str) -> String {
    escape_text(text, Fill::Fill)
}

/// Filled text whose every space is unbreakable, so man never wraps a line inside it.
#[must_use]
pub fn escape_unbroken(text: &str) -> String {
    escape(text).replace(' ', "\\ ")
}

/// Text in a font, which returns to the regular font after it, so every line ends in it.
#[must_use]
pub fn in_font(text: &str, font: Font, fill: Fill) -> String {
    let escaped = escape_text(text, fill);
    if escaped.is_empty() || font == Font::Regular {
        return escaped;
    }
    format!("{}{escaped}\\fR", opening(font))
}

/// Runs of text, joined by font first, so each font opens once for each stretch of it.
#[must_use]
pub fn write_runs(runs: &[Run]) -> String {
    let mut joined: Vec<Run> = Vec::new();
    for run in runs {
        match joined.last_mut() {
            Some(last) if last.font == run.font => last.text.push_str(&run.text),
            _ if run.text.is_empty() => {}
            _ => joined.push(run.clone()),
        }
    }
    joined
        .iter()
        .map(|run| in_font(&run.text, run.font, Fill::Fill))
        .collect()
}

/// A text line, which starts with `\&` when it would start with a period, so it is no request.
#[must_use]
pub fn text_line(content: &str) -> String {
    if content.starts_with('.') {
        format!("\\&{content}")
    } else {
        content.to_owned()
    }
}

/// A request with each argument written in double quotes, so an argument of several words is one.
#[must_use]
pub fn request(name: &str, args: &[&str]) -> String {
    let mut line = format!(".{name}");
    for arg in args {
        line.push_str(&format!(" \"{}\"", escape(arg)));
    }
    line
}
