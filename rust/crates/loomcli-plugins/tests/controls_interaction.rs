//! The interaction plugin. The reference has no plugin-level test file for it: the run rules are
//! `packages/core/tests/interaction.test.ts`, which `crates/loomcli-core/tests/interaction.rs`
//! ports with the option declared by hand. These cases install the plugin itself.

#![cfg(feature = "interaction")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;

use loomcli_core::{
    Application, Context, Done, NoInputs, NoResult, Opt, ProcessHandle, RunOptions,
};
use loomcli_plugins::interaction::interaction;
use loomcli_testing::{MockFields, MockTerminal, assert_assembles, mock_process};

type App = Application<NoInputs, NoResult, Done>;

/// An application whose action prints the run's interaction decision.
fn asking(settings: loomcli_plugins::interaction::Interaction) -> App {
    Application::new("mimir")
        .plugins((settings,))
        .action(|ctx: Context| async move {
            ctx.out
                .print(&format!("interactive={}", ctx.interactive))
                .await
        })
}

async fn run(application: &App, fields: MockFields) -> (u8, String, String) {
    let process = mock_process(fields);
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

fn terminal() -> MockTerminal {
    MockTerminal::new(80, 24).keys(Vec::<&str>::new())
}

fn answer(interactive: bool) -> (u8, String, String) {
    (0, format!("interactive={interactive}\n"), String::new())
}

#[tokio::test]
async fn a_terminal_run_is_interactive_until_no_input_turns_it_off() {
    let application = asking(interaction());
    assert_eq!(
        run(&application, MockFields::new().terminal(terminal())).await,
        answer(true)
    );
    assert_eq!(
        run(
            &application,
            MockFields::new().argv(["--no-input"]).terminal(terminal())
        )
        .await,
        answer(false)
    );
}

#[tokio::test]
async fn a_bound_variable_states_the_option() {
    let application = asking(interaction().env(["MIMIR_INPUT"]));
    assert_eq!(
        run(
            &application,
            MockFields::new()
                .env("MIMIR_INPUT", "false")
                .terminal(terminal())
        )
        .await,
        answer(false)
    );
    assert_eq!(
        run(
            &application,
            MockFields::new()
                .env("MIMIR_INPUT", "true")
                .terminal(terminal())
        )
        .await,
        answer(true)
    );
    // Without the binding the variable means nothing: core derives no name.
    let unbound = asking(interaction());
    assert_eq!(
        run(
            &unbound,
            MockFields::new()
                .env("MIMIR_INPUT", "false")
                .terminal(terminal())
        )
        .await,
        answer(true)
    );
}

#[test]
fn the_option_is_a_negative_control_with_the_interaction_mark_and_its_description() {
    let application = asking(interaction().env(["MIMIR_INPUT", "MIMIR_ASK"]));
    assert_assembles(&application);
    let graph = application.inspect().unwrap();
    let option = serde_json::to_value(&*graph.globals[0]).unwrap();
    assert_eq!(option["name"], serde_json::json!("input"));
    assert_eq!(option["type"], serde_json::json!("boolean"));
    assert_eq!(option["control"], serde_json::json!(true));
    assert_eq!(option["interaction"], serde_json::json!(true));
    assert_eq!(option["long"], serde_json::Value::Null);
    assert_eq!(option["negative"], serde_json::json!("--no-input"));
    assert_eq!(
        option["env"],
        serde_json::json!(["MIMIR_INPUT", "MIMIR_ASK"])
    );
    assert_eq!(
        option["description"],
        serde_json::json!("Ask no questions, and take every answer from options.")
    );
}

#[test]
fn installing_the_plugin_beside_another_interaction_option_is_a_declaration_error() {
    let payload = catch_unwind(AssertUnwindSafe(|| {
        let _ = Application::new("mimir")
            .plugins((interaction(),))
            .global_option("ask", Opt::boolean().interaction());
    }))
    .expect_err("two interaction marks should panic");
    let message = payload
        .downcast_ref::<String>()
        .cloned()
        .unwrap_or_default();
    assert!(
        message.contains("@loomcli/core/interaction-mark"),
        "{message}"
    );
}
