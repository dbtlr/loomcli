//! The cases of the reference's `packages/core/tests/style.test.ts` that exercise the style module,
//! resolved through the public surface as the reference's fixtures resolve them.

mod common;

use common::{Facts, bold_span, length, padded, red_span, resolve, unbroken};
use loomcli_style::{
    Alignment, Ansi16Color, Ansi256Fallbacks, ColorFallbacks, Glyph, RenderingPolicy, Style,
    StyleError, Switch, TerminalControls, ThemeMapping, escape, nowrap, pad, style,
};

fn always_color() -> RenderingPolicy {
    RenderingPolicy::new().color(Switch::Always)
}

fn always_both() -> RenderingPolicy {
    RenderingPolicy::new()
        .color(Switch::Always)
        .modifiers(Switch::Always)
}

#[test]
fn each_run_captures_fresh_capability_facts() {
    // The `fresh` scenario: FORCE_COLOR set for the first run and emptied before the second.
    let first = Facts::new().env(&[("FORCE_COLOR", "1"), ("TERM", "linux")]);
    let second = Facts::new().env(&[("FORCE_COLOR", ""), ("TERM", "linux")]);
    let text = style().red().apply("X");
    assert_eq!(
        format!("{}{}", first.resolve(&text), second.resolve(&text)),
        "\u{1b}[31mX\u{1b}[39mX"
    );
}

#[test]
fn styles_compose_as_ordinary_strings_and_restore_the_enclosing_foreground() {
    let text = style()
        .red()
        .apply(&format!("A{}C", style().blue().apply("B")));
    let facts = Facts::new()
        .env(&[("FORCE_COLOR", ""), ("TERM", "linux")])
        .rendering(always_both());
    assert_eq!(
        facts.resolve(&text),
        "\u{1b}[31mA\u{1b}[34mB\u{1b}[31mC\u{1b}[39m"
    );
}

#[test]
fn one_policy_resolves_stdout_and_stderr_separately() {
    // The `destinations` scenario: stdout is a pipe and stderr a terminal under TERM=linux. The
    // lane's gutter and continuation indent belong to core; the resolution of each stream is here.
    let env = [("FORCE_COLOR", ""), ("TERM", "linux")];
    let stdout = Facts::new().env(&env);
    let stderr = Facts::new().env(&env).tty();
    assert_eq!(stdout.resolve(&style().red().apply("plain")), "plain");
    let line = format!(
        "{} {}",
        style().info().apply(&Glyph::Info.to_string()),
        style().red().apply("ready")
    );
    assert_eq!(stderr.resolve(&line), "i \u{1b}[31mready\u{1b}[39m");
}

#[test]
fn a_theme_contributes_concrete_chains_without_changing_glyph_identity() {
    let theme = ThemeMapping::new()
        .entry("identifier", style().cyan())
        .entry("info", style().green().bold());
    let facts = Facts::new()
        .env(&[("FORCE_COLOR", ""), ("TERM", "linux")])
        .rendering(always_both())
        .theme(theme);
    let info = format!("{} ready", style().info().apply(&Glyph::Info.to_string()));
    assert_eq!(facts.resolve(&info), "\u{1b}[32;1mi\u{1b}[39;22m ready");
    assert_eq!(
        facts.resolve(&style().token("identifier").apply("custom")),
        "\u{1b}[36mcustom\u{1b}[39m"
    );
}

#[test]
fn embedded_ansi_resets_restore_enclosing_loom_attributes() {
    let facts = Facts::new().rendering(always_color());
    assert_eq!(
        facts.resolve(&red_span("A\u{1b}[34mB\u{1b}[39mC")),
        "\u{1b}[31mA\u{1b}[34mB\u{1b}[31mC\u{1b}[39m"
    );
}

#[test]
fn preserved_unmodeled_sgr_closes_at_each_output_boundary() {
    let facts =
        Facts::new().rendering(always_color().terminal_controls(TerminalControls::Preserve));
    assert_eq!(
        facts.resolve_each(&["\u{1b}[5mblink", "plain"]),
        "\u{1b}[5mblink\u{1b}[0mplain"
    );
    assert_eq!(facts.resolve("\u{9b}5mX"), "\u{1b}[5mX\u{1b}[0m");
    assert_eq!(
        facts.resolve(&red_span("\u{1b}[5mX")),
        "\u{1b}[31m\u{1b}[5mX\u{1b}[39m\u{1b}[0m"
    );
}

#[test]
fn closing_a_loom_frame_restores_outer_raw_and_loom_attributes_together() {
    assert_eq!(
        Facts::new()
            .rendering(always_both())
            .resolve(&red_span(&format!("A{}C", bold_span("\u{1b}[34mB")))),
        "\u{1b}[31mA\u{1b}[34;1mB\u{1b}[31;22mC\u{1b}[39m"
    );
    assert_eq!(
        Facts::new()
            .rendering(always_color())
            .resolve(&format!("\u{1b}[34mA{}C", red_span("B"))),
        "\u{1b}[34mA\u{1b}[31mB\u{1b}[34mC\u{1b}[39m"
    );
}

