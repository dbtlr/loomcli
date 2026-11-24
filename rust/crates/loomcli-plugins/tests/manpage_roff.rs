//! The roff writer, ported from the reference's `manpage-roff.test.ts`.

#![cfg(feature = "manpage")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use loomcli_plugins::manpage::roff::{
    Fill, Font, Run, escape, escape_text, escape_unbroken, in_font, request, text_line, write_runs,
};

/// A character by its code point, so the test source stays ASCII.
fn char_of(point: u32) -> char {
    char::from_u32(point).unwrap()
}

#[test]
fn the_backslash_the_hyphen_the_quote_characters_the_caret_and_the_tilde_are_escaped() {
    assert_eq!(
        escape("a\\b-c'd`e^f~g\"h"),
        r"a\eb\-c\(aqd\(gae\(haf\(tig\(dqh"
    );
    assert_eq!(escape(r"\fB"), r"\efB");
}

#[test]
fn a_tab_is_a_space_in_filled_text_and_kept_in_no_fill_text() {
    assert_eq!(escape("a\tb"), "a b");
    assert_eq!(escape_text("a\tb", Fill::NoFill), "a\tb");
}

#[test]
fn unbroken_text_escapes_each_space_a_tab_included_so_man_never_wraps_inside_it() {
    assert_eq!(escape_unbroken("\" a\tb\""), r"\(dq\ a\ b\(dq");
}

#[test]
fn a_control_character_and_a_line_separator_show_as_their_escape_its_backslash_escaped() {
    assert_eq!(escape(&format!("a{}b", char_of(0x1b))), r"a\eu001bb");
    assert_eq!(
        escape(&format!(
            "{}{}{}",
            char_of(0x7f),
            char_of(0x85),
            char_of(0x9f)
        )),
        r"\eu007f\eu0085\eu009f"
    );
    assert_eq!(
        escape(&format!("{}{}", char_of(0x2028), char_of(0x2029))),
        r"\eu2028\eu2029"
    );
    assert_eq!(
        escape_text(&format!("a{}b\nc", char_of(0)), Fill::NoFill),
        r"a\eu0000b\eu000ac"
    );
}

#[test]
fn every_other_character_above_ascii_is_written_as_its_code_point_in_uppercase_hexadecimal() {
    assert_eq!(
        escape(&format!(
            "caf{} {} {}",
            char_of(0xe9),
            char_of(0x2014),
            char_of(0x4e2d)
        )),
        r"caf\[u00E9] \[u2014] \[u4E2D]"
    );
    assert_eq!(escape(&char_of(0x1f600).to_string()), r"\[u1F600]");
    assert_eq!(
        escape(&format!(
            "{}{}{}",
            char_of(0x202e),
            char_of(0x200f),
            char_of(0xa0)
        )),
        r"\[u202E]\[u200F]\[u00A0]"
    );
}

#[test]
fn a_text_line_that_would_start_with_a_period_starts_with_the_zero_width_escape() {
    assert_eq!(text_line(".TH not a request"), r"\&.TH not a request");
    assert_eq!(text_line("plain. text"), "plain. text");
}

#[test]
fn a_run_in_a_font_opens_with_its_escape_and_returns_to_the_regular_font() {
    assert_eq!(in_font("a-b", Font::Bold, Fill::Fill), r"\fBa\-b\fR");
    assert_eq!(in_font("path", Font::Italic, Fill::Fill), r"\fIpath\fR");
    assert_eq!(
        in_font("both", Font::BoldItalic, Fill::Fill),
        r"\f(BIboth\fR"
    );
    assert_eq!(in_font("plain", Font::Regular, Fill::Fill), "plain");
    assert_eq!(in_font("", Font::Bold, Fill::Fill), "");
}

#[test]
fn runs_in_one_font_join_before_they_are_written_so_a_font_opens_once() {
    assert_eq!(
        write_runs(&[
            Run::new("a", Font::Bold),
            Run::new("b", Font::Bold),
            Run::new(" and ", Font::Regular),
            Run::new("c", Font::Italic),
            Run::new("", Font::Italic),
        ]),
        r"\fBab\fR and \fIc\fR"
    );
}

#[test]
fn a_request_writes_each_argument_in_double_quotes_escaped() {
    assert_eq!(request("SH", &["NAME"]), r#".SH "NAME""#);
    assert_eq!(request("SS", &["SAY \"HI\""]), r#".SS "SAY \(dqHI\(dq""#);
    assert_eq!(
        request("TH", &["JSONKIT-GET", "1", "", "jsonkit 0.0.0", ""]),
        r#".TH "JSONKIT\-GET" "1" "" "jsonkit 0.0.0" """#
    );
}
