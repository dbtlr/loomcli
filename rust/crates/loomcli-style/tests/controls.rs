//! The cases of the reference's `packages/core/tests/controls.test.ts`.

use loomcli_style::escape_control_characters;

/// One code point between two letters, and the escape the text reads as once escaped.
fn surrounded(code: u32) -> (String, String) {
    let character = char::from_u32(code).unwrap_or_default();
    (format!("a{character}b"), format!("a\\u{code:04x}b"))
}

#[test]
fn every_control_character_and_line_separator_is_escaped() {
    for code in [0x0000, 0x001b, 0x007f, 0x0085, 0x2028, 0x2029] {
        let (raw, escaped) = surrounded(code);
        assert_eq!(escape_control_characters(&raw), escaped, "{code:04X}");
    }
}

#[test]
fn every_bidirectional_control_is_escaped() {
    for code in [
        0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f,
        0x061c,
    ] {
        let (raw, escaped) = surrounded(code);
        assert_eq!(escape_control_characters(&raw), escaped, "{code:04X}");
    }
}

#[test]
fn other_format_characters_and_the_neighbors_of_the_escaped_ranges_stay() {
    for kept in [
        "\u{1f469}\u{200d}\u{1f4bb}",
        "co\u{ad}op",
        "a\u{200b}b",
        "a\u{200d}b",
        "a\u{2010}b",
        "a\u{202f}b",
        "a\u{2065}b",
        "a\u{206a}b",
        "a\u{61b}b",
        "a\u{61d}b",
    ] {
        assert_eq!(escape_control_characters(kept), kept, "{kept:?}");
    }
}
