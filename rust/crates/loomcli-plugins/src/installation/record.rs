//! A first-party plugin's file in the installation record, `<plugin>.json`: the directories the
//! installed-files module created, each file it installed with its digest, each installed folder
//! with its per-file digests, each startup line by its startup file's path and its text, and each agent
//! registration by its name and command line. Only the module reads or writes it, and it replaces
//! the file whole, through a staging file and a rename.
//!
//! The bytes are the reference's: one line of JSON, the members in the contract's order, then a
//! line feed, so a TypeScript and a Rust build of one application share a record.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use loomcli_core::Log;

use crate::change_events::file_written;

use serde_json::{Map, Value};

use super::InstallationError;
use super::disk::{self, ReplaceOptions};
use super::reach::{read_failure, write_failure};

/// A recorded file and the digest the module wrote to it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommittedFile {
    /// The file's absolute path.
    pub path: PathBuf,
    /// `sha256:` and 64 lowercase hexadecimal digits.
    pub digest: String,
}

/// An installed folder, with its per-file digests when the record has them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordedFolder {
    /// The folder's absolute path.
    pub path: PathBuf,
    /// The recorded files, absent for a folder owned by its path alone.
    pub files: Option<Vec<FolderDigest>>,
}

/// A file inside an installed folder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FolderDigest {
    /// The file's relative POSIX path.
    pub path: String,
    /// `sha256:` and 64 lowercase hexadecimal digits.
    pub digest: String,
    /// Whether the plugin generated this reference from the Command graph.
    pub generated: bool,
}

/// The ownership the pending swap started from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FolderPrior {
    /// The folder was unrecorded.
    Unrecorded,
    /// The record listed only the folder's path.
    Path,
    /// The record listed the folder's files and their digests.
    Files(Vec<FolderDigest>),
}

/// A folder an install is writing or removing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingFolder {
    /// The folder's absolute path.
    pub path: PathBuf,
    /// The prior record, absent for a pending entry read from format 1.
    pub prior: Option<FolderPrior>,
    /// The files the install will write, absent when the folder is being removed.
    pub intended: Option<Vec<FolderDigest>>,
}

/// A file an install or uninstall under way touches: the digest it held before, `None` when it
/// held nothing, and the one it will hold, `None` when the file is being removed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingFile {
    /// The file's absolute path.
    pub path: PathBuf,
    /// The digest before.
    pub prior: Option<String>,
    /// The digest after.
    pub intended: Option<String>,
}

/// A startup line, recorded by its startup file's path and its text, never the file's digest,
/// because the startup file is the operator's.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StartupLine {
    /// The startup file's absolute path.
    pub path: PathBuf,
    /// The line's text: one line, not empty, with no line break.
    pub line: String,
}

/// A startup line an install or uninstall under way touches: the text recorded before, `None` for
/// none, and the text it will hold, `None` when the line is being removed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingLine {
    /// The startup file's absolute path.
    pub path: PathBuf,
    /// The text before.
    pub prior: Option<String>,
    /// The text after.
    pub intended: Option<String>,
}

/// A registration an agent holds, recorded by its name and the command line it starts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordedRegistration {
    /// The registered name.
    pub name: String,
    /// The command line the agent starts, never empty.
    pub command: Vec<String>,
}

/// A registration an install or uninstall under way touches: the command line recorded before,
/// `None` for none, and the one it will hold, `None` when the registration is being removed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingRegistration {
    /// The registered name.
    pub name: String,
    /// The command line before.
    pub prior: Option<Vec<String>>,
    /// The command line after.
    pub intended: Option<Vec<String>>,
}

/// What the module recorded once its work finished.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Committed {
    /// The directories the module created.
    pub directories: Vec<PathBuf>,
    /// The files it installed.
    pub files: Vec<CommittedFile>,
    /// The folders it installed.
    pub folders: Vec<RecordedFolder>,
    /// The startup lines it added.
    pub lines: Vec<StartupLine>,
    /// The registrations an agent holds.
    pub registrations: Vec<RecordedRegistration>,
}

