//! The doctor plugin attaches its Command to the root of the Application that installs it, ahead
//! of the application's own, and the Command reports its checks through the pack views.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use doctor::{PACKAGE_NAME, doctor};
use loomcli_core::{Application, Command, Context, GroupApplication, NoInputs, NoResult};
use loomcli_core::{ProcessHandle, RunOptions};
use loomcli_testing::{MockFields, MockTerminal, assert_assembles, mock_process};

/// An Application that installs the plugin beside one Command of its own.
fn application() -> GroupApplication<NoInputs, NoResult> {
    Application::new("host")
        .plugins((doctor(),))
        .description("Host the doctor.")
        .command(
            Command::new("hello")
                .description("Say hello.")
                .action(|ctx: Context| async move { ctx.out.print("hello").await }),
        )
}

/// Runs the application with these words on a mock with these fields.
async fn run(fields: MockFields) -> (u8, String, String) {
    let process = mock_process(fields);
    let code = application()
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

/// The report for a host on `platform` whose stdout is `output`, with the box's title between
/// `open` and `close`.
fn report_with(platform: &str, output: &str, open: &str, close: &str) -> String {
    let rule = "─".repeat(80);
    format!(
        "Host checks\n───────────\n● Platform: {platform}\n● Output: {output}\n{rule}\n╭─ {open}Result{close} ───────────╮\n│ All checks passed. │\n╰────────────────────╯\n"
    )
}

/// The report for a host on `platform` whose stdout is `output`, with no styling.
fn report(platform: &str, output: &str) -> String {
    report_with(platform, output, "", "")
}

#[test]
fn the_plugin_is_named_by_its_package_and_its_command_leads_the_roots_commands() {
    assert_eq!(PACKAGE_NAME, "@loom/doctor");
    assert_eq!(doctor().identity(), "@loom/doctor");
    assert_assembles(&application());
    let graph = application().inspect().unwrap();
    let children: Vec<&str> = graph
        .root
        .children
        .iter()
        .map(|child| child.name.as_deref().unwrap_or_default())
        .collect();
    assert_eq!(children, ["doctor", "hello"]);
    let command = graph.command(&["doctor"]).unwrap();
    assert_eq!(
        command.description.as_deref(),
        Some("Check the host this application runs on.")
    );
    assert!(command.options.is_empty() && command.arguments.is_empty());
}

#[tokio::test]
async fn piped_it_reports_the_platform_and_that_stdout_is_not_a_terminal() {
    assert_eq!(
        run(MockFields::new().argv(["doctor"])).await,
        (0, report("linux", "not a terminal"), String::new())
    );
    assert_eq!(
        run(MockFields::new().argv(["doctor"]).platform("darwin")).await,
        (0, report("darwin", "not a terminal"), String::new())
    );
}

/// `NO_COLOR` speaks for color alone, so a terminal keeps the box title's bold.
#[tokio::test]
async fn at_a_terminal_it_reports_that_stdout_is_one() {
    let (status, stdout, stderr) = run(MockFields::new()
        .argv(["doctor"])
        .env("NO_COLOR", "1")
        .terminal(MockTerminal::new(80, 24)))
    .await;
    assert_eq!(
        (status, stdout, stderr),
        (
            0,
            report_with("linux", "a terminal", "\u{1b}[1m", "\u{1b}[22m"),
            String::new()
        )
    );
}
