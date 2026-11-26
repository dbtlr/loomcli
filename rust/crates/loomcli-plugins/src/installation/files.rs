//! The installed-files module's operations on one plugin's file: install, uninstall, the reads a
//! plugin makes before it acts, and the registration writes the MCP plugin makes around an
//! agent's own call.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::{fmt, io};

use super::disk::{self, Observed, ReplaceOptions, observe};
use super::folders::{
    FolderFile, changed_references, folder_digests, recovered_folder, remove_folder_leftovers,
    remove_whole, write_folder,
};
use super::lines::{
    InstalledLine, LineAction, LineListing, StartupLinesOutcome, held_line, outcome_of, plan_lines,
    recovered_line, unlisted_actions,
};
use super::reach::write_failure;
use super::record::{
    Committed, CommittedFile, FolderPrior, Pending, PendingFile, PendingFolder,
    PendingRegistration, PluginFile, PluginFileRead, RecordProblem, RecordedFolder,
    RecordedRegistration, StartupLine, plugin_file_path, read_plugin_file, write_plugin_file,
};
use super::startup::NotFile;
use super::{Cancellation, InstallationError, read_signal};

/// One file an install writes: its absolute, normalized path, the content it will hold, and the
/// permission bits it is written with whatever the umask, when the plugin names any.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstalledFile {
    /// The file's absolute path.
    pub path: PathBuf,
    /// The bytes it will hold.
    pub content: Vec<u8>,
    /// The permission bits, or `None` to follow the umask.
    pub mode: Option<u32>,
}

impl InstalledFile {
    /// The file at `path` holding `content`, with no mode named.
    pub fn new(path: impl Into<PathBuf>, content: impl Into<Vec<u8>>) -> Self {
        Self {
            path: path.into(),
            content: content.into(),
            mode: None,
        }
    }

    /// Names the permission bits the file takes whatever the umask.
    #[must_use]
    pub fn mode(self, mode: u32) -> Self {
        Self {
            mode: Some(mode),
            ..self
        }
    }
}

/// One folder an install writes: its absolute, normalized path and the files it holds, which the
/// install writes whole in place of whatever the folder held.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstalledFolder {
    /// The folder's absolute path.
    pub path: PathBuf,
    /// The files it holds.
    pub files: Vec<FolderFile>,
}

impl InstalledFolder {
    /// The folder at `path` holding `files`.
    pub fn new(path: impl Into<PathBuf>, files: impl IntoIterator<Item = FolderFile>) -> Self {
        Self {
            path: path.into(),
            files: files.into_iter().collect(),
        }
    }
}

/// Why a path refuses an install or uninstall.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefusalReason {
    /// A file or folder the plugin's file does not record: `unrecorded`.
    Unrecorded,
    /// A recorded file whose digest changed since: `changed`.
    Changed,
    /// A symbolic link, or a startup file that is a link to nothing: `link`.
    Link,
    /// A directory: `directory`.
    Directory,
    /// Another kind of file, such as a FIFO or a device: `special`.
    Special,
    /// The plugin's own file is not the file's shape: `damaged`.
    Damaged,
    /// The plugin's own file holds a `format` the module does not know: `unknown-format`.
    UnknownFormat,
}

impl RefusalReason {
    /// The reason as the reference spells it, such as `unknown-format`.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            RefusalReason::Unrecorded => "unrecorded",
            RefusalReason::Changed => "changed",
            RefusalReason::Link => "link",
            RefusalReason::Directory => "directory",
            RefusalReason::Special => "special",
            RefusalReason::Damaged => "damaged",
            RefusalReason::UnknownFormat => "unknown-format",
        }
    }
}

impl fmt::Display for RefusalReason {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl From<RecordProblem> for RefusalReason {
    fn from(problem: RecordProblem) -> Self {
        match problem {
            RecordProblem::Damaged => RefusalReason::Damaged,
            RecordProblem::UnknownFormat => RefusalReason::UnknownFormat,
        }
    }
}

impl From<NotFile> for RefusalReason {
    fn from(reason: NotFile) -> Self {
        match reason {
            NotFile::Link => RefusalReason::Link,
            NotFile::Directory => RefusalReason::Directory,
            NotFile::Special => RefusalReason::Special,
        }
    }
}

/// A path that refuses an install or uninstall, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    /// The refused path: a target, a startup file, or the plugin's own file.
    pub path: PathBuf,
    /// Why it refuses.
    pub reason: RefusalReason,
    /// The relative path of a changed command reference inside a refused folder.
    pub file: Option<String>,
}

impl Refusal {
    fn new(path: impl Into<PathBuf>, reason: RefusalReason) -> Self {
        Self {
            path: path.into(),
            reason,
            file: None,
        }
    }
}

