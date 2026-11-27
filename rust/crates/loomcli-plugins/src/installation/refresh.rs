//! The `after_replace` refresh the installing plugins share: a replaced process holds the old
//! version's files, so it runs the new binary with the plugin's `update` words, as a child program
//! through the run's `host.spawn`, and passes the child's output through. The skills, completion,
//! and manpage plugins each call it with their words and sentences. A refresh that names its
//! application starts no child when the installation record holds nothing of that kind, and logs
//! the skip at trace. A child that exits 0 records `Program run.`. A child that fails or cannot
//! start adds a `warn` log event and returns, because the binary update succeeded.

use std::path::Path;

use loomcli_core::{
    ApplicationDirectory, ChildExit, ChildStream, DirectoryFacts, DirectoryLookup, Host, Log,
    LogFields, RunSignal, SpawnOptions, application_directory, escape_control_characters,
};

use super::{exists, plugin_file_path};
use crate::change_events::program_run;

/// What a refresh reads from a self-update's `after_replace` context: the binary that replaced
/// this one, the run's host, its signal, its log, and, when the hook gives one, the application's
/// name, which is what lets a refresh skip when nothing of its kind is installed.
#[derive(Clone, Copy)]
#[non_exhaustive]
pub struct RefreshContext<'a> {
    /// The binary that replaced this one.
    pub path: &'a Path,
    /// The run's host.
    pub host: &'a Host,
    /// The run signal, which ends the child when the run is cancelled.
    pub signal: &'a RunSignal,
    /// The run's log.
    pub log: &'a Log,
    /// The Application's name, when available, for looking up the installation record.
    pub name: Option<&'a str>,
}

impl<'a> RefreshContext<'a> {
    /// Builds a context that always runs the refresh child.
    #[must_use]
    pub fn new(path: &'a Path, host: &'a Host, signal: &'a RunSignal, log: &'a Log) -> Self {
        Self {
            path,
            host,
            signal,
            log,
            name: None,
        }
    }

    /// Allows the refresh to skip its child when this Application has nothing installed.
    #[must_use]
    pub fn name(mut self, name: &'a str) -> Self {
        self.name = Some(name);
        self
    }
}

/// What one plugin's refresh runs and says: the words the new binary runs with, the `warn` log
/// event's message, and the line a child that cannot start leaves for the operator, from the
/// binary's path and its name, each escaped.
#[derive(Clone, Copy, Debug)]
pub struct Refresh {
    /// The words the new binary runs with, such as `["completion", "update"]`.
    pub words: &'static [&'static str],
    /// The `warn` log event's message.
    pub warning: &'static str,
    /// The stderr line for a binary that could not start, from its escaped path and escaped name,
    /// ending with a line feed.
    pub not_started: fn(&str, &str) -> String,
    /// The plugin's file names in the installation record, without the JSON suffix.
    pub records: fn() -> Vec<String>,
    /// The trace message when no installation record exists for the plugin.
    pub skipped: &'static str,
}

/// The exit code of a child that succeeded.
const SUCCEEDED: i32 = 0;

/// Runs the new binary with the refresh's words, the host's environment and working directory, no
/// input, and its output written to the host's streams, so the child reads neither as a terminal,
/// and the run's signal ending it. A child that exits with another code adds the `warn` event with
/// `code` and `path`; one that cannot start writes the refresh's line to the host's stderr and
/// adds the event with `error` and `path`. An abandoned child logs just `path`. A named application
/// with nothing of this kind installed starts no child and logs the skip at trace, and a child that
/// exits 0 records `Program run.`.
pub async fn refresh_by_running(context: RefreshContext<'_>, refresh: &Refresh) {
    if nothing_installed(context, refresh) {
        context.log.trace(refresh.skipped, ());
        return;
    }
    let RefreshContext {
        path,
        host,
        signal,
        log,
        ..
    } = context;
    let command = path.to_string_lossy();
    let options = SpawnOptions::new()
        .signal(signal.token())
        .stdout(ChildStream::Stream(host.stdout()))
        .stderr(ChildStream::Stream(host.stderr()));
    let child = host.spawn(&command, refresh.words.iter().copied(), options);
    match child.exited().await {
        ChildExit::Exited { code, .. } if code == SUCCEEDED => {
            program_run(log, &command, refresh.words, code);
        }
        ChildExit::Exited { code, .. } => log.warn(
            refresh.warning,
            LogFields::new()
                .field("code", code)
                .field("path", command.as_ref()),
        ),
        ChildExit::Unstarted { error } => {
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            let line = (refresh.not_started)(
                &escape_control_characters(&command),
                &escape_control_characters(&name),
            );
            // A stderr that refuses the line follows the run's closed-pipe rule; the refresh still
            // reports its event.
            let _ = host.stderr().write(line.as_bytes()).await;
            log.warn(
                refresh.warning,
                LogFields::new()
                    .field("error", error.to_string())
                    .field("path", command.as_ref()),
            );
        }
        ChildExit::Abandoned { .. } => log.warn(
            refresh.warning,
            LogFields::new().field("path", command.as_ref()),
        ),
        // An exit core adds later is no failure the refresh can name.
        _ => {}
    }
}

/// Only a resolved directory where each record is absent can skip the child.
fn nothing_installed(context: RefreshContext<'_>, refresh: &Refresh) -> bool {
    let Some(name) = context.name else {
        return false;
    };
    let DirectoryLookup::Path(directory) = application_directory(
        ApplicationDirectory::Installation,
        name,
        &DirectoryFacts::from(context.host),
    ) else {
        return false;
    };
    (refresh.records)()
        .into_iter()
        .all(|record| exists(&plugin_file_path(&directory, &record)).is_ok_and(|present| !present))
}