/// What the module was doing when it wrote the file: the work a later run recovers.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Pending {
    /// The directories the module created and will create.
    pub directories: Vec<PathBuf>,
    /// The files it writes or removes.
    pub files: Vec<PendingFile>,
    /// Every folder recorded before and listed now.
    pub folders: Vec<PendingFolder>,
    /// The startup lines it adds, replaces, or removes.
    pub lines: Vec<PendingLine>,
    /// The registrations the agent's call adds or removes.
    pub registrations: Vec<PendingRegistration>,
}

/// A plugin's file: committed or pending.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PluginFile {
    /// `"state":"committed"`.
    Committed(Committed),
    /// `"state":"pending"`.
    Pending(Pending),
}

/// Why the plugin's own file refuses: its content is not the file's shape, or its `format` is one
/// the module does not know.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RecordProblem {
    Damaged,
    UnknownFormat,
}

/// What reading a plugin's file found: nothing, a file the module cannot read, or the file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum PluginFileRead {
    Missing,
    Refused(RecordProblem),
    Read(PluginFile),
}

const FILE_FORMAT: u8 = 1;
const FOLDER_FORMAT: u8 = 2;

/// Whether a value is a digest as the record spells it: `sha256:` and 64 lowercase hexadecimal
/// digits.
fn digest_text(value: &Value) -> Option<String> {
    let text = value.as_str()?;
    let hex = text.strip_prefix("sha256:")?;
    (hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
    .then(|| text.to_owned())
}

/// An absolute path a value holds, or `None` for anything else.
fn absolute_path(value: &Value) -> Option<PathBuf> {
    let text = value.as_str()?;
    Path::new(text).is_absolute().then(|| PathBuf::from(text))
}

/// Whether some text is a startup line's: one line, not empty, with no line break.
#[must_use]
pub fn is_line_text(text: &str) -> bool {
    !text.is_empty() && !text.contains(['\n', '\r'])
}

/// A startup line's text a value holds, or `None` for anything else.
fn line_text(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|text| is_line_text(text))
        .map(str::to_owned)
}

/// The path of a plugin's file in the record directory: `<record>/<plugin>.json`.
#[must_use]
pub fn plugin_file_path(record: &Path, plugin: &str) -> PathBuf {
    record.join(format!("{plugin}.json"))
}

/// The entries of an array whose every member `read` accepts, or `None` for anything else.
fn every_of<T>(value: Option<&Value>, read: impl Fn(&Value) -> Option<T>) -> Option<Vec<T>> {
    value?.as_array()?.iter().map(read).collect()
}

/// The entries of a member a plugin's file may omit, none when it does, or `None` when malformed.
fn optional_of<T>(value: Option<&Value>, read: impl Fn(&Value) -> Option<T>) -> Option<Vec<T>> {
    match value {
        None => Some(Vec::new()),
        Some(_) => every_of(value, read),
    }
}

/// A value that is `null`, as `Some(None)`, or one `read` accepts, as `Some(Some(_))`.
fn or_null<T>(value: Option<&Value>, read: impl Fn(&Value) -> Option<T>) -> Option<Option<T>> {
    match value? {
        Value::Null => Some(None),
        other => read(other).map(Some),
    }
}

fn folder_digest_of(value: &Value) -> Option<FolderDigest> {
    let members = value.as_object()?;
    let path = members.get("path")?.as_str()?;
    if path.split('/').any(|part| matches!(part, "" | "." | "..")) {
        return None;
    }
    Some(FolderDigest {
        path: path.to_owned(),
        digest: digest_text(members.get("digest")?)?,
        generated: match members.get("generated") {
            None => false,
            Some(Value::Bool(true)) => true,
            _ => return None,
        },
    })
}