/// What an install did, for the plugin's Command to state.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Installed {
    /// The files and the folders written, files first, in the order listed.
    pub written: Vec<PathBuf>,
    /// Recorded files the install no longer lists, removed because no one changed them, then
    /// recorded folders it no longer lists.
    pub removed: Vec<PathBuf>,
    /// Recorded files and folders the install no longer lists and keeps because someone edited them.
    pub kept: Vec<PathBuf>,
    /// Unrecorded or modified folder paths the force mode took over. `None` when it took none.
    pub replaced: Option<Vec<PathBuf>>,
    /// What happened to each startup line listed, recorded, or released; `None` when there was
    /// none.
    pub lines: Option<StartupLinesOutcome>,
}

/// What an install answers: the refused paths, with nothing written, or what was done.
// An outcome is built once per install and matched at once; boxing it buys nothing.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InstallOutcome {
    /// Every path that refuses the install. Nothing was written.
    Refused(Vec<Refusal>),
    /// What the install did.
    Installed(Installed),
}

/// What happened to each recorded startup line in an uninstall: removed, no longer held, or
/// released.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UninstalledLines {
    /// Recorded lines removed.
    pub removed: Vec<StartupLine>,
    /// Recorded lines the file no longer holds.
    pub no_longer_held: Vec<StartupLine>,
    /// Recorded lines the plugin released.
    pub released: Vec<StartupLine>,
}

/// What an uninstall did, for the plugin's Command to state.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Uninstalled {
    /// Recorded files removed because no one changed them, then recorded folders that were there.
    pub removed: Vec<PathBuf>,
    /// Recorded files or folders kept because someone edited them.
    pub kept: Vec<PathBuf>,
    /// What happened to each recorded startup line; `None` when the plugin's file records none.
    pub lines: Option<UninstalledLines>,
}

/// What an uninstall answers: the refusal of the plugin's own file, with nothing changed, or what
/// was done.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UninstallOutcome {
    /// The plugin's own file is damaged or of an unknown format. Nothing was changed.
    Refused(Vec<Refusal>),
    /// What the uninstall did.
    Uninstalled(Uninstalled),
}

/// What an install writes: files, folders, startup lines, or any of them, with the startup files
/// whose recorded lines the plugin releases, the force mode, the update mark, and the permission
/// bits of the directories it creates. Each target path is absolute and normalized, and each
/// startup line one line of text, as the first-party plugins build them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[must_use]
pub struct InstallRequest {
    /// The files to write.
    pub files: Vec<InstalledFile>,
    /// The folders to write whole.
    pub folders: Vec<InstalledFolder>,
    /// The startup lines to hold.
    pub lines: Vec<InstalledLine>,
    /// The startup files whose recorded lines are dropped without reading or writing the file.
    pub release: Vec<PathBuf>,
    /// Whether an unrecorded folder at a listed folder's path is replaced in place of refusing;
    /// the skills plugin alone sets it, for an operator's `--force`.
    pub force: bool,
    /// Whether the install is an update, which adds no recorded line its startup file no longer
    /// holds and drops it from the plugin's file.
    pub update: bool,
    /// The permission bits of each directory the install creates, whatever the umask, or `None`
    /// to follow the umask.
    pub directory_mode: Option<u32>,
}

impl InstallRequest {
    /// An install that writes nothing yet.
    pub fn new() -> Self {
        Self::default()
    }

    /// Lists the files to write.
    pub fn files(self, files: impl IntoIterator<Item = InstalledFile>) -> Self {
        Self {
            files: files.into_iter().collect(),
            ..self
        }
    }

    /// Lists the folders to write whole.
    pub fn folders(self, folders: impl IntoIterator<Item = InstalledFolder>) -> Self {
        Self {
            folders: folders.into_iter().collect(),
            ..self
        }
    }

    /// Lists the startup lines to hold.
    pub fn lines(self, lines: impl IntoIterator<Item = InstalledLine>) -> Self {
        Self {
            lines: lines.into_iter().collect(),
            ..self
        }
    }

    /// Lists the startup files whose recorded lines the plugin releases.
    pub fn release(self, release: impl IntoIterator<Item = impl Into<PathBuf>>) -> Self {
        Self {
            release: release.into_iter().map(Into::into).collect(),
            ..self
        }
    }

    /// Sets the force mode, which only the skills plugin passes.
    pub fn force(self, force: bool) -> Self {
        Self { force, ..self }
    }

    /// Marks the install as an update.
    pub fn update(self, update: bool) -> Self {
        Self { update, ..self }
    }

    /// Names the permission bits of each directory the install creates.
    pub fn directory_mode(self, mode: u32) -> Self {
        Self {
            directory_mode: Some(mode),
            ..self
        }
    }
}

/// What a plugin's file records, read without writing: its files, folders, and startup lines, or
/// the refusal of its file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RecordedRead {
    /// The plugin's file is damaged or of an unknown format.
    Refused(Refusal),
    /// What it records; every list is empty for a missing file.
    Read {
        /// Each recorded file with its digest.
        files: Vec<CommittedFile>,
        /// Each recorded folder.
        folders: Vec<RecordedFolder>,
        /// Each recorded startup line.
        lines: Vec<StartupLine>,
    },
}

