//! A plugin's sentence escapes every value it repeats (`docs/core/failures.md#failure-message-voice`,
//! rule 5), ported from the reference's `escaped-plugin-sentences.test.ts`. The configuration
//! plugin's lines name an option by its declared spelling, which the declared-name rule lets hold a
//! control character, and the MCP server's error text repeats the tool name and the argument key a
//! client sent. A control or bidirectional character in one prints as its `\uXXXX` escape, so it
//! cannot reorder or break the line.
//!
//! The reference's configuration case also runs a `strict` setting, whose failure names the option
//! the same way. The Rust plugin has no `strict` setting, so that half is not ported.

#![cfg(all(feature = "config", feature = "mcp"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod config_support;
mod mcp_support;

use std::sync::Arc;

use config_support::{Loose, Settings, Workspace, loud};
use loomcli_core::{
    Application, Arg, Command, Context, Done, Group, NoInputs, NoResult, Opt, ProcessHandle,
    RunOptions,
};
use loomcli_plugins::config::configuration;
use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
use loomcli_plugins::mcp::extension::{MCP_COMMAND, McpCommandFacts};
use loomcli_plugins::mcp::mcp;
use loomcli_testing::{MockFields, mock_process};
use mcp_support::{call, serve};
use serde_json::json;

type App = Application<NoInputs, NoResult, Done>;

/// Runs an application whose option `fla<U+202E>g` reads `flag` from `.app.json`, with `-L`.
async fn config_run(workspace: &Workspace) -> (u8, String) {
    let config = configuration::<Loose>(Settings::default().apply::<Loose>(None));
    let app: App = Application::new("app")
        .plugins([loomcli_core::AnyPlugin::from(loud()), config.plugin.into()])
        .option(
            "fla\u{202e}g",
            Opt::boolean().extend([CONFIG_INPUT.value(ConfigInputFacts::path("flag"))]),
        )
        .action(|_: Context| async move { Ok(()) });
    let process = mock_process(
        MockFields::new()
            .argv(["-L"])
            .cwd(&workspace.project)
            .home(workspace.home.clone()),
    );
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stderr_text())
}

#[tokio::test]
async fn the_configuration_plugins_lines_escape_the_spelling_of_the_option_a_file_value_fills() {
    let workspace = Workspace::new();
    workspace.write(".app.json", &json!({ "flag": "yes" }).to_string());
    assert_eq!(
        config_run(&workspace).await,
        (
            0,
            "› Ignored option \"--fla\\u202eg\" from flag in .app.json: Use true or false.\n"
                .to_owned()
        )
    );
}

/// The `echo` tool the MCP server serves.
fn echo_app() -> Application<NoInputs, NoResult, Group> {
    let echo = Command::new("echo")
        .extend([MCP_COMMAND.value(McpCommandFacts::new())])
        .argument("word", Arg::string().required())
        .action(|ctx: Context| async move {
            let word: Option<String> = ctx.argument("word")?;
            ctx.out.print(&word.unwrap_or_default()).await
        });
    Application::new("app").plugins([mcp()]).command(echo)
}

#[tokio::test]
async fn the_mcp_servers_error_text_escapes_the_tool_name_and_the_argument_key_a_client_sent() {
    let app = echo_app();
    let mut session = serve(&app);
    session.send(&call(1, "ec\u{202e}ho", None));
    session.send(&call(
        2,
        "echo",
        Some(json!({ "ex\u{202e}tra": 1, "word": "hi" })),
    ));
    let (_, first) = session.until_answer(1).await;
    let (_, second) = session.until_answer(2).await;
    session.close().await;
    assert_eq!(
        first["error"]["message"],
        "Unknown tool \"ec\\u202eho\". Call tools/list for the tool names."
    );
    assert_eq!(
        second["result"]["content"][0]["text"],
        "Tool \"echo\" takes no argument \"ex\\u202etra\". Use a property its input schema lists."
    );
    assert_eq!(second["result"]["isError"], true);
}
