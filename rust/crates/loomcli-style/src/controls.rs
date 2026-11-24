//! The control-character escape for raw text a message quotes.

/// Whether a character is escaped: a control character (U+0000 through U+001F and U+007F through
/// U+009F), a line or paragraph separator (U+2028, U+2029), or a bidirectional control or mark
/// (U+202A through U+202E, U+2066 through U+2069, U+200E, U+200F, U+061C).
fn escaped(character: char) -> bool {
    matches!(
        character,
        '\u{0}'..='\u{1f}'
            | '\u{7f}'..='\u{9f}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2066}'..='\u{2069}'
            | '\u{200e}'
            | '\u{200f}'
            | '\u{61c}'
    )
}

/// The text with every control character, line separator, and bidirectional control replaced by
/// its four-digit lowercase `\uXXXX` escape, so raw text stays on one line, writes no control
/// character, and cannot reorder the rest of the line. Other format characters, such as a
/// zero-width joiner or a soft hyphen, pass through. It escapes no Loom markup; pass styled data
/// through [`escape`](crate::escape) as well.
#[must_use]
pub fn escape_control_characters(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        if escaped(character) {
            out.push_str(&format!("\\u{:04x}", u32::from(character)));
        } else {
            out.push(character);
        }
    }
    out
}