/// What a plugin's file lists as registered, or the refusal of its file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RegistrationRead {
    /// The plugin's file is damaged or of an unknown format.
    Refused(Refusal),
    /// The registration it records, if any.
    Read(Option<RecordedRegistration>),
}

/// One plugin's file in an installation record: `<record>/<plugin>.json`. Each operation reads
/// and writes that file alone; the record directory is the one
/// [`record_directory`](super::record_directory) resolves, and the plugin's name is its own, or
/// its name and a target for a plugin with independent targets, such as `skills.claude`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PluginRecord {
    record: PathBuf,
    plugin: String,
}

/// What an install will do, written as the pending plugin's file before it touches any target.
struct InstallPlan {
    pending: Pending,
    created: Vec<PathBuf>,
    /// The listed files already there with the digest the install would write, which it leaves.
    unchanged: BTreeSet<PathBuf>,
    removals: Vec<CommittedFile>,
    folder_removals: Vec<RecordedFolder>,
    replaced: Vec<PathBuf>,
    lines: Vec<LineAction>,
    committed: Committed,
}

/// The entries in order, each once.
fn unique<T: Ord + Clone>(entries: impl IntoIterator<Item = T>) -> Vec<T> {
    let mut seen = BTreeSet::new();
    entries
        .into_iter()
        .filter(|entry| seen.insert(entry.clone()))
        .collect()
}

/// The refusal a target is, or none for an absent target or a recorded file with its digest
/// unchanged.
fn refusal_of(path: &Path, seen: &Observed, digests: &HashMap<&Path, &str>) -> Option<Refusal> {
    match seen {
        Observed::Absent => None,
        Observed::File { digest, .. } => match digests.get(path) {
            None => Some(Refusal::new(path, RefusalReason::Unrecorded)),
            Some(recorded) if *recorded == digest => None,
            Some(_) => Some(Refusal::new(path, RefusalReason::Changed)),
        },
        Observed::Link => Some(Refusal::new(path, RefusalReason::Link)),
        Observed::Directory => Some(Refusal::new(path, RefusalReason::Directory)),
        Observed::Special => Some(Refusal::new(path, RefusalReason::Special)),
    }
}

/// The recorded files by path, with their digests.
fn digests_of(files: &[CommittedFile]) -> HashMap<&Path, &str> {
    files
        .iter()
        .map(|file| (file.path.as_path(), file.digest.as_str()))
        .collect()
}

/// A pending file resolved by what is on disk: kept with the digest it holds when that is the
/// intended or the prior one, and dropped when it is gone or holds any other.
fn recovered_file(entry: &PendingFile) -> Result<Option<CommittedFile>, InstallationError> {
    Ok(match observe(&entry.path)? {
        Observed::File { digest, .. }
            if Some(&digest) == entry.intended.as_ref()
                || Some(&digest) == entry.prior.as_ref() =>
        {
            Some(CommittedFile {
                path: entry.path.clone(),
                digest,
            })
        }
        _ => None,
    })
}

/// A pending registration resolved without reading the agent: the command line it intended, or
/// the one it held before when it was being removed, and none when that is `None` too.
fn recovered_registration(entry: &PendingRegistration) -> Option<RecordedRegistration> {
    entry
        .intended
        .as_ref()
        .or(entry.prior.as_ref())
        .map(|command| RecordedRegistration {
            name: entry.name.clone(),
            command: command.clone(),
        })
}

/// The entries `resolve` keeps, in order.
fn kept<T, R>(
    entries: &[T],
    resolve: impl Fn(&T) -> Result<Option<R>, InstallationError>,
) -> Result<Vec<R>, InstallationError> {
    let mut out = Vec::new();
    for entry in entries {
        out.extend(resolve(entry)?);
    }
    Ok(out)
}

/// Resolves a pending plugin's file by what is on disk: a path holding the intended or the prior
/// digest stays recorded with it, and one that is gone or holds any other digest is dropped. A
/// listed directory that exists stays. A folder keeps the intended digests of a completed swap,
/// or the prior ownership when the swap stopped and something still holds its path. A pending startup line keeps the intended text or the prior one, whichever its file
/// holds, or no line. Leftover staging files, of targets and of startup files, and the staging and
/// retired folders beside each listed folder are removed, and the result is written as committed.
fn recover(path: &Path, pending: &Pending) -> Result<Committed, InstallationError> {
    for entry in &pending.files {
        disk::remove_staging_files(&entry.path)?;
    }
    for folder in &pending.folders {
        remove_folder_leftovers(&folder.path)?;
    }
    let mut directories = Vec::new();
    for directory in &pending.directories {
        if observe(directory)? == Observed::Directory {
            directories.push(directory.clone());
        }
    }
    let committed = Committed {
        directories,
        files: kept(&pending.files, recovered_file)?,
        folders: kept(&pending.folders, recovered_folder)?,
        lines: kept(&pending.lines, recovered_line)?,
        registrations: pending
            .registrations
            .iter()
            .filter_map(recovered_registration)
            .collect(),
    };
    write_plugin_file(path, &PluginFile::Committed(committed.clone()))?;
    Ok(committed)
}

