//! The five children that act on the unit: `install`, `uninstall`, `start`, `stop`, and
//! `restart`. Each makes the same checks first, then acts through the backend and the installed-files
//! module, with the unit recorded in the plugin's file `service.json`.

use std::path::{Path, PathBuf};

use loomcli_core::{Build, Env, Error, FatalError, Host, Out, RunSignal};

use super::backend::{Backend, Unit};
use super::manager::{Manager, OnShutdown};
use super::messages::{self, Child};
use super::unit::UnitValues;
use crate::installation::{
    CommittedFile, InstallOutcome, InstallRequest, InstalledFile, Observed, PluginRecord,
    RecordedRead, Refusal, RefusalReason, UninstallOutcome, digest_of, exists, home_of, observe,
    record_directory, target_refusals,
};

/// The unit file's mode whatever the umask, because launchd refuses a plist its group or others
/// can write.
const UNIT_MODE: u32 = 0o644;

/// The plugin's file in the installation record, `service.json`.
const RECORD_NAME: &str = "service";

/// What every child reads from its action context.
pub(super) struct ChildRun<'a> {
    pub(super) name: &'a str,
    pub(super) description: Option<&'a str>,
    pub(super) label: &'a str,
    pub(super) host: &'a Host,
    pub(super) signal: &'a RunSignal,
    pub(super) on_shutdown: OnShutdown<'a>,
}

/// What the checks found: the run's unit, its backend, its home, and its record directory.
pub(super) struct Prepared<'a> {
    pub(super) unit: Unit<'a>,
    pub(super) backend: Backend,
    home: &'a Path,
    record: PathBuf,
}

/// The managers' environment: the host's, which on Linux gains `/run/user/<uid>` for an absent
/// `XDG_RUNTIME_DIR`, because `sudo -u` drops it and `systemctl --user` needs it.
fn manager_env(host: &Host, uid: u32) -> Env {
    let mut env = host.env.clone();
    if host.platform == "linux" && !env.contains_key("XDG_RUNTIME_DIR") {
        env.insert("XDG_RUNTIME_DIR".to_owned(), format!("/run/user/{uid}"));
    }
    env
}

/// The checks every child makes, in order, before it reads or writes anything else: the platform,
/// which selects the backend, and an absolute home.
pub(super) fn prepare<'a>(run: &'a ChildRun<'a>) -> Result<Prepared<'a>, FatalError> {
    let host = run.host;
    let backend =
        Backend::of(&host.platform).ok_or_else(|| messages::platform(run.name, &host.platform))?;
    let home = home_of(&host.home).ok_or_else(|| messages::home(run.name))?;
    let uid = host
        .uid
        .ok_or_else(|| messages::platform(run.name, &host.platform))?;
    let manager = Manager {
        name: run.name,
        env: manager_env(host, uid),
        host,
        signal: run.signal,
        on_shutdown: run.on_shutdown,
    };
    let path = backend.unit_path(run.label, home, &host.env);
    let record = record_directory(run.name, host).map_err(|_| messages::home(run.name))?;
    Ok(Prepared {
        unit: Unit {
            name: run.name,
            label: run.label,
            uid,
            path,
            manager,
        },
        backend,
        home,
        record,
    })
}

/// The refusal of a build that is not distributed, which `install` alone makes.
fn require_distributed(run: &ChildRun<'_>) -> Result<(), FatalError> {
    match run.host.release.build {
        Build::Distributed => Ok(()),
        build => Err(messages::build(run.name, build == Build::Development)),
    }
}

/// The files the plugin's file records, or the refusal of a damaged or unknown-format file.
fn recorded_files(prepared: &Prepared<'_>, child: Child) -> Result<Vec<CommittedFile>, Error> {
    let file = PluginRecord::new(&prepared.record, RECORD_NAME);
    match file.read()? {
        RecordedRead::Refused(refused) => {
            Err(messages::record(prepared.unit.name, &refused.path, child).into())
        }
        RecordedRead::Read { files, .. } => Ok(files),
    }
}