#[test]
fn ansi_recognition_spans_removed_loom_frames_before_policy_filters_a_command() {
    let plain_preserving = RenderingPolicy::new()
        .color(Switch::Never)
        .modifiers(Switch::Never)
        .terminal_controls(TerminalControls::Preserve);
    assert_eq!(
        Facts::new()
            .rendering(plain_preserving)
            .resolve(&format!("\u{1b}[3{}", red_span("1mX"))),
        "X"
    );
    assert_eq!(
        Facts::new()
            .rendering(always_color())
            .resolve(&format!("{}\u{7}X", red_span("\u{1b}]0;hidden"))),
        "X"
    );
}

#[test]
fn interrupted_ansi_prefixes_cannot_assemble_forbidden_commands() {
    let facts = Facts::new().rendering(
        RenderingPolicy::new()
            .color(Switch::Never)
            .modifiers(Switch::Never)
            .terminal_controls(TerminalControls::Preserve),
    );
    assert_eq!(facts.resolve_each(&["\u{1b}[3\u{1b}", "1mX"]), "1mX");
    assert_eq!(facts.resolve("\u{1b}\u{1b}[31m[31mX"), "[31mX");
}

#[test]
fn padding_preserves_composed_graphemes_crlf_and_terminal_empty_lines() {
    assert_eq!(
        Facts::new().measure(&format!(
            "{}\u{200d}\u{1f4bb}",
            padded("\u{1f469}", 0, "left")
        )),
        "2"
    );
    assert_eq!(
        resolve(&padded(
            &format!("\u{1f469}{}", padded("\u{200d}\u{1f4bb}", 0, "left")),
            3,
            "left"
        )),
        "\u{1f469}\u{200d}\u{1f4bb} "
    );
    assert_eq!(
        resolve(&padded(
            &format!("\r{}", padded("\n", 0, "left")),
            5,
            "left"
        )),
        "     \r\n"
    );
    assert_eq!(
        resolve(&padded(
            &format!("cat\n{}", padded("", 0, "left")),
            5,
            "left"
        )),
        "cat  \n"
    );
    assert_eq!(resolve(&format!("\r{}", padded("\n", 1, "left"))), " \r\n");
    assert_eq!(resolve(&padded("\u{600}", 2, "left")), "\u{600}  ");
}

#[test]
fn zero_width_terminal_envelopes_after_a_newline_do_not_create_a_padded_extra_line() {
    let link_open = "\u{1b}]8;;https://example.com\u{1b}\\";
    let link_close = "\u{1b}]8;;\u{1b}\\";
    assert_eq!(
        Facts::new()
            .rendering(RenderingPolicy::new().hyperlinks(Switch::Always))
            .resolve(&padded(&format!("{link_open}cat\n{link_close}"), 5, "left")),
        format!("{link_open}cat  \n{link_close}")
    );
    assert_eq!(
        Facts::new()
            .rendering(RenderingPolicy::new().terminal_controls(TerminalControls::Preserve))
            .resolve(&padded("cat\n\u{1b}[0K", 5, "left")),
        "cat  \n\u{1b}[0K"
    );
}

#[test]
fn padding_spaces_inherit_the_surrounding_raw_ansi_attributes() {
    assert_eq!(
        Facts::new()
            .rendering(always_color())
            .resolve(&format!("\u{1b}[34m{}", padded("X", 3, "left"))),
        "\u{1b}[34mX  \u{1b}[39m"
    );
}

#[test]
fn empty_styled_padding_cannot_change_the_scope_of_following_text() {
    let blue = "\u{E000}[\"style\",[[\"foreground\",\"blue\"]]]\u{E001}X\u{E002}";
    let facts = Facts::new().rendering(always_color());
    assert_eq!(
        facts.resolve(&format!("{}X", red_span(&padded("", 3, "left")))),
        "\u{1b}[31m   \u{1b}[39mX"
    );
    assert_eq!(
        facts.resolve(&format!("{}{blue}", red_span(&padded("", 3, "left")))),
        "\u{1b}[31m   \u{1b}[34mX\u{1b}[39m"
    );
}

/// The fixture's `nest`: `depth` padding headers, the text, and `depth` closes.
fn nested(text: &str, depth: usize, width: usize) -> String {
    let marker = pad("", width, Alignment::Left).unwrap_or_default();
    let header: String = marker.chars().take(marker.chars().count() - 1).collect();
    format!("{}{text}{}", header.repeat(depth), "\u{E002}".repeat(depth))
}

#[test]
fn large_empty_boundaries_and_deep_unchanged_multiline_padding_stay_bounded() {
    assert_eq!(resolve(&padded("", 0, "left").repeat(100_000)), "");
    assert_eq!(
        Facts::new().measure(&nested(&"X\n".repeat(32_000), 32_000, 0)),
        "1"
    );
    assert_eq!(
        Facts::new().measure(&nested(&"X\n".repeat(10_000), 10_000, 1)),
        "1"
    );
    assert_eq!(Facts::new().measure(&"\u{E000}".repeat(100_000)), "100000");
}