/// Removes each recorded file whose digest is unchanged and keeps each one someone changed.
fn remove_recorded(
    files: &[CommittedFile],
) -> Result<(Vec<PathBuf>, Vec<PathBuf>), InstallationError> {
    let mut removed = Vec::new();
    let mut kept = Vec::new();
    for file in files {
        match observe(&file.path)? {
            Observed::File { digest, .. } if digest == file.digest => {
                std::fs::remove_file(&file.path)?;
                removed.push(file.path.clone());
            }
            Observed::Absent => {}
            _ => kept.push(file.path.clone()),
        }
    }
    Ok((removed, kept))
}

/// Removes each unchanged recorded folder whole and leaves a folder with edited references.
fn remove_folders(
    folders: &[RecordedFolder],
) -> Result<(Vec<PathBuf>, Vec<PathBuf>), InstallationError> {
    let mut removed = Vec::new();
    let mut kept = Vec::new();
    for folder in folders {
        if !changed_references(folder)?.is_empty() {
            kept.push(folder.path.clone());
        } else if remove_whole(&folder.path)? {
            removed.push(folder.path.clone());
        }
    }
    Ok((removed, kept))
}

/// Removes each recorded directory that is empty, deepest first, so a parent empties before its
/// turn.
fn remove_directories(directories: &[PathBuf]) -> Result<(), InstallationError> {
    let mut deepest_first = directories.to_vec();
    deepest_first.sort_by_key(|directory| std::cmp::Reverse(directory.as_os_str().len()));
    for directory in &deepest_first {
        disk::remove_empty_directory(directory)?;
    }
    Ok(())
}

/// Each unrecorded listed folder and each changed reference in a listed recorded folder.
pub fn folder_refusals(
    paths: &[&Path],
    folders: &[RecordedFolder],
) -> Result<Vec<Refusal>, InstallationError> {
    let recorded: BTreeSet<&Path> = folders.iter().map(|folder| folder.path.as_path()).collect();
    let mut refused = Vec::new();
    for path in paths {
        if !recorded.contains(path) && disk::exists(path)? {
            refused.push(Refusal::new(*path, RefusalReason::Unrecorded));
        }
    }
    for folder in folders
        .iter()
        .filter(|folder| paths.contains(&folder.path.as_path()))
    {
        refused.extend(changed_references(folder)?.into_iter().map(|file| Refusal {
            path: folder.path.clone(),
            reason: RefusalReason::Changed,
            file: Some(file),
        }));
    }
    Ok(refused)
}

/// Checks reachability before a recorded path can be dropped, even when a file blocks its parent.
fn read_reachable(path: &Path) -> io::Result<PluginFileRead> {
    let read = read_plugin_file(path)?;
    match &read {
        PluginFileRead::Read(PluginFile::Committed(file)) => {
            check_reachable(
                file.files.iter().map(|entry| &entry.path),
                file.folders.iter().map(|entry| &entry.path),
                &file.directories,
            )?;
        }
        PluginFileRead::Read(PluginFile::Pending(file)) => {
            check_reachable(
                file.files.iter().map(|entry| &entry.path),
                file.folders.iter().map(|entry| &entry.path),
                &file.directories,
            )?;
        }
        _ => {}
    }
    Ok(read)
}

fn check_reachable<'a>(
    files: impl Iterator<Item = &'a PathBuf>,
    folders: impl Iterator<Item = &'a PathBuf>,
    directories: &'a [PathBuf],
) -> io::Result<()> {
    for path in files.chain(folders).chain(directories) {
        disk::lstat(path)?;
    }
    Ok(())
}

/// The refusal each target path would meet from an install against the recorded files, read
/// without writing: none for an absent target or a recorded file with its digest unchanged.
pub fn target_refusals(
    paths: &[&Path],
    files: &[CommittedFile],
) -> Result<Vec<Refusal>, InstallationError> {
    let digests = digests_of(files);
    let mut refusals = Vec::new();
    for path in paths {
        refusals.extend(refusal_of(path, &observe(path)?, &digests));
    }
    Ok(refusals)
}

/// Every target an install lists, read against what the plugin's file records.
struct Targets {
    /// Each listed file with the digest it holds now, `None` when it holds nothing.
    priors: Vec<Option<String>>,
    refused: Vec<Refusal>,
    /// The unrecorded or modified folders the force mode takes over.
    replaced: Vec<PathBuf>,
    lines: Vec<LineAction>,
}

impl PluginRecord {
    /// The file of `plugin` in the record directory `record`.
    pub fn new(record: impl Into<PathBuf>, plugin: impl Into<String>) -> Self {
        Self {
            record: record.into(),
            plugin: plugin.into(),
        }
    }

