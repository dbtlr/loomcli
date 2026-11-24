//! The cases of the reference's `packages/core/tests/wrap.test.ts`: what a view's
//! `context.wrap(text, columns)` and `context.expandTabs(text)` return once resolved for a stdout
//! pipe, as its `wrap.mjs` fixture renders them.

mod common;

use common::Facts;
use loomcli_style::{
    Alignment, Glyph, RenderingPolicy, StyleError, Switch, nowrap, pad, style, wrap_plain,
};

fn padded(text: &str, width: usize) -> String {
    pad(text, width, Alignment::Left).unwrap_or_default()
}

/// What a view returning `context.wrap(text, columns)` writes to a stdout pipe.
fn wrapped_with(facts: &Facts, text: &str, columns: Option<usize>) -> Result<String, StyleError> {
    let renderer = facts.renderer();
    Ok(renderer.resolve(&renderer.wrap(text, columns)?))
}

fn wrapped(text: &str, columns: usize) -> String {
    wrapped_with(&Facts::new(), text, Some(columns)).unwrap_or_else(|error| error.to_string())
}

/// What a view returning `context.expandTabs(text)` writes to a stdout pipe.
fn expanded_with(facts: &Facts, text: &str) -> String {
    let renderer = facts.renderer();
    renderer.resolve(&renderer.expand_tabs(text))
}

fn always_color() -> Facts {
    Facts::new().rendering(RenderingPolicy::new().color(Switch::Always))
}

#[test]
fn greedy_fitting_takes_as_many_words_as_fit_and_a_line_exactly_columns_wide_fits() {
    assert_eq!(wrapped("aaa bbb ccc", 7), "aaa bbb\nccc");
    assert_eq!(wrapped("aaa bbb ccc", 6), "aaa\nbbb\nccc");
    assert_eq!(wrapped("aaa bbbb", 8), "aaa bbbb");
    assert_eq!(wrapped("aaa bbbb", 7), "aaa\nbbbb");
}

#[test]
fn a_line_breaks_only_at_a_space_never_at_a_tab_and_keeps_runs_of_spaces() {
    assert_eq!(wrapped("aaaa\tbbbb", 5), "aaaa\tbbbb");
    assert_eq!(wrapped("a\tb c", 9), "a\tb\nc");
    assert_eq!(wrapped("a  b c", 4), "a  b\nc");
    assert_eq!(wrapped("aaa   bbb", 4), "aaa\nbbb");
}

#[test]
fn authored_line_breaks_stay_and_a_break_matches_its_line_ending() {
    assert_eq!(wrapped("aaaa\nb c", 3), "aaaa\nb c");
    assert_eq!(wrapped("aa bb\ncc dd", 2), "aa\nbb\ncc\ndd");
    assert_eq!(wrapped("aa bb\r\ncc dd", 2), "aa\r\nbb\r\ncc\ndd");
    assert_eq!(wrapped("aa bb\r\n", 2), "aa\r\nbb\r\n");
}

#[test]
fn leading_spaces_stay_with_the_first_word_and_are_never_a_break() {
    assert_eq!(
        wrapped("  /a/very/long/path rest", 10),
        "  /a/very/long/path\nrest"
    );
    assert_eq!(wrapped("    abc", 2), "    abc");
}

#[test]
fn trailing_spaces_are_never_a_break_and_count_toward_the_fit() {
    assert_eq!(wrapped("abc   ", 3), "abc   ");
    assert_eq!(wrapped("ab cd   ", 5), "ab\ncd   ");
    assert_eq!(wrapped("ab cd   ", 8), "ab cd   ");
    assert_eq!(wrapped("ab cd ef  ", 7), "ab cd\nef  ");
}

#[test]
fn the_spaces_at_a_break_are_dropped() {
    assert_eq!(wrapped("one two   three", 7), "one two\nthree");
}

#[test]
fn a_word_wider_than_columns_keeps_a_line_of_its_own() {
    let url = "https://example.com/a/very/long/url";
    assert_eq!(
        wrapped(&format!("see {url} now"), 10),
        format!("see\n{url}\nnow")
    );
    assert_eq!(
        wrapped("token 0123456789abcdef0123456789abcdef", 8),
        "token\n0123456789abcdef0123456789abcdef"
    );
}

#[test]
fn a_no_wrap_frame_is_one_unit_at_its_body_width() {
    let path = "/Users/a/Library/Application Support/x";
    assert_eq!(
        wrapped(&format!("Wrote {}", nowrap(path)), 30),
        format!("Wrote\n{path}")
    );
    assert_eq!(wrapped(&format!("{} c", nowrap("a b")), 5), "a b c");
    assert_eq!(wrapped(&format!("{} c", nowrap("a b")), 4), "a b\nc");
    assert_eq!(wrapped(&nowrap("a b c d"), 1), "a b c d");
    let text = format!(
        "x {}",
        nowrap(&format!("{} {}", style().red().apply("a b"), Glyph::Tick))
    );
    assert_eq!(
        wrapped_with(&always_color(), &text, Some(3)),
        Ok("x\n\u{1b}[31ma b\u{1b}[39m ✔".to_owned())
    );
}

