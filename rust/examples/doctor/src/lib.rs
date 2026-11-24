//! A private example plugin: it attaches one ordinary Command, `doctor`, to the root of the
//! Application that installs it, and the Command reports a few checks about the host through the
//! pack views.
//!
//! The crate compiles outside any Application, so the Command reads no global option.

use loomcli_core::{Command, Context, Outcome, Plugin};
use loomcli_plugins::boxed::{BoxConfig, boxed};
use loomcli_plugins::heading::{HeadingConfig, heading};
use loomcli_plugins::list::{ListConfig, list};
use loomcli_plugins::rule::rule;

/// The plugin's package name, which is its identity.
pub const PACKAGE_NAME: &str = "@loom/doctor";

/// Reports the checks: a heading, a list of two checks, a rule, and the verdict in a box.
async fn check_host(context: Context) -> Outcome {
    let Context { host, out, .. } = context;
    let output = if host.terminal.stdout().is_tty {
        "a terminal"
    } else {
        "not a terminal"
    };
    out.render("Host checks", &heading(HeadingConfig::new()))
        .await?;
    let checks = vec![
        format!("Platform: {}", host.platform),
        format!("Output: {output}"),
    ];
    out.render(&checks, &list(ListConfig::<String>::new()))
        .await?;
    out.render("", &rule()).await?;
    out.render(
        "All checks passed.",
        &boxed(BoxConfig::new().title("Result")),
    )
    .await
}

/// The `doctor` Command: it reads no document and declares no option of its own.
fn doctor_command() -> Command {
    Command::new("doctor")
        .description("Check the host this application runs on.")
        .action(check_host)
}

/// A plugin that attaches one ordinary Command to the root of the Application that installs it.
pub fn doctor() -> Plugin {
    Plugin::new(PACKAGE_NAME).commands([doctor_command()])
}
