//! The one reader every action reads its document through.

use loomcli_core::{
    Content, ContentKind, ContextualStyle, Error, FailureFacts, FatalError, Out,
    escape_control_characters,
};
use serde_json::Value;

/// The reason a runtime gave, or the fallback, as one sentence ending in a period. A reason that
/// already ends with one keeps it, so the fix that follows never reads after two periods. A runtime
/// reason can quote the path it failed on, so its control characters are escaped as the name's are.
fn explain(error: &Error, fallback: &str) -> String {
    let reason = match (error.foreign(), error.failure()) {
        (Some(foreign), _) => escape_control_characters(&foreign.to_string()),
        (None, Some(failure)) => escape_control_characters(failure.message()),
        (None, None) => fallback.to_owned(),
    };
    if reason.ends_with('.') {
        reason
    } else {
        format!("{reason}.")
    }
}

/// Every action reads its document here, so a read failure reads the same everywhere. It first
/// names the source on one debug line, which the operator's `-v` reveals, with its control
/// characters escaped as every other operator-supplied name jsonkit prints. A malformed document
/// returns the parse error `serde_json` raises, which the application's translator turns into its
/// `InvalidJsonError`.
pub async fn read_json<R>(
    file: &Content,
    out: &Out<R>,
    style: &ContextualStyle,
) -> Result<Value, Error> {
    let stdin = matches!(file.kind, ContentKind::Stdin);
    let line = if stdin {
        "Reading stdin.".to_owned()
    } else {
        format!(
            "Reading {}.",
            style.escape(&escape_control_characters(&file.name))
        )
    };
    out.debug(&line).await?;
    let subject = if stdin {
        "stdin".to_owned()
    } else {
        format!("file: {}", escape_control_characters(&file.name))
    };
    let contents = match file.text().await {
        Ok(contents) => contents,
        Err(error) => {
            return Err(FatalError::new(format!(
                "Cannot read {subject}: {} Supply a readable file, or pipe JSON to stdin.",
                explain(&error, "The source could not be read.")
            ))
            .into());
        }
    };
    let document: Value = serde_json::from_str(&contents)?;
    Ok(document)
}