/// The sentence one refusal of the unit's path states.
fn refusal_of(name: &str, refusal: &Refusal) -> FatalError {
    match refusal.reason {
        RefusalReason::Unrecorded => messages::unrecorded(name, &refusal.path),
        RefusalReason::Changed => messages::changed(name, &refusal.path),
        RefusalReason::Damaged | RefusalReason::UnknownFormat => {
            messages::record(name, &refusal.path, Child::Install)
        }
        _ => messages::irregular(name, &refusal.path),
    }
}

/// Fails with the first refusal, when there is one.
fn refuse(name: &str, refused: &[Refusal]) -> Result<(), FatalError> {
    match refused.first() {
        Some(refusal) => Err(refusal_of(name, refusal)),
        None => Ok(()),
    }
}

/// The unit's text, or the refusal of a value the file cannot hold. The description is read on one
/// line first, as help reads it, so only a path or a character that form keeps is refused.
fn render_unit(
    prepared: &Prepared<'_>,
    run: &ChildRun<'_>,
    words: &[String],
) -> Result<String, FatalError> {
    let description = run
        .description
        .map_or_else(|| run.name.to_owned(), single_line);
    let home = prepared.home.to_string_lossy();
    let all: Vec<String> = run.host.program.iter().chain(words).cloned().collect();
    let holds = run
        .host
        .program
        .iter()
        .map(String::as_str)
        .chain([description.as_str(), &home])
        .any(|text| text.chars().any(char::is_control));
    if holds {
        return Err(messages::control_character(run.name));
    }
    Ok(prepared.backend.render(&UnitValues {
        label: run.label,
        words: &all,
        home: &home,
        description: &description,
    }))
}

/// A text with each line break, CRLF or one terminator, read as one space.
fn single_line(text: &str) -> String {
    let mut line = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\r' if characters.peek() == Some(&'\n') => {
                characters.next();
                line.push(' ');
            }
            '\n' | '\u{b}' | '\u{c}' | '\r' | '\u{85}' | '\u{2028}' | '\u{2029}' => line.push(' '),
            other => line.push(other),
        }
    }
    line
}

/// Whether the unit at its path holds the rendered text and the record lists it alone with that
/// digest.
fn is_unchanged(unit: &Path, text: &str, files: &[CommittedFile]) -> Result<bool, Error> {
    let digest = digest_of(text.as_bytes());
    let listed = matches!(files, [only] if only.path == unit && only.digest == digest);
    Ok(listed && matches!(observe(unit)?, Observed::File { digest: held, .. } if held == digest))
}

/// States the recorded files the module removed, and those it kept because they changed.
async fn report_removals(
    run: &ChildRun<'_>,
    out: &Out,
    removed: &[PathBuf],
    kept: &[PathBuf],
) -> Result<(), Error> {
    for path in removed {
        out.info(&messages::removed(path)).await?;
    }
    for path in kept {
        out.info(&messages::kept(run.name, path)).await?;
    }
    Ok(())
}

/// Writes the unit through the installed-files module after stopping each earlier unit the record
/// lists, and states what the module did.
async fn write_unit(
    prepared: &Prepared<'_>,
    run: &ChildRun<'_>,
    out: &Out,
    text: &str,
    files: &[CommittedFile],
) -> Result<(), Error> {
    let unit = &prepared.unit;
    for file in files.iter().filter(|file| file.path != unit.path) {
        prepared.backend.retire(unit, &file.path).await?;
    }
    let request =
        InstallRequest::new().files([InstalledFile::new(&unit.path, text).mode(UNIT_MODE)]);
    let file = PluginRecord::new(&prepared.record, RECORD_NAME);
    match file.install(&request, run.signal)? {
        InstallOutcome::Refused(refused) => refuse(run.name, &refused).map_err(Error::from),
        InstallOutcome::Installed(done) => {
            out.info(&messages::wrote(&unit.path)).await?;
            report_removals(run, out, &done.removed, &done.kept).await
        }
    }
}

