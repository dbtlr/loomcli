//! `completion uninstall`: each shell's recorded script and startup line removed, and its plugin's
//! file deleted. A line in a startup file the plugin cannot change is released and printed for the
//! operator to remove. Every shell is checked before any is changed.

use std::path::{Path, PathBuf};

use loomcli_core::{Error, FatalError};

use super::messages::{self, Verb};
use super::run::{
    ChildRun, LineReport, ShellRecord, has_plugin_file, read_shell, refuse_windows, remove_notice,
    report_lines, shell_record, write_notices,
};
use super::shells::{SHELLS, Shell};
use super::startup::{judge_startup, must_release};
use crate::installation::{
    RecordedRead, StartupLine, UninstallOutcome, Uninstalled, real_path, record_directory,
};

/// A shell an uninstall removes, with the recorded lines it releases.
struct Planned {
    recorded: ShellRecord,
    released: Vec<StartupLine>,
}

/// The recorded lines in startup files the plugin cannot change that hold them, which it releases.
fn plan_shell(run: &ChildRun, recorded: ShellRecord) -> Result<Planned, Error> {
    let mut released = Vec::new();
    for entry in &recorded.lines {
        if must_release(judge_startup(&entry.path, &entry.line, run.uid())?) {
            released.push(entry.clone());
        }
    }
    Ok(Planned { recorded, released })
}

/// States each recorded script: removed, left in place because someone changed it, or already gone.
async fn report_scripts(
    run: &ChildRun,
    recorded: &ShellRecord,
    outcome: &Uninstalled,
) -> Result<(), Error> {
    for file in &recorded.files {
        if outcome.removed.contains(&file.path) {
            run.info(&messages::removed_file(&file.path)).await?;
        } else if outcome.kept.contains(&file.path) {
            run.warn(&messages::script_left_in_place(&run.name, &file.path))
                .await?;
        } else {
            run.info(&messages::script_gone(&file.path)).await?;
        }
    }
    Ok(())
}

/// Removes one shell's recorded script and lines through the module, then states each.
async fn remove_shell(run: &ChildRun, record: &Path, planned: &Planned) -> Result<(), Error> {
    let Planned { recorded, released } = planned;
    let mut release: Vec<PathBuf> = Vec::new();
    for entry in released {
        if !release.contains(&entry.path) {
            release.push(entry.path.clone());
        }
    }
    let outcome = shell_record(record, recorded.shell)
        .with_log(&run.log)
        .uninstall(&release, &run.signal)?;
    let outcome = match outcome {
        UninstallOutcome::Uninstalled(done) => done,
        UninstallOutcome::Refused(refused) => {
            let path = refused
                .first()
                .map_or_else(|| record.to_path_buf(), |first| first.path.clone());
            return Err(FatalError::new(messages::record_unreadable(
                &run.name,
                &path,
                Verb::Uninstall,
            ))
            .into());
        }
    };
    report_scripts(run, recorded, &outcome).await?;
    let report = outcome.lines.as_ref().map(LineReport::from);
    report_lines(run, &report.unwrap_or_default(), false).await?;
    let notices: Vec<_> = released
        .iter()
        .map(|entry| remove_notice(run, &entry.path, &entry.line))
        .collect();
    write_notices(run, &notices).await
}

/// The shells an uninstall acts on, its argument's or, left out, every one, each whose plugin's file
/// exists, read before any is changed.
fn selected_shells(
    run: &ChildRun,
    record: &Path,
    argument: Option<Shell>,
) -> Result<Vec<ShellRecord>, Error> {
    let selected: Vec<Shell> = argument.map_or_else(|| SHELLS.to_vec(), |shell| vec![shell]);
    let mut records = Vec::new();
    for shell in selected {
        if has_plugin_file(record, shell)? {
            records.push(read_shell(run, record, shell, Verb::Uninstall)?);
        }
    }
    Ok(records)
}

/// Whether a shell's plugin's file records anything: a script or a startup line.
fn records_anything(recorded: &ShellRecord) -> bool {
    !recorded.files.is_empty() || !recorded.lines.is_empty()
}

/// The scripts another shell's plugin's file records.
fn scripts_of(record: &Path, shell: Shell) -> Result<Vec<PathBuf>, Error> {
    Ok(match shell_record(record, shell).read()? {
        RecordedRead::Read { files, .. } => files.into_iter().map(|file| file.path).collect(),
        _ => Vec::new(),
    })
}

/// Whether a script sits under a folder, both read through every symbolic link, so a script reached
/// through a link to the folder, or to one of its parents, is seen under it. The script's own
/// folder is resolved, through its nearest existing parent when it is gone.
fn sits_under(script: &Path, folder: &Path) -> Result<bool, Error> {
    let script_folder = real_path(script.parent().unwrap_or(script))?;
    let real_folder = real_path(folder)?;
    Ok(script_folder.starts_with(&real_folder))
}

/// Hands each folder a shell's plugin's file records it created to the plugin's file of another
/// installed shell whose script sits under it, before the shell's file is deleted. That folder
/// still holds the other shell's script, or its folders, after this uninstall, and the other
/// shell's uninstall removes it once it is empty.
fn hand_over_folders(run: &ChildRun, record: &Path, shell: Shell) -> Result<(), Error> {
    let mut remaining = shell_record(record, shell).directories()?;
    for heir in SHELLS.into_iter().filter(|other| *other != shell) {
        let scripts = scripts_of(record, heir)?;
        let mut held: Vec<PathBuf> = Vec::new();
        for folder in &remaining {
            let mut under = false;
            for script in &scripts {
                if sits_under(script, folder)? {
                    under = true;
                    break;
                }
            }
            if under {
                held.push(folder.clone());
            }
        }
        if !held.is_empty()
            && shell_record(record, heir)
                .with_log(&run.log)
                .adopt_directories(&held)?
        {
            remaining.retain(|folder| !held.contains(folder));
        }
    }
    Ok(())
}

/// `uninstall`: the platform, then the record's directory and each selected shell's plugin's file
/// read before any is changed, then each shell whose plugin's file exists removed and stated, its
/// shared folders handed first to a shell that outlives it. With nothing recorded, it states there
/// was nothing to remove.
pub(super) async fn uninstall_shells(run: &ChildRun, argument: Option<Shell>) -> Result<(), Error> {
    refuse_windows(run, argument)?;
    let record = record_directory(&run.name, &run.host)?;
    let selected = selected_shells(run, &record, argument)?;
    let nothing = !selected.iter().any(records_anything);
    let mut planned = Vec::with_capacity(selected.len());
    for recorded in selected {
        planned.push(plan_shell(run, recorded)?);
    }
    for entry in &planned {
        hand_over_folders(run, &record, entry.recorded.shell)?;
        remove_shell(run, &record, entry).await?;
    }
    if nothing {
        run.success(&messages::no_completion_to_remove(&run.name))
            .await?;
    }
    Ok(())
}
