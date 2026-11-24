//! The Loom theme and the bare theme plugin, ported from the reference's `loom-theme.test.ts`.
//! Each case runs an application whose action prints styled tokens through the mock process and
//! asserts the exact bytes.

#![cfg(feature = "theme")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;

use loomcli_core::{
    Application, Background, Context, Plugin, ProcessHandle, RenderingPolicy, RunOptions, Switch,
    ThemeMapping, style,
};
use loomcli_plugins::theme::{loom_theme, theme};
use loomcli_testing::{MockFields, MockTerminal, StreamName, mock_process};

const NAMES: [&str; 6] = ["dim", "highlight", "success", "warning", "error", "info"];
const ALL: [&str; 7] = [
    "primary",
    "dim",
    "highlight",
    "success",
    "warning",
    "error",
    "info",
];

/// One scenario of the reference fixture.
#[derive(Default, Clone)]
struct Scenario {
    background: Option<Background>,
    env: Vec<(&'static str, &'static str)>,
    mapping: Option<ThemeMapping>,
    bare: bool,
    absent: bool,
    outer: bool,
    literal: Option<&'static str>,
    tokens: Option<Vec<&'static str>>,
    rendering: Option<RenderingPolicy>,
    tty: bool,
}

fn always() -> RenderingPolicy {
    RenderingPolicy::new()
        .color(Switch::Always)
        .modifiers(Switch::Always)
}

/// What the fixture application prints for the scenario: the exact stdout.
async fn palette(scenario: Scenario) -> (u8, String, String) {
    let plugins: Vec<Plugin> = if scenario.absent {
        Vec::new()
    } else if scenario.bare {
        vec![theme(ThemeMapping::new())]
    } else {
        vec![loom_theme(scenario.mapping.clone().unwrap_or_default())]
    };
    let tokens = scenario.tokens.clone().unwrap_or_else(|| ALL.to_vec());
    let literal = scenario.literal;
    let outer = scenario.outer;
    let app = Application::new("palette")
        .plugins(plugins)
        .action(move |ctx: Context| {
            let tokens = tokens.clone();
            async move {
                let mut text = tokens
                    .iter()
                    .map(|name| ctx.style.token(name).apply(name))
                    .collect::<Vec<_>>()
                    .join("|");
                if let Some(literal) = literal {
                    text = literal.to_owned();
                }
                if outer {
                    text = style().red().bg_blue().bold().apply(&text);
                }
                ctx.out.print(&text).await
            }
        });
    let mut terminal = MockTerminal::new(80, 24).streams(if scenario.tty {
        vec![StreamName::Stdout]
    } else {
        Vec::new()
    });
    if let Some(background) = scenario.background {
        terminal = terminal.background(background);
    }
    let mut fields = MockFields::new().terminal(terminal);
    for (name, value) in &scenario.env {
        fields = fields.env(name, value);
    }
    let process = mock_process(fields);
    let mut options = RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>);
    if let Some(rendering) = scenario.rendering {
        options = options.rendering(rendering);
    }
    let code = app.run(options).await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

fn colored(codes: &[&str]) -> String {
    let body = NAMES
        .iter()
        .zip(codes)
        .map(|(name, code)| format!("\u{1b}[{code}m{name}\u{1b}[39m"))
        .collect::<Vec<_>>()
        .join("|");
    format!("primary|{body}\n")
}

async fn expect_palette(scenario: Scenario, codes: &[&str]) {
    assert_eq!(palette(scenario).await, (0, colored(codes), String::new()));
}

