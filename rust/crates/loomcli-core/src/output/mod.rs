//! Lanes, views, results, live regions, progress events, and logging.
//!
//! Every byte a run writes passes through one view registry. A view is a function from data to
//! marked text; a declared view carries an identity an override can replace, first in wins: the
//! application's overrides, then each plugin's in installation order, then the declaring
//! contributor's default.

pub(crate) mod emit;
mod log;
mod log_line;
mod messages;
mod out;
mod progress;
pub(crate) mod redaction;
mod region;
pub(crate) mod registry;
mod results;
mod screen;
pub(crate) mod view;

pub(crate) use log::{InstalledLogHook, LogHook, RunLog};

pub use log::{Log, LogApplication, LogDefect, LogDestination, LogEvent, LogFields, LogLevel};
pub use log_line::{LogLine, LogLineField, LogLineLevel, log_line};
pub use out::{Message, Out};
pub use region::{
    EndState, ProgressEvent, ProgressReport, ProgressState, Region, RegionCloser, RegionOptions,
};
pub use results::{
    NoResult, ResultKind, ResultTransform, ResultView, ResultViews, RowSource, RowViewEntry,
    RowViews, RowsResult, ValueResult,
};
pub use view::{
    AnyDeclaredView, Declare, DeclaredRowView, DeclaredView, IncompleteResult, IntoRendered,
    OverrideKey, Render, RowView, View, ViewContext, ViewContribution, ViewOverride, WholeView,
    incomplete_result, lanes, override_view, view,
};
