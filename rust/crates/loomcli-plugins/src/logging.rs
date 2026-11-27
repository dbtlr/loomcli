//! Ordered logging destinations and the logging file fact.

mod directory;
mod error;
pub mod extension;
#[cfg(feature = "logging")]
mod file;
mod messages;
#[cfg(feature = "logging")]
mod otel;
#[cfg(feature = "logging")]
mod plugin;
#[cfg(feature = "logging")]
mod record;
mod resolution;

pub use self::error::{LoggingError, LoggingErrorKind};
#[cfg(feature = "logging")]
pub use self::extension::LogVariable;
#[cfg(feature = "logging")]
pub use self::otel::{OpenTelemetryDestination, OpenTelemetryLogRecord};
#[cfg(feature = "logging")]
pub use self::plugin::{
    ConsoleDestination, FailureHint, FileDestination, LogTarget, Logging, LoggingDestination,
    MultipleDestinations, SingleDestination, logging,
};
