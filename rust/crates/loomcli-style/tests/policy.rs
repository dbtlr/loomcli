//! The rendering-policy decisions the reference proves: `color-policy.test.ts`, the policy-level
//! cases of `color.test.ts` and `columns.test.ts`, and `ci-rendering.test.ts`, decided here from
//! the facts those tests' processes carried.

mod common;

use common::Facts;
use loomcli_style::{
    Ansi16Color, BackgroundPolicy, ColorChoice, ColorDepth, ColorFallbacks, RenderingPolicy,
    StyleError, Switch, TerminalControls, capabilities, color_depth, columns_variable,
    effective_columns, style,
};

// --- color-policy.test.ts ---

#[test]
fn a_marked_application_whose_host_capture_failed_prints_with_color_off_and_nothing_else_set() {
    assert_eq!(
        RenderingPolicy::uncaptured(true),
        RenderingPolicy::new().color(Switch::Never)
    );
}

#[test]
fn an_application_with_no_mark_sets_nothing_early_when_its_host_capture_failed() {
    assert_eq!(RenderingPolicy::uncaptured(false), RenderingPolicy::new());
}

#[test]
fn the_choice_sets_the_color_field_alone_over_the_declared_policy() {
    let declared = RenderingPolicy::new()
        .color(Switch::Always)
        .hyperlinks(Switch::Never)
        .modifiers(Switch::Never);
    assert_eq!(
        declared.chosen(Some(ColorChoice::Never)),
        RenderingPolicy::new()
            .color(Switch::Never)
            .hyperlinks(Switch::Never)
            .modifiers(Switch::Never)
    );
    assert_eq!(declared.chosen(None), declared);
}

// --- color.test.ts, at the policy the operator's choice sets ---

/// A shell environment with no color variable and a terminal type that supports color.
const PLAIN: [(&str, &str); 1] = [("TERM", "xterm")];

fn color_and_bold(
    env: &[(&'static str, &'static str)],
    tty: bool,
    policy: RenderingPolicy,
) -> (bool, bool) {
    let caps = capabilities(env, tty, &policy);
    (caps.color, caps.modifiers)
}

#[test]
fn on_a_capable_terminal_no_color_prints_no_color_and_keeps_bold_under_force_color_too() {
    let never = RenderingPolicy::new().chosen(Some(ColorChoice::Never));
    assert_eq!(color_and_bold(&PLAIN, true, never), (false, true));
    assert_eq!(
        color_and_bold(&[("TERM", "xterm"), ("FORCE_COLOR", "1")], true, never),
        (false, true)
    );
}

#[test]
fn piped_color_prints_color_and_no_bold() {
    let always = RenderingPolicy::new().chosen(Some(ColorChoice::Always));
    assert_eq!(color_and_bold(&PLAIN, false, always), (true, false));
}

#[test]
fn the_choice_overrides_no_color_and_force_color() {
    let always = RenderingPolicy::new().chosen(Some(ColorChoice::Always));
    let never = RenderingPolicy::new().chosen(Some(ColorChoice::Never));
    assert!(color_and_bold(&[("TERM", "xterm"), ("NO_COLOR", "1")], true, always).0);
    assert!(!color_and_bold(&[("TERM", "xterm"), ("FORCE_COLOR", "1")], false, never).0);
}

#[test]
fn the_choice_beats_the_applications_and_runs_declared_color() {
    for (declared, run) in [
        (
            RenderingPolicy::new().color(Switch::Always),
            RenderingPolicy::new(),
        ),
        (
            RenderingPolicy::new(),
            RenderingPolicy::new().color(Switch::Always),
        ),
    ] {
        let merged = declared.merged(&run);
        assert!(!color_and_bold(&PLAIN, true, merged.chosen(Some(ColorChoice::Never))).0);
    }
    for (declared, run) in [
        (
            RenderingPolicy::new().color(Switch::Never),
            RenderingPolicy::new(),
        ),
        (
            RenderingPolicy::new(),
            RenderingPolicy::new().color(Switch::Never),
        ),
    ] {
        let merged = declared.merged(&run);
        assert!(color_and_bold(&PLAIN, false, merged.chosen(Some(ColorChoice::Always))).0);
    }
}

#[test]
fn the_plain_policy_writes_no_color_modifier_or_hyperlink_and_keeps_controls() {
    let declared = RenderingPolicy::new()
        .color(Switch::Always)
        .modifiers(Switch::Always)
        .hyperlinks(Switch::Always)
        .terminal_controls(TerminalControls::Preserve)
        .background(BackgroundPolicy::Light);
    let caps = capabilities(&[("FORCE_COLOR", "1")], true, &declared.plain());
    assert!(!caps.color && !caps.modifiers && !caps.hyperlinks);
    assert!(caps.terminal_controls);
    assert_eq!(declared.plain().background_setting(), None);
    assert_eq!(
        RenderingPolicy::new().plain().terminal_controls_setting(),
        None
    );
}

// --- depth hints, from the table in docs/core/styles.md ---