    /// The plugin's file's path: `<record>/<plugin>.json`.
    #[must_use]
    pub fn path(&self) -> PathBuf {
        plugin_file_path(&self.record, &self.plugin)
    }

    /// What the plugin's file records, a missing one recording nothing and a pending one recovered
    /// first, or the refusal of a file the module cannot read. Leftover staging files of a
    /// plugin's file it can read are removed.
    fn recorded(&self) -> Result<Result<Committed, Refusal>, InstallationError> {
        let path = self.path();
        let file = match read_reachable(&path)? {
            PluginFileRead::Refused(problem) => {
                return Ok(Err(Refusal::new(path, problem.into())));
            }
            PluginFileRead::Missing => None,
            PluginFileRead::Read(file) => Some(file),
        };
        disk::remove_staging_files(&path)?;
        Ok(Ok(match file {
            None => Committed::default(),
            Some(PluginFile::Committed(committed)) => committed,
            Some(PluginFile::Pending(pending)) => recover(&path, &pending)?,
        }))
    }

    /// Installs the plugin's files, folders, and startup lines.
    ///
    /// It recovers a pending plugin's file first, then checks every target: a file target that is
    /// absent, or a regular file the plugin recorded with its digest unchanged, may be written,
    /// and a folder target that is absent or recorded may be replaced when its generated references
    /// have no edits. Any
    /// other target refuses the whole install, which writes nothing and answers
    /// [`InstallOutcome::Refused`] with every such path, except an unrecorded folder target under
    /// the force mode, which is replaced and recorded. A damaged plugin's file, or one of an
    /// unknown format, refuses the same way. It reads `signal` before the pending write and, once
    /// it has begun, does not stop between targets.
    ///
    /// Each file goes through a staging file and a rename, unless it is already there with the
    /// digest it would be written with, each folder through a staging folder and renames, each
    /// recorded file the install no longer lists is removed when no one changed it, and each
    /// recorded folder it no longer lists is removed whole when its generated references have no edits. Each listed startup line is added,
    /// recorded as held, or replaced where it stands, each recorded line it no longer lists is
    /// removed, and each released line is dropped.
    ///
    /// # Errors
    ///
    /// [`InstallationError::Cancelled`] with the signal's error when `signal` was cancelled before
    /// the first write, a
    /// startup-file error for a listed or recorded startup file the module cannot read, and the
    /// runtime's [`std::io::Error`] for a file-system call that fails; a pending plugin's file it
    /// leaves is recovered on the next run.
    pub fn install(
        &self,
        request: &InstallRequest,
        signal: &dyn Cancellation,
    ) -> Result<InstallOutcome, InstallationError> {
        let path = self.path();
        let committed = match self.recorded()? {
            Ok(committed) => committed,
            Err(refusal) => return Ok(InstallOutcome::Refused(vec![refusal])),
        };
        let targets = read_targets(request, &committed)?;
        if !targets.refused.is_empty() {
            return Ok(InstallOutcome::Refused(targets.refused));
        }
        let plan = plan_install(request, &committed, targets)?;
        read_signal(signal)?;
        carry_out(&path, &plan, request)
    }

    /// Uninstalls the plugin's files, folders, and startup lines.
    ///
    /// It recovers a pending plugin's file first, removes each recorded file whose digest is
    /// unchanged, keeps each one someone changed, removes each recorded folder with unchanged
    /// generated references whole, removes each
    /// recorded startup line from its startup file, removes each recorded directory that is then
    /// empty, deepest first, and deletes the plugin's file. A line whose startup file `release`
    /// names is dropped without reading or writing that file, and a startup file that no longer
    /// holds its line is reported. It reads `signal` before the first removal. A path already gone
    /// is no error, and a startup file is never removed. A missing plugin's file records nothing,
    /// so nothing is removed and nothing is written.
    ///
    /// # Errors
    ///
    /// As [`PluginRecord::install`].
    pub fn uninstall(
        &self,
        release: &[PathBuf],
        signal: &dyn Cancellation,
    ) -> Result<UninstallOutcome, InstallationError> {
        let release: BTreeSet<&Path> = release.iter().map(PathBuf::as_path).collect();
        let path = self.path();
        let committed = match self.recorded()? {
            Ok(committed) => committed,
            Err(refusal) => return Ok(UninstallOutcome::Refused(vec![refusal])),
        };
        let lines = unlisted_actions(&committed.lines, &release)?;
        read_signal(signal)?;
        let (removed, kept) = remove_recorded(&committed.files)?;
        let (removed_folders, kept_folders) = remove_folders(&committed.folders)?;
        for action in &lines {
            action.apply()?;
        }
        remove_directories(&committed.directories)?;
        disk::remove_file_if_present(&path)?;
        Ok(UninstallOutcome::Uninstalled(Uninstalled {
            removed: removed.into_iter().chain(removed_folders).collect(),
            kept: kept.into_iter().chain(kept_folders).collect(),
            lines: (!lines.is_empty()).then(|| {
                let outcome = outcome_of(&lines);
                UninstalledLines {
                    removed: outcome.removed,
                    no_longer_held: outcome.no_longer_held,
                    released: outcome.released,
                }
            }),
        }))
    }