/// `install`: the checks and refusals, then the unit written unless unchanged, loaded, and started.
pub(super) async fn install_child(
    run: &ChildRun<'_>,
    out: &Out,
    words: &[String],
) -> Result<(), Error> {
    let prepared = prepare(run)?;
    require_distributed(run)?;
    let text = render_unit(&prepared, run, words)?;
    let unit = &prepared.unit;
    let files = recorded_files(&prepared, Child::Install)?;
    refuse(run.name, &target_refusals(&[unit.path.as_path()], &files)?)?;
    let unchanged = is_unchanged(&unit.path, &text, &files)?;
    if unchanged {
        out.info(&messages::unchanged(&unit.path)).await?;
    } else {
        write_unit(&prepared, run, out, &text, &files).await?;
    }
    prepared.backend.install(unit, !unchanged).await?;
    out.success(&messages::started(run.label)).await
}

/// Stops every recorded unit, removes the recorded files, and states each one.
async fn remove_units(
    prepared: &Prepared<'_>,
    run: &ChildRun<'_>,
    out: &Out,
    files: &[CommittedFile],
) -> Result<(), Error> {
    let unit = &prepared.unit;
    for file in files {
        prepared.backend.retire(unit, &file.path).await?;
    }
    let record = PluginRecord::new(&prepared.record, RECORD_NAME);
    let done = match record.uninstall(&[], run.signal)? {
        UninstallOutcome::Refused(refused) => {
            let path = refused
                .first()
                .map_or_else(|| prepared.record.clone(), |refusal| refusal.path.clone());
            return Err(messages::record(run.name, &path, Child::Uninstall).into());
        }
        UninstallOutcome::Uninstalled(done) => done,
    };
    prepared.backend.after_removal(unit).await?;
    for file in files {
        let line = if done.removed.contains(&file.path) {
            messages::removed(&file.path)
        } else if done.kept.contains(&file.path) {
            messages::kept(run.name, &file.path)
        } else {
            messages::gone(&file.path)
        };
        out.info(&line).await?;
    }
    Ok(())
}

/// `uninstall`: the checks and refusals, then every recorded unit stopped and its file removed.
pub(super) async fn uninstall_child(run: &ChildRun<'_>, out: &Out) -> Result<(), Error> {
    let prepared = prepare(run)?;
    let files = recorded_files(&prepared, Child::Uninstall)?;
    let path = &prepared.unit.path;
    if exists(path)? && !files.iter().any(|file| &file.path == path) {
        return Err(messages::unrecorded_uninstall(run.name, path).into());
    }
    if files.is_empty() {
        return out.success(&messages::nothing_to_remove(run.label)).await;
    }
    remove_units(&prepared, run, out, &files).await
}

/// The children that call the manager for an installed unit.
#[derive(Clone, Copy)]
pub(super) enum Control {
    Start,
    Stop,
    Restart,
}

/// `start`, `stop`, and `restart`: the manager's call for an installed unit, then its line.
pub(super) async fn control(run: &ChildRun<'_>, out: &Out, verb: Control) -> Result<(), Error> {
    let prepared = prepare(run)?;
    if !exists(&prepared.unit.path)? {
        return Err(messages::not_installed(run.name, run.label).into());
    }
    let (unit, backend) = (&prepared.unit, prepared.backend);
    let line = match verb {
        Control::Start => {
            backend.start(unit).await?;
            messages::started(run.label)
        }
        Control::Stop => {
            backend.stop(unit).await?;
            messages::stopped(run.label)
        }
        Control::Restart => {
            backend.restart(unit).await?;
            messages::restarted(run.label)
        }
    };
    out.success(&line).await
}