#[test]
fn depth_follows_the_hints_in_their_order() {
    let cases: [(&[(&str, &str)], ColorDepth); 12] = [
        (&[("COLORTERM", "truecolor")], ColorDepth::Truecolor),
        (&[("COLORTERM", "24bit")], ColorDepth::Truecolor),
        (&[("TERM", "xterm-kitty")], ColorDepth::Truecolor),
        (&[("TERM", "xterm-ghostty")], ColorDepth::Truecolor),
        (&[("TERM", "wezterm")], ColorDepth::Truecolor),
        (
            &[
                ("TERM_PROGRAM", "iTerm.app"),
                ("TERM_PROGRAM_VERSION", "3.4.1"),
            ],
            ColorDepth::Truecolor,
        ),
        (
            &[
                ("TERM_PROGRAM", "iTerm.app"),
                ("TERM_PROGRAM_VERSION", "2.9"),
            ],
            ColorDepth::Ansi256,
        ),
        (&[("TERM_PROGRAM", "iTerm.app")], ColorDepth::Ansi256),
        (&[("TERM_PROGRAM", "Apple_Terminal")], ColorDepth::Ansi256),
        (&[("TERM", "screen-256")], ColorDepth::Ansi256),
        (&[("TERM", "XTERM-256COLOR")], ColorDepth::Ansi256),
        (&[("TERM", "xterm")], ColorDepth::Ansi16),
    ];
    for (env, depth) in cases {
        assert_eq!(color_depth(env), depth, "{env:?}");
    }
}

// --- ci-rendering.test.ts ---

fn sienna() -> Result<String, StyleError> {
    Ok(style()
        .hex_with(
            "#C97B36",
            ColorFallbacks::new()
                .ansi16(Ansi16Color::Yellow)
                .ansi256(172),
        )?
        .bold()
        .apply("x"))
}

#[test]
fn on_a_terminal_under_ci_a_hex_style_writes_at_the_log_viewers_depth() -> Result<(), StyleError> {
    let truecolor = "\u{1b}[38;2;201;123;54;1mx\u{1b}[39;22m";
    let basic = "\u{1b}[33;1mx\u{1b}[39;22m";
    let indexed = "\u{1b}[38;5;172;1mx\u{1b}[39;22m";
    let cases: [(&[(&'static str, &'static str)], &str); 13] = [
        (&[("CI", "true"), ("GITHUB_ACTIONS", "true")], truecolor),
        (&[("CI", "true"), ("GITEA_ACTIONS", "true")], truecolor),
        (&[("CI", "true"), ("CIRCLECI", "true")], truecolor),
        (&[("CI", "true"), ("TRAVIS", "true")], basic),
        (&[("APPVEYOR", "True"), ("CI", "True")], basic),
        (&[("CI", "true"), ("GITLAB_CI", "true")], basic),
        (&[("BUILDKITE", "true"), ("CI", "true")], basic),
        (&[("CI", "true"), ("DRONE", "true")], basic),
        (&[("CI", "true"), ("CI_NAME", "codeship")], basic),
        (&[("CI", "true")], "x"),
        (&[("CI", "true"), ("FORCE_COLOR", "1")], indexed),
        (
            &[
                ("CI", "true"),
                ("FORCE_COLOR", "1"),
                ("GITHUB_ACTIONS", "true"),
            ],
            truecolor,
        ),
        (&[("CI", "false")], indexed),
    ];
    let text = sienna()?;
    for (env, written) in cases {
        let mut full = vec![("TERM", "xterm-256color")];
        full.extend_from_slice(env);
        let facts = Facts {
            env: full,
            tty: true,
            ..Facts::default()
        };
        assert_eq!(facts.resolve(&text), written, "{env:?}");
    }
    Ok(())
}

#[test]
fn on_a_terminal_under_ci_an_embedded_hyperlink_is_stripped_to_its_text() {
    let link = "\u{1b}]8;;https://example.com\u{7}docs\u{1b}]8;;\u{7}";
    let under_ci = Facts::new()
        .env(&[
            ("TERM", "xterm"),
            ("CI", "true"),
            ("GITHUB_ACTIONS", "true"),
        ])
        .tty();
    assert_eq!(under_ci.resolve(link), "docs");
    let outside = Facts::new().env(&[("TERM", "xterm")]).tty();
    assert_eq!(outside.resolve(link), link);
}

// --- columns.test.ts, at the width each destination reads ---

#[test]
fn each_destination_reads_its_own_width() {
    assert_eq!(effective_columns(&[("A", "")], true, Some(100)), Some(100));
    assert_eq!(effective_columns(&[("A", "")], true, Some(60)), Some(60));
}

#[test]
fn a_destination_that_is_not_a_terminal_reads_no_columns() {
    assert_eq!(effective_columns(&[("A", "")], false, Some(100)), None);
    assert_eq!(
        effective_columns(&[("COLUMNS", "60")], false, Some(100)),
        None
    );
    assert_eq!(effective_columns(&[("COLUMNS", "60")], false, None), None);
}

#[test]
fn columns_narrows_a_terminal_and_never_widens_it() {
    for (value, expected) in [("60", 60), ("150", 100), ("060", 60), ("100", 100)] {
        assert_eq!(
            effective_columns(&[("COLUMNS", value)], true, Some(100)),
            Some(expected),
            "{value}"
        );
    }
}

#[test]
fn a_columns_that_is_not_a_positive_integer_leaves_the_real_width() {
    for value in [
        " 60",
        "+60",
        "60 ",
        "6e1",
        "0",
        "abc",
        "-5",
        "60.5",
        "",
        "9007199254740992",
    ] {
        assert_eq!(columns_variable(Some(value)), None, "{value:?}");
        assert_eq!(
            effective_columns(&[("COLUMNS", value)], true, Some(100)),
            Some(100),
            "{value:?}"
        );
    }
    assert_eq!(
        columns_variable(Some("9007199254740991")),
        Some((1 << 53) - 1)
    );
}

#[test]
fn a_terminal_that_reports_no_width_reads_a_valid_columns_and_none_without_one() {
    assert_eq!(
        effective_columns(&[("COLUMNS", "60")], true, None),
        Some(60)
    );
    assert_eq!(effective_columns(&[("A", "")], true, None), None);
    assert_eq!(effective_columns(&[("A", "")], true, Some(0)), None);
}
