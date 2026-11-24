//! The help restyle, ported from the help cases of the reference's `help-style.test.ts`: exact
//! styled bytes under the Loom palette and a custom theme, and the policy matrix. The version-line
//! cases belong to the version package.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use help_support::{custom_theme, loom_theme, noop, plain, run_with, styled};
use loomcli_core::{
    AnyPlugin, Application, Arg, Command, Done, NoInputs, NoResult, Opt, Polarity, RenderingPolicy,
    Switch,
};
use loomcli_plugins::help::extension::{
    CommandExample, HELP_COMMAND, HELP_INPUT, HelpCommandFacts, HelpInputFacts,
};
use loomcli_plugins::help::help;
use loomcli_testing::{MockFields, MockTerminal, StreamName};

type App = Application<NoInputs, NoResult, Done>;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Theme {
    Loom,
    Custom,
    Absent,
}

#[derive(Clone, Copy)]
enum Fixture {
    Root,
    Leaf,
    Minimal,
    Kinds,
}

fn plugins(theme: Theme) -> Vec<AnyPlugin> {
    let mut installed: Vec<AnyPlugin> =
        vec![help().into(), help_support::version_stand_in().into()];
    match theme {
        Theme::Loom => installed.push(loom_theme().into()),
        Theme::Custom => installed.push(custom_theme().into()),
        Theme::Absent => {}
    }
    installed
}

fn application(fixture: Fixture, theme: Theme) -> App {
    let installed = plugins(theme);
    match fixture {
        Fixture::Root => Application::new("app")
            .plugins(installed)
            .description("Read values.")
            .extend([
                HELP_COMMAND.value(HelpCommandFacts::new().details("One line.").examples(vec![
                    CommandExample::new("get --raw «warning»").note("Literal flags."),
                ])),
            ])
            .command(
                Command::new("get")
                    .deprecated("Use read.")
                    .description("Read one.")
                    .action(noop),
            )
            .action(noop),
        Fixture::Leaf => Application::new("wide")
            .plugins(installed)
            .description("Literal \u{e001}red\u{e002}.")
            .extend([HELP_COMMAND.value(
                HelpCommandFacts::new()
                    .details("Details \u{e001}.")
                    .examples(vec![
                        CommandExample::new("--field \u{e002}").note("Note \u{e003}."),
                    ]),
            )])
            .argument(
                "界é",
                Arg::string().description("Wide.").required().variadic(),
            )
            .option(
                "field",
                Opt::string()
                    .deprecated("Use new.")
                    .description("Fields.")
                    .extend([HELP_INPUT.value(HelpInputFacts::placeholder("界界"))])
                    .multiple()
                    .required()
                    .short('F'),
            )
            .option(
                "mode",
                Opt::string()
                    .default("\u{e001}red\u{e002}x\u{e003}")
                    .description("Literal default."),
            )
            .option("quiet", Opt::boolean().polarity(Polarity::Negative))
            .option("cache", Opt::boolean().polarity(Polarity::Both))
            .option(
                "x",
                Opt::string()
                    .description("Short.")
                    .extend([HELP_INPUT.value(HelpInputFacts::placeholder("é"))])
                    .short('x')
                    .short_only(),
            )
            .action(noop),
        Fixture::Minimal => Application::new("app").plugins(installed).action(noop),
        Fixture::Kinds => Application::new("kinds")
            .plugins(installed)
            .option("backup", Opt::string().implied("simple"))
            .option("verbose", Opt::count().short('v'))
            .action(noop),
    }
}

/// One run of a fixture, as the reference's `help-style` fixture runs it.
struct Input {
    fixture: Fixture,
    theme: Theme,
    argv: Vec<&'static str>,
    env: Vec<(&'static str, &'static str)>,
    rendering: Option<RenderingPolicy>,
    tty: Option<u16>,
}