#[test]
fn a_padding_frame_is_one_unit_at_its_padded_width() {
    assert_eq!(wrapped(&format!("{} c", padded("a b", 6)), 8), "a b    c");
    assert_eq!(wrapped(&format!("{} c", padded("a b", 6)), 7), "a b   \nc");
    assert_eq!(wrapped(&format!("{} c", padded("a b", 6)), 6), "a b   \nc");
    assert_eq!(
        wrapped(&format!("{} c", padded(&nowrap("a b"), 4)), 1),
        "a b \nc"
    );
    // A line that starts inside a padding frame measures that frame's padding too.
    assert_eq!(
        wrapped(&format!("{} w", padded("x\ny z", 5)), 7),
        "x    \ny z   w"
    );
    assert_eq!(
        wrapped(&format!("{} w", padded("x\ny z", 5)), 6),
        "x    \ny z  \nw"
    );
}

#[test]
fn a_style_and_a_hyperlink_that_span_a_break_continue_across_it() {
    assert_eq!(
        wrapped_with(&always_color(), &style().red().apply("aaa bbb"), Some(3)),
        Ok("\u{1b}[31maaa\nbbb\u{1b}[39m".to_owned())
    );
    let open = "\u{1b}]8;;https://example.com\u{1b}\\";
    let close = "\u{1b}]8;;\u{1b}\\";
    assert_eq!(
        wrapped_with(
            &Facts::new().rendering(RenderingPolicy::new().hyperlinks(Switch::Always)),
            &format!("{open}aaa bbb{close}"),
            Some(3)
        ),
        Ok(format!("{open}aaa\nbbb{close}"))
    );
}

#[test]
fn wrap_measures_marked_glyphs_in_the_destination_glyph_forms() {
    let text = format!("{} ab cd", Glyph::RadioOn);
    assert_eq!(wrapped(&text, 7), "◉ ab cd");
    assert_eq!(
        wrapped_with(&Facts::new().env(&[("TERM", "linux")]), &text, Some(7)),
        Ok("(*) ab\ncd".to_owned())
    );
}

#[test]
fn wrap_measures_display_width() {
    assert_eq!(wrapped("界界 界界", 8), "界界\n界界");
    assert_eq!(wrapped("界界 界界", 9), "界界 界界");
}

#[test]
fn text_without_spaces_comes_back_unbroken() {
    for text in [
        "中文文本没有空格可以断开",
        "これは日本語の文章です",
        "ภาษาไทยไม่มีช่องว่างระหว่างคำ",
    ] {
        assert_eq!(wrapped(text, 2), text);
    }
}

#[test]
fn an_undefined_width_returns_the_text_unchanged() {
    assert_eq!(
        wrapped_with(&Facts::new(), "aaa bbb ccc", None),
        Ok("aaa bbb ccc".to_owned())
    );
}

#[test]
fn wrap_rejects_a_width_that_is_not_a_positive_safe_integer() {
    // A negative, fractional, NaN, or infinite width is unrepresentable in `usize`.
    for columns in [0, 1 << 53] {
        assert_eq!(
            wrapped("aaa bbb", columns),
            "Wrap width must be a positive safe integer."
        );
        assert_eq!(wrap_plain("aaa bbb", columns), Err(StyleError::WrapWidth));
    }
}

#[test]
fn pad_centers_each_line_of_a_wrapped_block() {
    let renderer = Facts::new().renderer();
    let block = renderer.wrap("aa bbbb", Some(6)).unwrap_or_default();
    assert_eq!(
        renderer.resolve(&pad(&block, 6, Alignment::Center).unwrap_or_default()),
        "  aa  \n bbbb "
    );
}

#[test]
fn expand_tabs_turns_each_tab_into_spaces_to_the_next_stop_from_its_line_start() {
    let facts = Facts::new();
    assert_eq!(expanded_with(&facts, "a\tb"), "a       b");
    assert_eq!(
        expanded_with(&facts, "abcdefgh\tb\t"),
        format!("abcdefgh{}b{}", " ".repeat(8), " ".repeat(7))
    );
    assert_eq!(
        expanded_with(&facts, "ab\tc\r\nabcd\te"),
        "ab      c\r\nabcd    e"
    );
    assert_eq!(expanded_with(&facts, "no tab"), "no tab");
}

#[test]
fn expand_tabs_measures_in_the_destination_glyph_forms_and_keeps_every_frame_working() {
    let text = format!("{}\tb", Glyph::RadioOn);
    assert_eq!(expanded_with(&Facts::new(), &text), "◉       b");
    assert_eq!(
        expanded_with(&Facts::new().env(&[("TERM", "linux")]), &text),
        "(*)     b"
    );
    let styled = format!("{}{}", style().red().apply("a\tb"), nowrap("c\td"));
    assert_eq!(
        expanded_with(&always_color(), &styled),
        "\u{1b}[31ma       b\u{1b}[39mc      d"
    );
}

#[test]
fn expand_tabs_leaves_a_tab_in_a_pad_frame_to_the_frame_and_an_ansi_payload_untouched() {
    assert_eq!(
        expanded_with(&Facts::new(), &format!("x{}\tc", padded("a\tb", 12))),
        format!("xa       b   {}c", " ".repeat(3))
    );
    let open = "\u{1b}]8;;https://example.com/a\tb\u{1b}\\";
    let close = "\u{1b}]8;;\u{1b}\\";
    assert_eq!(
        expanded_with(
            &Facts::new().rendering(RenderingPolicy::new().hyperlinks(Switch::Always)),
            &format!("{open}a\tb{close}")
        ),
        format!("{open}a       b{close}")
    );
}

#[test]
fn wrap_plain_reads_frames_as_literal_text() {
    assert_eq!(wrap_plain("aaa bbb ccc", 7), Ok("aaa bbb\nccc".to_owned()));
    let framed = nowrap("a b");
    assert_eq!(wrap_plain(&framed, 1), Ok(framed.replace(' ', "\n")));
}