#[test]
fn scoped_resets_clear_only_the_requested_inherited_attributes() {
    for (reset, clearing, restoring) in [
        ("reset", "39;49;22", "31;44;1"),
        ("resetForeground", "39", "31"),
        ("resetBackground", "49", "44"),
    ] {
        let inside = format!("\u{E000}[\"style\",[[\"{reset}\"]]]\u{E001}B\u{E002}");
        let text = format!(
            "\u{E000}[\"style\",[[\"foreground\",\"red\"],[\"background\",\"blue\"],[\"modifier\",\"bold\"]]]\u{E001}A{inside}C\u{E002}"
        );
        assert_eq!(
            Facts::new().rendering(always_both()).resolve(&text),
            format!("\u{1b}[31;44;1mA\u{1b}[{clearing}mB\u{1b}[{restoring}mC\u{1b}[39;49;22m"),
            "{reset}"
        );
    }
}

#[test]
fn scoped_reset_helpers_build_the_reset_operations() {
    let text = style()
        .red()
        .bg_blue()
        .bold()
        .apply(&format!("A{}C", style().reset().apply("B")));
    assert_eq!(
        Facts::new().rendering(always_both()).resolve(&text),
        "\u{1b}[31;44;1mA\u{1b}[39;49;22mB\u{1b}[31;44;1mC\u{1b}[39;49;22m"
    );
    assert_eq!(
        style().reset_foreground().apply("x"),
        "\u{E000}[\"style\",[[\"resetForeground\"]]]\u{E001}x\u{E002}"
    );
    assert_eq!(
        style().reset_background().apply("x"),
        "\u{E000}[\"style\",[[\"resetBackground\"]]]\u{E001}x\u{E002}"
    );
    // `style.reset.red(text)` clears inherited styling and then applies red.
    assert_eq!(
        Facts::new().rendering(always_both()).resolve(
            &style()
                .bold()
                .apply(&format!("a{}b", style().reset().red().apply("X")))
        ),
        "\u{1b}[1ma\u{1b}[31;22mX\u{1b}[39;1mb\u{1b}[22m"
    );
}

#[test]
fn every_exported_glyph_matches_the_pinned_main_and_compatibility_catalog() {
    let catalog = include_str!("fixtures/glyph-catalog.md");
    let rows: Vec<[&str; 3]> = catalog
        .lines()
        .filter_map(|line| {
            let cells: Vec<&str> = line.split(" | ").collect();
            match cells.as_slice() {
                [name, main, compat] => Some([
                    name.trim_start_matches("| `").trim_end_matches('`'),
                    main.trim_matches('`'),
                    compat.trim_end_matches(" |").trim_matches('`'),
                ]),
                _ => None,
            }
        })
        .collect();
    assert!(rows.len() > 70);
    let names: Vec<&str> = rows.iter().map(|row| row[0]).collect();
    let catalog_names: Vec<&str> = Glyph::ALL.iter().map(|glyph| glyph.name()).collect();
    assert_eq!(names, catalog_names);
    let main: Vec<&str> = rows.iter().map(|row| row[1]).collect();
    let compat: Vec<&str> = rows.iter().map(|row| row[2]).collect();
    let all: Vec<String> = Glyph::ALL.iter().map(ToString::to_string).collect();
    let all = all.join("\n");
    assert_eq!(
        Facts::new().env(&[("NO_COLOR", "1")]).resolve(&all),
        main.join("\n")
    );
    assert_eq!(
        Facts::new()
            .env(&[("FORCE_COLOR", "1"), ("TERM", "linux")])
            .resolve(&all),
        compat.join("\n")
    );
    assert_eq!(Glyph::Success.main_form(), Glyph::Tick.main_form());
    assert_eq!(
        Glyph::Error.compatibility_form(),
        Glyph::Cross.compatibility_form()
    );
    assert_eq!(Glyph::from_name("radioOn"), Some(Glyph::RadioOn));
    assert_eq!(
        Glyph::Success.to_string(),
        "\u{E000}[\"glyph\",\"success\"]\u{E001}\u{E002}"
    );
}

#[test]
fn padding_resolves_compatibility_glyphs_and_measures_unicode_columns_tabs_and_lines() {
    let radio = "\u{E000}[\"glyph\",\"radioOn\"]\u{E001}\u{E002}";
    assert_eq!(
        Facts::new().env(&[("TERM", "linux")]).resolve(&padded(
            &padded(radio, 5, "left"),
            8,
            "center"
        )),
        " (*)    "
    );
    assert_eq!(
        resolve(&padded("a\tb\r\n古\n\n", 11, "right")),
        "  a       b\r\n         古\n           \n"
    );
    assert_eq!(
        Facts::new().measure(
            "é\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}\u{200d}\u{1f466}\u{1f1fa}\u{1f1f8}\n古\ta"
        ),
        "9"
    );
}

