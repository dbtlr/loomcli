//! The textstat Application.

use explain::explain;
use explain::extension::{EXPLAIN_COMMAND, ExplainFacts};
use loomcli_core::{Application, Content, FatalError, Inputs, RowViews, RowsResult, ThemeMapping};
use loomcli_core::{failure, override_view};
use loomcli_plugins::completion::completion;
use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
use loomcli_plugins::config::toml::TOML;
use loomcli_plugins::config::{ConfigurationSettings, Scope, configuration};
use loomcli_plugins::format::format;
use loomcli_plugins::help::extension::{
    CommandExample, HELP_COMMAND, HELP_INPUT, HelpCommandFacts, HelpInputFacts,
};
use loomcli_plugins::help::help;
use loomcli_plugins::logging::logging;
use loomcli_plugins::manifest::manifest;
use loomcli_plugins::suggestions::suggestions;
use loomcli_plugins::table::{Column, TableConfig, table};
use loomcli_plugins::theme::loom_theme;
use loomcli_plugins::version::version;
use loomcli_validators::{integer, one_of};
use serde::Deserialize;
use serde_json::json;

use crate::count_files::count_files;
use crate::row::Row;
use crate::views::{fatal_error, row_cell};

/// What the root says about itself, which help and the explain plugin each print.
const DETAILS: &str =
    "Textstat counts files and piped text in order. Use - to place stdin among the files.";

/// The configuration file's settings. Both keys are optional, because the file is written after
/// the application already runs, and a value the type rejects is dropped, not a failure.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TextstatFile {
    #[allow(dead_code)]
    min_bytes: Option<NumberOrText>,
    #[allow(dead_code)]
    total: Option<bool>,
}

/// A number or a string, the two shapes `minBytes` accepts.
#[derive(Deserialize)]
#[serde(untagged)]
enum NumberOrText {
    Number(#[allow(dead_code)] f64),
    Text(#[allow(dead_code)] String),
}

/// The inputs of the root: the sources and the counting options.
#[derive(Inputs)]
pub struct TextstatInputs {
    /// The files and piped text to count. Use - to place stdin.
    #[argument(stdin, required)]
    pub files: Vec<Content>,
    /// What each row counts.
    #[option(
        short = 'm',
        default = "bytes",
        validate = one_of(["bytes", "words", "lines"]),
        extensions = [HELP_INPUT.value(HelpInputFacts::new().section(&["Counting", "Measure"]))]
    )]
    pub metric: String,
    /// Drop a source smaller than this many bytes. `--minimum` is the option's earlier name: it
    /// still binds the option, and no listing shows it.
    #[option(
        description = "Drop a source smaller than this many bytes.",
        short = 'b',
        aliases = ["minimum"],
        default = "0",
        env = "TEXTSTAT_MIN_BYTES",
        validate = integer().min(0),
        extensions = [
            CONFIG_INPUT.value(ConfigInputFacts::path("minBytes")),
            HELP_INPUT.value(HelpInputFacts::new().section(&["Counting", "Filter"])),
        ]
    )]
    pub min_bytes: i64,
    /// Add a total row.
    #[option(
        short = 't',
        env = "TEXTSTAT_TOTAL",
        extensions = [
            CONFIG_INPUT.value(ConfigInputFacts::path("total")),
            HELP_INPUT.value(HelpInputFacts::new().section(&["Counting", "Summary"])),
        ]
    )]
    pub total: bool,
    /// Report the elapsed time on stderr.
    #[option(hidden)]
    pub timing: bool,
}

/// The configuration file's JSON Schema, as the reference's schema converts.
fn file_schema() -> Option<serde_json::Map<String, serde_json::Value>> {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "minBytes": { "type": ["number", "string"] },
            "total": { "type": "boolean" }
        }
    })
    .as_object()
    .cloned()
}

/// The application: the root counts the sources it is given.
pub fn textstat() -> Application<TextstatInputs, RowsResult<Row>> {
    // Textstat counts text wherever the operator stands, so no entry marks a project it belongs
    // to. Its walk runs to the directory below home, as a lookup with no marker does.
    let config = configuration::<TextstatFile>(
        ConfigurationSettings::new(file_schema())
            .file(".textstat.{toml,json}")
            .formats(&[TOML])
            .short('c')
            .scopes(&[Scope::Project { root: Vec::new() }, Scope::User]),
    );
    Application::new("textstat")
        .plugins((
            help(),
            suggestions(),
            version(),
            format().short('f'),
            manifest().short('M'),
            config.plugin,
            // Each run appends its records to textstat.jsonl in the platform's log directory.
            logging(),
            loom_theme(ThemeMapping::default()),
            explain(),
            completion(),
        ))
        .description("Count bytes, words, or lines across text sources.")
        .version(env!("CARGO_PKG_VERSION"))
        .extend([
            HELP_COMMAND.value(
                HelpCommandFacts::new()
                    .details(DETAILS)
                    .examples(vec![
                        CommandExample::new("one.txt two.txt"),
                        CommandExample::new("--metric words --total *.md"),
                    ])
                    .option_sections(&[
                        &["Counting", "Measure"],
                        &["Counting", "Filter"],
                        &["Counting", "Summary"],
                        &["Options"],
                    ]),
            ),
            EXPLAIN_COMMAND.value(ExplainFacts {
                details: DETAILS.to_owned(),
                examples: Some(vec![
                    "textstat one.txt two.txt".to_owned(),
                    "textstat --metric words --total *.md".to_owned(),
                ]),
            }),
        ])
        .overrides([override_view(failure::<FatalError>(), fatal_error())])
        .inputs::<TextstatInputs>()
        // The counted sources are the rows this application produces, and the table is their
        // default. Stdout therefore carries the rows and nothing else the action writes.
        .rows(RowViews::<Row>::new().view(
            "table",
            table(TableConfig::new().columns(vec![
                Column::new("count")
                    .header("COUNT")
                    .align(loomcli_plugins::table::Alignment::Right)
                    .format(row_cell),
                Column::new("source").header("SOURCE").format(row_cell),
            ])),
        ))
        .action(count_files)
}
