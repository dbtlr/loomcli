//! Maps Loom log events to records for the author's OpenTelemetry logger.

use std::time::SystemTime;

use loomcli_core::{Error, IntoOutcome, LogEvent, LogLevel, Outcome};
use serde_json::{Map, Value};

use super::record::is_written;

/// An OpenTelemetry log record with owned, JSON-compatible attributes.
#[derive(Debug)]
#[non_exhaustive]
pub struct OpenTelemetryLogRecord {
    /// The event's instant.
    pub timestamp: SystemTime,
    /// The event's lowercase level.
    pub severity_text: &'static str,
    /// The base severity of the event's OpenTelemetry range.
    pub severity_number: u8,
    /// The message template as written.
    pub body: String,
    /// The redacted fields, run facts, and any failure or exception attributes.
    pub attributes: Map<String, Value>,
}

/// An OpenTelemetry destination using a synchronous emitter supplied by the author.
#[must_use]
pub struct OpenTelemetryDestination {
    level: LogLevel,
    emit: Box<dyn Fn(OpenTelemetryLogRecord) -> Outcome + Send + Sync>,
}

impl OpenTelemetryDestination {
    /// Emits eligible records to `emit`, which owns each record. An `Err` follows the ordinary
    /// log-hook failure path. The author configures and shuts down the logger.
    pub fn new<T: IntoOutcome>(
        emit: impl Fn(OpenTelemetryLogRecord) -> T + Send + Sync + 'static,
    ) -> Self {
        Self {
            level: LogLevel::Info,
            emit: Box::new(move |record| emit(record).into_outcome()),
        }
    }

    /// Sets the minimum level. Fatal events always reach the destination.
    pub fn level(mut self, level: LogLevel) -> Self {
        self.level = level;
        self
    }

    pub(super) fn write(&self, event: &LogEvent) -> Outcome {
        if is_written(event.level, self.level) {
            (self.emit)(record_of(event)?)?;
        }
        Ok(())
    }
}

fn record_of(event: &LogEvent) -> Result<OpenTelemetryLogRecord, Error> {
    let (severity_text, severity_number) = match event.level {
        LogLevel::Trace => ("trace", 1),
        LogLevel::Debug => ("debug", 5),
        LogLevel::Info => ("info", 9),
        LogLevel::Warn => ("warn", 13),
        LogLevel::Error => ("error", 17),
        LogLevel::Fatal => ("fatal", 21),
    };
    let timestamp = SystemTime::from(event.time.parse::<jiff::Timestamp>()?);
    let mut attributes = Map::from_iter([
        ("loom.fields".into(), Value::Object(event.fields.clone())),
        (
            "loom.path".into(),
            Value::Array(event.path.iter().cloned().map(Value::String).collect()),
        ),
        (
            "loom.plugin".into(),
            event.plugin.clone().map_or(Value::Null, Value::String),
        ),
        ("loom.run".into(), Value::String(event.run.clone())),
        (
            "service.name".into(),
            Value::String(event.application.name.clone()),
        ),
        (
            "service.version".into(),
            Value::String(event.application.version.clone()),
        ),
    ]);
    if let Some(failure) = &event.failure {
        attributes.insert("loom.failure".into(), serde_json::to_value(failure)?);
    }
    if let Some(defect) = &event.defect {
        attributes.insert("exception.type".into(), Value::String(defect.name.clone()));
        attributes.insert(
            "exception.message".into(),
            Value::String(defect.message.clone()),
        );
        if let Some(stack) = &defect.stack {
            attributes.insert("exception.stacktrace".into(), Value::String(stack.clone()));
        }
    }
    Ok(OpenTelemetryLogRecord {
        timestamp,
        severity_text,
        severity_number,
        body: event.message.clone(),
        attributes,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use loomcli_testing::{LogEventValues, log_event};

    use super::*;

    #[test]
    fn a_captured_stack_is_copied_to_the_exception_attribute() {
        let event = log_event(LogEventValues::new().level(LogLevel::Fatal).defect(
            "ProbeError",
            "The probe failed.",
            Some("probe stack".into()),
        ));
        let record = record_of(&event).unwrap();
        assert_eq!(record.attributes["exception.stacktrace"], "probe stack");
    }
}
