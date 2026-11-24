//! `jsonkit paths`.

use loomcli_core::{Command, RowViews, RowsResult};
use loomcli_plugins::manifest::extension::{MANIFEST_COMMAND, ManifestCommandFacts};
use loomcli_plugins::records::{RecordsConfig, records};
use loomcli_plugins::table::{Column, table};

use crate::actions::list_paths::list_paths;
use crate::document_input::DocumentInputs;
use crate::entries::Entry;
use crate::failures::read_failures;

/// `paths` is a hidden Command, so no listing shows it and no candidate names it. It declares a
/// sequence of rows, so stdout carries the walk and nothing else the action writes.
pub fn paths() -> Command<DocumentInputs, RowsResult<Entry>> {
    Command::new("paths")
        .description("List every path in the document.")
        .extend([MANIFEST_COMMAND.value(ManifestCommandFacts::new().failures(read_failures()))])
        .hidden()
        .inputs::<DocumentInputs>()
        .rows(
            RowViews::new()
                .view("list", records(RecordsConfig::new("path")))
                .view(
                    "table",
                    table(vec![Column::from("path"), Column::from("kind")]),
                ),
        )
        .action(list_paths)
}
