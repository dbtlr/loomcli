//! Whether the plugin may change a startup file, judged before it writes anything: the file read
//! as the installed-files module reads it, resolved through symbolic links to its real path, and
//! the nearest folder at or above it that exists. A line goes into a file the plugin may change, and
//! is printed for the operator when it may not.

use std::io;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use loomcli_core::Error;
use rustix::fs::{Access, access};
use rustix::io::Errno;

use super::messages::lines;
use super::paths::dirname;
use super::run::{ChildRun, Notice, remove_notice};
use crate::installation::{InstalledLine, StartupFileState, exists, inspect_startup_file};

/// What a startup file is to the plugin: not a regular file or nothing, or a file the plugin may
/// change or not. `holds` says whether the file holds the line asked about, `Some(false)` for a
/// file that does not exist, and unknown for a file the process may not read or in an encoding the
/// module does not read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum StartupJudgement {
    NotFile,
    File {
        changeable: bool,
        holds: Option<bool>,
    },
}

/// Whether the process may do `how` to the path, as `access(2)` answers: a missing permission, an
/// operation the system forbids, and a read-only file system say no, and any other error is the
/// run's to report.
fn may(path: &Path, how: Access) -> io::Result<bool> {
    match access(path, how) {
        Ok(()) => Ok(true),
        Err(errno) => {
            let error = io::Error::from(errno);
            if denies_write(&error) {
                Ok(false)
            } else {
                Err(error)
            }
        }
    }
}

/// Whether a runtime error says the process may not write a path, as a missing permission, an
/// operation the system forbids, or a read-only file system does, rather than a failure to report.
#[must_use]
pub fn denies_write(error: &io::Error) -> bool {
    matches!(
        Errno::from_io_error(error),
        Some(Errno::ACCESS | Errno::PERM | Errno::ROFS)
    )
}

/// Whether the process may write the path, which exists.
pub(super) fn may_write(path: &Path) -> io::Result<bool> {
    may(path, Access::WRITE_OK)
}

/// Whether the process may run the path.
pub(super) fn may_execute(path: &Path) -> bool {
    may(path, Access::EXEC_OK).unwrap_or(false)
}

/// The nearest folder at or above `path` that exists.
fn nearest_existing(path: &str) -> io::Result<PathBuf> {
    let mut current = path.to_owned();
    loop {
        if exists(Path::new(&current))? {
            return Ok(PathBuf::from(current));
        }
        let parent = dirname(&current);
        if parent == current {
            return Ok(PathBuf::from(current));
        }
        current = parent;
    }
}

/// Whether a file belongs to another user, which makes it one the plugin cannot change. A runtime
/// that reports no user owns every file it may write.
#[must_use]
pub fn owned_by_another(owner: u32, user: Option<u32>) -> bool {
    user.is_some_and(|user| owner != user)
}

/// Whether the plugin may change a file that exists: write it and its folder, and own it, as the
/// run's user, which a runtime with no user ID reports as `None`.
fn may_change_file(path: &Path, user: Option<u32>) -> io::Result<bool> {
    let real = std::fs::canonicalize(path)?;
    let owner = std::fs::metadata(&real)?.uid();
    let folder = real.parent().unwrap_or(&real);
    Ok(may_write(&real)? && may_write(folder)? && !owned_by_another(owner, user))
}

/// Judges a startup file for one line: not a file, one the process may not read or in an encoding
/// the module does not read, which the plugin cannot change, or, by whether the process may write
/// it, its folder, or the nearest folder that exists and whether another user owns it, one it may
/// or may not change.
pub(super) fn judge_startup(
    path: &Path,
    line: &str,
    user: Option<u32>,
) -> Result<StartupJudgement, Error> {
    Ok(match inspect_startup_file(path, line)? {
        StartupFileState::NotFile => StartupJudgement::NotFile,
        StartupFileState::UnknownEncoding | StartupFileState::Unreadable => {
            StartupJudgement::File {
                changeable: false,
                holds: None,
            }
        }
        StartupFileState::Absent => {
            let folder = dirname(&path.to_string_lossy());
            StartupJudgement::File {
                changeable: may_write(&nearest_existing(&folder)?)?,
                holds: Some(false),
            }
        }
        StartupFileState::Text { holds, .. } => StartupJudgement::File {
            changeable: may_change_file(path, user)?,
            holds: Some(holds),
        },
    })
}

