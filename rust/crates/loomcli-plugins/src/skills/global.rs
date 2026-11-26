//! The global children: `install`, `update`, and `uninstall` act on the skill folders under the
//! operator's home, which the installation record lists as installed folders, one plugin's file for
//! each target.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use loomcli_core::{CommandGraph, Error, FatalError, Host, Log, NoResult, Out, RunSignal};

use super::Declared;
use super::load::{LoadedSkill, load_for_run};
use super::messages::{self, WritingVerb};
use super::targets::{Place, Target, global_places, selected_targets};
use crate::installation::{
    InstallOutcome, InstallRequest, InstallationError, Installed, InstalledFolder, PluginRecord,
    RecordedFolder, RecordedRead, Refusal, RefusalReason, UninstallOutcome, changed_references,
    folder_refusals, real_path, record_directory, stale_files,
};

/// What a child reads from its action: the application, the run, and the lanes it writes.
pub(super) struct ChildRun<'a, R = NoResult> {
    pub(super) name: &'a str,
    pub(super) graph: &'a CommandGraph,
    pub(super) log: &'a Log,
    pub(super) host: &'a Host,
    pub(super) signal: &'a RunSignal,
    pub(super) out: &'a Out<R>,
}

/// The plugin's file in the installation record for a target, `skills.<target>`.
pub(super) fn record_name(target: Target) -> String {
    format!("skills.{}", target.name())
}

/// A folder an install writes, with the name of the skill it holds.
struct NamedFolder {
    name: String,
    folder: InstalledFolder,
}

/// The folders of the loaded skills under a skills directory.
fn folders_in(directory: &Path, loaded: &[LoadedSkill]) -> Vec<NamedFolder> {
    loaded
        .iter()
        .map(|skill| NamedFolder {
            name: skill.name.clone(),
            folder: InstalledFolder::new(directory.join(&skill.name), skill.files.clone()),
        })
        .collect()
}

/// The record's directory and the places of the selected targets, which every global child
/// resolves before it loads or reads anything: the selected targets' directories first, then the
/// record's directory.
pub(super) fn prepare<R>(
    run: &ChildRun<'_, R>,
    agent: Option<Target>,
) -> Result<(Vec<Place>, PathBuf), Error> {
    let places = global_places(run.name, run.host, &selected_targets(agent))?;
    let record = record_directory(run.name, run.host)?;
    Ok((places, record))
}

/// The places a child acts on: both, or the first alone when a link makes the two skills
/// directories one folder, which it states.
pub(super) async fn acting_places<R>(
    run: &ChildRun<'_, R>,
    places: Vec<Place>,
    status: bool,
) -> Result<Vec<Place>, Error> {
    let [first, second] = places.as_slice() else {
        return Ok(places);
    };
    if real_path(&first.directory).map_err(InstallationError::from)?
        != real_path(&second.directory).map_err(InstallationError::from)?
    {
        return Ok(places);
    }
    let line = if status {
        messages::status_same_folder(run.name, &second.directory, &first.directory)
    } else {
        messages::same_folder(run.name, &second.directory, &first.directory)
    };
    run.out.info(&line).await?;
    Ok(places.into_iter().take(1).collect())
}

/// A place with the folders its plugin's file lists, and whether that file is still `pending`.
struct Recorded {
    place: Place,
    folders: Vec<RecordedFolder>,
    pending: bool,
}

/// The folders each place's plugin's file lists, or the refusal of a file that cannot be read.
fn recorded_by(
    run: &ChildRun<'_>,
    record: &Path,
    places: Vec<Place>,
    verb: &str,
) -> Result<Vec<Recorded>, Error> {
    places
        .into_iter()
        .map(|place| {
            let file = PluginRecord::new(record, record_name(place.target));
            match file.read()? {
                RecordedRead::Refused(refused) => {
                    Err(FatalError::new(messages::record(run.name, &refused.path, verb)).into())
                }
                RecordedRead::Read { folders, .. } => Ok(Recorded {
                    folders,
                    pending: file.has_pending()?,
                    place,
                }),
            }
        })
        .collect()
}

/// A recorded target with the folders an install would write there.
struct Wanted {
    recorded: Recorded,
    wanted: Vec<NamedFolder>,
}

