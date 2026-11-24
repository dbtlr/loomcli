//! The action: count each source, and emit the rows at once.

use std::time::Instant;

use loomcli_core::{
    ContentKind, Context, Error, FailureFacts, FatalError, Log, LogFields, Outcome, RowsResult,
    escape_control_characters,
};

use crate::application::TextstatInputs;
use crate::count_source::{Metric, count_source};
use crate::row::Row;

/// The reason a read failed, as one sentence ending in a period. A reason that already ends with
/// one keeps it, so the fix that follows never reads after two periods.
fn explain(error: &Error) -> String {
    let reason = match (error.foreign(), error.failure()) {
        (Some(foreign), _) => escape_control_characters(&foreign.to_string()),
        (None, Some(failure)) => escape_control_characters(failure.message()),
        (None, None) => "The source could not be read.".to_owned(),
    };
    if reason.ends_with('.') {
        reason
    } else {
        format!("{reason}.")
    }
}

/// What one pass over the sources produced: the rows it kept and the total of their counts.
struct Counted {
    rows: Vec<Row>,
    total: u64,
}

/// Rows are collected while the sources are counted and returned once at the end, so a read
/// failure on any source ends the invocation before a partial table reaches stdout.
async fn count_all(
    inputs: &TextstatInputs,
    metric: Metric,
    log: &Log,
) -> Result<Counted, FatalError> {
    let mut rows = Vec::new();
    let mut total = 0;
    for source in &inputs.files {
        let counts = count_source(source, metric).await.map_err(|error| {
            let subject = match source.kind {
                ContentKind::Stdin => "stdin".to_owned(),
                _ => format!("file: {}", source.name),
            };
            FatalError::new(format!(
                "Cannot read {subject}: {} Supply readable files, or pipe text to stdin.",
                explain(&error)
            ))
        })?;
        if i64::try_from(counts.bytes).is_ok_and(|bytes| bytes >= inputs.min_bytes) {
            total += counts.counted;
            rows.push(Row {
                count: counts.counted,
                source: source.name.clone(),
                is_total: false,
            });
        } else {
            log.debug(
                "Dropped a source below the byte threshold.",
                LogFields::new()
                    .field("bytes", counts.bytes)
                    .field("minimum", inputs.min_bytes)
                    .field("source", &source.name),
            );
        }
    }
    Ok(Counted { rows, total })
}

/// The counted rows are emitted at once as the result, and the hidden timing line follows it.
pub async fn count_files(context: Context<TextstatInputs, RowsResult<Row>>) -> Outcome {
    let Context {
        inputs, out, log, ..
    } = context;
    let started = Instant::now();
    let metric = Metric::named(&inputs.metric);
    let counted = count_all(&inputs, metric, &log).await?;
    log.info(
        "Counted the sources.",
        LogFields::new()
            .field("kept", counted.rows.len())
            .field("metric", &inputs.metric)
            .field("sources", inputs.files.len()),
    );
    let mut rows = counted.rows;
    if inputs.total {
        rows.push(Row {
            count: counted.total,
            source: "total".to_owned(),
            is_total: true,
        });
    }
    out.results(rows).await?;
    if inputs.timing {
        out.info(&format!("elapsed: {}ms", started.elapsed().as_millis()))
            .await?;
    }
    Ok(())
}
