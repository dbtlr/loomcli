//! `jsonkit stats depth max`, three levels below the root, so routing, help, completion, and every
//! projection jsonkit installs serve a path that deep.

use loomcli_core::{Command, GroupCommand};
use loomcli_plugins::help::extension::{CommandExample, HELP_COMMAND, HelpCommandFacts};
use loomcli_plugins::manifest::extension::{MANIFEST_COMMAND, ManifestCommandFacts};
use loomcli_plugins::mcp::extension::{MCP_COMMAND, McpAnnotations, McpCommandFacts};

use crate::actions::max_depth::{MaxInputs, max_depth};
use crate::failures::{path_failures, read_failures};

/// Print the deepest nesting level under a path.
pub fn max() -> Command<MaxInputs> {
    Command::new("max")
        .description("Print the deepest nesting level under a path.")
        .extend([
            MANIFEST_COMMAND.value(
                ManifestCommandFacts::new().failures([path_failures(), read_failures()].concat()),
            ),
            HELP_COMMAND.value(HelpCommandFacts::new().examples(vec![CommandExample::new(
                "stats depth max user -f doc.json",
            )])),
            MCP_COMMAND.value(McpCommandFacts::annotations(
                McpAnnotations::new().open_world(false).read_only(true),
            )),
        ])
        .inputs::<MaxInputs>()
        .action(max_depth)
}

/// Measure how deeply the document nests.
fn depth() -> GroupCommand {
    Command::new("depth")
        .description("Measure how deeply the document nests.")
        .command(max())
}

/// Report facts about the document's shape.
pub fn stats() -> GroupCommand {
    Command::new("stats")
        .description("Report facts about the document's shape.")
        .extend([
            HELP_COMMAND.value(HelpCommandFacts::new().section(&["Document commands", "Read"]))
        ])
        .command(depth())
}
