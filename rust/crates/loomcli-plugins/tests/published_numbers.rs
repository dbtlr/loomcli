//! A whole-number bound from 2^64 up to 1e21 publishes as digits, as `JSON.stringify` writes it,
//! through every channel that publishes a validator's schema: the manifest and an MCP
//! `tools/list`. The validators crate holds such a bound as a JSON float, and each channel writes
//! floats through the formatter's `Number.prototype.toString` writer.

#![cfg(all(feature = "manifest", feature = "mcp"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod mcp_support;

use loomcli_core::{Command, Context, GroupApplication, NoInputs, NoResult, Opt};
use loomcli_plugins::manifest::manifest;
use loomcli_plugins::mcp::extension::{MCP_COMMAND, McpCommandFacts};
use loomcli_plugins::mcp::mcp;
use loomcli_validators::number;
use mcp_support::{request, serve};
use serde_json::json;

const PUBLISHED: &str = r#""type":"number","maximum":100000000000000000000"#;

fn application() -> GroupApplication<NoInputs, NoResult> {
    let get = Command::new("get")
        .description("Read one value.")
        .extend([MCP_COMMAND.value(McpCommandFacts::new())])
        .option(
            "limit",
            Opt::string()
                .description("The most values to read.")
                .validate(number().max(1e20)),
        )
        .action(|context: Context| async move { context.out.print("read").await });
    loomcli_core::Application::new("app")
        .description("Read values.")
        .version("1.0.0")
        .plugins((manifest(), mcp()))
        .command(get)
}

#[tokio::test]
async fn the_manifest_publishes_a_bound_of_1e20_as_digits() {
    let process = loomcli_testing::mock_process(
        loomcli_testing::MockFields::new().argv(["get", "--manifest"]),
    );
    let code = application()
        .run(loomcli_core::RunOptions::new().process(
            std::sync::Arc::clone(&process) as std::sync::Arc<dyn loomcli_core::ProcessHandle>
        ))
        .await;
    assert_eq!((code.get(), process.stderr_text()), (0, String::new()));
    let stdout = process.stdout_text();
    let compact: String = stdout.split_whitespace().collect();
    assert!(compact.contains(PUBLISHED), "{stdout}");
}

#[tokio::test]
async fn an_mcp_tool_listing_publishes_a_bound_of_1e20_as_digits() {
    let mut session = serve(&application());
    session.send(&request(1, "tools/list", json!({})));
    let line = session.next_line().await;
    let ending = session.close().await;
    assert_eq!((ending.status, ending.stderr.as_str()), (0, ""));
    assert!(line.contains(PUBLISHED), "{line}");
}