#[test]
fn a_no_wrap_frame_resolves_to_its_body_byte_for_byte_and_measures_as_its_body() {
    let radio = "\u{E000}[\"glyph\",\"radioOn\"]\u{E001}\u{E002}";
    let color = Facts::new().rendering(always_color());
    assert_eq!(
        color.resolve(&unbroken(&red_span(&format!("a\tb {radio}")))),
        "\u{1b}[31ma\tb ◉\u{1b}[39m"
    );
    assert_eq!(
        color.resolve(&red_span(&format!("A{}C", unbroken("B")))),
        "\u{1b}[31mABC\u{1b}[39m"
    );
    assert_eq!(
        Facts::new()
            .env(&[("TERM", "linux")])
            .resolve(&unbroken(radio)),
        "(*)"
    );
    assert_eq!(resolve(&padded(&unbroken("ab"), 4, "left")), "ab  ");
    assert_eq!(resolve(&unbroken(&padded("ab", 4, "left"))), "ab  ");
    assert_eq!(Facts::new().measure(&unbroken("a\tb")), "9");
    assert_eq!(resolve(&unbroken(&unbroken("a b"))), "a b");
    let malformed = "\u{E000}[\"nowrap\",1]\u{E001}X\u{E002}";
    assert_eq!(resolve(malformed), malformed);
}

#[test]
fn nowrap_builds_the_no_wrap_frame() {
    assert_eq!(
        resolve(&nowrap("/Users/a/Application Support")),
        "/Users/a/Application Support"
    );
    assert_eq!(
        format!("{}\n", escape(&nowrap("a b"))),
        format!("{}\n", escape(&unbroken("a b")))
    );
    assert_eq!(nowrap("a b"), unbroken("a b"));
}

/// One chain step, as a method of `Style`.
type Step = fn(&Style) -> Style;

/// A captured environment, as the fixtures spell one.
type Env = &'static [(&'static str, &'static str)];

const NAMED_COLORS: [(Step, Step, u8); 16] = [
    (Style::black, Style::bg_black, 30),
    (Style::red, Style::bg_red, 31),
    (Style::green, Style::bg_green, 32),
    (Style::yellow, Style::bg_yellow, 33),
    (Style::blue, Style::bg_blue, 34),
    (Style::magenta, Style::bg_magenta, 35),
    (Style::cyan, Style::bg_cyan, 36),
    (Style::white, Style::bg_white, 37),
    (Style::bright_black, Style::bg_bright_black, 90),
    (Style::bright_red, Style::bg_bright_red, 91),
    (Style::bright_green, Style::bg_bright_green, 92),
    (Style::bright_yellow, Style::bg_bright_yellow, 93),
    (Style::bright_blue, Style::bg_bright_blue, 94),
    (Style::bright_magenta, Style::bg_bright_magenta, 95),
    (Style::bright_cyan, Style::bg_bright_cyan, 96),
    (Style::bright_white, Style::bg_bright_white, 97),
];

#[test]
fn every_named_foreground_and_background_preserves_its_terminal_palette_identity() {
    for (index, (foreground, background, code)) in NAMED_COLORS.iter().enumerate() {
        assert_eq!(
            Facts::new()
                .env(&[("COLORTERM", "truecolor")])
                .rendering(always_color())
                .resolve(&foreground(&style()).apply("X")),
            format!("\u{1b}[{code}mX\u{1b}[39m")
        );
        assert_eq!(
            Facts::new()
                .rendering(always_color())
                .resolve(&background(&style()).apply("X")),
            format!("\u{1b}[{}mX\u{1b}[49m", code + 10)
        );
        let named = Ansi16Color::ALL[index];
        assert_eq!(
            style().foreground(named).apply("X"),
            foreground(&style()).apply("X")
        );
        assert_eq!(
            style().background(named).apply("X"),
            background(&style()).apply("X")
        );
    }
}

#[test]
fn every_modifier_has_an_independent_policy_and_closes_at_the_call_boundary() {
    let modifiers: [(Step, u8, u8); 8] = [
        (Style::bold, 1, 22),
        (Style::faint, 2, 22),
        (Style::italic, 3, 23),
        (Style::underline, 4, 24),
        (Style::inverse, 7, 27),
        (Style::hidden, 8, 28),
        (Style::strikethrough, 9, 29),
        (Style::overline, 53, 55),
    ];
    for (modifier, on, off) in modifiers {
        assert_eq!(
            Facts::new()
                .rendering(
                    RenderingPolicy::new()
                        .color(Switch::Never)
                        .modifiers(Switch::Always)
                )
                .resolve(&modifier(&style()).apply("X")),
            format!("\u{1b}[{on}mX\u{1b}[{off}m")
        );
        assert_eq!(
            Facts::new()
                .tty()
                .rendering(RenderingPolicy::new().modifiers(Switch::Never))
                .resolve(&format!("\u{1b}[{on}mX")),
            "X"
        );
    }
}