impl Input {
    fn new(fixture: Fixture, argv: &[&'static str]) -> Self {
        Self {
            fixture,
            theme: Theme::Loom,
            argv: argv.to_vec(),
            env: Vec::new(),
            rendering: None,
            tty: None,
        }
    }

    async fn run(self) -> (u8, String, String) {
        let mut fields = MockFields::new().argv(self.argv.iter().copied());
        for (name, value) in &self.env {
            fields = fields.env(name, value);
        }
        if let Some(columns) = self.tty {
            fields = fields.terminal(MockTerminal::new(columns, 24).streams([StreamName::Stdout]));
        }
        let (outcome, _) = run_with(
            &application(self.fixture, self.theme),
            fields,
            self.rendering,
        )
        .await;
        (outcome.status, outcome.stdout, outcome.stderr)
    }
}

fn joined(lines: &[&str]) -> String {
    let mut text = lines.join("\n");
    text.push('\n');
    text
}

#[tokio::test]
async fn help_styles_each_semantic_fragment_including_deprecation_punctuation_and_examples() {
    let input = Input {
        rendering: Some(styled()),
        ..Input::new(Fixture::Root, &["--help"])
    };
    assert_eq!(
        input.run().await,
        (
            0,
            joined(&[
                "\u{1b}[33;1mapp\u{1b}[39;22m \u{1b}[90m·\u{1b}[39m Read values.",
                "",
                "  One line.",
                "",
                "\u{1b}[90mUSAGE\u{1b}[39m",
                "  \u{1b}[33mapp\u{1b}[39m \u{1b}[90;3m[options]\u{1b}[39;23m",
                "  \u{1b}[33mapp\u{1b}[39m \u{1b}[90;3m<command>\u{1b}[39;23m \u{1b}[90;3m[options]\u{1b}[39;23m",
                "",
                "\u{1b}[90mCOMMANDS\u{1b}[39m",
                "  \u{1b}[33mget\u{1b}[39m  Read one.  \u{1b}[90m(\u{1b}[93mdeprecated: Use read.\u{1b}[90m)\u{1b}[39m",
                "",
                "\u{1b}[90mGLOBAL OPTIONS\u{1b}[39m",
                "  \u{1b}[33m-h\u{1b}[90m,\u{1b}[39m \u{1b}[33m--help\u{1b}[39m     Show this help.",
                "  \u{1b}[33m-V\u{1b}[90m,\u{1b}[39m \u{1b}[33m--version\u{1b}[39m  Print the version.",
                "",
                "\u{1b}[90mEXAMPLES\u{1b}[39m",
                "  \u{1b}[90m$\u{1b}[39m \u{1b}[33mapp\u{1b}[39m get --raw «warning»",
                "    \u{1b}[90mLiteral flags.\u{1b}[39m",
                "",
                "\u{1b}[90mRun\u{1b}[39m \u{1b}[33mapp\u{1b}[39m \u{1b}[90;3m<command>\u{1b}[39;23m \u{1b}[33m--help\u{1b}[39m \u{1b}[90mfor command details.\u{1b}[39m",
            ]),
            String::new()
        )
    );
}

#[tokio::test]
async fn a_compact_page_styles_the_child_hint_and_the_pointer_to_the_extended_page() {
    let input = Input {
        rendering: Some(styled()),
        ..Input::new(Fixture::Root, &["-h"])
    };
    assert_eq!(
        input.run().await,
        (
            0,
            joined(&[
                "\u{1b}[33;1mapp\u{1b}[39;22m \u{1b}[90m·\u{1b}[39m Read values.",
                "",
                "\u{1b}[90mUSAGE\u{1b}[39m",
                "  \u{1b}[33mapp\u{1b}[39m \u{1b}[90;3m[options]\u{1b}[39;23m",
                "  \u{1b}[33mapp\u{1b}[39m \u{1b}[90;3m<command>\u{1b}[39;23m \u{1b}[90;3m[options]\u{1b}[39;23m",
                "",
                "\u{1b}[90mCOMMANDS\u{1b}[39m",
                "  \u{1b}[33mget\u{1b}[39m  Read one.  \u{1b}[90m(\u{1b}[93mdeprecated: Use read.\u{1b}[90m)\u{1b}[39m",
                "",
                "\u{1b}[90mGLOBAL OPTIONS\u{1b}[39m",
                "  \u{1b}[33m-h\u{1b}[90m,\u{1b}[39m \u{1b}[33m--help\u{1b}[39m     Show this help.",
                "  \u{1b}[33m-V\u{1b}[90m,\u{1b}[39m \u{1b}[33m--version\u{1b}[39m  Print the version.",
                "",
                "\u{1b}[90mRun\u{1b}[39m \u{1b}[33mapp\u{1b}[39m \u{1b}[90;3m<command>\u{1b}[39;23m \u{1b}[33m-h\u{1b}[39m \u{1b}[90mfor command details.\u{1b}[39m",
                "\u{1b}[90mRun\u{1b}[39m \u{1b}[33mapp\u{1b}[39m \u{1b}[33m--help\u{1b}[39m \u{1b}[90mfor details and examples.\u{1b}[39m",
            ]),
            String::new()
        )
    );
}

#[tokio::test]
async fn help_measures_wide_and_combining_placeholders_and_escapes_literal_data_before_styling() {
    let input = Input {
        rendering: Some(plain()),
        ..Input::new(Fixture::Leaf, &["--help"])
    };
    assert_eq!(
        input.run().await,
        (
            0,
            joined(&[
                "wide · Literal \u{e001}red\u{e002}.",
                "",
                "  Details \u{e001}.",
                "",
                "USAGE",
                "  wide <界é...> --field <界界>... [options]",
                "",
                "ARGUMENTS",
                "  界é  Wide.",
                "",
                "OPTIONS",
                "  -F, --field <界界>  Fields.  (required, repeatable, deprecated: Use new.)",
                "      --mode <mode>   Literal default.  (default: \u{e001}red\u{e002}x\u{e003})",
                "      --no-quiet      (default: true)",
                "      --[no-]cache",
                "  -x <é>              Short.",
                "  -h, --help          Show this help.",
                "  -V, --version       Print the version.",
                "",
                "EXAMPLES",
                "  $ wide --field \u{e002}",
                "    Note \u{e003}.",
            ]),
            String::new()
        )
    );
}

#[tokio::test]
async fn themed_option_cells_separate_spellings_placeholders_facts_and_warning_text() {
    let input = Input {
        rendering: Some(styled()),
        ..Input::new(Fixture::Leaf, &["--help"])
    };
    let (status, stdout, stderr) = input.run().await;
    assert_eq!((status, stderr.as_str()), (0, ""));
    for expected in [
        "\u{1b}[33;1mwide\u{1b}[39;22m \u{1b}[90m·\u{1b}[39m Literal \u{e001}red\u{e002}.\n",
        "  \u{1b}[33mwide\u{1b}[39m \u{1b}[90;3m<界é...>\u{1b}[39;23m \u{1b}[33m--field\u{1b}[39m \u{1b}[90;3m<界界>...\u{1b}[39;23m \u{1b}[90;3m[options]\u{1b}[39;23m\n",
        "  \u{1b}[33m-F\u{1b}[90m,\u{1b}[39m \u{1b}[33m--field\u{1b}[39m \u{1b}[90;3m<界界>\u{1b}[39;23m  Fields.  \u{1b}[90m(required,\u{1b}[39m \u{1b}[90mrepeatable,\u{1b}[39m \u{1b}[93mdeprecated: Use new.\u{1b}[90m)\u{1b}[39m\n",
        "      \u{1b}[33m--mode\u{1b}[39m \u{1b}[90;3m<mode>\u{1b}[39;23m   Literal default.  \u{1b}[90m(default: \u{e001}red\u{e002}x\u{e003})\u{1b}[39m\n",
        "      \u{1b}[33m--[no-]cache\u{1b}[39m\n",
        "  \u{1b}[33m-x\u{1b}[39m \u{1b}[90;3m<é>\u{1b}[39;23m              Short.\n",
        "  \u{1b}[90;3m界é\u{1b}[39;23m  Wide.\n",
    ] {
        assert!(stdout.contains(expected), "{expected:?} in {stdout:?}");
    }
}

#[tokio::test]
async fn an_implied_values_brackets_and_a_counts_ellipsis_share_the_placeholder_style() {
    let input = Input {
        rendering: Some(styled()),
        ..Input::new(Fixture::Kinds, &["--help"])
    };
    let (status, stdout, _) = input.run().await;
    assert_eq!(status, 0);
    assert!(stdout.contains(
        "      \u{1b}[33m--backup\u{1b}[90;3m[=<backup>]\u{1b}[39;23m  \u{1b}[90m(implied: simple)\u{1b}[39m\n"
    ));
    assert!(stdout.contains(
        "  \u{1b}[33m-v\u{1b}[90m,\u{1b}[39m \u{1b}[33m--verbose\u{1b}[90;3m...\u{1b}[39;23m\n"
    ));
}

#[tokio::test]
async fn a_deprecated_routed_command_highlights_only_the_deprecation_line_as_warning() {
    let input = Input {
        rendering: Some(styled()),
        ..Input::new(Fixture::Root, &["get", "--help"])
    };
    assert_eq!(
        input.run().await.1,
        joined(&[
            "\u{1b}[33;1mapp get\u{1b}[39;22m \u{1b}[90m·\u{1b}[39m Read one.",
            "  \u{1b}[93mDeprecated: Use read.\u{1b}[39m",
            "",
            "\u{1b}[90mUSAGE\u{1b}[39m",
            "  \u{1b}[33mapp get\u{1b}[39m \u{1b}[90;3m[options]\u{1b}[39;23m",
            "",
            "\u{1b}[90mGLOBAL OPTIONS\u{1b}[39m",
            "  \u{1b}[33m-h\u{1b}[90m,\u{1b}[39m \u{1b}[33m--help\u{1b}[39m     Show this help.",
            "  \u{1b}[33m-V\u{1b}[90m,\u{1b}[39m \u{1b}[33m--version\u{1b}[39m  Print the version.",
        ])
    );
}

/// Literal terminal codes from the palette contract, independent of Loom's style helpers.
fn terminal(code: &str, text: &str, reset: &str) -> String {
    if code.is_empty() {
        text.to_owned()
    } else {
        format!("\u{1b}[{code}m{text}\u{1b}[{reset}m")
    }
}

/// One row of the policy matrix: the palette's codes and whether modifiers print.
struct Expected {
    dim: &'static str,
    highlight: &'static str,
    primary: &'static str,
    modifiers: bool,
}

#[tokio::test]
async fn help_resolves_the_theme_and_modifier_policy_without_changing_layout() {
    let never = RenderingPolicy::new()
        .color(Switch::Never)
        .modifiers(Switch::Never);
    let color_only = RenderingPolicy::new()
        .color(Switch::Always)
        .modifiers(Switch::Never);
    let cases: Vec<(Input, Expected)> = vec![
        (
            Input {
                rendering: Some(styled()),
                ..Input::new(Fixture::Minimal, &["--help"])
            },
            Expected {
                dim: "90",
                highlight: "33",
                primary: "",
                modifiers: true,
            },
        ),
        (
            Input {
                env: vec![("TERM", "xterm-256color")],
                rendering: Some(styled()),
                ..Input::new(Fixture::Minimal, &["--help"])
            },
            Expected {
                dim: "38;5;245",
                highlight: "38;5;172",
                primary: "",
                modifiers: true,
            },
        ),
        (
            Input {
                env: vec![("COLORTERM", "truecolor")],
                rendering: Some(styled()),
                ..Input::new(Fixture::Minimal, &["--help"])
            },
            Expected {
                dim: "38;2;139;147;163",
                highlight: "38;2;201;123;54",
                primary: "",
                modifiers: true,
            },
        ),
        (
            Input {
                theme: Theme::Custom,
                rendering: Some(styled()),
                ..Input::new(Fixture::Minimal, &["--help"])
            },
            Expected {
                dim: "35",
                highlight: "36",
                primary: "32",
                modifiers: true,
            },
        ),
        (
            Input {
                theme: Theme::Absent,
                rendering: Some(styled()),
                ..Input::new(Fixture::Minimal, &["--help"])
            },
            Expected {
                dim: "",
                highlight: "",
                primary: "",
                modifiers: true,
            },
        ),
        (
            Input {
                env: vec![("NO_COLOR", "1")],
                tty: Some(80),
                ..Input::new(Fixture::Minimal, &["--help"])
            },
            Expected {
                dim: "",
                highlight: "",
                primary: "",
                modifiers: true,
            },
        ),
        (
            Input::new(Fixture::Minimal, &["--help"]),
            Expected {
                dim: "",
                highlight: "",
                primary: "",
                modifiers: false,
            },
        ),
        (
            Input {
                rendering: Some(never),
                tty: Some(80),
                ..Input::new(Fixture::Minimal, &["--help"])
            },
            Expected {
                dim: "",
                highlight: "",
                primary: "",
                modifiers: false,
            },
        ),
        (
            Input {
                rendering: Some(color_only),
                ..Input::new(Fixture::Minimal, &["--help"])
            },
            Expected {
                dim: "90",
                highlight: "33",
                primary: "",
                modifiers: false,
            },
        ),
    ];
    for (input, expected) in cases {
        let Expected {
            dim,
            highlight,
            primary,
            modifiers,
        } = expected;
        let join = |parts: [&str; 2]| {
            parts
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(";")
        };
        let bold = join([highlight, if modifiers { "1" } else { "" }]);
        let italic = join([dim, if modifiers { "3" } else { "" }]);
        let bold_reset = join([
            if highlight.is_empty() { "" } else { "39" },
            if modifiers { "22" } else { "" },
        ]);
        let italic_reset = join([
            if dim.is_empty() { "" } else { "39" },
            if modifiers { "23" } else { "" },
        ]);
        let short = |letter: &str| {
            if highlight.is_empty() {
                format!("{letter},")
            } else {
                format!("\u{1b}[{highlight}m{letter}\u{1b}[{dim}m,\u{1b}[39m")
            }
        };
        let page = joined(&[
            &terminal(&bold, "app", &bold_reset),
            "",
            &terminal(dim, "USAGE", "39"),
            &format!(
                "  {} {}",
                terminal(highlight, "app", "39"),
                terminal(&italic, "[options]", &italic_reset)
            ),
            "",
            &terminal(dim, "OPTIONS", "39"),
            &format!(
                "  {} {}     {}",
                short("-h"),
                terminal(highlight, "--help", "39"),
                terminal(primary, "Show this help.", "39")
            ),
            &format!(
                "  {} {}  {}",
                short("-V"),
                terminal(highlight, "--version", "39"),
                terminal(primary, "Print the version.", "39")
            ),
        ]);
        assert_eq!(input.run().await, (0, page, String::new()));
    }
}

#[tokio::test]
async fn a_detailed_custom_theme_distinguishes_every_page_token() {
    let input = Input {
        theme: Theme::Custom,
        rendering: Some(styled()),
        ..Input::new(Fixture::Root, &["--help"])
    };
    assert_eq!(
        input.run().await,
        (
            0,
            joined(&[
                "\u{1b}[36;1mapp\u{1b}[39;22m \u{1b}[35m·\u{1b}[39m \u{1b}[32mRead values.\u{1b}[39m",
                "",
                "  \u{1b}[32mOne line.\u{1b}[39m",
                "",
                "\u{1b}[35mUSAGE\u{1b}[39m",
                "  \u{1b}[36mapp\u{1b}[39m \u{1b}[35;3m[options]\u{1b}[39;23m",
                "  \u{1b}[36mapp\u{1b}[39m \u{1b}[35;3m<command>\u{1b}[39;23m \u{1b}[35;3m[options]\u{1b}[39;23m",
                "",
                "\u{1b}[35mCOMMANDS\u{1b}[39m",
                "  \u{1b}[36mget\u{1b}[39m  \u{1b}[32mRead one.\u{1b}[39m  \u{1b}[35m(\u{1b}[31mdeprecated: Use read.\u{1b}[35m)\u{1b}[39m",
                "",
                "\u{1b}[35mGLOBAL OPTIONS\u{1b}[39m",
                "  \u{1b}[36m-h\u{1b}[35m,\u{1b}[39m \u{1b}[36m--help\u{1b}[39m     \u{1b}[32mShow this help.\u{1b}[39m",
                "  \u{1b}[36m-V\u{1b}[35m,\u{1b}[39m \u{1b}[36m--version\u{1b}[39m  \u{1b}[32mPrint the version.\u{1b}[39m",
                "",
                "\u{1b}[35mEXAMPLES\u{1b}[39m",
                "  \u{1b}[35m$\u{1b}[39m \u{1b}[36mapp\u{1b}[39m \u{1b}[32mget --raw «warning»\u{1b}[39m",
                "    \u{1b}[35mLiteral flags.\u{1b}[39m",
                "",
                "\u{1b}[35mRun\u{1b}[39m \u{1b}[36mapp\u{1b}[39m \u{1b}[35;3m<command>\u{1b}[39;23m \u{1b}[36m--help\u{1b}[39m \u{1b}[35mfor command details.\u{1b}[39m",
            ]),
            String::new()
        )
    );
}

/// The lines of a page wider than 20 columns.
fn overflowing(stdout: &str) -> Vec<&str> {
    stdout
        .split('\n')
        .filter(|line| line.chars().count() > 20)
        .collect()
}

#[tokio::test]
async fn a_help_page_wraps_on_a_terminal_narrower_than_its_rows_where_only_literals_overflow() {
    let piped = Input {
        rendering: Some(plain()),
        ..Input::new(Fixture::Root, &["--help"])
    }
    .run()
    .await;
    let narrow = Input {
        rendering: Some(plain()),
        tty: Some(20),
        ..Input::new(Fixture::Root, &["--help"])
    }
    .run()
    .await;
    assert_eq!(piped.0, 0);
    assert!(overflowing(&piped.1).contains(&"  get  Read one.  (deprecated: Use read.)"));
    assert_eq!(narrow.0, 0);
    assert_eq!(
        overflowing(&narrow.1),
        ["  app <command> [options]", "  $ app get --raw «warning»"]
    );
}
