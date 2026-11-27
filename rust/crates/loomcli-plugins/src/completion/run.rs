//! What `install`, `update`, and `uninstall` share: the run they act on, each shell's plugin's file
//! in the installation record, and the lines they write about startup lines.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use loomcli_core::{Error, FatalError, Host, Log, Out, RunSignal};

use super::messages::{self, Verb};
use super::shells::Shell;
use crate::installation::{
    CommittedFile, InstallOutcome, Installed, InstalledFile, PluginRecord, RecordedRead, Refusal,
    RefusalReason, StartupLine, StartupLinesOutcome, UninstalledLines, digest_of, exists,
    plugin_file_path, target_refusals,
};

/// What a child reads from its action: the application, the run, and the lanes it writes.
pub(super) struct ChildRun {
    pub name: String,
    pub host: Arc<Host>,
    pub signal: RunSignal,
    pub out: Out,
    pub log: Log,
}

impl ChildRun {
    /// The run's user, for judging whether another user owns a startup file.
    pub fn uid(&self) -> Option<u32> {
        self.host.uid
    }

    pub async fn info(&self, message: &str) -> Result<(), Error> {
        self.out.info(message).await
    }

    pub async fn success(&self, message: &str) -> Result<(), Error> {
        self.out.success(message).await
    }

    pub async fn warn(&self, message: &str) -> Result<(), Error> {
        self.out.warn(message).await
    }

    pub async fn print(&self, message: &str) -> Result<(), Error> {
        self.out.print(message).await
    }
}

/// What a shell's plugin's file records, read as recovery would resolve it, without writing.
pub(super) struct ShellRecord {
    pub shell: Shell,
    pub files: Vec<CommittedFile>,
    pub lines: Vec<StartupLine>,
    pub pending: bool,
}

/// Refuses an installing child on `win32`, before it reads anything, naming the print Command of
/// the shell the operator named, and the PowerShell one for `pwsh` or when no shell is named.
pub(super) fn refuse_windows(run: &ChildRun, shell: Option<Shell>) -> Result<(), Error> {
    if run.host.platform == "win32" {
        let printer = match shell {
            None | Some(Shell::Pwsh) => "powershell",
            Some(shell) => shell.name(),
        };
        return Err(FatalError::new(messages::installs_not_on_windows(&run.name, printer)).into());
    }
    Ok(())
}

/// The plugin's file in the installation record for a shell, `completion.<shell>`.
pub(super) fn record_name(shell: Shell) -> String {
    format!("completion.{}", shell.name())
}

/// The plugin's file of a shell in the record's directory.
pub(super) fn shell_record(record: &Path, shell: Shell) -> PluginRecord {
    PluginRecord::new(record, record_name(shell))
}

/// Whether a shell's plugin's file exists in the record's directory.
pub(super) fn has_plugin_file(record: &Path, shell: Shell) -> Result<bool, Error> {
    Ok(exists(&plugin_file_path(record, &record_name(shell)))?)
}

/// What a shell's plugin's file records, or the refusal of one that is damaged or holds an unknown
/// format, which names the Command to run again.
pub(super) fn read_shell(
    run: &ChildRun,
    record: &Path,
    shell: Shell,
    verb: Verb,
) -> Result<ShellRecord, Error> {
    let file = shell_record(record, shell);
    match file.read()? {
        RecordedRead::Refused(refused) => {
            Err(FatalError::new(messages::record_unreadable(&run.name, &refused.path, verb)).into())
        }
        RecordedRead::Read { files, lines, .. } => Ok(ShellRecord {
            files,
            lines,
            pending: file.has_pending()?,
            shell,
        }),
    }
}

/// The permission bits of each script, whatever the umask.
const SCRIPT_MODE: u32 = 0o644;

/// The permission bits of each folder the module creates for a script or a startup file.
pub(super) const DIRECTORY_MODE: u32 = 0o755;

/// The script file the module writes.
pub(super) fn script_file(path: &Path, content: &str) -> InstalledFile {
    InstalledFile::new(path, content.as_bytes()).mode(SCRIPT_MODE)
}

/// What the record says of a script a run would write.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ScriptState {
    /// The plugin's file is committed, records that script alone with the digest of this content,
    /// and the file is there.
    Steady,
    /// The script is there with that digest but the plugin's file records more or is pending.
    Same,
    /// Anything else.
    Changed,
}

/// Judges a script against the record and the content a run would write.
pub(super) fn script_state(
    recorded: &ShellRecord,
    script: &Path,
    content: &str,
) -> Result<ScriptState, Error> {
    let digest = digest_of(content.as_bytes());
    let same = recorded
        .files
        .iter()
        .any(|file| file.path == script && file.digest == digest);
    if !same || !exists(script)? {
        return Ok(ScriptState::Changed);
    }
    Ok(if recorded.pending || recorded.files.len() != 1 {
        ScriptState::Same
    } else {
        ScriptState::Steady
    })
}

/// A script a run would write, with the shell and the files its plugin's file records.
pub(super) struct Wanted<'a> {
    pub shell: Shell,
    pub script: &'a Path,
    pub files: &'a [CommittedFile],
}

