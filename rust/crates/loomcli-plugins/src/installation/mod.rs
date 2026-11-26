//! The installed-files module: the writer side of the installation record that the first-party
//! plugins which install files outside the application share — completion scripts, man pages,
//! agent skills, MCP registrations, the self-update binary record, and service units.
//!
//! Core reads the installation record (`install.json`, through `loomcli_core::shipping`); this
//! module writes each plugin's own file beside it, `<record>/<plugin>.json`, under the
//! reference's [installation record] contract and ADR-0071. It is internal to the pack: no
//! feature exports it, and the `installation` feature that compiles it is turned on by the
//! `completion`, `manpage`, `skills`, `mcp`, `self-update`, and `service` features.
//!
//! [installation record]: https://github.com/dbtlr/loomcli/blob/main/docs/core/installation-record.md
//!
//! # What it guarantees
//!
//! - **One file per plugin.** A [`PluginRecord`] names `<record>/<plugin>.json`; the plugin's
//!   name is its own, or its name and a target for a plugin with independent targets
//!   (`skills.claude`, `mcp.codex`, `completion.bash`). Each write replaces that file whole
//!   through a staging file and a rename, and no operation reads or writes another plugin's
//!   file. The bytes are the reference's, so a TypeScript and a Rust build of one application
//!   share a record. Format 1 holds records without folders. Format 2 adds the ordered file digests
//!   and generated reference marks of each folder. A reader also accepts a format 1 folder by its
//!   path alone.
//! - **Pending, then committed.** An install writes the plugin's file `pending` (each path with
//!   the digest it held and the one it will hold) before it touches any target, and `committed`
//!   after the last. The next install or uninstall recovers a `pending` file by what is on disk
//!   before it does anything else, so a killed run rolls forward.
//! - **Staged writes.** Every file goes to `.<name>.<16 hex>.loom-staging` beside it, created
//!   exclusively, and is renamed into place; a folder is built in a staging folder and swapped in
//!   through a `.loom-retired` move. Recovery removes the leftovers of the names it records and
//!   nothing else.
//! - **Refusal.** At a file target, an unrecorded file, a changed digest, a symbolic link, a
//!   directory, or a special file refuses the whole install. At a folder target, an unrecorded
//!   occupant or an edited generated reference refuses unless the operator forces the install.
//!   A damaged plugin's file or an unknown `format` refuses install and uninstall alike.
//! - **Uninstall removes only what is unchanged.** A recorded file whose digest changed is kept
//!   and reported. A folder with an edited generated reference is kept whole and its ownership is
//!   dropped. Recorded directories are removed once empty, deepest first.
//! - **Startup lines.** A startup file is the operator's: the module appends one line in place,
//!   replaces or removes only lines equal to the recorded text, keeps every other byte, its
//!   encoding (UTF-8 with or without a byte order mark), its line endings, and its mode, and never
//!   removes the file. The plugin decides beforehand, with [`inspect_startup_file`], whether it
//!   may change the file; it lists no line for one it may not, and releases a recorded line it can
//!   no longer change through [`InstallRequest::release`] or [`PluginRecord::uninstall`]'s
//!   `release`.
//! - **Registrations.** The MCP plugin records an agent registration it never applies itself:
//!   [`PluginRecord::write_pending_registration`] before the agent's own call,
//!   [`PluginRecord::write_committed_registration`] (or [`PluginRecord::delete`]) after it.
//!
//! # The API
//!
//! | Need | Call |
//! | --- | --- |
//! | The record directory, or the operator-facing refusal | [`record_directory`]`(name, &host)` |
//! | The home folder, or its refusal | [`required_home`], [`home_refusal`], [`home_of`], [`absolute_variable`] |
//! | One plugin's file | [`PluginRecord::new`]`(record, plugin)` |
//! | Install files, folders, startup lines | [`PluginRecord::install`] with an [`InstallRequest`] |
//! | Uninstall | [`PluginRecord::uninstall`] |
//! | Read what is recorded, without writing | [`PluginRecord::read`], [`PluginRecord::directories`], [`PluginRecord::has_pending`], [`PluginRecord::read_registration`] |
//! | Judge targets before acting (`status`, `--check`) | [`target_refusals`], [`folder_refusals`] |
//! | Hand a shared directory to a sibling file | [`PluginRecord::adopt_directories`] |
//! | Judge a startup file before listing a line | [`inspect_startup_file`] |
//! | Write or check a folder with no record (a project skill) | [`write_folder`] |
//! | Replace one file atomically (self-update's `install.json`) | [`replace_file`] with [`ReplaceOptions`] |
//! | Run the new binary's `update` after a self-update | [`refresh_by_running`] |
//!
//! Every operation is synchronous, as the reference's are: call it from an action directly, or
//! through `tokio::task::spawn_blocking` for a large folder. Every [`InstallationError`] converts
//! into `loomcli_core::Error` through `?`. A file-system call that fails returns
//! [`InstallationError::Io`] with the runtime's error, which converts into that `io::Error` as a
//! foreign error the plugin's Command reports. The run's signal is read through the
//! [`Cancellation`] trait, which `loomcli_core::RunSignal` implements: pass `&ctx.signal`. A run
//! cancelled before the first write or removal returns [`InstallationError::Cancelled`] with the
//! run's cancellation echo, which converts back into that echo, so the action ends silently with
//! the cancellation's exit code, as the reference's `signal.throwIfAborted()` does.
//!
//! # Outcomes
//!
//! [`InstallOutcome::Refused`] and [`UninstallOutcome::Refused`] list each [`Refusal`] with its
//! [`RefusalReason`], whose [`RefusalReason::as_str`] is the reference's spelling. An install's
//! [`Installed`] lists `written` (files, then folders, as listed), `removed` (recorded files no
//! longer listed and unchanged, then recorded folders no longer listed), `kept` (recorded files
//! no longer listed that someone changed), `replaced` (folders the force mode took over, `None`
//! when none) and `lines` (a [`StartupLinesOutcome`], `None` when no line was listed, recorded, or
//! released). Each plugin states these to the operator under its own contract.
//!
//! # Worked example
//!
//! A completion-style install of one script and one startup line, a refresh that rewrites the
//! script, and an uninstall. (The integration test `the_worked_example_from_the_module_rustdoc`
//! runs this same sequence.)
//!
//! ```ignore
//! use crate::installation::{
//!     InstallOutcome, InstallRequest, InstalledFile, InstalledLine, PluginRecord,
//!     UninstallOutcome, record_directory,
//! };
//!
//! // In an action: `ctx.host`, `ctx.signal`.
//! let record = record_directory("notes", &ctx.host)?; // a FatalError the run reports, exit 1
//! let bash = PluginRecord::new(&record, "completion.bash");
//! let script = data.join("notes/completion/notes.bash");
//! let rc = home.join(".bashrc");
//! let line = format!(". '{}' # added by notes completion install", script.display());
//!
//! // Install: writes `completion.bash.json` pending, creates notes/ and notes/completion/
//! // (recorded as directories the module created), stages and renames the script, appends the
//! // line to ~/.bashrc in its own line ending, then writes the file committed.
//! let request = InstallRequest::new()
//!     .files([InstalledFile::new(&script, bash_script("notes")).mode(0o644)])
//!     .lines([InstalledLine::new(&rc, &line)])
//!     .directory_mode(0o755);
//! match bash.install(&request, &ctx.signal)? {
//!     InstallOutcome::Refused(refused) => {
//!         // Nothing was written. Name each `refusal.path` and `refusal.reason` to the operator.
//!     }
//!     InstallOutcome::Installed(done) => {
//!         // done.written == [script]; done.lines.unwrap().added == [StartupLine { rc, line }].
//!     }
//! }
//!
//! // Refresh (`completion update` after a self-update): the same request with new content and
//! // `.update(true)`. The script is replaced because its recorded digest is unchanged; a script
//! // someone edited refuses as `changed`. The recorded line stays `held`; one the operator
//! // removed is not added again and is dropped from the record (`no_longer_held`).
//! let refreshed = request.clone()
//!     .files([InstalledFile::new(&script, bash_script_v2("notes")).mode(0o644)])
//!     .update(true);
//! bash.install(&refreshed, &ctx.signal)?;
//!
//! // Uninstall: removes the script if unchanged (else keeps and reports it), removes every line
//! // equal to the recorded text from ~/.bashrc (never the file), removes notes/completion/ and
//! // notes/ once empty, deepest first, and deletes `completion.bash.json`.
//! if let UninstallOutcome::Uninstalled(done) = bash.uninstall(&[], &ctx.signal)? {
//!     // done.removed == [script]; done.lines.unwrap().removed == [StartupLine { rc, line }].
//! }
//! ```