    /// What the plugin's file records, read without writing anything: each recorded file with its
    /// digest, each recorded folder, and each recorded startup line, none for a missing file, and
    /// for a pending file what recovery would keep, reading each pending line's startup file. A
    /// damaged file or one of an unknown format refuses, as it refuses an install or uninstall.
    ///
    /// # Errors
    ///
    /// The runtime's error for a read that fails, or a startup-file error for a pending line's
    /// file the module cannot read.
    pub fn read(&self) -> Result<RecordedRead, InstallationError> {
        let path = self.path();
        Ok(match read_reachable(&path)? {
            PluginFileRead::Refused(problem) => {
                RecordedRead::Refused(Refusal::new(path, problem.into()))
            }
            PluginFileRead::Missing => RecordedRead::Read {
                files: Vec::new(),
                folders: Vec::new(),
                lines: Vec::new(),
            },
            PluginFileRead::Read(PluginFile::Committed(committed)) => RecordedRead::Read {
                files: committed.files,
                folders: committed.folders,
                lines: committed.lines,
            },
            PluginFileRead::Read(PluginFile::Pending(pending)) => RecordedRead::Read {
                files: kept(&pending.files, recovered_file)?,
                folders: kept(&pending.folders, recovered_folder)?,
                lines: kept(&pending.lines, held_line)?,
            },
        })
    }

    /// The directories the plugin's file records the module created, read without writing: for a
    /// pending file, those that exist, as recovery keeps them, and none for a missing, damaged, or
    /// unknown file. A plugin that keeps one file per shell or target reads them to hand a
    /// directory two of its files share to the file that outlives the other.
    ///
    /// # Errors
    ///
    /// The runtime's error for a read that fails.
    pub fn directories(&self) -> Result<Vec<PathBuf>, InstallationError> {
        Ok(match read_reachable(&self.path())? {
            PluginFileRead::Read(PluginFile::Committed(committed)) => committed.directories,
            PluginFileRead::Read(PluginFile::Pending(pending)) => {
                let mut existing = Vec::new();
                for directory in pending.directories {
                    if observe(&directory)? == Observed::Directory {
                        existing.push(directory);
                    }
                }
                existing
            }
            PluginFileRead::Missing | PluginFileRead::Refused(_) => Vec::new(),
        })
    }

    /// Adds directories to those the plugin's file records the module created, so the plugin's own
    /// uninstall removes each once it is empty: a plugin that keeps one file per shell or target
    /// hands a directory two of its files share to the file that outlives the other. A pending
    /// file is recovered first. Answers whether the file records them; a missing, damaged, or
    /// unknown file records none and is left as it is.
    ///
    /// # Errors
    ///
    /// As [`PluginRecord::install`], without the cancellation.
    pub fn adopt_directories(&self, directories: &[PathBuf]) -> Result<bool, InstallationError> {
        let path = self.path();
        if !matches!(read_reachable(&path)?, PluginFileRead::Read(_)) {
            return Ok(false);
        }
        let Ok(committed) = self.recorded()? else {
            return Ok(false);
        };
        let adopted = unique(committed.directories.iter().chain(directories).cloned());
        if adopted.len() != committed.directories.len() {
            write_plugin_file(
                &path,
                &PluginFile::Committed(Committed {
                    directories: adopted,
                    ..committed
                }),
            )?;
        }
        Ok(true)
    }

    /// Whether the plugin's file is `pending`, which an install or uninstall resolves before it
    /// acts, read without writing. A missing, damaged, or unknown file is not pending.
    ///
    /// # Errors
    ///
    /// The runtime's error for a read that fails.
    pub fn has_pending(&self) -> Result<bool, InstallationError> {
        Ok(matches!(
            read_reachable(&self.path())?,
            PluginFileRead::Read(PluginFile::Pending(_))
        ))
    }

    /// The registration the plugin's file records, read without writing: none for a missing file,
    /// and for a pending file the one recovery would keep. A damaged file or one of an unknown
    /// format refuses, as it refuses an install or uninstall.
    ///
    /// # Errors
    ///
    /// The runtime's error for a read that fails.
    pub fn read_registration(&self) -> Result<RegistrationRead, InstallationError> {
        let path = self.path();
        Ok(match read_reachable(&path)? {
            PluginFileRead::Refused(problem) => {
                RegistrationRead::Refused(Refusal::new(path, problem.into()))
            }
            PluginFileRead::Missing => RegistrationRead::Read(None),
            PluginFileRead::Read(PluginFile::Committed(committed)) => {
                RegistrationRead::Read(committed.registrations.into_iter().next())
            }
            PluginFileRead::Read(PluginFile::Pending(pending)) => RegistrationRead::Read(
                pending
                    .registrations
                    .iter()
                    .find_map(recovered_registration),
            ),
        })
    }