#[test]
fn color_helpers_normalize_input_and_degrade_to_the_nearest_indexed_color() -> Result<(), StyleError>
{
    assert_eq!(
        Facts::new()
            .env(&[("COLORTERM", "truecolor")])
            .rendering(always_color())
            .resolve(&style().hex("#F00")?.apply("X")),
        "\u{1b}[38;2;255;0;0mX\u{1b}[39m"
    );
    assert_eq!(
        Facts::new()
            .env(&[("TERM", "xterm-256color")])
            .rendering(always_color())
            .resolve(&style().rgb(255, 0, 0).apply("X")),
        "\u{1b}[91mX\u{1b}[39m"
    );
    assert_eq!(
        Facts::new()
            .rendering(always_color())
            .resolve(&style().ansi256(196).apply("X")),
        "\u{1b}[91mX\u{1b}[39m"
    );
    assert_eq!(
        Facts::new()
            .env(&[("COLORTERM", "24bit")])
            .rendering(always_color())
            .resolve(&style().bg_hex("#123")?.apply("X")),
        "\u{1b}[48;2;17;34;51mX\u{1b}[49m"
    );
    assert_eq!(
        Facts::new()
            .env(&[("TERM_PROGRAM", "Apple_Terminal")])
            .rendering(always_color())
            .resolve(&style().bg_ansi256(196).apply("X")),
        "\u{1b}[48;5;196mX\u{1b}[49m"
    );
    Ok(())
}

#[test]
fn invalid_color_helper_input_is_rejected_before_rendering() {
    // The reference's out-of-range and fractional channels are unrepresentable in `u8`.
    for hex in ["#1234", "F00", "#GGG", "#12345", "#1234567", ""] {
        assert_eq!(style().hex(hex), Err(StyleError::InvalidHex), "{hex}");
        assert_eq!(style().bg_hex(hex), Err(StyleError::InvalidHex), "{hex}");
    }
    assert_eq!(
        StyleError::InvalidHex.to_string(),
        "Hex colors must use #RGB or #RRGGBB."
    );
    assert!(style().hex("#aBc").is_ok());
}

#[test]
fn automatic_color_and_modifier_policy_uses_captured_facts() {
    let cases: [(Env, bool, bool, bool); 8] = [
        (&[], false, false, false),
        (&[], true, true, true),
        (&[("TERM", "dumb")], true, false, false),
        (&[("NO_COLOR", "0")], true, false, true),
        (&[("NO_COLOR", "")], true, true, true),
        (&[("FORCE_COLOR", "0")], false, true, true),
        (
            &[("FORCE_COLOR", "3"), ("NO_COLOR", "1")],
            false,
            true,
            true,
        ),
        (&[("FORCE_COLOR", "")], false, false, false),
    ];
    for (env, tty, color, modifier) in cases {
        let mut facts = Facts::new().env(env);
        facts.tty = tty;
        let starts: Vec<&str> = [color.then_some("31"), modifier.then_some("1")]
            .into_iter()
            .flatten()
            .collect();
        let ends: Vec<&str> = [color.then_some("39"), modifier.then_some("22")]
            .into_iter()
            .flatten()
            .collect();
        let sgr = |codes: &[&str]| {
            if codes.is_empty() {
                String::new()
            } else {
                format!("\u{1b}[{}m", codes.join(";"))
            }
        };
        assert_eq!(
            facts.resolve(&style().red().bold().apply("X")),
            format!("{}X{}", sgr(&starts), sgr(&ends)),
            "{env:?} {tty}"
        );
    }
}

#[test]
fn invocation_policy_overrides_supplied_fields_and_explicit_auto_restores_detection() {
    let text = style().red().bold().apply("X");
    assert_eq!(
        Facts::new()
            .rendering(always_both())
            .run_rendering(RenderingPolicy::new().color(Switch::Auto))
            .resolve(&text),
        "\u{1b}[1mX\u{1b}[22m"
    );
    assert_eq!(
        Facts::new()
            .env(&[("NO_COLOR", "1")])
            .rendering(
                RenderingPolicy::new()
                    .color(Switch::Never)
                    .modifiers(Switch::Always)
            )
            .run_rendering(always_color())
            .resolve(&text),
        "\u{1b}[31;1mX\u{1b}[39;22m"
    );
}

const LINK: &str = "\u{1b}]8;;https://example.test\u{1b}\\label\u{1b}]8;;\u{1b}\\";

#[test]
fn hyperlinks_and_general_terminal_controls_have_independent_policies() {
    let text = format!("{LINK}\u{1b}[2J\u{7}");
    assert_eq!(resolve(&text), "label");
    assert_eq!(
        Facts::new()
            .rendering(RenderingPolicy::new().hyperlinks(Switch::Always))
            .resolve(&text),
        LINK
    );
    assert_eq!(
        Facts::new()
            .rendering(RenderingPolicy::new().terminal_controls(TerminalControls::Preserve))
            .resolve(&text),
        "label\u{1b}[2J\u{7}"
    );
    assert_eq!(
        Facts::new()
            .tty()
            .resolve("\u{1b}]8;;https://example.test\u{1b}\\X"),
        "\u{1b}]8;;https://example.test\u{1b}\\X\u{1b}]8;;\u{1b}\\"
    );
    assert_eq!(Facts::new().tty().measure(LINK), "5");
}

