//! The cases of the reference's `packages/core/tests/written-width.test.ts`.

use loomcli_style::width;

#[test]
fn width_skips_every_control_sequence() {
    for (written, columns) in [
        (
            "\u{1b}[1mName\u{1b}[22m  \u{1b}]8;;https://example.com\u{1b}\\docs\u{1b}]8;;\u{1b}\\",
            10,
        ),
        ("\u{1b}]8;;https://example.com\u{7}docs\u{1b}]8;;\u{7}", 4),
        ("名前\tok", 10),
    ] {
        assert_eq!(width(written), columns, "{written:?}");
    }
}

#[test]
fn width_emulates_no_cursor_movement_so_overwritten_text_still_counts() {
    assert_eq!(width("abc\u{1b}[2Dxy"), 5);
    assert_eq!(width("abcd\rxy"), 6);
}

#[test]
fn width_counts_grapheme_clusters_as_the_view_context_does() {
    for (written, columns) in [
        ("日本語", 6),
        ("\u{1f469}\u{200d}\u{1f4bb}", 2),
        ("\u{1f1ef}\u{1f1f5}", 2),
        ("e\u{301}", 1),
    ] {
        assert_eq!(width(written), columns, "{written:?}");
    }
}

#[test]
fn width_is_the_widest_line_with_lf_and_crlf_as_line_breaks() {
    assert_eq!(width("abc\r\nabcdef\nab"), 6);
    assert_eq!(width("\u{1b}[31mabcdefghij\u{1b}[39m\n\tx"), 10);
}

#[test]
fn width_reads_no_marked_string_frame() {
    let framed = "\u{E000}[\"nowrap\"]\u{E001}ab\u{E002}";
    assert_eq!(width(framed), framed.chars().count());
}
