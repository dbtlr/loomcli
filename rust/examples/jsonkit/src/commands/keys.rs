//! `jsonkit keys`.

use loomcli_core::Command;
use loomcli_plugins::help::extension::{HELP_COMMAND, HelpCommandFacts};
use loomcli_plugins::manifest::extension::{MANIFEST_COMMAND, ManifestCommandFacts};
use loomcli_plugins::mcp::extension::{MCP_COMMAND, McpAnnotations, McpCommandFacts};

use crate::actions::list_keys::{KeysInputs, list_keys};
use crate::failures::{path_failures, read_failures};

/// List the keys at a path. `ls` is an alias: it routes to this Command, and no projection
/// advertises it.
pub fn keys() -> Command<KeysInputs> {
    Command::new("keys")
        .description("List the keys at a path.")
        .extend([
            MANIFEST_COMMAND.value(
                ManifestCommandFacts::new().failures([path_failures(), read_failures()].concat()),
            ),
            HELP_COMMAND.value(HelpCommandFacts::new().section(&["Document commands", "Read"])),
            MCP_COMMAND.value(McpCommandFacts::annotations(
                McpAnnotations::new().open_world(false).read_only(true),
            )),
        ])
        .alias("ls")
        .inputs::<KeysInputs>()
        .action(list_keys)
}
