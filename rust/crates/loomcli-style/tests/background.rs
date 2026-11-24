//! The cases of the reference's `packages/core/tests/background-replies.test.ts`: the pure
//! decisions of background settlement.

use std::cell::Cell;

use loomcli_style::{
    BACKGROUND_QUERY, Background, BackgroundPolicy, BackgroundSources, BackgroundStep,
    background_before_query, background_of_luminance, color_fg_bg, query_allowed, read_replies,
    settle_background,
};

const ESCAPE: &str = "\u{1b}";
const BELL: &str = "\u{7}";
const TERMINATOR: &str = "\u{1b}\\";
const DA1: &str = "\u{1b}[?62;22c";

/// An OSC 11 reply carrying one `rgb:` payload, ended by the terminator given.
fn osc11(payload: &str, end: &str) -> String {
    format!("{ESCAPE}]11;rgb:{payload}{end}")
}

#[test]
fn an_osc_11_reply_answers_at_every_component_width() {
    for (payload, answer) in [
        ("f/f/f", Background::Light),
        ("00/00/00", Background::Dark),
        ("fff/fff/fff", Background::Light),
        ("1c1c/1c1c/1c1c", Background::Dark),
        ("f/ffff/ff", Background::Light),
    ] {
        for end in [BELL, TERMINATOR] {
            let replies = read_replies(format!("{}{DA1}", osc11(payload, end)).as_bytes());
            assert_eq!(replies.answer, Some(answer), "{payload}");
            assert!(replies.ended);
            assert_eq!(replies.typeahead, b"");
        }
    }
}

#[test]
fn garbage_before_between_and_after_the_replies_passes_through_as_typeahead() {
    let received = format!(
        "ab{}c{ESCAPE}[?997;1nd{DA1}ef",
        osc11("ffff/ffff/ffff", TERMINATOR)
    );
    let replies = read_replies(received.as_bytes());
    assert_eq!(replies.answer, Some(Background::Light));
    assert!(replies.ended);
    assert_eq!(replies.typeahead, b"abcdef");
}

#[test]
fn interrupt_keys_stay_in_the_typeahead_for_the_caller_to_raise() {
    let received = format!(
        "a\u{1a}{}b\u{3}\u{1c}{DA1}c\u{3}",
        osc11("0/0/0", TERMINATOR)
    );
    let replies = read_replies(received.as_bytes());
    assert_eq!(replies.answer, Some(Background::Dark));
    assert!(replies.ended);
    assert_eq!(replies.typeahead, b"a\x1ab\x03\x1cc\x03");
}

#[test]
fn a_da1_reply_that_arrives_first_ends_the_read_with_no_answer() {
    let late = osc11("ffff/ffff/ffff", TERMINATOR);
    let replies = read_replies(format!("{DA1}{late}").as_bytes());
    assert_eq!(replies.answer, None);
    assert!(replies.ended);
    assert_eq!(replies.typeahead, late.as_bytes());
}

#[test]
fn a_color_scheme_reply_answers_alone() {
    for (mode, answer) in [("1", Background::Dark), ("2", Background::Light)] {
        let replies = read_replies(format!("{ESCAPE}[?997;{mode}n{DA1}").as_bytes());
        assert_eq!(replies.answer, Some(answer));
    }
}

#[test]
fn an_osc_11_reply_wins_over_a_color_scheme_reply_beside_it() {
    let received = format!("{ESCAPE}[?997;2n{}{DA1}", osc11("0/0/0", TERMINATOR));
    assert_eq!(
        read_replies(received.as_bytes()).answer,
        Some(Background::Dark)
    );
}

#[test]
fn an_osc_11_reply_that_does_not_parse_is_removed_and_answers_nothing() {
    let received = format!("{ESCAPE}]11;rgba:ffff/ffff/ffff/ffff{BELL}{DA1}");
    let replies = read_replies(received.as_bytes());
    assert_eq!(replies.answer, None);
    assert!(replies.ended);
    assert_eq!(replies.typeahead, b"");
}

#[test]
fn replies_read_before_the_sentinel_still_answer_and_the_read_is_not_ended() {
    let received = format!("x{}", osc11("ffff/ffff/ffff", TERMINATOR));
    let replies = read_replies(received.as_bytes());
    assert_eq!(replies.answer, Some(Background::Light));
    assert!(!replies.ended);
    assert_eq!(replies.typeahead, b"x");
}

#[test]
fn a_luminance_just_above_one_half_answers_light_and_exactly_one_half_dark() {
    assert_eq!(background_of_luminance(0.500_001), Background::Light);
    assert_eq!(background_of_luminance(0.5), Background::Dark);
}

#[test]
fn a_gray_either_side_of_the_threshold_answers_by_its_wcag_luminance() {
    // #BCBCBC has a relative luminance of 0.5029, and #BBBBBB of 0.4969.
    let bc = format!("{}{DA1}", osc11("bc/bc/bc", TERMINATOR));
    let bb = format!("{}{DA1}", osc11("bb/bb/bb", TERMINATOR));
    assert_eq!(read_replies(bc.as_bytes()).answer, Some(Background::Light));
    assert_eq!(read_replies(bb.as_bytes()).answer, Some(Background::Dark));
}

#[test]
fn colorfgbg_answers_by_its_last_field() {
    for (value, answer) in [
        (Some("0;15"), Some(Background::Light)),
        (Some("15;0"), Some(Background::Dark)),
        (Some("15;default;7"), Some(Background::Light)),
        (Some("0;8"), Some(Background::Dark)),
        (Some(""), None),
        (None, None),
    ] {
        assert_eq!(color_fg_bg(value), answer, "{value:?}");
    }
}

