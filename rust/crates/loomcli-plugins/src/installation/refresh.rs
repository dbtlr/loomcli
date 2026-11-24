//! The `after_replace` refresh the installing plugins share: a replaced process holds the old
//! version's files, so it runs the new binary with the plugin's `update` words, as a child program
//! through the run's `host.spawn`, and passes the child's output through. The skills, completion,
//! and manpage plugins each call it with their words and sentences. A child that fails or cannot
//! start adds a `warn` log event and returns, because the binary update succeeded.

use std::path::Path;

use loomcli_core::{
    ChildExit, ChildStream, Host, Log, LogFields, RunSignal, SpawnOptions,
    escape_control_characters,
};

/// What a refresh reads from a self-update's `after_replace` context: the binary that replaced
/// this one, the run's host, its signal, and its log.
#[derive(Clone, Copy)]
pub struct RefreshContext<'a> {
    /// The binary that replaced this one.
    pub path: &'a Path,
    /// The run's host.
    pub host: &'a Host,
    /// The run signal, which ends the child when the run is cancelled.
    pub signal: &'a RunSignal,
    /// The run's log.
    pub log: &'a Log,
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
}

/// The exit code of a child that succeeded.
const SUCCEEDED: i32 = 0;

/// Runs the new binary with the refresh's words, the host's environment and working directory, no
/// input, and its output written to the host's streams, so the child reads neither as a terminal,
/// and the run's signal ending it. A child that exits with another code adds the `warn` event with
/// `code` and `path`; one that cannot start writes the refresh's line to the host's stderr and
/// adds the event with `error` and `path`. Either way it returns.
pub async fn refresh_by_running(context: RefreshContext<'_>, refresh: &Refresh) {
    let RefreshContext {
        path,
        host,
        signal,
        log,
    } = context;
    let command = path.to_string_lossy();
    let options = SpawnOptions::new()
        .signal(signal.token())
        .stdout(ChildStream::Stream(host.stdout()))
        .stderr(ChildStream::Stream(host.stderr()));
    let child = host.spawn(&command, refresh.words.iter().copied(), options);
    match child.exited().await {
        ChildExit::Exited { code, .. } if code == SUCCEEDED => {}
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
        // An exit core adds later is no failure the refresh can name.
        _ => {}
    }
}