mod application_folders;
mod disk;
mod files;
mod folders;
mod lines;
mod messages;
mod reach;
mod record;
mod refresh;
mod startup;

use std::fmt;
use std::io;
use std::path::PathBuf;

pub use application_folders::{
    absolute_variable, home_of, home_refusal, record_directory, required_home,
};
pub use disk::{
    Observed, PERMISSION_BITS, ReplaceOptions, Step, create_directory, create_new, digest_of,
    exists, missing_parents, observe, real_path, remove_empty_directory, remove_staging_files,
    replace_file, retired_path, set_probe, staging_path,
};
pub use files::{
    InstallOutcome, InstallRequest, Installed, InstalledFile, InstalledFolder, PluginRecord,
    RecordedRead, Refusal, RefusalReason, RegistrationRead, UninstallOutcome, Uninstalled,
    UninstalledLines, folder_refusals, target_refusals,
};
pub use folders::{FolderFile, fill_folder, remove_folder_leftovers, remove_whole, write_folder};
#[cfg(feature = "skills")]
pub(crate) use folders::{changed_references, stale_files};
pub use lines::{InstalledLine, StartupLinesOutcome};
pub use record::{
    Committed, CommittedFile, FolderDigest, FolderPrior, Pending, PendingFile, PendingFolder,
    PendingLine, PendingRegistration, PluginFile, RecordedFolder, RecordedRegistration,
    StartupLine, is_line_text, plugin_file_path,
};
pub use refresh::{Refresh, RefreshContext, refresh_by_running};
pub use startup::{StartupEncoding, StartupFileState, inspect_startup_file};

