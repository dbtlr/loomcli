//! `jsonkit fetch`.

use loomcli_core::Command;
use loomcli_plugins::help::extension::{HELP_COMMAND, HelpCommandFacts};
use loomcli_plugins::manifest::extension::{MANIFEST_COMMAND, ManifestCommandFacts};

use crate::actions::get_value::{GetInputs, get_value};
use crate::failures::{path_failures, read_failures};

/// `fetch` is the former spelling of `get`. It still routes and runs, and its help rows and page
/// show the migration message beside it.
pub fn fetch() -> Command<GetInputs> {
    Command::new("fetch")
        .deprecated("Use get instead.")
        .description("Read one value at a path.")
        .extend([
            MANIFEST_COMMAND.value(
                ManifestCommandFacts::new().failures([path_failures(), read_failures()].concat()),
            ),
            HELP_COMMAND.value(HelpCommandFacts::new().section(&["Document commands", "Read"])),
        ])
        .inputs::<GetInputs>()
        .action(get_value)
}