#[test]
fn incomplete_ansi_is_discarded_even_when_controls_are_preserved() {
    let facts = Facts::new()
        .rendering(RenderingPolicy::new().terminal_controls(TerminalControls::Preserve));
    for raw in [
        "\u{1b}[3",
        "\u{1b}",
        "\u{1b}]0;hidden",
        "\u{1b}Ppayload",
        "\u{9d}0;hidden",
    ] {
        assert_eq!(facts.resolve_each(&[raw, "1mX"]), "1mX", "{raw:?}");
    }
}

#[test]
fn a_control_payload_is_opaque_and_completely_filtered() {
    for raw in [
        "\u{1b}]0;a\u{1b}[31mb\u{7}",
        "\u{1b}Ppayload\u{1b}\\",
        "\u{1b}_payload\u{1b}\\",
        "\u{9d}0;hidden\u{9c}",
    ] {
        assert_eq!(resolve(&format!("{raw}X")), "X", "{raw:?}");
        assert_eq!(Facts::new().measure(&format!("{raw}X")), "1", "{raw:?}");
    }
}

#[test]
fn literal_escaping_decodes_once_while_malformed_frames_retain_their_data() {
    let literal = "\u{E000}\u{E001}\u{E002}\u{E003}";
    assert_eq!(resolve(&escape(literal)), literal);
    assert_eq!(
        resolve(&escape(&escape(literal))),
        "\u{E003}E000\u{E003}E001\u{E003}E002\u{E003}E003"
    );
    assert_eq!(resolve(&escape(&red_span("X"))), red_span("X"));
    assert_eq!(style().escape(literal), escape(literal));
    for input in [
        "\u{E000}[\"glyph\",\"tick\"]\u{E001}KEEP\u{E002}",
        "\u{E000}[\"glyph\",\"missing\"]\u{E001}\u{E002}",
        "\u{E000}[\"style\",[[\"token\",\"missing\"]]]\u{E001}X\u{E002}",
        "\u{E000}{bad\u{E000}json\u{E001}X\u{E002}",
        "\u{E000}truncated",
        "\u{E003}E004",
        "\u{E001}\u{E002}",
    ] {
        assert_eq!(resolve(input), input, "{input:?}");
        assert_eq!(Facts::new().measure(input), length(input), "{input:?}");
    }
    assert_eq!(
        Facts::new()
            .rendering(always_color())
            .resolve("\u{E000}[\"style\",[[\"foreground\",\"red\"]]]\u{E001}X"),
        "\u{1b}[31mX\u{1b}[39m"
    );
}

#[test]
fn one_theme_resolves_its_entries() {
    // The second theme's slot fault is core's; one theme's resolution is here.
    assert_eq!(
        Facts::new()
            .theme(ThemeMapping::new().declare("identifier"))
            .resolve(&style().token("identifier").apply("X")),
        "X"
    );
    assert_eq!(
        Facts::new()
            .rendering(always_both())
            .theme(ThemeMapping::new().entry("identifier", style().cyan().bold()))
            .resolve(&style().token("identifier").apply("X")),
        "\u{1b}[36;1mX\u{1b}[39;22m"
    );
}

fn sage() -> ColorFallbacks {
    ColorFallbacks::new()
        .ansi16(Ansi16Color::Green)
        .ansi256(108)
}

#[test]
fn explicit_rgb_fallbacks_select_only_the_destination_depth() -> Result<(), StyleError> {
    for (env, code) in [
        (&[("FORCE_COLOR", "1")][..], "32"),
        (
            &[("FORCE_COLOR", "1"), ("TERM", "xterm-256color")],
            "38;5;108",
        ),
        (
            &[("FORCE_COLOR", "1"), ("COLORTERM", "truecolor")],
            "38;2;122;143;123",
        ),
    ] {
        assert_eq!(
            Facts::new()
                .env(env)
                .resolve(&style().hex_with("#7A8F7B", sage())?.apply("X")),
            format!("\u{1b}[{code}mX\u{1b}[39m")
        );
    }
    Ok(())
}

#[test]
fn fallback_helpers_copy_accepted_values() -> Result<(), StyleError> {
    // Unknown members, wrong names, and wrong types are unrepresentable in the Rust types; what
    // remains is that empty fallbacks equal none and that the wire carries the copied values.
    let rgb_helpers: [fn(ColorFallbacks) -> Result<Style, StyleError>; 4] = [
        |fallbacks| style().hex_with("#7A8F7B", fallbacks),
        |fallbacks| Ok(style().rgb_with(122, 143, 123, fallbacks)),
        |fallbacks| style().bg_hex_with("#7A8F7B", fallbacks),
        |fallbacks| Ok(style().bg_rgb_with(122, 143, 123, fallbacks)),
    ];
    for helper in rgb_helpers {
        assert_eq!(
            helper(ColorFallbacks::new())?.apply("X"),
            helper(ColorFallbacks::default())?.apply("X")
        );
        let chain = helper(sage())?.apply("X");
        assert!(chain.contains("\"ansi256\":108"), "{chain}");
        assert!(chain.contains("\"ansi16\":\"green\""), "{chain}");
        assert!(
            chain.contains("{\"ansi16\":\"green\",\"ansi256\":108}"),
            "{chain}"
        );
    }
    let indexed: [fn(Ansi256Fallbacks) -> Style; 2] = [
        |fallbacks| style().ansi256_with(108, fallbacks),
        |fallbacks| style().bg_ansi256_with(108, fallbacks),
    ];
    for helper in indexed {
        assert_eq!(
            helper(Ansi256Fallbacks::new()).apply("X"),
            helper(Ansi256Fallbacks::default()).apply("X")
        );
        assert!(
            helper(Ansi256Fallbacks::new().ansi16(Ansi16Color::Green))
                .apply("X")
                .contains("[\"ansi256\",108,{\"ansi16\":\"green\"}]")
        );
    }
    assert_eq!(
        ["#7A8F7B"]
            .map(|value| style().hex(value).map(|chain| chain.apply("X")))
            .first()
            .cloned(),
        Some(Ok(style().hex("#7A8F7B")?.apply("X")))
    );
    Ok(())
}