fn recorded_folder_of(value: &Value) -> Option<RecordedFolder> {
    let members = value.as_object()?;
    Some(RecordedFolder {
        path: absolute_path(members.get("path")?)?,
        files: match members.get("files") {
            None => None,
            present => Some(every_of(present, folder_digest_of)?),
        },
    })
}

fn pending_folder_of(value: &Value, format: u8) -> Option<PendingFolder> {
    if format == FILE_FORMAT {
        return Some(PendingFolder {
            path: recorded_folder_of(value)?.path,
            prior: None,
            intended: None,
        });
    }
    let members = value.as_object()?;
    let prior = match members.get("prior")? {
        Value::Null => FolderPrior::Unrecorded,
        Value::String(text) if text == "path" => FolderPrior::Path,
        other => FolderPrior::Files(every_of(Some(other), folder_digest_of)?),
    };
    Some(PendingFolder {
        path: absolute_path(members.get("path")?)?,
        prior: Some(prior),
        intended: or_null(members.get("intended"), |files| {
            every_of(Some(files), folder_digest_of)
        })?,
    })
}

fn committed_file_of(value: &Value) -> Option<CommittedFile> {
    let members = value.as_object()?;
    Some(CommittedFile {
        path: absolute_path(members.get("path")?)?,
        digest: digest_text(members.get("digest")?)?,
    })
}

fn pending_file_of(value: &Value) -> Option<PendingFile> {
    let members = value.as_object()?;
    let path = absolute_path(members.get("path")?)?;
    Some(PendingFile {
        path,
        prior: or_null(members.get("prior"), digest_text)?,
        intended: or_null(members.get("intended"), digest_text)?,
    })
}

fn startup_line_of(value: &Value) -> Option<StartupLine> {
    let members = value.as_object()?;
    Some(StartupLine {
        path: absolute_path(members.get("path")?)?,
        line: line_text(members.get("line")?)?,
    })
}

fn pending_line_of(value: &Value) -> Option<PendingLine> {
    let members = value.as_object()?;
    let path = absolute_path(members.get("path")?)?;
    Some(PendingLine {
        path,
        prior: or_null(members.get("prior"), line_text)?,
        intended: or_null(members.get("intended"), line_text)?,
    })
}

/// A command line, a nonempty list of words, or `None` for anything else.
fn command_line_of(value: &Value) -> Option<Vec<String>> {
    let words = every_of(Some(value), |word| word.as_str().map(str::to_owned))?;
    (!words.is_empty()).then_some(words)
}

/// A registration's name: nonempty text.
fn name_of(value: Option<&Value>) -> Option<String> {
    value?
        .as_str()
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

fn recorded_registration_of(value: &Value) -> Option<RecordedRegistration> {
    let members = value.as_object()?;
    let name = name_of(members.get("name"))?;
    Some(RecordedRegistration {
        name,
        command: command_line_of(members.get("command")?)?,
    })
}

fn pending_registration_of(value: &Value) -> Option<PendingRegistration> {
    let members = value.as_object()?;
    let name = name_of(members.get("name"))?;
    Some(PendingRegistration {
        name,
        prior: or_null(members.get("prior"), command_line_of)?,
        intended: or_null(members.get("intended"), command_line_of)?,
    })
}

/// The plugin's file one parsed object holds, or `None` when it is not that shape.
fn plugin_file_of(members: &Map<String, Value>, format: u8) -> Option<PluginFile> {
    let directories = every_of(members.get("directories"), absolute_path)?;
    match members.get("state").and_then(Value::as_str) {
        Some("committed") => Some(PluginFile::Committed(Committed {
            directories,
            files: every_of(members.get("files"), committed_file_of)?,
            folders: optional_of(members.get("folders"), recorded_folder_of)?,
            lines: optional_of(members.get("lines"), startup_line_of)?,
            registrations: optional_of(members.get("registrations"), recorded_registration_of)?,
        })),
        Some("pending") => Some(PluginFile::Pending(Pending {
            directories,
            files: every_of(members.get("files"), pending_file_of)?,
            folders: optional_of(members.get("folders"), |value| {
                pending_folder_of(value, format)
            })?,
            lines: optional_of(members.get("lines"), pending_line_of)?,
            registrations: optional_of(members.get("registrations"), pending_registration_of)?,
        })),
        _ => None,
    }
}

/// The plugin's file's text, or `None` when there is none. A failed read returns its error. The
/// bytes decode as UTF-8 with a replacement character for each invalid sequence, as Node's
/// `readFileSync(path, 'utf8')` does.
fn read_text(path: &Path) -> io::Result<Option<String>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(read_failure(path, error)),
    }
}

