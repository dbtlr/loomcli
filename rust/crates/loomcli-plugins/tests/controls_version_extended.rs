//! Extended `--version` through application runs, ported from `version-extended.test.ts`.

#![cfg(feature = "version")]

use loomcli_core::{
    AnyPlugin, Application, Build, Command, Context, Done, Group, Installation, IntoList, NoInputs,
    NoResult, Release, ReleaseFacts, RenderingPolicy, ResultViews, RunOptions, State, Switch,
    ValueResult, View, override_view,
};
use loomcli_plugins::version::version;
use loomcli_plugins::version::views::{VersionLine, version_line};
use loomcli_testing::{MockFields, MockTerminal, mock_process};

const TARGET: &str = "x86_64-unknown-linux-musl";
const DISTRIBUTED_BLOCK: &str = concat!(
    "notes v1.1.0-next.3\n",
    "channel              next\n",
    "build                distributed\n",
    "asset                notes-linux-x64\n",
    "installation method  script\n",
    "runtime              x86_64-unknown-linux-musl\n",
    "platform             linux-x64\n",
);

type App<S = Done> = Application<NoInputs, NoResult, S>;

fn list(name: &str, view: View<String>) -> Command<NoInputs, ValueResult<String>> {
    Command::new("list")
        .result(ResultViews::new().view(name, view))
        .action(|ctx: Context<NoInputs, ValueResult<String>>| async move {
            ctx.out.results("dispatched".to_owned()).await
        })
}

fn base(plugins: impl IntoList<AnyPlugin>) -> App<Group> {
    Application::new("notes")
        .version("1.1.0-next.3")
        .plugins(plugins)
        .command(list(
            "text",
            View::new(|data: &String, _| format!("{data}\n")),
        ))
}

fn app(plugins: impl IntoList<AnyPlugin>) -> App {
    with_action(base(plugins))
}

fn with_action(app: App<Group>) -> App {
    app.action(|ctx: Context| async move { ctx.out.print("dispatched").await })
}

fn group(plugins: impl IntoList<AnyPlugin>) -> App<Group> {
    base(plugins).command(
        Command::new("cache").command(Command::new("clear").action(|_: Context| async { Ok(()) })),
    )
}

