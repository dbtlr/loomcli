//! The jsonkit Application.

use doctor::doctor;
use explain::explain;
use explain::extension::{EXPLAIN_COMMAND, ExplainFacts};
use loomcli_core::{
    Application, FatalError, RowViews, RowsResult, ThemeMapping, failure, override_view,
};
use loomcli_plugins::color::color;
use loomcli_plugins::completion::completion;
use loomcli_plugins::format::format;
use loomcli_plugins::help::extension::{CommandExample, HELP_COMMAND, HelpCommandFacts};
use loomcli_plugins::help::help;
use loomcli_plugins::manifest::extension::{MANIFEST_COMMAND, ManifestCommandFacts};
use loomcli_plugins::manifest::manifest;
use loomcli_plugins::manpage::manpage;
use loomcli_plugins::mcp::extension::{MCP_COMMAND, McpAnnotations, McpCommandFacts};
use loomcli_plugins::mcp::mcp;
use loomcli_plugins::records::{RecordsConfig, records};
use loomcli_plugins::suggestions::suggestions;
use loomcli_plugins::theme::loom_theme;
use loomcli_plugins::verbose::verbose;
use loomcli_plugins::version::version;

use crate::actions::summarize::summarize;
use crate::commands::{debug, fetch, get, keys, paths, select, stats};
use crate::document_input::DocumentInputs;
use crate::failures::read_failures;
use crate::member::Member;
use crate::translators::invalid_json;
use crate::views::fatal_error;

/// What the root does with no subcommand, which help and the explain plugin each print.
const ROOT_DETAILS: &str =
    "With no subcommand, jsonkit summarizes the document and its top-level keys.";

/// The application: the root summarizes the document, and each Command reads or reshapes it.
pub fn jsonkit() -> Application<DocumentInputs, RowsResult<Member>> {
    Application::new("jsonkit")
        .plugins((
            help().command(true).paging(true),
            suggestions(),
            version(),
            format().short('o'),
            manifest().short('M'),
            loom_theme(ThemeMapping::default()),
            explain(),
            color(),
            verbose(),
            doctor(),
            completion(),
            mcp(),
            manpage(),
        ))
        .description("Read and reshape one JSON document.")
        .version(env!("CARGO_PKG_VERSION"))
        .extend([
            HELP_COMMAND.value(
                HelpCommandFacts::new()
                    .command_sections(&[
                        &["Document commands", "Read"],
                        &["Document commands", "Reshape"],
                        &["Commands"],
                    ])
                    .details(ROOT_DETAILS)
                    .examples(vec![
                        CommandExample::new("-f doc.json"),
                        CommandExample::new("get user.name -f doc.json"),
                    ]),
            ),
            EXPLAIN_COMMAND.value(ExplainFacts {
                details: ROOT_DETAILS.to_owned(),
                examples: Some(vec![
                    "jsonkit -f doc.json".to_owned(),
                    "jsonkit get user.name -f doc.json".to_owned(),
                ]),
            }),
            // The root action summarizes the document, so it reads one.
            MANIFEST_COMMAND.value(ManifestCommandFacts::new().failures(read_failures())),
            MCP_COMMAND.value(McpCommandFacts::annotations(
                McpAnnotations::new().open_world(false).read_only(true),
            )),
        ])
        .translators([invalid_json()])
        .overrides([override_view(failure::<FatalError>(), fatal_error())])
        .inputs::<DocumentInputs>()
        .command(get())
        .command(keys())
        .command(select())
        .command(stats())
        .command(fetch())
        .command(debug())
        .command(paths())
        .rows(RowViews::<Member>::new().view("records", records(RecordsConfig::new("key"))))
        .action(summarize)
}