/// Reads a plugin's file: missing, refused as damaged or of an unknown format, or read.
pub(super) fn read_plugin_file(path: &Path) -> io::Result<PluginFileRead> {
    let Some(text) = read_text(path)? else {
        return Ok(PluginFileRead::Missing);
    };
    let Ok(Value::Object(members)) = serde_json::from_str::<Value>(&text) else {
        return Ok(PluginFileRead::Refused(RecordProblem::Damaged));
    };
    let format = match members.get("format").and_then(Value::as_f64) {
        Some(1.0) => FILE_FORMAT,
        Some(2.0) => FOLDER_FORMAT,
        _ => return Ok(PluginFileRead::Refused(RecordProblem::UnknownFormat)),
    };
    Ok(plugin_file_of(&members, format).map_or(
        PluginFileRead::Refused(RecordProblem::Damaged),
        PluginFileRead::Read,
    ))
}

/// A path as the record spells it: its text, which must be UTF-8 for JSON to hold it.
fn path_text(path: &Path) -> io::Result<Value> {
    path.to_str()
        .map(Value::from)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, super::messages::PATH_NOT_UTF8))
}

/// An object of members in the order given.
fn object(members: Vec<(&str, Value)>) -> Value {
    Value::Object(
        members
            .into_iter()
            .map(|(name, value)| (name.to_owned(), value))
            .collect(),
    )
}

/// Some text, or `null` for none.
fn text_or_null(text: Option<&String>) -> Value {
    text.map_or(Value::Null, |text| Value::from(text.as_str()))
}

/// A command line as a list of words, or `null` for none.
fn words_or_null(words: Option<&Vec<String>>) -> Value {
    words.map_or(Value::Null, |words| Value::from(words.clone()))
}

/// The paths as a list of their texts.
fn path_list(paths: &[PathBuf]) -> io::Result<Value> {
    paths
        .iter()
        .map(|path| path_text(path))
        .collect::<io::Result<Vec<_>>>()
        .map(Value::Array)
}

fn folder_members(files: &[FolderDigest]) -> Value {
    Value::Array(
        files
            .iter()
            .map(|file| {
                let mut members = vec![
                    ("path", Value::from(file.path.as_str())),
                    ("digest", Value::from(file.digest.as_str())),
                ];
                if file.generated {
                    members.push(("generated", Value::Bool(true)));
                }
                object(members)
            })
            .collect(),
    )
}

fn committed_folder_members(folder: &RecordedFolder) -> io::Result<Value> {
    let mut members = vec![("path", path_text(&folder.path)?)];
    if let Some(files) = &folder.files {
        members.push(("files", folder_members(files)));
    }
    Ok(object(members))
}

fn pending_folder_members(folder: &PendingFolder) -> io::Result<Value> {
    let mut members = vec![("path", path_text(&folder.path)?)];
    if let Some(prior) = &folder.prior {
        let prior = match prior {
            FolderPrior::Unrecorded => Value::Null,
            FolderPrior::Path => Value::from("path"),
            FolderPrior::Files(files) => folder_members(files),
        };
        members.push(("prior", prior));
        members.push((
            "intended",
            folder
                .intended
                .as_deref()
                .map_or(Value::Null, folder_members),
        ));
    }
    Ok(object(members))
}