#[test]
fn fallbacks_never_affect_another_depth() {
    let cases = [
        (None, "90", "90"),
        (Some(ColorFallbacks::new()), "90", "90"),
        (Some(ColorFallbacks::new().ansi256(108)), "90", "38;5;108"),
        (
            Some(ColorFallbacks::new().ansi16(Ansi16Color::Green)),
            "32",
            "90",
        ),
    ];
    for (fallbacks, ansi16, ansi256) in cases {
        let chain = match fallbacks {
            None => style().rgb(122, 143, 123),
            Some(fallbacks) => style().rgb_with(122, 143, 123, fallbacks),
        };
        for (env, code) in [
            (&[][..], ansi16),
            (&[("TERM", "xterm-256color")], ansi256),
            (&[("COLORTERM", "truecolor")], "38;2;122;143;123"),
        ] {
            assert_eq!(
                Facts::new()
                    .env(env)
                    .rendering(always_color())
                    .resolve(&chain.apply("X")),
                format!("\u{1b}[{code}mX\u{1b}[39m"),
                "{fallbacks:?} {env:?}"
            );
        }
    }
}

#[test]
fn color_helpers_use_explicit_fallbacks() -> Result<(), StyleError> {
    let green = Ansi256Fallbacks::new().ansi16(Ansi16Color::Green);
    let cases = [
        (
            style().ansi256_with(108, green),
            "32",
            "38;5;108",
            "38;5;108",
            "39",
        ),
        (style().ansi256(108), "90", "38;5;108", "38;5;108", "39"),
        (
            style().bg_ansi256_with(108, green),
            "42",
            "48;5;108",
            "48;5;108",
            "49",
        ),
        (
            style().bg_hex_with("#7A8F7B", sage())?,
            "42",
            "48;5;108",
            "48;2;122;143;123",
            "49",
        ),
        (
            style().bg_rgb_with(122, 143, 123, sage()),
            "42",
            "48;5;108",
            "48;2;122;143;123",
            "49",
        ),
    ];
    for (chain, ansi16, ansi256, truecolor, reset) in cases {
        for (env, code) in [
            (&[][..], ansi16),
            (&[("TERM", "xterm-256color")], ansi256),
            (&[("COLORTERM", "truecolor")], truecolor),
        ] {
            assert_eq!(
                Facts::new()
                    .env(env)
                    .rendering(always_color())
                    .resolve(&chain.apply("X")),
                format!("\u{1b}[{code}mX\u{1b}[{reset}m")
            );
        }
    }
    Ok(())
}

#[test]
fn whole_color_replacement_and_background_composition_preserve_independent_choices()
-> Result<(), StyleError> {
    let sage_chain = style().hex_with("#7A8F7B", sage())?;
    let facts = Facts::new().rendering(always_color());
    assert_eq!(
        facts.resolve(&sage_chain.blue().apply("X")),
        "\u{1b}[34mX\u{1b}[39m"
    );
    assert_eq!(
        facts.resolve(
            &sage_chain
                .bg_hex_with("#C04532", ColorFallbacks::new().ansi16(Ansi16Color::Red))?
                .apply("X")
        ),
        "\u{1b}[32;41mX\u{1b}[39;49m"
    );
    assert_eq!(
        Facts::new()
            .env(&[("NO_COLOR", "1")])
            .tty()
            .resolve(&sage_chain.apply("X")),
        "X"
    );
    assert_eq!(resolve(&sage_chain.apply("X")), "X");
    Ok(())
}

#[test]
fn nested_and_embedded_resets_restore_fallback_colors() -> Result<(), StyleError> {
    for (env, foreground, background) in [
        (&[][..], "32", "42"),
        (&[("TERM", "xterm-256color")], "38;5;108", "48;5;108"),
        (
            &[("COLORTERM", "truecolor")],
            "38;2;122;143;123",
            "48;2;122;143;123",
        ),
    ] {
        let chain = style()
            .hex_with("#7A8F7B", sage())?
            .bg_hex_with("#7A8F7B", sage())?
            .bold();
        let text = chain.apply(&format!("A{}C\u{1b}[34;45mD\u{1b}[0mE", red_span("B")));
        assert_eq!(
            Facts::new()
                .env(env)
                .rendering(always_both())
                .resolve(&text),
            format!(
                "\u{1b}[{foreground};{background};1mA\u{1b}[31mB\u{1b}[{foreground}mC\u{1b}[34;45mD\u{1b}[{foreground};{background}mE\u{1b}[39;49;22m"
            )
        );
    }
    Ok(())
}