async fn run<S: State>(app: &App<S>, args: &[&str], fields: MockFields) -> (u8, String, String) {
    let process = mock_process(fields.argv(args.iter().copied()).env("NO_COLOR", "1"));
    let code = app
        .run(
            RunOptions::new()
                .process(process.clone())
                .rendering(RenderingPolicy::new().modifiers(Switch::Never)),
        )
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

fn printed(stdout: &str) -> (u8, String, String) {
    (0, stdout.to_owned(), String::new())
}

fn distributed() -> MockFields {
    MockFields::new()
        .release(
            ReleaseFacts::new(Build::Distributed)
                .release(Release::new("1.1.0-next.3", "acme/notes").asset("notes-linux-x64"))
                .installation(Installation::new(
                    "script",
                    "/loom-test/bin/notes",
                    "sha256:0",
                )),
        )
        .runtime(Some(TARGET.to_owned()))
}

#[tokio::test]
async fn a_distributed_release_prints_six_facts_under_both_version_spellings() {
    let app = app((version().extended(true),));
    for flag in ["--version", "-V"] {
        assert_eq!(
            run(&app, &[flag], distributed()).await,
            printed(DISTRIBUTED_BLOCK)
        );
    }
}

#[tokio::test]
async fn a_source_run_on_a_terminal_ends_each_absent_fact_at_its_label() {
    let app = app((version().extended(true),));
    let fields = MockFields::new()
        .runtime(Some(TARGET.to_owned()))
        .terminal(MockTerminal::new(80, 24));
    assert_eq!(
        run(&app, &["--version"], fields).await,
        printed(concat!(
            "notes v1.1.0-next.3\n",
            "channel\n",
            "build                source\n",
            "asset\n",
            "installation method\n",
            "runtime              x86_64-unknown-linux-musl\n",
            "platform             linux-x64\n",
        )),
    );
}

#[tokio::test]
async fn a_source_run_off_a_terminal_keeps_padding_on_each_absent_fact() {
    let app = app((version().extended(true),));
    assert_eq!(
        run(
            &app,
            &["--version"],
            MockFields::new().runtime(Some(TARGET.to_owned()))
        )
        .await,
        printed(concat!(
            "notes v1.1.0-next.3\n",
            "channel              \n",
            "build                source\n",
            "asset                \n",
            "installation method  \n",
            "runtime              x86_64-unknown-linux-musl\n",
            "platform             linux-x64\n",
        )),
    );
}

#[tokio::test]
async fn a_release_without_an_asset_and_a_handle_without_a_runtime_print_blank_values() {
    let app = app((version().extended(true),));
    let fields = MockFields::new()
        .arch("arm64")
        .platform("darwin")
        .release(ReleaseFacts::new(Build::Distributed).release(Release::new("1.0.0", "acme/notes")))
        .runtime(None);
    assert_eq!(
        run(&app, &["--version"], fields).await,
        printed(concat!(
            "notes v1.1.0-next.3\n",
            "channel              stable\n",
            "build                distributed\n",
            "asset                \n",
            "installation method  \n",
            "runtime              \n",
            "platform             darwin-arm64\n",
        )),
    );
}

#[tokio::test]
async fn a_routed_command_prints_the_same_bytes_as_the_root() {
    let app = app((version().extended(true),));
    assert_eq!(
        run(&app, &["list", "--version"], distributed()).await,
        printed(DISTRIBUTED_BLOCK)
    );
}

#[tokio::test]
async fn the_postfix_stays_on_the_first_line() {
    let app = app((version().extended(true).postfix("(Report schema v1)"),));
    let expected = DISTRIBUTED_BLOCK.replacen(
        "notes v1.1.0-next.3\n",
        "notes v1.1.0-next.3 (Report schema v1)\n",
        1,
    );
    assert_eq!(
        run(&app, &["--version"], distributed()).await,
        printed(&expected)
    );
}

#[tokio::test]
async fn an_override_of_version_line_renders_the_first_line_above_the_facts() {
    let app = with_action(base((version().extended(true),)).overrides([override_view(
        version_line(),
        View::new(|data: &VersionLine, _| format!("{} release\n", data.graph.name)),
    )]));
    let expected = DISTRIBUTED_BLOCK.replacen("notes v1.1.0-next.3\n", "notes release\n", 1);
    assert_eq!(
        run(&app, &["--version"], distributed()).await,
        printed(&expected)
    );
}

#[cfg(feature = "theme")]
#[tokio::test]
async fn the_block_styles_padded_labels_dim_and_values_primary() {
    use loomcli_core::{ThemeMapping, style};
    use loomcli_plugins::theme::theme;

    let app = app((
        version().extended(true),
        theme(
            ThemeMapping::new()
                .entry("dim", style().red())
                .entry("primary", style().green()),
        ),
    ));
    assert_eq!(
        run(&app, &["--version"], distributed().env("FORCE_COLOR", "1")).await,
        printed(concat!(
            "notes \u{1b}[32mv1.1.0-next.3\u{1b}[39m\n",
            "\u{1b}[31mchannel            \u{1b}[39m  \u{1b}[32mnext\u{1b}[39m\n",
            "\u{1b}[31mbuild              \u{1b}[39m  \u{1b}[32mdistributed\u{1b}[39m\n",
            "\u{1b}[31masset              \u{1b}[39m  \u{1b}[32mnotes-linux-x64\u{1b}[39m\n",
            "\u{1b}[31minstallation method\u{1b}[39m  \u{1b}[32mscript\u{1b}[39m\n",
            "\u{1b}[31mruntime            \u{1b}[39m  \u{1b}[32mx86_64-unknown-linux-musl\u{1b}[39m\n",
            "\u{1b}[31mplatform           \u{1b}[39m  \u{1b}[32mlinux-x64\u{1b}[39m\n",
        )),
    );
}

const DISTRIBUTED_DOCUMENT: &str = concat!(
    "{\n",
    "  \"name\": \"notes\",\n",
    "  \"version\": \"1.1.0-next.3\",\n",
    "  \"channel\": \"next\",\n",
    "  \"build\": \"distributed\",\n",
    "  \"asset\": \"notes-linux-x64\",\n",
    "  \"installationMethod\": \"script\",\n",
    "  \"runtime\": \"x86_64-unknown-linux-musl\",\n",
    "  \"platform\": \"linux-x64\"\n",
    "}\n",
);

#[tokio::test]
async fn an_authors_own_json_view_selects_a_document_without_the_formatter() {
    let app = Application::new("notes")
        .version("1.1.0-next.3")
        .plugins((version().extended(true),))
        .command(list(
            "json",
            View::new(|data: &String, _| format!("{data}\n")).media_type("application/json"),
        ))
        .command(Command::new("add").action(|_: Context| async { Ok(()) }));
    assert_eq!(
        run(&app, &["list", "--version"], distributed()).await,
        printed(DISTRIBUTED_DOCUMENT)
    );
}

#[tokio::test]
async fn without_the_formatter_the_takeover_holds_the_unknown_option_at_a_group() {
    let app = group((version().extended(true),));
    assert_eq!(
        run(&app, &["--version", "--format", "json"], distributed()).await,
        printed(DISTRIBUTED_BLOCK),
    );
    assert_eq!(
        run(&app, &["--format", "json"], distributed()).await,
        (2, String::new(), "notes: Unknown option \"--format\". Supply a declared option; prefix a hyphenated path with \"./\".\n".to_owned()),
    );
}

#[cfg(feature = "format")]
mod formatted {
    use super::*;
    use loomcli_plugins::format::format;
    use loomcli_plugins::version::Version;
    use loomcli_plugins::version::views::{VersionFacts, version_facts};

    const DISTRIBUTED_LINE: &str = concat!(
        "{\"name\":\"notes\",\"version\":\"1.1.0-next.3\",\"channel\":\"next\",",
        "\"build\":\"distributed\",\"asset\":\"notes-linux-x64\",\"installationMethod\":\"script\",",
        "\"runtime\":\"x86_64-unknown-linux-musl\",\"platform\":\"linux-x64\"}\n",
    );

    fn extended() -> (loomcli_plugins::format::Format, Version) {
        (format(), version().extended(true))
    }

    #[tokio::test]
    async fn without_extended_only_the_line_prints_even_in_json_format() {
        for settings in [version(), version().extended(false)] {
            let app = app((format(), settings));
            for args in [
                &["--version"][..],
                &["list", "--format", "json", "--version"],
            ] {
                assert_eq!(
                    run(&app, args, distributed()).await,
                    printed("notes v1.1.0-next.3\n")
                );
            }
        }
    }

    #[tokio::test]
    async fn json_is_one_indented_object_with_eight_keys_in_order() {
        let app = app(extended());
        assert_eq!(
            run(
                &app,
                &["list", "--format", "json", "--version"],
                distributed()
            )
            .await,
            printed(DISTRIBUTED_DOCUMENT),
        );
    }

    #[tokio::test]
    async fn jsonl_is_one_line_with_null_for_each_absent_fact() {
        let app = app(extended());
        assert_eq!(
            run(
                &app,
                &["list", "--format", "jsonl", "-V"],
                MockFields::new().runtime(None)
            )
            .await,
            printed(concat!(
                "{\"name\":\"notes\",\"version\":\"1.1.0-next.3\",\"channel\":null,",
                "\"build\":\"source\",\"asset\":null,\"installationMethod\":null,",
                "\"runtime\":null,\"platform\":\"linux-x64\"}\n",
            )),
        );
    }

    #[tokio::test]
    async fn the_json_version_is_the_declared_string_without_a_postfix() {
        let app = with_action(
            base((format(), version().postfix("(schema)").extended(true))).version("v0.2.0"),
        );
        assert_eq!(
            run(
                &app,
                &["list", "--format", "json", "--version"],
                distributed()
            )
            .await,
            printed(&DISTRIBUTED_DOCUMENT.replacen("1.1.0-next.3", "v0.2.0", 1)),
        );
    }

    #[tokio::test]
    async fn a_formatter_after_version_cannot_select_the_media_type_for_it() {
        let app = app((version().extended(true), format()));
        assert_eq!(
            run(
                &app,
                &["list", "--format", "json", "--version"],
                distributed()
            )
            .await,
            printed(DISTRIBUTED_BLOCK),
        );
    }

    #[tokio::test]
    async fn an_action_with_no_result_prints_the_block_under_format_json() {
        let app = app(extended());
        assert_eq!(
            run(&app, &["--format", "json", "--version"], distributed()).await,
            printed(DISTRIBUTED_BLOCK),
        );
    }

    #[tokio::test]
    async fn a_group_root_prints_json_and_jsonl_in_either_option_order() {
        let app = group(extended());
        for (args, stdout) in [
            (["--version", "--format", "json"], DISTRIBUTED_DOCUMENT),
            (["--format", "json", "--version"], DISTRIBUTED_DOCUMENT),
            (["--format", "jsonl", "-V"], DISTRIBUTED_LINE),
            (["--format", "ndjson", "--version"], DISTRIBUTED_LINE),
        ] {
            assert_eq!(run(&app, &args, distributed()).await, printed(stdout));
        }
    }

    #[tokio::test]
    async fn a_nested_group_prints_the_same_json_as_the_root() {
        let app = group(extended());
        assert_eq!(
            run(
                &app,
                &["cache", "--version", "--format", "jsonl"],
                distributed()
            )
            .await,
            printed(DISTRIBUTED_LINE),
        );
    }

    #[tokio::test]
    async fn a_group_applications_command_with_a_result_prints_the_same_json() {
        let app = group(extended());
        for (args, stdout) in [
            (
                ["list", "--format", "json", "--version"],
                DISTRIBUTED_DOCUMENT,
            ),
            (["list", "--format", "jsonl", "-V"], DISTRIBUTED_LINE),
            (
                ["--format", "json", "list", "--version"],
                DISTRIBUTED_DOCUMENT,
            ),
        ] {
            assert_eq!(run(&app, &args, distributed()).await, printed(stdout));
        }
    }

    #[tokio::test]
    async fn an_unknown_format_prints_the_block_under_version_and_fails_without_it() {
        let app = group(extended());
        assert_eq!(
            run(&app, &["--version", "--format", "yaml"], distributed()).await,
            printed(DISTRIBUTED_BLOCK),
        );
        assert_eq!(
            run(&app, &["--format", "yaml"], distributed()).await,
            (
                2,
                String::new(),
                "notes: A command is required. Use one of: list, cache.\n".to_owned()
            ),
        );
    }

    #[tokio::test]
    async fn an_override_of_version_facts_restyles_only_the_text_block() {
        let app = with_action(base(extended()).overrides([override_view(
            version_facts(),
            View::new(|facts: &VersionFacts, _| {
                format!(
                    "{} on {}\n",
                    facts.platform,
                    facts.runtime.as_deref().unwrap_or("")
                )
            }),
        )]));
        assert_eq!(
            run(&app, &["--version"], distributed()).await,
            printed("notes v1.1.0-next.3\nlinux-x64 on x86_64-unknown-linux-musl\n"),
        );
        assert_eq!(
            run(
                &app,
                &["list", "--format", "json", "--version"],
                distributed()
            )
            .await,
            printed(DISTRIBUTED_DOCUMENT),
        );
    }
}