    /// Writes the plugin's file pending, before the agent's call that adds or removes the
    /// registration `name`: `prior` is the command line recorded before, `None` when the file
    /// recorded none, and `intended` the one the call will leave, `None` when the call removes it.
    ///
    /// # Errors
    ///
    /// The runtime's error for a write that fails, or a path that is not UTF-8.
    pub fn write_pending_registration(
        &self,
        name: &str,
        prior: Option<&[String]>,
        intended: Option<&[String]>,
    ) -> Result<(), InstallationError> {
        write_plugin_file(
            &self.path(),
            &PluginFile::Pending(Pending {
                registrations: vec![PendingRegistration {
                    name: name.to_owned(),
                    prior: prior.map(<[String]>::to_vec),
                    intended: intended.map(<[String]>::to_vec),
                }],
                ..Pending::default()
            }),
        )
    }

    /// Writes the plugin's file committed, once the agent's call settled, with the registration
    /// the agent holds now.
    ///
    /// # Errors
    ///
    /// The runtime's error for a write that fails.
    pub fn write_committed_registration(
        &self,
        name: &str,
        command: &[String],
    ) -> Result<(), InstallationError> {
        write_plugin_file(
            &self.path(),
            &PluginFile::Committed(Committed {
                registrations: vec![RecordedRegistration {
                    name: name.to_owned(),
                    command: command.to_vec(),
                }],
                ..Committed::default()
            }),
        )
    }

    /// Removes the staging files a killed write left beside the plugin's file, which it never
    /// reads.
    ///
    /// # Errors
    ///
    /// The runtime's error for a removal that fails.
    pub fn remove_staging(&self) -> Result<(), InstallationError> {
        Ok(disk::remove_staging_files(&self.path())?)
    }

    /// Deletes the plugin's file, which records nothing once nothing is registered. A file already
    /// gone is no error.
    ///
    /// # Errors
    ///
    /// The runtime's error for a removal that fails.
    pub fn delete(&self) -> Result<(), InstallationError> {
        Ok(disk::remove_file_if_present(&self.path())?)
    }
}

/// Every target an install lists, read against what the plugin's file records: each file
/// observed, the refusals of every kind of target, the unrecorded folders the force mode takes
/// over, and what the install does to each startup line.
fn read_targets(
    request: &InstallRequest,
    committed: &Committed,
) -> Result<Targets, InstallationError> {
    let observed = request
        .files
        .iter()
        .map(|file| observe(&file.path))
        .collect::<Result<Vec<_>, _>>()?;
    let folder_paths: Vec<&Path> = request
        .folders
        .iter()
        .map(|folder| folder.path.as_path())
        .collect();
    let folder_refusals = folder_refusals(&folder_paths, &committed.folders)?;
    let replaced = unique(folder_refusals.iter().map(|refusal| refusal.path.clone()));
    let lines = plan_lines(
        &LineListing {
            lines: &request.lines,
            release: request.release.iter().map(PathBuf::as_path).collect(),
            update: request.update,
        },
        &committed.lines,
    )?;
    let digests = digests_of(&committed.files);
    let mut refused: Vec<Refusal> = request
        .files
        .iter()
        .zip(&observed)
        .filter_map(|(file, seen)| refusal_of(&file.path, seen, &digests))
        .collect();
    if !request.force {
        refused.extend(folder_refusals);
    }
    refused.extend(
        lines
            .refused
            .into_iter()
            .map(|refusal| Refusal::new(refusal.path, refusal.reason.into())),
    );
    Ok(Targets {
        priors: observed
            .into_iter()
            .map(|seen| match seen {
                Observed::File { digest, .. } => Some(digest),
                _ => None,
            })
            .collect(),
        refused,
        replaced,
        lines: lines.actions,
    })
}

