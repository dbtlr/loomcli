//! The four children: `generate` writes the set to a folder and records nothing; `install`,
//! `update`, and `uninstall` act on the set under the operator's home through the installed-files
//! module, recorded in the plugin's file `manpage.json`.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use loomcli_core::{CommandGraph, Error, Host, Out, RunSignal};

use super::advice::advice;
use super::messages::{self, WritingVerb};
use super::page::{ManPage, man_pages};
use crate::installation::{
    InstallOutcome, InstallRequest, InstalledFile, Observed, PluginRecord, RecordedRead, Refusal,
    RefusalReason, ReplaceOptions, UninstallOutcome, create_directory, digest_of, missing_parents,
    observe, record_directory, replace_file, required_home,
};

/// What a child reads from its action: the application, the run, and the lanes it writes.
pub(super) struct ChildRun<'a> {
    pub(super) graph: &'a CommandGraph,
    pub(super) host: &'a Host,
    pub(super) signal: &'a RunSignal,
    pub(super) out: &'a Out,
}

/// The plugin's file in the installation record, `manpage.json`.
const PLUGIN: &str = "manpage";

/// The permission bits of a folder the plugin creates and of a page it writes, whatever the umask.
const FOLDER_MODE: u32 = 0o755;
const PAGE_MODE: u32 = 0o644;

/// The folder under the home that `install` writes the set to.
const HOME_FOLDER: [&str; 4] = [".local", "share", "man", "man1"];

/// The page files of the set in a folder, as the installed-files module writes them.
fn files_in(folder: &Path, set: Vec<ManPage>) -> Vec<InstalledFile> {
    set.into_iter()
        .map(|page| InstalledFile::new(folder.join(page.file), page.text).mode(PAGE_MODE))
        .collect()
}

/// What a path names, following links, or `None` when nothing is there or a parent is a file. A
/// symbolic link whose target is missing is what is there, read without following it.
fn stat_of(path: &Path) -> io::Result<Option<fs::Metadata>> {
    match fs::metadata(path) {
        Ok(found) => Ok(Some(found)),
        Err(error) if error.kind() == io::ErrorKind::NotADirectory => Ok(None),
        Err(error) if error.kind() == io::ErrorKind::NotFound => match fs::symlink_metadata(path) {
            Ok(found) => Ok(Some(found)),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
                ) =>
            {
                Ok(None)
            }
            Err(error) => Err(error),
        },
        Err(error) => Err(error),
    }
}

/// Whether a path names something other than a folder: the nearest of it and its parents that
/// exists, which is where the plugin would create the rest, is not a folder.
fn is_not_folder(path: &Path) -> io::Result<bool> {
    let mut current = path;
    loop {
        if let Some(found) = stat_of(current)? {
            return Ok(!found.is_dir());
        }
        match current.parent() {
            Some(parent) if parent != current => current = parent,
            _ => return Ok(false),
        }
    }
}

/// `target` resolved against `base` the way a path resolves: an absolute target stands alone, and
/// `.`, `..`, and repeated separators are folded away without reading the file system.
pub(super) fn resolve(base: &Path, target: &str) -> PathBuf {
    let mut resolved = PathBuf::new();
    for component in base.join(target).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                resolved.pop();
            }
            other => resolved.push(other.as_os_str()),
        }
    }
    resolved
}

/// The folder `--out` names, resolved against the working directory, which must be a folder when
/// it exists.
fn out_folder(run: &ChildRun<'_>, out: &str) -> Result<PathBuf, Error> {
    let folder = resolve(&run.host.cwd, out);
    if is_not_folder(&folder)? {
        return Err(messages::not_folder(&run.graph.name, &folder).into());
    }
    Ok(folder)
}

/// `generate`: the folder created with its missing parents when it is missing, then each page
/// written through a staging file and a rename, which replaces a file or a link of that name.
pub(super) async fn generate_pages(run: &ChildRun<'_>, out: &str) -> Result<(), Error> {
    let folder = out_folder(run, out)?;
    let pages = files_in(&folder, man_pages(run.graph)?);
    for directory in missing_parents(&folder.join(PLUGIN))? {
        create_directory(&directory, Some(FOLDER_MODE))?;
    }
    for page in &pages {
        replace_file(
            &page.path,
            &page.content,
            ReplaceOptions::new().maybe_mode(page.mode),
        )?;
    }
    run.out
        .success(&messages::wrote(pages.len(), &folder))
        .await
}

/// What a writing child reads: the plugin's file and what it records.
struct Recorded {
    file: PluginRecord,
    files: Vec<(PathBuf, String)>,
}

/// The record's directory and the plugin's file, or the refusal of either.
fn read_record(run: &ChildRun<'_>, verb: &str) -> Result<Recorded, Error> {
    let name = &run.graph.name;
    let record = record_directory(name, run.host)?;
    let file = PluginRecord::new(record, PLUGIN);
    match file.read()? {
        RecordedRead::Refused(refused) => Err(messages::record(name, &refused.path, verb).into()),
        RecordedRead::Read { files, .. } => Ok(Recorded {
            files: files
                .into_iter()
                .map(|recorded| (recorded.path, recorded.digest))
                .collect(),
            file,
        }),
    }
}

/// Whether the recorded set is the set this run would write: the plugin's file is committed, it
/// records exactly the set's paths, and each page holds its recorded digest and the one it would.
fn is_unchanged(recorded: &Recorded, wanted: &[InstalledFile]) -> Result<bool, Error> {
    if recorded.file.has_pending()? {
        return Ok(false);
    }
    let digests: HashMap<&Path, &str> = recorded
        .files
        .iter()
        .map(|(path, digest)| (path.as_path(), digest.as_str()))
        .collect();
    if digests.len() != wanted.len() {
        return Ok(false);
    }
    for page in wanted {
        let digest = digest_of(&page.content);
        let seen = observe(&page.path)?;
        let holds = matches!(&seen, Observed::File { digest: held, .. } if *held == digest);
        if !holds || digests.get(page.path.as_path()) != Some(&digest.as_str()) {
            return Ok(false);
        }
    }
    Ok(true)
}