/// A style frame whose foreground is a color spelled as JSON.
fn wire_color(color: &str) -> String {
    format!("\u{E000}[\"style\",[[\"foreground\",{color}]]]\u{E001}X\u{E002}")
}

#[test]
fn a_malformed_fallback_wire_color_stays_literal_and_measurable() {
    for color in [
        r#"["rgb",122,143,123,{"ansi16":null}]"#,
        r#"["rgb",122,143,123,{"ansi256":null}]"#,
        r#"["rgb",122,143,123,{"ansi256":256}]"#,
        r#"["rgb",122,143,123,{"ansi16":"bgGreen"}]"#,
        r#"["rgb",122,143,123,{"unknown":1}]"#,
        r#"["rgb",122,143,123,null]"#,
        r#"["rgb",122,143,123,{},{}]"#,
        r#"["ansi256",108,{"ansi256":108}]"#,
        r#"["ansi256",108,{"ansi16":null}]"#,
        r#"["ansi256",108,null]"#,
        r#"["ansi256",108,{},{}]"#,
    ] {
        let text = wire_color(color);
        assert_eq!(resolve(&text), text, "{color}");
        assert_eq!(Facts::new().measure(&text), length(&text), "{color}");
    }
}

#[test]
fn a_valid_wire_color_resolves_through_output_and_width() {
    for (color, code) in [
        (r#"["rgb",122,143,123]"#, "90"),
        (r#"["rgb",122,143,123,{}]"#, "90"),
        (r#"["rgb",122,143,123,{"ansi16":"green"}]"#, "32"),
        (r#"["ansi256",108]"#, "90"),
        (r#"["ansi256",108,{}]"#, "90"),
        (r#"["ansi256",108,{"ansi16":"green"}]"#, "32"),
    ] {
        let text = wire_color(color);
        assert_eq!(
            Facts::new().rendering(always_color()).resolve(&text),
            format!("\u{1b}[{code}mX\u{1b}[39m"),
            "{color}"
        );
        assert_eq!(Facts::new().measure(&text), "1", "{color}");
    }
}

#[test]
fn the_helpers_write_the_reference_wire_form() -> Result<(), StyleError> {
    assert_eq!(
        style().yellow().bold().apply("Ready"),
        "\u{E000}[\"style\",[[\"foreground\",\"yellow\"],[\"modifier\",\"bold\"]]]\u{E001}Ready\u{E002}"
    );
    assert_eq!(
        style().bg_hex("#123")?.apply("x"),
        "\u{E000}[\"style\",[[\"background\",[\"rgb\",17,34,51]]]]\u{E001}x\u{E002}"
    );
    assert_eq!(
        style().warning().red().apply("x"),
        "\u{E000}[\"style\",[[\"token\",\"warning\"],[\"foreground\",\"red\"]]]\u{E001}x\u{E002}"
    );
    assert_eq!(
        pad("cat", 8, Alignment::Center)?,
        "\u{E000}[\"pad\",8,\"center\"]\u{E001}cat\u{E002}"
    );
    // A token name holding a delimiter is written as a \u escape inside the header.
    assert_eq!(
        style().token("a\u{E000}\"").apply(""),
        "\u{E000}[\"style\",[[\"token\",\"a\\ue000\\\"\"]]]\u{E001}\u{E002}"
    );
    assert_eq!(resolve(&pad("cat", 8, Alignment::Left)?), "cat     ");
    assert_eq!(resolve(&pad("cat", 8, Alignment::Right)?), "     cat");
    assert_eq!(resolve(&pad("cat", 8, Alignment::Center)?), "  cat   ");
    assert_eq!(
        resolve(&pad("cat\ndog", 5, Alignment::Left)?),
        "cat  \ndog  "
    );
    assert_eq!(resolve(&pad("cat\n", 5, Alignment::Left)?), "cat  \n");
    assert_eq!(resolve(&pad("", 3, Alignment::Left)?), "   ");
    Ok(())
}

#[test]
fn tokens_compose_in_chain_order() {
    // For `warning` mapped to yellow and bold, `warning.red` is red and bold, and `red.warning`
    // is yellow and bold; a token without a mapping leaves the surrounding style unchanged.
    let facts = Facts::new()
        .rendering(always_both())
        .theme(ThemeMapping::new().entry("warning", style().yellow().bold()));
    assert_eq!(
        facts.resolve(&style().warning().red().apply("x")),
        "\u{1b}[31;1mx\u{1b}[39;22m"
    );
    assert_eq!(
        facts.resolve(&style().red().warning().apply("x")),
        "\u{1b}[33;1mx\u{1b}[39;22m"
    );
    assert_eq!(
        Facts::new()
            .rendering(always_both())
            .resolve(&style().red().apply(&style().success().apply("x"))),
        "\u{1b}[31mx\u{1b}[39m"
    );
}