/// Refuses, before any write, every script something else holds or someone changed since it was
/// written, stating each one; the failure names the first refused shell's install Command.
pub(super) async fn refuse_in_the_way(
    run: &ChildRun,
    verb: Verb,
    wanted: &[Wanted<'_>],
) -> Result<(), Error> {
    let mut first: Option<Shell> = None;
    for entry in wanted {
        for refusal in target_refusals(&[entry.script], entry.files)? {
            let sentence = if refusal.reason == RefusalReason::Changed {
                messages::script_changed(&run.name, &refusal.path)
            } else {
                messages::script_not_installed(&run.name, &refusal.path)
            };
            run.warn(&sentence).await?;
            first.get_or_insert(entry.shell);
        }
    }
    match first {
        Some(shell) => {
            Err(FatalError::new(messages::scripts_in_the_way(&run.name, verb, shell.name())).into())
        }
        None => Ok(()),
    }
}

/// The failure of an install the module refused although every check passed, as when another run
/// changed the record or a script between the checks and the write.
pub(super) fn outcome_failure(
    run: &ChildRun,
    refused: &[Refusal],
    shell: Shell,
    verb: Verb,
) -> Error {
    match refused.first() {
        Some(first)
            if matches!(
                first.reason,
                RefusalReason::Damaged | RefusalReason::UnknownFormat
            ) =>
        {
            FatalError::new(messages::record_unreadable(
                &run.name,
                &first.path,
                Verb::Install,
            ))
            .into()
        }
        _ => FatalError::new(messages::scripts_in_the_way(&run.name, verb, shell.name())).into(),
    }
}

/// A line the operator adds or removes by hand: the sentence that says why through `warn`, then the
/// line itself through `print`, the only thing these children write to stdout.
#[derive(Clone)]
pub(super) struct Notice {
    pub sentence: String,
    pub line: String,
}

/// Writes each notice: its sentence as a warning, then its line to stdout.
pub(super) async fn write_notices(run: &ChildRun, notices: &[Notice]) -> Result<(), Error> {
    for notice in notices {
        run.warn(&notice.sentence).await?;
        run.print(&notice.line).await?;
    }
    Ok(())
}

/// The notice of a recorded line the plugin released and the operator removes by hand.
pub(super) fn remove_notice(run: &ChildRun, path: &Path, line: &str) -> Notice {
    Notice {
        sentence: messages::remove_line_yourself(&run.name, path),
        line: line.to_owned(),
    }
}

/// What happened to the startup lines, as `reportLines` states it.
#[derive(Default)]
pub(super) struct LineReport<'a> {
    pub removed: &'a [StartupLine],
    pub no_longer_held: &'a [StartupLine],
    pub added: &'a [StartupLine],
    pub replaced: &'a [StartupLine],
    pub held: &'a [StartupLine],
}

impl<'a> From<&'a StartupLinesOutcome> for LineReport<'a> {
    fn from(outcome: &'a StartupLinesOutcome) -> Self {
        Self {
            removed: &outcome.removed,
            no_longer_held: &outcome.no_longer_held,
            added: &outcome.added,
            replaced: &outcome.replaced,
            held: &outcome.held,
        }
    }
}

impl<'a> From<&'a UninstalledLines> for LineReport<'a> {
    fn from(outcome: &'a UninstalledLines) -> Self {
        Self {
            removed: &outcome.removed,
            no_longer_held: &outcome.no_longer_held,
            ..Self::default()
        }
    }
}

/// States what happened to the startup lines: each removed or no longer held, then each added,
/// replaced, and, when `held` is set, each the file already held. A released line is stated by its
/// notice.
pub(super) async fn report_lines(
    run: &ChildRun,
    report: &LineReport<'_>,
    held: bool,
) -> Result<(), Error> {
    for line in report.removed {
        run.info(&messages::removed_line(&line.path)).await?;
    }
    for line in report.no_longer_held {
        run.info(&messages::line_no_longer_held(&run.name, &line.path))
            .await?;
    }
    for line in report.added {
        run.success(&messages::added_line(&line.path)).await?;
    }
    for line in report.replaced {
        run.success(&messages::updated_line(&line.path)).await?;
    }
    if held {
        for line in report.held {
            run.info(&messages::already_loads(&line.path)).await?;
        }
    }
    Ok(())
}

/// What an install or update wrote, and the lines the operator changes by hand.
pub(super) struct Written<'a> {
    pub outcome: &'a Installed,
    /// Whether a line the startup file already held is stated, as `install` states it.
    pub held: bool,
    /// The startup files the plugin may not change that already load the script, which `install`
    /// states.
    pub loaded: &'a [PathBuf],
    pub notices: &'a [Notice],
}

/// States what an install or update did past its script: each recorded script it no longer lists,
/// removed or kept because someone changed it, each startup line, and each line the operator adds
/// or removes by hand.
pub(super) async fn report_written(run: &ChildRun, written: &Written<'_>) -> Result<(), Error> {
    let Written {
        outcome,
        held,
        loaded,
        notices,
    } = written;
    for path in &outcome.removed {
        run.info(&messages::removed_file(path)).await?;
    }
    for path in &outcome.kept {
        run.warn(&messages::script_left_in_place(&run.name, path))
            .await?;
    }
    let report = outcome.lines.as_ref().map(LineReport::from);
    report_lines(run, &report.unwrap_or_default(), *held).await?;
    for path in *loaded {
        run.info(&messages::already_loads(path)).await?;
    }
    write_notices(run, notices).await
}

/// The outcome an install through the module answers when it wrote.
pub(super) fn installed_or_failure(
    run: &ChildRun,
    outcome: InstallOutcome,
    shell: Shell,
    verb: Verb,
) -> Result<Installed, Error> {
    match outcome {
        InstallOutcome::Installed(installed) => Ok(installed),
        InstallOutcome::Refused(refused) => Err(outcome_failure(run, &refused, shell, verb)),
    }
}