/// States each refused page, then fails: nothing was written.
async fn refuse(run: &ChildRun<'_>, verb: WritingVerb, refused: &[Refusal]) -> Result<(), Error> {
    let name = &run.graph.name;
    for Refusal { path, reason } in refused {
        match reason {
            RefusalReason::Damaged | RefusalReason::UnknownFormat => {
                return Err(messages::record(name, path, "install").into());
            }
            RefusalReason::Changed => run.out.warn(&messages::changed(name, path)).await?,
            _ => run.out.warn(&messages::not_installed(name, path)).await?,
        }
    }
    Err(messages::in_the_way(name, verb).into())
}

/// States each recorded page the set no longer holds: removed when unchanged, left in place when
/// changed.
async fn report_removals(
    run: &ChildRun<'_>,
    kept: &[PathBuf],
    removed: &[PathBuf],
) -> Result<(), Error> {
    for path in removed {
        run.out.info(&messages::removed(path)).await?;
    }
    for path in kept {
        run.out.warn(&messages::kept(&run.graph.name, path)).await?;
    }
    Ok(())
}

/// Writes the set into a folder through the module, or states it unchanged.
async fn write_set(
    run: &ChildRun<'_>,
    recorded: &Recorded,
    folder: &Path,
    verb: WritingVerb,
) -> Result<(), Error> {
    let wanted = files_in(folder, man_pages(run.graph)?);
    if is_unchanged(recorded, &wanted)? {
        run.out
            .info(&messages::unchanged(wanted.len(), folder))
            .await?;
        return Ok(());
    }
    let request = InstallRequest::new()
        .files(wanted.clone())
        .directory_mode(FOLDER_MODE);
    let done = match recorded.file.install(&request, run.signal)? {
        InstallOutcome::Refused(refused) => return refuse(run, verb, &refused).await,
        InstallOutcome::Installed(done) => done,
    };
    let line = match verb {
        WritingVerb::Update => messages::updated(wanted.len(), folder),
        WritingVerb::Install => messages::installed(wanted.len(), folder),
    };
    run.out.success(&line).await?;
    report_removals(run, &done.kept, &done.removed).await
}

/// States how to read the pages: `man <name>`, or the line that sets `MANPATH` when man will not
/// find them.
async fn advise_on(run: &ChildRun<'_>, home: &Path) -> Result<(), Error> {
    match advice(home, &run.host.env) {
        None => run.out.info(&messages::read(&run.graph.name)).await,
        Some(advised) => {
            run.out.warn(&messages::advice(&advised.folder)).await?;
            run.out.print(&advised.line).await
        }
    }
}

/// `install`: the set under `<home>/.local/share/man/man1`, then the advice when man will not find
/// it.
pub(super) async fn install_pages(run: &ChildRun<'_>) -> Result<(), Error> {
    let home = required_home(&run.graph.name, run.host)?;
    let recorded = read_record(run, "install")?;
    let folder = resolve(home, &HOME_FOLDER.join("/"));
    write_set(run, &recorded, &folder, WritingVerb::Install).await?;
    advise_on(run, home).await
}

/// The folders the recorded pages sit in, in the order the record lists them.
fn folders_of(files: &[(PathBuf, String)]) -> Vec<PathBuf> {
    let mut folders: Vec<PathBuf> = Vec::new();
    for (path, _) in files {
        let folder = path.parent().map(Path::to_path_buf).unwrap_or_default();
        if !folders.contains(&folder) {
            folders.push(folder);
        }
    }
    folders
}

/// `update`: the set into the folder that holds the recorded pages, which derives nothing from the
/// home.
pub(super) async fn update_pages(run: &ChildRun<'_>) -> Result<(), Error> {
    let name = &run.graph.name;
    let recorded = read_record(run, "install")?;
    let folders = folders_of(&recorded.files);
    let Some((folder, others)) = folders.split_first() else {
        return run.out.success(&messages::none_to_update(name)).await;
    };
    if !others.is_empty() {
        return Err(messages::many_folders(name, &recorded.file.path()).into());
    }
    write_set(run, &recorded, folder, WritingVerb::Update).await
}

/// `uninstall`: the recorded pages removed or kept, and the plugin's file deleted.
pub(super) async fn uninstall_pages(run: &ChildRun<'_>) -> Result<(), Error> {
    let name = &run.graph.name;
    let recorded = read_record(run, "uninstall")?;
    let done = match recorded.file.uninstall(&[], run.signal)? {
        UninstallOutcome::Refused(refused) => {
            let path = refused
                .first()
                .map_or_else(|| recorded.file.path(), |refusal| refusal.path.clone());
            return Err(messages::record(name, &path, "uninstall").into());
        }
        UninstallOutcome::Uninstalled(done) => done,
    };
    if done.removed.is_empty() && done.kept.is_empty() {
        return run.out.success(&messages::none_to_remove(name)).await;
    }
    let mut counts: Vec<(PathBuf, usize)> = Vec::new();
    for path in &done.removed {
        let folder = path.parent().map(Path::to_path_buf).unwrap_or_default();
        match counts.iter_mut().find(|(each, _)| *each == folder) {
            Some((_, count)) => *count += 1,
            None => counts.push((folder, 1)),
        }
    }
    for (folder, count) in &counts {
        run.out
            .success(&messages::removed_from(*count, folder))
            .await?;
    }
    report_removals(run, &done.kept, &[]).await
}