/// The whole module for the crate's integration tests, which cannot reach a private module. Not
/// part of any contract.
#[doc(hidden)]
pub mod test_support {
    pub use super::*;
}

/// The run's signal as the module reads it: an install reads it before its first write, an
/// uninstall before its first removal, and a replacement given a signal before its rename.
/// `loomcli_core::RunSignal` implements it; a test or a caller with no run implements it on its own
/// type.
pub trait Cancellation {
    /// `Err` with the error that ends the operation once the run has been cancelled, `Ok` while it
    /// goes on. The run signal's error is its cancellation echo
    /// (`loomcli_core::RunSignal::throw_if_cancelled`), which ends the action silently when it
    /// reaches core.
    ///
    /// # Errors
    ///
    /// The cancellation's error once the run has been cancelled.
    fn throw_if_cancelled(&self) -> Result<(), loomcli_core::Error>;
}

impl Cancellation for loomcli_core::RunSignal {
    fn throw_if_cancelled(&self) -> Result<(), loomcli_core::Error> {
        loomcli_core::RunSignal::throw_if_cancelled(self)
    }
}

/// Reads `signal`, answering [`InstallationError::Cancelled`] with its error once the run has been
/// cancelled.
fn read_signal(signal: &dyn Cancellation) -> Result<(), InstallationError> {
    signal
        .throw_if_cancelled()
        .map_err(InstallationError::Cancelled)
}

/// Why an operation of the module did not finish. A refusal is not an error: it is an outcome,
/// with nothing written.
#[derive(Debug)]
#[non_exhaustive]
pub enum InstallationError {
    /// The run was cancelled before the first write or removal; nothing was written. It carries
    /// the signal's error, the run's cancellation echo for a `loomcli_core::RunSignal`, which is
    /// what it converts into.
    Cancelled(loomcli_core::Error),
    /// A file-system call failed with the runtime's error. A `pending` plugin's file it leaves is
    /// recovered on the next run.
    Io(io::Error),
    /// A startup file the module would change is one the process may not read: a first-party
    /// plugin's bug, since the plugin judges the file with [`inspect_startup_file`] first.
    UnreadableStartupFile(PathBuf),
    /// A startup file the module would change is not UTF-8: a first-party plugin's bug, as above.
    UnknownStartupEncoding(PathBuf),
    /// A startup file the module found missing was created by another run and then changed into
    /// something that is not a regular file before the line was added.
    StartupFileChanged(PathBuf),
}

impl InstallationError {
    fn map_io(self, update: impl FnOnce(io::Error) -> io::Error) -> Self {
        match self {
            Self::Io(error) => Self::Io(update(error)),
            error => error,
        }
    }
}

impl fmt::Display for InstallationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InstallationError::Cancelled(_) => formatter.write_str(messages::RUN_CANCELLED),
            InstallationError::Io(error) => error.fmt(formatter),
            InstallationError::UnreadableStartupFile(path) => {
                formatter.write_str(&messages::startup_file_unreadable(&path.to_string_lossy()))
            }
            InstallationError::UnknownStartupEncoding(path) => {
                formatter.write_str(&messages::startup_file_encoding(&path.to_string_lossy()))
            }
            InstallationError::StartupFileChanged(path) => {
                formatter.write_str(&messages::startup_file_changed(&path.to_string_lossy()))
            }
        }
    }
}

/// The conversion `?` makes in an action. A cancellation becomes the error the signal returned,
/// the run's cancellation echo, which core ends silently; a file-system failure becomes the
/// runtime's `io::Error` as a foreign error, as the reference rethrows the file-system error; a
/// startup-file error becomes a foreign [`StartupFileError`] with its message. The enum is not a
/// `std::error::Error` itself, so `?` takes this conversion and not core's blanket one, which
/// would hide the echo.
impl From<InstallationError> for loomcli_core::Error {
    fn from(error: InstallationError) -> Self {
        match error {
            InstallationError::Cancelled(echo) => echo,
            InstallationError::Io(error) => match error
                .get_ref()
                .and_then(|source| source.downcast_ref::<reach::ReachFailure>())
            {
                Some(failure) => loomcli_core::FatalError::new(failure.to_string()).into(),
                None => error.into(),
            },
            other => StartupFileError(other.to_string()).into(),
        }
    }
}

/// A startup-file error as the foreign error a run reports: a first-party plugin's bug, since the
/// plugin judges a startup file with [`inspect_startup_file`] before listing a line in it.
#[derive(Debug)]
pub struct StartupFileError(String);

impl fmt::Display for StartupFileError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for StartupFileError {}

impl From<io::Error> for InstallationError {
    fn from(error: io::Error) -> Self {
        InstallationError::Io(error)
    }
}
