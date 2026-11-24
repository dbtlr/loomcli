//! The version plugin, ported from the reference's `version.test.ts` and its `--version` and
//! `-V` options from `control-marks.test.ts`.

#![cfg(feature = "version")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;

use loomcli_core::{
    Application, Command, Context, Done, NoInputs, NoResult, ProcessHandle, RunOptions,
};
use loomcli_plugins::version::{VersionOptions, version};
use loomcli_testing::{MockFields, assert_assembles, mock_process};

type App = Application<NoInputs, NoResult, Done>;

/// The fixture application: a `get` Command and a root action beside the version plugin.
fn app(declared: Option<&str>, settings: loomcli_plugins::version::Version) -> App {
    let application = Application::new("app").plugins((settings,));
    let application = match declared {
        Some(declared) => application.version(declared),
        None => application,
    };
    application
        .command(
            Command::new("get").action(|ctx: Context| async move { ctx.out.print("got").await }),
        )
        .action(|ctx: Context| async move { ctx.out.print("root").await })
}

async fn run(application: &App, argv: &[&str]) -> (u8, String, String) {
    let process = mock_process(MockFields::new().argv(argv.iter().copied()));
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

fn printed(line: &str) -> (u8, String, String) {
    (0, line.to_owned(), String::new())
}

#[tokio::test]
async fn version_prints_the_application_name_and_its_declared_version() {
    let application = app(Some("1.2.0"), version());
    assert_eq!(
        run(&application, &["--version"]).await,
        printed("app v1.2.0\n")
    );
}

#[tokio::test]
async fn short_v_prints_the_same_line_as_its_long_spelling() {
    let application = app(Some("1.2.0"), version());
    assert_eq!(run(&application, &["-V"]).await, printed("app v1.2.0\n"));
}

#[tokio::test]
async fn a_declared_version_that_starts_with_a_lowercase_v_carries_that_v_once() {
    let application = app(Some("v0.2.0"), version());
    assert_eq!(
        run(&application, &["--version"]).await,
        printed("app v0.2.0\n")
    );
}

#[tokio::test]
async fn a_declared_version_that_starts_with_an_uppercase_v_is_printed_after_the_added_v() {
    let application = app(Some("V0.2.0"), version());
    assert_eq!(
        run(&application, &["--version"]).await,
        printed("app vV0.2.0\n")
    );
}

#[tokio::test]
async fn an_application_that_declares_no_version_prints_the_unversioned_sentinel() {
    let application = app(None, version());
    assert_eq!(
        run(&application, &["--version"]).await,
        printed("app v0.0.0\n")
    );
}

#[tokio::test]
async fn the_routed_command_does_not_change_the_line() {
    let application = app(Some("1.2.0"), version());
    assert_eq!(
        run(&application, &["get", "--version"]).await,
        printed("app v1.2.0\n")
    );
}

#[tokio::test]
async fn a_postfix_follows_the_standard_line_after_one_space() {
    let application = app(Some("1.2.0"), version().postfix("(Report schema v1)"));
    assert_eq!(
        run(&application, &["--version"]).await,
        printed("app v1.2.0 (Report schema v1)\n")
    );
}

#[tokio::test]
async fn version_with_empty_settings_prints_the_standard_line() {
    let application = app(Some("1.2.0"), version());
    assert_eq!(
        run(&application, &["--version"]).await,
        printed("app v1.2.0\n")
    );
}

#[tokio::test]
async fn without_the_option_the_action_runs() {
    let application = app(Some("1.2.0"), version());
    assert_eq!(run(&application, &[]).await, printed("root\n"));
    assert_eq!(run(&application, &["get"]).await, printed("got\n"));
}

#[tokio::test]
async fn the_line_without_a_theme_is_bold_and_the_postfix_loses_its_control_character() {
    use loomcli_core::{RenderingPolicy, Switch};
    let application = app(Some("1.2.0"), version().postfix("(a\u{7}b)"));
    let process = mock_process(MockFields::new().argv(["--version"]));
    let policy = RenderingPolicy::new()
        .color(Switch::Always)
        .modifiers(Switch::Always);
    let code = application
        .run(
            RunOptions::new()
                .process(Arc::clone(&process) as Arc<dyn ProcessHandle>)
                .rendering(policy),
        )
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(process.stderr_text(), "");
    assert_eq!(
        process.stdout_text(),
        "\u{1b}[1mapp\u{1b}[22m v1.2.0 (ab)\n"
    );
}

#[test]
fn the_plugin_assembles_and_marks_its_option_as_a_control() {
    let application = app(Some("1.2.0"), version());
    assert_assembles(&application);
    let graph = application.inspect().unwrap();
    let option = graph
        .globals
        .iter()
        .find(|option| option.name() == "version")
        .unwrap();
    assert_eq!(
        (option.long(), option.short()),
        (Some("--version"), Some("-V"))
    );
    let json = serde_json::to_value(&**option).unwrap();
    assert_eq!(json["control"], serde_json::json!(true));
    assert_eq!(json["description"], serde_json::json!("Print the version."));
    let _ = std::marker::PhantomData::<VersionOptions>;
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
fn a_postfix_that_is_not_one_line_of_prose_panics_with_the_diagnostic() {
    for bad in ["", "   ", "two\nlines", "\u{2028}"] {
        let message = panic_text(|| {
            let _ = version().postfix(bad);
        });
        assert!(
            message.contains("@loomcli/plugins/version/postfix"),
            "{message}"
        );
        assert!(
            message.contains("Plugin \"@loomcli/plugins/version\" postfix must be a string that holds a character other than whitespace and no line terminator."),
            "{message}"
        );
        assert!(
            message
                .contains("Supply one line, such as \"(Report schema v1)\", or omit the postfix."),
            "{message}"
        );
    }
}

#[test]
fn a_zero_width_space_postfix_is_prose() {
    let _ = version().postfix("\u{200b}");
}

#[cfg(feature = "version-views")]
mod line_view {
    use loomcli_plugins::version::views::{VersionLine, version_line};

    #[test]
    fn the_view_has_its_declared_identity() {
        assert_eq!(version_line().identity(), "@loomcli/plugins/version/line");
    }

    use std::sync::Arc;

    use loomcli_core::{Application, Context, ProcessHandle, RunOptions, View, override_view};
    use loomcli_plugins::version::version;
    use loomcli_testing::{MockFields, mock_process};

    async fn run_with(view: View<VersionLine>) -> (u8, String, String) {
        let application = Application::new("app")
            .description("Does things.")
            .version("1.2.0")
            .plugins((version().postfix("(schema v1)"),))
            .overrides([override_view(version_line(), view)])
            .action(|ctx: Context| async move { ctx.out.print("root").await });
        let process = mock_process(MockFields::new().argv(["--version"]));
        let code = application
            .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
            .await;
        (code.get(), process.stdout_text(), process.stderr_text())
    }

    #[tokio::test]
    async fn an_override_reads_the_graph_and_the_postfix() {
        let view = View::new(|data: &VersionLine, _context| {
            format!(
                "{} / {} / {} / {}\n",
                data.graph.name,
                data.graph.version,
                data.graph.description.as_deref().unwrap_or("none"),
                data.postfix.as_deref().unwrap_or("none"),
            )
        });
        assert_eq!(
            run_with(view).await,
            (
                0,
                "app / 1.2.0 / Does things. / (schema v1)\n".to_owned(),
                String::new()
            )
        );
    }

    #[tokio::test]
    async fn an_override_can_build_on_the_default_line() {
        let view = View::new(|data: &VersionLine, context| {
            let base = version_line().render(data, context)?;
            Ok::<_, loomcli_core::Error>(format!("{base}built on\n"))
        });
        assert_eq!(
            run_with(view).await,
            (
                0,
                "app v1.2.0 (schema v1)\nbuilt on\n".to_owned(),
                String::new()
            )
        );
    }
}

#[cfg(feature = "theme")]
#[tokio::test]
async fn under_the_loom_theme_the_name_is_highlight_bold_the_version_primary_and_the_postfix_dim() {
    use loomcli_core::{RenderingPolicy, Switch, ThemeMapping};
    use loomcli_plugins::theme::loom_theme;
    let application = Application::new("app")
        .plugins((
            loom_theme(ThemeMapping::new()),
            version().postfix("(Report schema v1)"),
        ))
        .version("1.2.0")
        .action(|ctx: Context| async move { ctx.out.print("root").await });
    let process = mock_process(MockFields::new().argv(["--version"]));
    let policy = RenderingPolicy::new()
        .color(Switch::Always)
        .modifiers(Switch::Always);
    let code = application
        .run(
            RunOptions::new()
                .process(Arc::clone(&process) as Arc<dyn ProcessHandle>)
                .rendering(policy),
        )
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(
        process.stdout_text(),
        "\u{1b}[33;1mapp\u{1b}[39;22m v1.2.0 \u{1b}[90m(Report schema v1)\u{1b}[39m\n"
    );
}
