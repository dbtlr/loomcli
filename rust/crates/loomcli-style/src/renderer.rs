//! The renderer: one destination's capabilities and palette, and every operation a view context
//! performs with them.

use std::fmt;

use crate::ascii;
use crate::glyph::Glyph;
use crate::rendering::Capabilities;
use crate::resolve::{drawn_rows, marked_width, resolve_text};
use crate::style::{DELIMITER_LEAD_BYTE, StyleError, frame};
use crate::theme::Palette;
use crate::wrap::{expand_tabs_marked, wrap_marked};

/// Marked text resolved and measured for one destination: its capabilities under the run's
/// rendering policy, and the palette the installed theme resolves to on the run's background.
/// Every operation shares one frame parser and ANSI recognizer, and each call is its own state
/// boundary: no style, hyperlink, or partial command crosses from one call into the next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Renderer {
    capabilities: Capabilities,
    palette: Palette,
}

impl Renderer {
    /// A renderer for a destination with these capabilities and this palette.
    #[must_use]
    pub const fn new(capabilities: Capabilities, palette: Palette) -> Renderer {
        Renderer {
            capabilities,
            palette,
        }
    }

    /// The destination's capabilities.
    #[must_use]
    pub const fn capabilities(&self) -> &Capabilities {
        &self.capabilities
    }

    /// The palette semantic tokens resolve through.
    #[must_use]
    pub const fn palette(&self) -> &Palette {
        &self.palette
    }

    /// The bytes the destination receives for marked text: glyph forms selected, padding applied,
    /// styles and embedded ANSI written under the policy, and every style and hyperlink still open
    /// closed at the end. An incomplete ANSI sequence at the end is discarded.
    #[must_use]
    pub fn resolve(&self, text: &str) -> String {
        // Text with no frame and no control resolves to itself under every capability, so the
        // bulk of what an application writes, such as a large JSON document, skips the parse.
        if is_unmarked(text) {
            return text.to_owned();
        }
        if let Some(resolved) = ascii::resolve(text, &self.palette, &self.capabilities) {
            return resolved;
        }
        let input: Vec<char> = text.chars().collect();
        resolve_text(&input, &self.palette, &self.capabilities)
    }

    /// Marked text resolved with no color, modifier, hyperlink, or terminal control, keeping the
    /// destination's glyph forms and padding.
    #[must_use]
    pub fn plain(&self, text: &str) -> String {
        if is_unmarked(text) {
            return text.to_owned();
        }
        let caps = Capabilities {
            color: false,
            hyperlinks: false,
            modifiers: false,
            terminal_controls: false,
            ..self.capabilities
        };
        if let Some(resolved) = ascii::resolve(text, &self.palette, &caps) {
            return resolved;
        }
        let input: Vec<char> = text.chars().collect();
        resolve_text(&input, &self.palette, &caps)
    }

    /// The terminal columns of marked text on this destination: its widest line, with glyph forms
    /// selected, styling and hyperlink envelopes ignored, grapheme clusters measured as uucode
    /// 2.2.1 does, and tabs advancing to the next multiple of eight from each line's start.
    #[must_use]
    pub fn width(&self, text: &str) -> usize {
        if let Some(columns) = ascii::width(text, &self.palette, &self.capabilities) {
            return columns;
        }
        let input: Vec<char> = text.chars().collect();
        marked_width(&input, &self.palette, &self.capabilities)
    }

    /// Marked text with line breaks inserted so each line fits `columns`, measured as
    /// [`Renderer::width`] measures. Breaks fall at U+0020 alone and drop the spaces there, a word
    /// wider than `columns` keeps a line of its own, a padding or no-wrap frame is one unit, line
    /// breaks are kept with an inserted break matching its line's ending, and a style or hyperlink
    /// that spans a break continues across it. `None` returns the text unchanged.
    ///
    /// # Errors
    ///
    /// [`StyleError::WrapWidth`] when `columns` is zero or above `2^53 - 1`.
    pub fn wrap(&self, text: &str, columns: Option<usize>) -> Result<String, StyleError> {
        wrap_marked(text, columns, &self.capabilities, &self.palette)
    }

    /// Marked text with each tab replaced by spaces to the next multiple of eight, counted from the
    /// start of its own line as [`Renderer::width`] counts. Frame headers, escapes, and ANSI
    /// commands keep their bytes; a tab inside a padding frame is left to the frame, and a tab
    /// inside a control string is no tab.
    #[must_use]
    pub fn expand_tabs(&self, text: &str) -> String {
        expand_tabs_marked(text, &self.capabilities, &self.palette)
    }