/// Environment variables and the six expected SGR parameter strings.
type Case = (Vec<(&'static str, &'static str)>, Vec<&'static str>);

fn dark_or_unknown() -> [Case; 3] {
    [
        (vec![], vec!["90", "33", "32", "93", "31", "34"]),
        (
            vec![("TERM", "xterm-256color")],
            vec![
                "38;5;245", "38;5;172", "38;5;108", "38;5;178", "38;5;131", "38;5;67",
            ],
        ),
        (
            vec![("COLORTERM", "truecolor")],
            vec![
                "38;2;139;147;163",
                "38;2;201;123;54",
                "38;2;122;143;123",
                "38;2;226;185;61",
                "38;2;192;69;50",
                "38;2;91;125;163",
            ],
        ),
    ]
}

#[tokio::test]
async fn the_loom_palette_supplies_only_the_specified_foregrounds() {
    for (env, codes) in dark_or_unknown() {
        let scenario = Scenario {
            env,
            rendering: Some(always()),
            ..Scenario::default()
        };
        expect_palette(scenario, &codes).await;
    }
}

#[tokio::test]
async fn the_loom_palette_on_a_stated_dark_background_is_the_same() {
    for (env, codes) in dark_or_unknown() {
        let scenario = Scenario {
            background: Some(Background::Dark),
            env,
            rendering: Some(always()),
            ..Scenario::default()
        };
        expect_palette(scenario, &codes).await;
    }
}

#[tokio::test]
async fn the_loom_palette_supplies_its_light_foregrounds_on_a_light_background() {
    let cases: [Case; 3] = [
        (vec![], vec!["90", "33", "32", "93", "31", "34"]),
        (
            vec![("TERM", "xterm-256color")],
            vec![
                "38;5;243", "38;5;130", "38;5;65", "38;5;94", "38;5;131", "38;5;60",
            ],
        ),
        (
            vec![("COLORTERM", "truecolor")],
            vec![
                "38;2;95;107;122",
                "38;2;156;90;30",
                "38;2;78;107;80",
                "38;2;138;109;14",
                "38;2;192;69;50",
                "38;2;74;107;145",
            ],
        ),
    ];
    for (env, codes) in cases {
        let scenario = Scenario {
            background: Some(Background::Light),
            env,
            rendering: Some(always()),
            ..Scenario::default()
        };
        expect_palette(scenario, &codes).await;
    }
}

#[tokio::test]
async fn a_whole_token_override_is_one_value_on_both_backgrounds() {
    let mut outputs = Vec::new();
    for background in [Background::Dark, Background::Light] {
        let scenario = Scenario {
            background: Some(background),
            mapping: Some(ThemeMapping::new().entry("highlight", style().cyan())),
            rendering: Some(always()),
            tokens: Some(vec!["highlight"]),
            ..Scenario::default()
        };
        outputs.push(palette(scenario).await.1);
    }
    assert_eq!(outputs[0], "\u{1b}[36mhighlight\u{1b}[39m\n");
    assert_eq!(outputs[0], outputs[1]);
}

#[tokio::test]
async fn defaults_change_foregrounds_while_preserving_enclosing_backgrounds_and_modifiers() {
    let scenario = Scenario {
        outer: true,
        rendering: Some(always()),
        tokens: Some(vec!["primary", "dim", "highlight"]),
        ..Scenario::default()
    };
    assert_eq!(
        palette(scenario).await.1,
        "\u{1b}[44;1mprimary\u{1b}[31m|\u{1b}[90mdim\u{1b}[31m|\u{1b}[33mhighlight\u{1b}[39;49;22m\n"
    );
}

#[tokio::test]
async fn a_declared_core_name_keeps_its_default_replacements_remove_it_and_custom_names_inherit() {
    let mapping = ThemeMapping::new()
        .declare("absent")
        .declare("highlight")
        .entry("identifier", style().magenta())
        .entry("success", style().cyan().bold());
    let scenario = Scenario {
        mapping: Some(mapping),
        rendering: Some(always()),
        tokens: Some(vec!["highlight", "success", "identifier", "absent"]),
        ..Scenario::default()
    };
    assert_eq!(
        palette(scenario).await.1,
        "\u{1b}[33mhighlight\u{1b}[39m|\u{1b}[36;1msuccess\u{1b}[39;22m|\u{1b}[35midentifier\u{1b}[39m|absent\n"
    );
    let mapping = ThemeMapping::new()
        .entry("highlight", style())
        .entry("success", style().reset_foreground());
    let scenario = Scenario {
        outer: true,
        mapping: Some(mapping),
        rendering: Some(always()),
        tokens: Some(vec!["highlight", "success"]),
        ..Scenario::default()
    };
    assert_eq!(
        palette(scenario).await.1,
        "\u{1b}[31;44;1mhighlight|\u{1b}[39msuccess\u{1b}[49;22m\n"
    );
}

#[tokio::test]
async fn theme_installation_leaves_plain_destinations_and_bare_mappings_uncolored() {
    let plain = "primary|dim|highlight|success|warning|error|info\n".to_owned();
    let cases = [
        Scenario::default(),
        Scenario {
            env: vec![("NO_COLOR", "1")],
            tty: true,
            ..Scenario::default()
        },
        Scenario {
            env: vec![("FORCE_COLOR", "1")],
            rendering: Some(RenderingPolicy::new().color(Switch::Never)),
            ..Scenario::default()
        },
        Scenario {
            bare: true,
            rendering: Some(RenderingPolicy::new().color(Switch::Always)),
            ..Scenario::default()
        },
        Scenario {
            absent: true,
            rendering: Some(RenderingPolicy::new().color(Switch::Always)),
            ..Scenario::default()
        },
    ];
    for scenario in cases {
        assert_eq!(palette(scenario).await, (0, plain.clone(), String::new()));
    }
}

#[tokio::test]
async fn force_color_retains_precedence_over_no_color_without_a_tty() {
    let scenario = Scenario {
        env: vec![("FORCE_COLOR", "1"), ("NO_COLOR", "1")],
        tokens: Some(vec!["success"]),
        ..Scenario::default()
    };
    assert_eq!(palette(scenario).await.1, "\u{1b}[32msuccess\u{1b}[39m\n");
}

fn panic_text(work: impl FnOnce()) -> String {
    let payload = catch_unwind(AssertUnwindSafe(work)).expect_err("the call should panic");
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|text| (*text).to_owned())
        })
        .unwrap_or_default()
}

#[test]
fn the_named_theme_retains_the_identity_collision_rule() {
    let message = panic_text(|| {
        let _ = Application::new("palette")
            .plugins([loom_theme(ThemeMapping::new()), theme(ThemeMapping::new())]);
    });
    assert!(message.contains("@loomcli/plugins/theme"), "{message}");
    assert!(message.contains("Install each plugin once."), "{message}");
}

#[test]
fn the_named_theme_retains_the_slot_collision_rule() {
    let message = panic_text(|| {
        let _ = Application::new("palette").plugins([
            loom_theme(ThemeMapping::new()),
            Plugin::new("another").theme(ThemeMapping::new()),
        ]);
    });
    assert!(message.contains("@loomcli/plugins/theme"), "{message}");
    assert!(message.contains("theme slot"), "{message}");
}

#[tokio::test]
async fn installing_the_named_theme_leaves_unmarked_text_unchanged() {
    let scenario = Scenario {
        literal: Some("plain"),
        rendering: Some(always()),
        ..Scenario::default()
    };
    assert_eq!(
        palette(scenario).await,
        (0, "plain\n".to_owned(), String::new())
    );
}
