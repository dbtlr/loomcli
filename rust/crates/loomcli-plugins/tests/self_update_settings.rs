//! Ports the self-update rows of `pack-diagnostics.test.ts` and the projection cases of
//! `update-notices.test.ts`: a `notice_env` that is not a variable name panics at its call with the
//! `@loomcli/plugins/self-update/settings` Developer Diagnostic; the Command's declaration as the
//! graph publishes it; `--refresh-notice` listed by no help page and offered by no completion.

#![cfg(feature = "self-update")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::panic::{AssertUnwindSafe, catch_unwind};

use loomcli_core::{Application, Command, Context, Group, NoInputs, NoResult};
use loomcli_plugins::self_update::self_update;

type App = Application<NoInputs, NoResult, Group>;

/// The message a call panics with, or none when it returns.
fn diagnostic(call: impl FnOnce()) -> Option<String> {
    catch_unwind(AssertUnwindSafe(call)).err().map(|payload| {
        payload
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| {
                payload
                    .downcast_ref::<&str>()
                    .map(|text| (*text).to_owned())
            })
            .unwrap_or_default()
    })
}

#[test]
fn a_notice_env_that_is_not_a_variable_name_panics_with_the_settings_diagnostic() {
    for name in ["1X", "NOTES-NO-NOTICE", "", "É"] {
        let message = diagnostic(|| drop(self_update().notice_env(name))).expect(name);
        assert!(
            message.contains("@loomcli/plugins/self-update/settings"),
            "{message}"
        );
        assert!(
            message.contains(
                "Plugin \"@loomcli/plugins/self-update\" setting \"notices.env\" is not an environment variable name."
            ),
            "{message}"
        );
        assert!(
            message.contains(
                "Name it with letters, digits, and underscores, not starting with a digit."
            ),
            "{message}"
        );
    }
}

#[test]
fn a_variable_name_and_notices_off_are_accepted() {
    for name in ["NOTES_NO_UPDATE_NOTICE", "_x", "a1"] {
        assert_eq!(
            diagnostic(|| drop(self_update().notice_env(name).plugin())),
            None,
            "{name}"
        );
    }
    assert_eq!(
        diagnostic(|| drop(self_update().notices(false).plugin())),
        None
    );
}

fn application() -> App {
    Application::new("notes")
        .description("Keep notes.")
        .plugins((self_update().plugin(),))
        .command(
            Command::new("add")
                .description("Add a note.")
                .action(|ctx: Context| async move { ctx.out.success("Added note 12.").await }),
        )
}

#[test]
fn the_command_declares_its_argument_and_options_with_the_pinned_descriptions() {
    let graph = application().inspect().unwrap();
    let node = graph.command(&["self-update"]).unwrap();
    assert_eq!(
        node.description.as_deref(),
        Some("Replace this application with another release.")
    );
    assert!(!node.hidden);
    assert!(node.result.is_none());
    let arguments: Vec<(String, Option<String>)> = node
        .arguments
        .iter()
        .map(|argument| (argument.name.clone(), argument.description.clone()))
        .collect();
    assert_eq!(
        arguments,
        [(
            "version".to_owned(),
            Some("A release version to install, newer or older, such as 1.4.0.".to_owned())
        )]
    );
    let options: Vec<serde_json::Value> = node
        .options
        .iter()
        .map(|option| serde_json::to_value(&**option).unwrap())
        .map(|option| serde_json::json!([option["name"], option["description"], option["hidden"]]))
        .collect();
    assert_eq!(
        options,
        [
            serde_json::json!([
                "channel",
                "The release channel to follow, such as stable or next.",
                false
            ]),
            serde_json::json!([
                "check",
                "Report what an update would do and replace nothing.",
                false
            ]),
            serde_json::json!(["refresh-notice", "Refresh the update notices' cache.", true]),
        ]
    );
    // The version and channel publish a plain string schema, as the reference's validators do.
    let version = serde_json::to_value(&*node.arguments[0]).unwrap();
    assert_eq!(version["schema"]["type"], "string", "{version}");
}

#[cfg(feature = "help")]
#[tokio::test]
async fn refresh_notice_is_listed_by_no_help_page() {
    use std::sync::Arc;

    use loomcli_core::{ProcessHandle, RunOptions};
    use loomcli_plugins::help::help;
    use loomcli_testing::{MockFields, mock_process};

    let application: App = Application::new("notes")
        .description("Keep notes.")
        .plugins((help(), self_update().plugin()))
        .command(
            Command::new("add")
                .description("Add a note.")
                .action(|ctx: Context| async move { ctx.out.success("Added note 12.").await }),
        );
    let process = mock_process(MockFields::new().argv(["self-update", "--help"]));
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    assert_eq!(code.get(), 0);
    let page = process.stdout_text();
    assert!(page.contains("--check"), "{page}");
    assert!(!page.contains("refresh"), "{page}");
}

#[cfg(feature = "completion")]
#[test]
fn refresh_notice_is_offered_by_no_completion() {
    use loomcli_core::locate;
    use loomcli_plugins::completion::test_support::answer;

    let graph = Application::new("notes")
        .plugins((self_update().plugin(),))
        .inspect()
        .unwrap();
    let offered = answer(&graph, &locate(&graph, &["self-update", "--"]));
    assert!(offered.contains("--check"), "{offered}");
    assert!(!offered.contains("refresh"), "{offered}");
}