#[test]
fn the_environment_a_query_needs() {
    let cases: [(&[(&str, &str)], bool); 9] = [
        (&[("TERM", "xterm-256color")], true),
        (&[], false),
        (&[("TERM", "")], false),
        (&[("TERM", "dumb")], false),
        (&[("STY", "1234.pts-0.host"), ("TERM", "screen")], false),
        (&[("STY", ""), ("TERM", "screen")], true),
        (&[("INSIDE_EMACS", "29.1,comint"), ("TERM", "xterm")], false),
        (&[("CI", "true"), ("TERM", "xterm")], false),
        (&[("CI", "false"), ("TERM", "xterm")], true),
    ];
    for (env, allowed) in cases {
        assert_eq!(query_allowed(env), allowed, "{env:?}");
    }
}

/// Sources that settle nothing before the query, on a terminal whose color is on.
fn detecting<'a>(env: &'a [(&'a str, &'a str)]) -> BackgroundSources<'a, [(&'a str, &'a str)]> {
    let mut sources = BackgroundSources::new(env);
    sources.detects = true;
    sources.terminals = true;
    sources.colored = true;
    sources
}

/// Settles with a query that answers `answer`, and reports how often it was asked.
fn settled_with(
    sources: &BackgroundSources<'_, [(&str, &str)]>,
    answer: Option<Background>,
) -> (Option<Background>, usize) {
    let calls = Cell::new(0);
    let settled = settle_background(sources, || {
        calls.set(calls.get() + 1);
        answer
    });
    (settled, calls.get())
}

const XTERM_256: [(&str, &str); 1] = [("TERM", "xterm-256color")];

#[test]
fn the_precedence_settles_before_the_query() {
    let light = Some(Background::Light);
    let dark = Some(Background::Dark);

    let mut sources = detecting(&XTERM_256);
    sources.choice = dark;
    sources.policy = Some(BackgroundPolicy::Light);
    assert_eq!(settled_with(&sources, light), (dark, 0));

    let mut sources = detecting(&XTERM_256);
    sources.policy = Some(BackgroundPolicy::Light);
    sources.stated = dark;
    assert_eq!(settled_with(&sources, light), (light, 0));

    let mut sources = detecting(&XTERM_256);
    sources.policy = Some(BackgroundPolicy::Auto);
    sources.stated = dark;
    assert_eq!(settled_with(&sources, light), (dark, 0));

    let mut sources = detecting(&XTERM_256);
    sources.colored = false;
    sources.stated = light;
    assert_eq!(settled_with(&sources, light), (light, 0));

    let mut sources = detecting(&XTERM_256);
    sources.colored = false;
    assert_eq!(settled_with(&sources, light), (None, 0));

    let piped = [("COLORFGBG", "0;15"), ("TERM", "xterm")];
    let mut sources = detecting(&piped);
    sources.terminals = false;
    assert_eq!(settled_with(&sources, light), (None, 0));

    let mut sources = detecting(&XTERM_256);
    sources.stated = light;
    sources.terminals = false;
    assert_eq!(settled_with(&sources, light), (light, 0));

    let console = [("COLORFGBG", "0;15"), ("TERM", "linux")];
    assert_eq!(settled_with(&detecting(&console), light), (dark, 0));
}

#[test]
fn the_query_answers_after_every_earlier_step_and_beats_colorfgbg() {
    let env = [("COLORFGBG", "15;0"), ("TERM", "xterm")];
    assert_eq!(
        settled_with(&detecting(&env), Some(Background::Light)),
        (Some(Background::Light), 1)
    );
    assert_eq!(
        background_before_query(&detecting(&env)),
        BackgroundStep::Query
    );
}

#[test]
fn colorfgbg_answers_when_the_query_has_no_answer() {
    let env = [("COLORFGBG", "0;15"), ("TERM", "xterm")];
    assert_eq!(
        settled_with(&detecting(&env), None).0,
        Some(Background::Light)
    );
}

#[test]
fn a_background_no_source_knows_settles_unknown() {
    assert_eq!(settled_with(&detecting(&XTERM_256), None).0, None);
}

#[test]
fn detection_runs_only_for_a_reader() {
    let env = [("COLORFGBG", "0;15"), ("TERM", "linux")];
    let mut sources = detecting(&env);
    sources.detects = false;
    assert_eq!(settled_with(&sources, Some(Background::Light)), (None, 0));
}

#[test]
fn a_stated_background_and_the_policy_answer_even_when_nothing_detects() {
    let mut quiet = detecting(&XTERM_256);
    quiet.detects = false;
    let mut stated = quiet;
    stated.stated = Some(Background::Light);
    assert_eq!(
        settled_with(&stated, Some(Background::Light)).0,
        Some(Background::Light)
    );
    let mut policy = quiet;
    policy.policy = Some(BackgroundPolicy::Dark);
    assert_eq!(
        settled_with(&policy, Some(Background::Light)).0,
        Some(Background::Dark)
    );
}

#[test]
fn the_query_is_osc_11_the_color_scheme_query_and_da1_in_one_write() {
    assert_eq!(BACKGROUND_QUERY, "\u{1b}]11;?\u{1b}\\\u{1b}[?996n\u{1b}[c");
    assert_eq!(Background::from_name("light"), Some(Background::Light));
    assert_eq!(Background::Dark.name(), "dark");
}