/// The refusals of wanted folders held by something else or holding edited references.
fn refusals_of(entries: &[Wanted]) -> Result<Vec<Refusal>, Error> {
    let mut refusals = Vec::new();
    for entry in entries {
        let paths: Vec<&Path> = entry
            .wanted
            .iter()
            .map(|named| named.folder.path.as_path())
            .collect();
        refusals.extend(folder_refusals(&paths, &entry.recorded.folders)?);
    }
    Ok(refusals)
}

/// Whether a target's skills are all unchanged and its plugin's file lists no other folder. A
/// `pending` file is never unchanged: the module's install resolves it and removes its leftovers.
fn is_unchanged(entry: &Wanted) -> Result<bool, Error> {
    let recorded = &entry.recorded;
    let paths: HashSet<_> = recorded.folders.iter().map(|folder| &folder.path).collect();
    if recorded.pending || paths.len() != entry.wanted.len() {
        return Ok(false);
    }
    for held in &recorded.folders {
        if !changed_references(held)
            .map_err(InstallationError::from)?
            .is_empty()
        {
            return Ok(false);
        }
    }
    for named in &entry.wanted {
        let folder = &named.folder;
        let files = recorded
            .folders
            .iter()
            .find(|held| held.path == folder.path)
            .and_then(|held| held.files.as_deref());
        let Some(files) = files else {
            return Ok(false);
        };
        if !stale_files(&folder.path, &folder.files, files)
            .map_err(InstallationError::from)?
            .is_empty()
        {
            return Ok(false);
        }
    }
    Ok(true)
}

/// The refusal an install returns, as the failure the child reports.
fn failure_of(run: &ChildRun<'_>, verb: WritingVerb, refused: &[Refusal]) -> Error {
    if let Some(first) = refused.first() {
        if matches!(
            first.reason,
            RefusalReason::Damaged | RefusalReason::UnknownFormat
        ) {
            return FatalError::new(messages::record(run.name, &first.path, "install")).into();
        }
    }
    FatalError::new(messages::in_the_way(run.name, verb)).into()
}

/// What `install` and `update` read from the command line.
pub(super) struct InstallRequestFacts {
    pub(super) verb: WritingVerb,
    pub(super) agent: Option<Target>,
    pub(super) force: bool,
}

/// States the folders the install replaced, wrote, and removed.
async fn report_install(
    run: &ChildRun<'_>,
    verb: WritingVerb,
    entry: &Wanted,
    done: &Installed,
    modified: &HashSet<&Path>,
) -> Result<(), Error> {
    for folder in done.replaced.iter().flatten() {
        let line = if modified.contains(folder.as_path()) {
            messages::replaced_modified(run.name, folder)
        } else {
            messages::replaced(run.name, folder)
        };
        run.out.info(&line).await?;
    }
    for named in &entry.wanted {
        let target = entry.recorded.place.target.name();
        let line = match verb {
            WritingVerb::Update => messages::updated(&named.name, target, &named.folder.path),
            WritingVerb::Install => messages::installed(&named.name, target, &named.folder.path),
        };
        run.out.success(&line).await?;
    }
    for folder in &done.kept {
        run.out
            .warn(&messages::modified_kept(run.name, folder))
            .await?;
    }
    for folder in &done.removed {
        run.out.info(&messages::removed(folder)).await?;
    }
    Ok(())
}

/// Writes the skills of one target through the module, or states that they are unchanged.
async fn write_target(
    run: &ChildRun<'_>,
    record: &Path,
    facts: &InstallRequestFacts,
    entry: &Wanted,
) -> Result<(), Error> {
    if is_unchanged(entry)? {
        for named in &entry.wanted {
            run.out
                .info(&messages::unchanged(&named.folder.path))
                .await?;
        }
        return Ok(());
    }
    let mut modified = HashSet::new();
    for folder in &entry.recorded.folders {
        if !changed_references(folder)
            .map_err(InstallationError::from)?
            .is_empty()
        {
            modified.insert(folder.path.as_path());
        }
    }
    let request = InstallRequest::new()
        .folders(entry.wanted.iter().map(|named| named.folder.clone()))
        .force(facts.force);
    let file = PluginRecord::new(record, record_name(entry.recorded.place.target));
    match file.install(&request, run.signal)? {
        InstallOutcome::Refused(refused) => Err(failure_of(run, facts.verb, &refused)),
        InstallOutcome::Installed(done) => {
            report_install(run, facts.verb, entry, &done, &modified).await
        }
    }
}