/// The plan for the targets an install writes. The pending file lists every folder recorded
/// before and every folder listed now, so a folder stays recorded wherever a kill leaves the
/// install; each missing directory above a target or a startup file the install creates is
/// recorded as a directory the module created.
fn plan_install(
    request: &InstallRequest,
    committed: &Committed,
    targets: Targets,
) -> Result<InstallPlan, InstallationError> {
    let listed: BTreeSet<&Path> = request
        .files
        .iter()
        .map(|file| file.path.as_path())
        .collect();
    let listed_folders: BTreeSet<&Path> = request
        .folders
        .iter()
        .map(|folder| folder.path.as_path())
        .collect();
    let mut parents = Vec::new();
    for path in request
        .files
        .iter()
        .map(|file| &file.path)
        .chain(request.folders.iter().map(|folder| &folder.path))
    {
        parents.extend(disk::missing_parents(path)?);
    }
    for action in &targets.lines {
        parents.extend(action.created_parents()?);
    }
    let created = unique(parents);
    let directories = unique(committed.directories.iter().chain(&created).cloned());
    let removals: Vec<CommittedFile> = committed
        .files
        .iter()
        .filter(|file| !listed.contains(file.path.as_path()))
        .cloned()
        .collect();
    let written: Vec<PendingFile> = request
        .files
        .iter()
        .zip(targets.priors)
        .map(|(file, prior)| PendingFile {
            path: file.path.clone(),
            prior,
            intended: Some(disk::digest_of(&file.content)),
        })
        .collect();
    let unchanged = written
        .iter()
        .filter(|entry| entry.prior == entry.intended)
        .map(|entry| entry.path.clone())
        .collect();
    let committed_files = written
        .iter()
        .map(|entry| CommittedFile {
            path: entry.path.clone(),
            digest: entry.intended.clone().unwrap_or_default(),
        })
        .collect();
    let pending_files = written
        .into_iter()
        .chain(removals.iter().map(|file| PendingFile {
            path: file.path.clone(),
            prior: Some(file.digest.clone()),
            intended: None,
        }))
        .collect();
    let folder_removals = committed
        .folders
        .iter()
        .filter(|folder| !listed_folders.contains(folder.path.as_path()))
        .cloned()
        .collect();
    let committed_folders: Vec<_> = request
        .folders
        .iter()
        .map(|folder| RecordedFolder {
            path: folder.path.clone(),
            files: Some(folder_digests(&folder.files)),
        })
        .collect();
    let pending_folders = committed
        .folders
        .iter()
        .map(|folder| &folder.path)
        .chain(
            committed_folders
                .iter()
                .filter(|next| !committed.folders.iter().any(|held| held.path == next.path))
                .map(|folder| &folder.path),
        )
        .map(|path| {
            let prior = committed.folders.iter().find(|held| held.path == *path);
            let intended = committed_folders.iter().find(|next| next.path == *path);
            PendingFolder {
                path: path.clone(),
                prior: Some(match prior {
                    Some(held) => held
                        .files
                        .clone()
                        .map_or(FolderPrior::Path, FolderPrior::Files),
                    None => FolderPrior::Unrecorded,
                }),
                intended: intended.and_then(|next| next.files.clone()),
            }
        })
        .collect();
    Ok(InstallPlan {
        pending: Pending {
            directories: directories.clone(),
            files: pending_files,
            folders: pending_folders,
            lines: targets
                .lines
                .iter()
                .filter_map(LineAction::pending)
                .collect(),
            registrations: Vec::new(),
        },
        committed: Committed {
            directories,
            files: committed_files,
            folders: committed_folders,
            lines: targets
                .lines
                .iter()
                .filter_map(LineAction::committed)
                .collect(),
            registrations: Vec::new(),
        },
        created,
        unchanged,
        removals,
        folder_removals,
        replaced: targets.replaced,
        lines: targets.lines,
    })
}

/// The writes of an install, which do not stop between targets once the pending file is written:
/// the missing parents with the directory mode the plugin names, then the files, the folders, and
/// the startup lines, in that order, then the removals, then the committed file. A file already
/// there with the digest it would be written with is left in place.
fn carry_out(
    path: &Path,
    plan: &InstallPlan,
    request: &InstallRequest,
) -> Result<InstallOutcome, InstallationError> {
    write_plugin_file(path, &PluginFile::Pending(plan.pending.clone()))?;
    for directory in &plan.created {
        disk::create_directory(directory, request.directory_mode)
            .map_err(|error| write_failure(directory, error))?;
    }
    for file in request
        .files
        .iter()
        .filter(|file| !plan.unchanged.contains(&file.path))
    {
        disk::replace_file(
            &file.path,
            &file.content,
            ReplaceOptions::new().maybe_mode(file.mode),
        )
        .map_err(|error| error.map_io(|error| write_failure(&file.path, error)))?;
    }
    for folder in &request.folders {
        write_folder(&folder.path, &folder.files)?;
    }
    for action in &plan.lines {
        action.apply()?;
    }
    let (removed, kept) = remove_recorded(&plan.removals)?;
    let (removed_folders, kept_folders) = remove_folders(&plan.folder_removals)?;
    write_plugin_file(path, &PluginFile::Committed(plan.committed.clone()))?;
    Ok(InstallOutcome::Installed(Installed {
        written: request
            .files
            .iter()
            .map(|file| file.path.clone())
            .chain(request.folders.iter().map(|folder| folder.path.clone()))
            .collect(),
        removed: removed.into_iter().chain(removed_folders).collect(),
        kept: kept.into_iter().chain(kept_folders).collect(),
        replaced: (!plan.replaced.is_empty()).then(|| plan.replaced.clone()),
        lines: (!plan.lines.is_empty()).then(|| outcome_of(&plan.lines)),
    }))
}
