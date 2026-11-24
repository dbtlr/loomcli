//! `jsonkit debug`.

use loomcli_core::Command;
use loomcli_plugins::manifest::extension::{MANIFEST_COMMAND, ManifestCommandFacts};

use crate::actions::dump_document::dump_document;
use crate::document_input::DocumentInputs;
use crate::failures::read_failures;

/// `debug` is a hidden Command, so no listing shows it. It routes, runs, and prints its own page
/// when an invocation routes to it directly.
pub fn debug() -> Command<DocumentInputs> {
    Command::new("debug")
        .description("Dump the parsed document.")
        .extend([MANIFEST_COMMAND.value(ManifestCommandFacts::new().failures(read_failures()))])
        .hidden()
        .inputs::<DocumentInputs>()
        .action(dump_document)
}
