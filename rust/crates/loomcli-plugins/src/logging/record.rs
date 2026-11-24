//! The log record of one event, and which events a level writes.

use loomcli_core::{LogEvent, LogLevel};

/// Whether an event reaches the destination: at or above `floor`, and a `fatal` event always.
pub(super) fn is_written(level: LogLevel, floor: LogLevel) -> bool {
    level == LogLevel::Fatal || level >= floor
}

/// The log record of one event: the event as JSON with its keys in the record order (`time`,
/// `level`, `message`, `fields`, `application`, `run`, `path`, `plugin`, `failure`, `defect`), an
/// absent `failure` or `defect` left out, and one newline after it. The file and the console write
/// these bytes alike.
pub(super) fn record_of(event: &LogEvent) -> String {
    // The event's fields are plain JSON data, so writing it cannot fail; a failure leaves an empty
    // record and loses the event rather than the run.
    let mut record = serde_json::to_string(event).unwrap_or_default();
    record.push('\n');
    record
}