/// The targets an install or update writes, each with the folders it would write: after the checks,
/// the loaders, and the record. `update` keeps the targets whose plugin's file lists a folder.
async fn chosen_targets(
    run: &ChildRun<'_>,
    record: &Path,
    declared: &Declared,
    facts: &InstallRequestFacts,
    places: Vec<Place>,
) -> Result<Vec<Wanted>, Error> {
    let acting = acting_places(run, places, false).await?;
    let loaded = load_for_run(run, declared).await?;
    let mut entries = recorded_by(run, record, acting, "install")?;
    if facts.verb == WritingVerb::Update {
        entries.retain(|entry| !entry.folders.is_empty());
    }
    Ok(entries
        .into_iter()
        .map(|recorded| Wanted {
            wanted: folders_in(&recorded.place.directory, &loaded),
            recorded,
        })
        .collect())
}

/// Refuses, before any write, every folder something else holds, stating each one.
async fn refuse_unrecorded(
    run: &ChildRun<'_>,
    facts: &InstallRequestFacts,
    chosen: &[Wanted],
) -> Result<(), Error> {
    let refused = if facts.force {
        Vec::new()
    } else {
        refusals_of(chosen)?
    };
    for refusal in &refused {
        let warning = match &refusal.file {
            Some(file) => messages::reference_changed(run.name, &refusal.path.join(file)),
            None => messages::not_installed(run.name, &refusal.path),
        };
        run.out.warn(&warning).await?;
    }
    if refused.is_empty() {
        Ok(())
    } else {
        Err(FatalError::new(messages::in_the_way(run.name, facts.verb)).into())
    }
}

/// `install` and `update` at global scope: the checks, the loaders, the record, and every refusal
/// before any write, then each target written or stated unchanged. `update` acts only on the
/// targets whose plugin's file lists a folder.
pub(super) async fn install_global(
    run: &ChildRun<'_>,
    declared: &Declared,
    facts: &InstallRequestFacts,
) -> Result<(), Error> {
    let (places, record) = prepare(run, facts.agent)?;
    let chosen = chosen_targets(run, &record, declared, facts, places).await?;
    if chosen.is_empty() {
        return run.out.success(&messages::none_to_update(run.name)).await;
    }
    refuse_unrecorded(run, facts, &chosen).await?;
    for entry in &chosen {
        write_target(run, &record, facts, entry).await?;
    }
    Ok(())
}

/// Removes one target's recorded folders through the module and states each.
async fn remove_target(run: &ChildRun<'_>, record: &Path, entry: &Recorded) -> Result<(), Error> {
    let file = PluginRecord::new(record, record_name(entry.place.target));
    match file.uninstall(&[], run.signal)? {
        UninstallOutcome::Refused(refused) => {
            let path = refused.first().map_or(record, |refusal| &refusal.path);
            Err(FatalError::new(messages::record(run.name, path, "uninstall")).into())
        }
        UninstallOutcome::Uninstalled(done) => {
            for folder in &entry.folders {
                if done.kept.contains(&folder.path) {
                    run.out
                        .warn(&messages::modified_kept(run.name, &folder.path))
                        .await?;
                } else {
                    let line = if done.removed.contains(&folder.path) {
                        messages::removed(&folder.path)
                    } else {
                        messages::gone(&folder.path)
                    };
                    run.out.info(&line).await?;
                }
            }
            Ok(())
        }
    }
}

/// `uninstall`: the module removes each target's recorded folders, and the child states each.
pub(super) async fn uninstall_global(
    run: &ChildRun<'_>,
    agent: Option<Target>,
) -> Result<(), Error> {
    let (places, record) = prepare(run, agent)?;
    let acting = acting_places(run, places, false).await?;
    let mut recording = recorded_by(run, &record, acting, "uninstall")?;
    recording.retain(|entry| !entry.folders.is_empty());
    if recording.is_empty() {
        return run.out.success(&messages::none_to_remove(run.name)).await;
    }
    for entry in &recording {
        remove_target(run, &record, entry).await?;
    }
    Ok(())
}
