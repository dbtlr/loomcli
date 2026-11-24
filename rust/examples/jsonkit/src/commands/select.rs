//! `jsonkit select`.

use loomcli_core::Command;
use loomcli_plugins::help::extension::{HELP_COMMAND, HelpCommandFacts};
use loomcli_plugins::manifest::extension::{MANIFEST_COMMAND, ManifestCommandFacts};
use loomcli_plugins::mcp::extension::{MCP_COMMAND, McpAnnotations, McpCommandFacts};

use crate::actions::select_fields::{SelectInputs, select_fields};
use crate::failures::read_failures;

/// Keep the named fields of the document.
pub fn select() -> Command<SelectInputs> {
    Command::new("select")
        .description("Keep the named fields of the document.")
        .extend([
            MANIFEST_COMMAND.value(ManifestCommandFacts::new().failures(read_failures())),
            HELP_COMMAND.value(HelpCommandFacts::new().section(&["Document commands", "Reshape"])),
            MCP_COMMAND.value(McpCommandFacts::annotations(
                McpAnnotations::new().open_world(false).read_only(true),
            )),
        ])
        .inputs::<SelectInputs>()
        .action(select_fields)
}