/// Whether a run that would change a recorded line in its file must release it instead: the plugin
/// cannot change the file, and the file holds the line or cannot be read to tell.
pub(super) fn must_release(judgement: StartupJudgement) -> bool {
    matches!(
        judgement,
        StartupJudgement::File {
            changeable: false,
            holds
        } if holds != Some(false)
    )
}

/// What a run does with one startup file's line: the line it lists for the module, the startup file
/// whose recorded line it releases, the lines the operator adds or removes by hand, and the file
/// that already loads the script although the plugin may not change it.
#[derive(Default)]
pub(super) struct LinePlacement {
    pub lines: Vec<InstalledLine>,
    pub release: Vec<PathBuf>,
    pub notices: Vec<Notice>,
    pub loaded: Vec<PathBuf>,
}

/// What a run asks of one startup file: its path, the line it should hold, and the line recorded
/// there.
pub(super) struct LineRequest<'a> {
    pub path: &'a Path,
    pub line: &'a str,
    pub recorded: Option<&'a str>,
    /// Whether the run is an update, which asks the operator for no line the record did not hold.
    pub update: bool,
}

/// The line recorded in a startup file the plugin may not change, dropped from the record with no
/// write: released when the file holds it, may hold it, or holds the new line, and printed for the
/// operator to remove when its text differs from the new line's.
fn recorded_here(
    run: &ChildRun,
    request: &LineRequest<'_>,
    holds: Option<bool>,
) -> Result<(Vec<Notice>, Vec<PathBuf>), Error> {
    let Some(recorded) = request.recorded else {
        return Ok((Vec::new(), Vec::new()));
    };
    let held = must_release(judge_startup(request.path, recorded, run.uid())?);
    let notices = if held && recorded != request.line {
        vec![remove_notice(run, request.path, recorded)]
    } else {
        Vec::new()
    };
    let release = if held || holds == Some(true) {
        vec![request.path.to_path_buf()]
    } else {
        Vec::new()
    };
    Ok((notices, release))
}

/// Places a line in a startup file the plugin has judged to be a file or nothing. One it may
/// change gets the line listed, so the module writes and records it. One it may not change gets no
/// line recorded: its recorded line is dropped, and the new line is printed for the operator to
/// add, unless the file already holds it or an update finds no line there to replace.
pub(super) fn place_line(
    run: &ChildRun,
    request: &LineRequest<'_>,
    changeable: bool,
    holds: Option<bool>,
) -> Result<LinePlacement, Error> {
    let LineRequest {
        path, line, update, ..
    } = request;
    if changeable {
        return Ok(LinePlacement {
            lines: vec![InstalledLine::new(*path, *line)],
            ..LinePlacement::default()
        });
    }
    let (mut notices, release) = recorded_here(run, request, holds)?;
    if holds == Some(true) || (*update && notices.is_empty()) {
        return Ok(LinePlacement {
            lines: Vec::new(),
            loaded: if holds == Some(true) {
                vec![path.to_path_buf()]
            } else {
                Vec::new()
            },
            notices,
            release,
        });
    }
    let sentence = if notices.is_empty() {
        lines::add_yourself(&run.name, path)
    } else {
        lines::add_in_place(path)
    };
    notices.push(Notice {
        sentence,
        line: (*line).to_owned(),
    });
    Ok(LinePlacement {
        lines: Vec::new(),
        loaded: Vec::new(),
        notices,
        release,
    })
}
