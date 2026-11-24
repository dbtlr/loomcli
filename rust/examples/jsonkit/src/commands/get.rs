//! `jsonkit get`.

use explain::extension::{EXPLAIN_COMMAND, ExplainFacts};
use loomcli_core::Command;
use loomcli_plugins::help::extension::{CommandExample, HELP_COMMAND, HelpCommandFacts};
use loomcli_plugins::manifest::extension::{MANIFEST_COMMAND, ManifestCommandFacts};
use loomcli_plugins::mcp::extension::{MCP_COMMAND, McpAnnotations, McpCommandFacts};

use crate::actions::get_value::{GetInputs, get_value};
use crate::failures::{path_failures, read_failures};

/// Read one value at a path.
pub fn get() -> Command<GetInputs> {
    Command::new("get")
        .description("Read one value at a path.")
        .extend([
            // An instruction an agent needs before it quotes a path, beyond what the help page says.
            MANIFEST_COMMAND.value(
                ManifestCommandFacts::new()
                    .details("Quote a path that holds a shell metacharacter.")
                    .failures([path_failures(), read_failures()].concat()),
            ),
            HELP_COMMAND.value(
                HelpCommandFacts::new()
                    .details(include_str!("get.md"))
                    .examples(vec![
                        CommandExample::new("get name -f doc.json"),
                        CommandExample::new("get nested.deep.value -f doc.json"),
                    ])
                    .section(&["Document commands", "Read"]),
            ),
            EXPLAIN_COMMAND.value(ExplainFacts {
                details: "A path is a dot-separated walk from the root of the document.".to_owned(),
                examples: Some(vec![
                    "jsonkit get name -f doc.json".to_owned(),
                    "jsonkit get nested.deep.value -f doc.json".to_owned(),
                ]),
            }),
            MCP_COMMAND.value(McpCommandFacts::annotations(
                McpAnnotations::new().open_world(false).read_only(true),
            )),
        ])
        .inputs::<GetInputs>()
        .action(get_value)
}
