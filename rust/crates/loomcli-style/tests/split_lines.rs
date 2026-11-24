//! The cases of the reference's `packages/core/tests/split-lines.test.ts`.

use loomcli_style::{Alignment, nowrap, pad, split_lines, style};

const LINK: &str = "\u{1b}]8;;https://example.com\u{1b}\\";
const UNLINK: &str = "\u{1b}]8;;\u{1b}\\";
const RED: &str = "\u{1b}[31m";

fn red(text: &str) -> String {
    style().red().apply(text)
}

fn bold(text: &str) -> String {
    style().bold().apply(text)
}

/// `style(text)`: the root chain applied, a style frame with no operation.
fn plain_frame(text: &str) -> String {
    style().apply(text)
}

fn padded(text: &str, width: usize, align: Alignment) -> String {
    pad(text, width, align).unwrap_or_default()
}

#[test]
fn text_without_a_break_is_one_line_unchanged() {
    assert_eq!(split_lines("one two"), ["one two"]);
    assert_eq!(split_lines(&red("one two")), [red("one two")]);
    assert_eq!(split_lines(""), [""]);
}

#[test]
fn a_style_that_spans_a_break_closes_on_its_line_and_reopens_on_the_next() {
    assert_eq!(
        split_lines(&red("one\ntwo\nthree")),
        [red("one"), red("two"), red("three")]
    );
}

#[test]
fn nested_frames_reopen_in_their_order_and_a_closed_frame_stays_closed() {
    assert_eq!(
        split_lines(&format!("{}\ne", red(&format!("a {} d", bold("b\nc"))))),
        [
            red(&format!("a {}", bold("b"))),
            red(&format!("{} d", bold("c"))),
            "e".to_owned()
        ]
    );
}

#[test]
fn a_padding_frame_and_a_no_wrap_frame_close_and_reopen_at_a_break() {
    assert_eq!(
        split_lines(&padded("ab\ncd", 4, Alignment::Right)),
        [
            padded("ab", 4, Alignment::Right),
            padded("cd", 4, Alignment::Right)
        ]
    );
    assert_eq!(
        split_lines(&nowrap("a b\nc d")),
        [nowrap("a b"), nowrap("c d")]
    );
}

#[test]
fn a_frame_whose_header_names_a_theme_token_splits_like_any_style() {
    let brand =
        |body: &str| format!("\u{E000}[\"style\",[[\"token\",\"brand\"]]]\u{E001}{body}\u{E002}");
    assert_eq!(split_lines(&brand("a\nb")), [brand("a"), brand("b")]);
}

#[test]
fn a_crlf_ends_a_line_as_an_lf_does() {
    assert_eq!(split_lines("one\r\ntwo"), ["one", "two"]);
    assert_eq!(split_lines(&red("one\r\ntwo")), [red("one"), red("two")]);
}

#[test]
fn a_trailing_line_break_adds_no_empty_line_and_a_blank_line_inside_stays() {
    assert_eq!(split_lines("one\r\ntwo\n"), ["one", "two"]);
    assert_eq!(split_lines(&red("one\n")), [red("one")]);
    assert_eq!(
        split_lines(&padded("cat\n", 5, Alignment::Left)),
        [padded("cat", 5, Alignment::Left)]
    );
    assert_eq!(split_lines("\n"), [""]);
    assert_eq!(split_lines("a\n\nb"), ["a", "", "b"]);
    // A padding frame after the last break resolves to spaces, so that line is a line.
    assert_eq!(
        split_lines(&format!("a\n{}", padded("", 3, Alignment::Left))),
        ["a".to_owned(), padded("", 3, Alignment::Left)]
    );
}

#[test]
fn an_escaped_delimiter_and_a_glyph_frame_are_text_not_frames() {
    let glyph = "\u{E000}[\"glyph\",\"success\"]\u{E001}\u{E002}";
    assert_eq!(
        split_lines(&format!("\u{E003}E002 {glyph}\nnext")),
        [format!("\u{E003}E002 {glyph}"), "next".to_owned()]
    );
}

#[test]
fn an_embedded_sgr_attribute_is_scoped_to_its_line_and_set_again_on_the_next() {
    assert_eq!(
        split_lines(&format!("{RED}one\ntwo\u{1b}[39m")),
        [
            plain_frame(&format!("{RED}one")),
            plain_frame(&format!("{RED}two\u{1b}[39m"))
        ]
    );
    assert_eq!(
        split_lines(&bold(&format!("{RED}a\nb"))),
        [
            plain_frame(&bold(&format!("{RED}a"))),
            plain_frame(&bold(&format!("{RED}b")))
        ]
    );
}

#[test]
fn an_sgr_attribute_set_inside_a_padding_frame_carries_to_the_next_line_in_its_style() {
    let pad_red = padded(&format!("{RED}a"), 2, Alignment::Left);
    assert_eq!(
        split_lines(&bold(&format!("{pad_red} b\nc"))),
        [
            plain_frame(&bold(&format!("{pad_red} b"))),
            plain_frame(&bold(&format!("{RED}c")))
        ]
    );
}

#[test]
fn an_embedded_hyperlink_closes_at_the_end_of_its_line_and_opens_again_on_the_next() {
    assert_eq!(
        split_lines(&format!("{LINK}one two\nthree{UNLINK} four")),
        [
            format!("{LINK}one two{UNLINK}"),
            format!("{LINK}three{UNLINK} four")
        ]
    );
    // The input leaves the link open past the style's close, so the last line closes it at its end.
    assert_eq!(
        split_lines(&red(&format!("{LINK}a\nb"))),
        [
            red(&format!("{LINK}a{UNLINK}")),
            format!("{}{UNLINK}", red(&format!("{LINK}b")))
        ]
    );
}

#[test]
fn a_line_break_inside_a_terminal_control_string_is_not_a_break() {
    let title = "\u{1b}]0;one\ntwo\u{7}";
    assert_eq!(
        split_lines(&format!("{title}rest")),
        [format!("{title}rest")]
    );
}