/// The files, startup lines, and registrations of a plugin's file, each entry's members in the
/// contract's order.
fn entry_members(file: &PluginFile) -> io::Result<(Vec<Value>, Vec<Value>, Vec<Value>)> {
    match file {
        PluginFile::Committed(committed) => Ok((
            committed
                .files
                .iter()
                .map(|file| {
                    Ok(object(vec![
                        ("path", path_text(&file.path)?),
                        ("digest", Value::from(file.digest.as_str())),
                    ]))
                })
                .collect::<io::Result<_>>()?,
            committed
                .lines
                .iter()
                .map(|line| {
                    Ok(object(vec![
                        ("path", path_text(&line.path)?),
                        ("line", Value::from(line.line.as_str())),
                    ]))
                })
                .collect::<io::Result<_>>()?,
            committed
                .registrations
                .iter()
                .map(|registration| {
                    object(vec![
                        ("name", Value::from(registration.name.as_str())),
                        ("command", Value::from(registration.command.clone())),
                    ])
                })
                .collect(),
        )),
        PluginFile::Pending(pending) => Ok((
            pending
                .files
                .iter()
                .map(|file| {
                    Ok(object(vec![
                        ("path", path_text(&file.path)?),
                        ("prior", text_or_null(file.prior.as_ref())),
                        ("intended", text_or_null(file.intended.as_ref())),
                    ]))
                })
                .collect::<io::Result<_>>()?,
            pending
                .lines
                .iter()
                .map(|line| {
                    Ok(object(vec![
                        ("path", path_text(&line.path)?),
                        ("prior", text_or_null(line.prior.as_ref())),
                        ("intended", text_or_null(line.intended.as_ref())),
                    ]))
                })
                .collect::<io::Result<_>>()?,
            pending
                .registrations
                .iter()
                .map(|registration| {
                    object(vec![
                        ("name", Value::from(registration.name.as_str())),
                        ("prior", words_or_null(registration.prior.as_ref())),
                        ("intended", words_or_null(registration.intended.as_ref())),
                    ])
                })
                .collect(),
        )),
    }
}

/// The plugin's file as one line of JSON, its members in the contract's order, then `folders` and
/// `lines` and `registrations`, each only when it lists any, and a line feed.
pub(super) fn serialize(file: &PluginFile) -> io::Result<String> {
    let (state, directories, folders): (_, _, io::Result<Vec<_>>) = match file {
        PluginFile::Committed(committed) => (
            "committed",
            &committed.directories,
            committed
                .folders
                .iter()
                .map(committed_folder_members)
                .collect(),
        ),
        PluginFile::Pending(pending) => (
            "pending",
            &pending.directories,
            pending.folders.iter().map(pending_folder_members).collect(),
        ),
    };
    let (files, lines, registrations) = entry_members(file)?;
    let folders = folders?;
    let format = if folders.is_empty() {
        FILE_FORMAT
    } else {
        FOLDER_FORMAT
    };
    let mut members = vec![
        ("format", Value::from(format)),
        ("state", Value::from(state)),
        ("directories", path_list(directories)?),
        ("files", Value::Array(files)),
    ];
    if !folders.is_empty() {
        members.push(("folders", Value::Array(folders)));
    }
    if !lines.is_empty() {
        members.push(("lines", Value::Array(lines)));
    }
    if !registrations.is_empty() {
        members.push(("registrations", Value::Array(registrations)));
    }
    Ok(format!("{}\n", object(members)))
}

/// Replaces the plugin's file whole, creating the record directory when it is missing.
pub(super) fn write_plugin_file(
    path: &Path,
    file: &PluginFile,
    log: Option<&Log>,
) -> Result<(), InstallationError> {
    let text = serialize(file)?;
    fs::create_dir_all(disk::parent_of(path)).map_err(|error| write_failure(path, error))?;
    disk::replace_file(path, text.as_bytes(), ReplaceOptions::new())
        .map_err(|error| error.map_io(|error| write_failure(path, error)))?;
    if let Some(log) = log {
        file_written(log, path);
    }
    Ok(())
}
