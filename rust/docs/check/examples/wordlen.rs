//! wordlen measures words.

use loomcli_core::{
    Application, Command, Context, GroupApplication, Inputs, Outcome, RowViews, RowsResult,
};
use loomcli_plugins::completion::completion;
use loomcli_plugins::format::format;
use loomcli_plugins::help::help;
use loomcli_plugins::manifest::manifest;
use loomcli_plugins::mcp::extension::{MCP_COMMAND, McpAnnotations, McpCommandFacts};
use loomcli_plugins::mcp::mcp;
use loomcli_plugins::table::{TableConfig, table};
use loomcli_plugins::version::version;
use loomcli_validators::integer;
use serde::Serialize;

/// What `wordlen count` reads.
#[derive(Inputs)]
struct CountInputs {
    /// The words to measure.
    #[argument(required)]
    words: Vec<String>,
    /// Leave out a word shorter than this many characters.
    #[option(short = 'm', default = "1", validate = integer().min(1))]
    min: i64,
}

/// One measured word: a row of the result.
#[derive(Serialize)]
struct Measured {
    word: String,
    length: usize,
}

async fn count(context: Context<CountInputs, RowsResult<Measured>>) -> Outcome {
    let CountInputs { words, min } = &context.inputs;
    let rows: Vec<Measured> = words
        .iter()
        .map(|word| Measured {
            word: word.clone(),
            length: word.chars().count(),
        })
        .filter(|row| i64::try_from(row.length).is_ok_and(|length| length >= *min))
        .collect();
    context.out.results(rows).await
}

fn wordlen() -> GroupApplication {
    Application::new("wordlen")
        .plugins((help(), version(), format(), manifest(), completion(), mcp()))
        .description("Measure words.")
        .version("1.0.0")
        .command(
            Command::new("count")
                .description("Print the length of each word.")
                .extend([MCP_COMMAND.value(McpCommandFacts::annotations(
                    McpAnnotations::new().read_only(true).open_world(false),
                ))])
                .inputs::<CountInputs>()
                .rows(RowViews::new().view("table", table(TableConfig::new())))
                .action(count),
        )
}

fn main() -> std::process::ExitCode {
    wordlen().main()
}