    /// The rows a drawn frame of marked text advances the cursor on a terminal `columns` wide,
    /// leaving a final partial line on its row. With no width, each line break is one row.
    #[must_use]
    pub fn drawn_rows(&self, text: &str, columns: Option<usize>) -> usize {
        let input: Vec<char> = text.chars().collect();
        drawn_rows(&input, &self.palette, &self.capabilities, columns)
    }
}

impl Glyph {
    /// The glyph a catalog name names, such as `radioOn`.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Glyph> {
        Glyph::ALL
            .iter()
            .copied()
            .find(|glyph| glyph.name() == name)
    }

    /// The unstyled marked string that resolves to the glyph's form for the destination.
    #[must_use]
    pub fn marked(self) -> String {
        frame(&format!("[\"glyph\",\"{}\"]", self.name()), "")
    }
}

impl fmt::Display for Glyph {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.marked())
    }
}

/// Whether text holds no marked-string delimiter and no control character other than the line
/// endings LF and CRLF: the flat text every resolution leaves unchanged. It reads bytes, so it
/// decides without decoding: a delimiter's lead byte is 0xEE, a C0 control or DEL is its own byte,
/// and a C1 control is 0xC2 followed by 0x80 through 0x9F. It may answer `false` for flat text
/// (any character from U+E000 through U+EFFF), which then takes the full path.
fn is_unmarked(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.iter().enumerate().all(|(index, &byte)| match byte {
        b'\n' => true,
        b'\r' => bytes.get(index + 1) == Some(&b'\n'),
        0..=0x1f | 0x7f | DELIMITER_LEAD_BYTE => false,
        0xc2 => !matches!(bytes.get(index + 1), Some(0x80..=0x9f)),
        _ => true,
    })
}

#[cfg(test)]
mod tests {
    use super::{is_unmarked, resolve_text};
    use crate::color::ColorDepth;
    use crate::rendering::Capabilities;
    use crate::theme::Palette;

    /// Every combination of the capabilities that could change what a resolution writes.
    fn every_capability() -> Vec<Capabilities> {
        let mut all = Vec::new();
        for bits in 0_u8..32 {
            all.push(Capabilities {
                color: bits & 1 != 0,
                modifiers: bits & 2 != 0,
                hyperlinks: bits & 4 != 0,
                terminal_controls: bits & 8 != 0,
                depth: ColorDepth::Truecolor,
                main_glyphs: bits & 16 != 0,
            });
        }
        all
    }

    #[test]
    fn unmarked_text_resolves_to_itself_on_the_full_path() {
        let samples = [
            "",
            "plain words",
            "{\"kind\":\"object with 3 keys\",\"path\":\".\"}\n{\"kind\":\"string\",\"path\":\"a.b\"}\n",
            "two\nlines\n",
            "windows\r\nline endings\r\n",
            "  leading and trailing spaces  \n",
            "caf\u{e9} \u{b7} na\u{ef}ve \u{a0}non-breaking",
            "\u{4e2d}\u{6587} wide and \u{1f600} emoji \u{1f469}\u{200d}\u{1f4bb}",
            "combining e\u{301} and private use \u{f000} above the delimiters",
        ];
        let palette = Palette::new();
        for sample in samples {
            assert!(is_unmarked(sample), "{sample:?} is unmarked");
            let input: Vec<char> = sample.chars().collect();
            for capabilities in every_capability() {
                assert_eq!(
                    resolve_text(&input, &palette, &capabilities),
                    sample,
                    "{sample:?} under {capabilities:?}"
                );
            }
        }
    }

    #[test]
    fn text_the_full_path_can_change_is_not_unmarked() {
        let marked = [
            "\u{e000}[\"nowrap\"]\u{e001}framed\u{e002}",
            "an escaped delimiter \u{e003}E000",
            "\u{1b}[31mred\u{1b}[0m",
            "a\ttab",
            "a lone\rcarriage return",
            "a trailing carriage return\r",
            "bell\u{7}",
            "delete\u{7f}",
            "c1 control\u{9b}31m",
            "c1 edge\u{80}",
            "c1 edge\u{9f}",
        ];
        for sample in marked {
            assert!(!is_unmarked(sample), "{sample:?} takes the full path");
        }
    }
}
