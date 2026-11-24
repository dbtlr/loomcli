//! `path`.

use std::path::{Component, Path as FsPath, PathBuf};

use loomcli_core::{InputSchema, Issue, ValidationContext, Validator};
use serde::{Deserialize, Serialize};

use crate::codes::{Kind, NoParams, PATH_ISSUE, PATH_READABLE_ISSUE, PATH_WRITABLE_ISSUE};

/// The kind of file system entry a `path` validator accepts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PathKind {
    /// A file.
    File,
    /// A directory.
    Directory,
    /// Either.
    Any,
}

/// The access a `path` validator probes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PathAccess {
    /// Readable.
    Read,
    /// Writable.
    Write,
}

/// A file system path, optionally of a kind and readable or writable.
#[derive(Clone, Debug)]
#[must_use]
pub struct Path {
    kind: PathKind,
    access: Option<PathAccess>,
}

/// Validates a path, resolved against the run's working directory and normalized without following
/// symbolic links. A token that is empty or holds NUL is rejected before any probe. With
/// [`Path::access`], the validator probes the file system synchronously; the probe is advisory,
/// since the file system can change before the action runs.
pub fn path() -> Path {
    Path {
        kind: PathKind::File,
        access: None,
    }
}

impl Path {
    /// The kind of entry required beside an access; `File` unless this says otherwise. Without an
    /// access, nothing on the file system is read and the kind changes nothing.
    pub fn kind(mut self, kind: PathKind) -> Self {
        self.kind = kind;
        self
    }

    /// The access required: `Read` accepts an entry that exists, is of the kind, following symbolic
    /// links, and the process can read. `Write` accepts such an entry the process can write, or,
    /// when no entry exists, a path whose parent is an existing directory the process can write.
    /// Nothing is created.
    pub fn access(mut self, access: PathAccess) -> Self {
        self.access = Some(access);
        self
    }
}

/// `target` resolved against `cwd`, and normalized lexically: `.` and empty segments dropped and
/// `..` applied. Symbolic links are not resolved.
fn resolve(cwd: &FsPath, raw: &str) -> PathBuf {
    let joined = cwd.join(raw);
    let mut resolved = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => resolved.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                let at_root = matches!(
                    resolved.components().next_back(),
                    Some(Component::RootDir | Component::Prefix(_)) | None
                );
                if !at_root {
                    resolved.pop();
                }
            }
            Component::Normal(name) => resolved.push(name),
        }
    }
    resolved
}

fn kind_matches(metadata: &std::fs::Metadata, kind: PathKind) -> bool {
    match kind {
        PathKind::File => metadata.is_file(),
        PathKind::Directory => metadata.is_dir(),
        PathKind::Any => true,
    }
}

/// Whether `target` grants `mode`, as `access(2)` answers for the process.
#[cfg(unix)]
fn grants_mode(target: &FsPath, write: bool) -> bool {
    use rustix::fs::{Access, access};
    access(
        target,
        if write {
            Access::WRITE_OK
        } else {
            Access::READ_OK
        },
    )
    .is_ok()
}

#[cfg(not(unix))]
fn grants_mode(target: &FsPath, write: bool) -> bool {
    std::fs::metadata(target).is_ok_and(|metadata| !write || !metadata.permissions().readonly())
}

/// Whether an entry exists, following symbolic links, is of `kind`, and grants the access.
/// Any failure to learn that is a verdict about the token.
fn grants(target: &FsPath, kind: PathKind, write: bool) -> std::io::Result<bool> {
    let metadata = std::fs::metadata(target)?;
    Ok(kind_matches(&metadata, kind) && grants_mode(target, write))
}

/// Whether the process can read the entry.
fn readable(target: &FsPath, kind: PathKind) -> bool {
    grants(target, kind, false).unwrap_or(false)
}

/// Whether the process can write the entry, or create it when no entry exists: then the parent
/// must be an existing directory the process can write. Nothing is created.
fn writable(target: &FsPath, kind: PathKind) -> bool {
    match grants(target, kind, true) {
        Ok(verdict) => verdict,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => target
            .parent()
            .is_some_and(|parent| grants(parent, PathKind::Directory, true).unwrap_or(false)),
        Err(_) => false,
    }
}

impl Validator for Path {
    type Output = PathBuf;

    fn validate(&self, input: &str, context: &ValidationContext) -> Result<PathBuf, Vec<Issue>> {
        let issue = || {
            let kind = Kind { kind: self.kind };
            vec![match self.access {
                None => PATH_ISSUE.issue(NoParams {}),
                Some(PathAccess::Read) => PATH_READABLE_ISSUE.issue(kind),
                Some(PathAccess::Write) => PATH_WRITABLE_ISSUE.issue(kind),
            }]
        };
        if input.is_empty() || input.contains('\0') {
            return Err(issue());
        }
        let resolved = resolve(&context.host.cwd, input);
        let passes = match self.access {
            None => true,
            Some(PathAccess::Read) => readable(&resolved, self.kind),
            Some(PathAccess::Write) => writable(&resolved, self.kind),
        };
        if passes { Ok(resolved) } else { Err(issue()) }
    }

    fn input_schema(&self) -> InputSchema {
        let mut schema = serde_json::Map::new();
        schema.insert("type".to_owned(), "string".into());
        schema.insert("minLength".to_owned(), 1.into());
        Some(loomcli_core::with_schema_dialect(schema))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolution_is_lexical() {
        let cwd = FsPath::new("/work/app");
        assert_eq!(resolve(cwd, "a/../b/./c"), PathBuf::from("/work/app/b/c"));
        assert_eq!(resolve(cwd, "../../.."), PathBuf::from("/"));
        assert_eq!(resolve(cwd, "/abs//x/"), PathBuf::from("/abs/x"));
    }
}
