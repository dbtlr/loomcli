//! The startup lines of the installed-files module: what an install or uninstall does to each
//! startup file's line, decided from the recorded lines and what each startup file holds, and the
//! writes that carry it out. A released line is decided without reading its startup file.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use loomcli_core::Log;

use crate::change_events::file_written;

use super::InstallationError;
use super::disk;
use super::record::{PendingLine, StartupLine};
use super::startup::{
    LineEdit, NotFile, StartupRead, StartupText, append_line, create_startup_file, holds_line,
    read_startup, real_path_of, rewrite_lines,
};

/// One startup line an install lists: its startup file's absolute, normalized path and its text,
/// one line with no line break.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstalledLine {
    /// The startup file's absolute path.
    pub path: PathBuf,
    /// The line's text.
    pub line: String,
}

impl InstalledLine {
    /// The line `line` in the startup file at `path`.
    pub fn new(path: impl Into<PathBuf>, line: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            line: line.into(),
        }
    }
}

/// What a run does to one startup file's line, with the text recorded before, `None` for none.
#[derive(Clone, Debug)]
pub(super) enum LineAction {
    /// Append the line, or create the file when `found` is `None`.
    Add {
        listed: InstalledLine,
        prior: Option<String>,
        found: Option<StartupText>,
    },
    /// The file holds the recorded line: keep it recorded.
    Hold {
        listed: InstalledLine,
        prior: String,
    },
    /// The file holds a line the record did not: report it, record nothing.
    Present { listed: InstalledLine },
    /// Replace each line equal to the recorded text where it stands.
    Replace {
        listed: InstalledLine,
        prior: String,
        found: StartupText,
    },
    /// Remove each line equal to the recorded text.
    Remove {
        path: PathBuf,
        prior: String,
        found: StartupText,
    },
    /// The file no longer holds the recorded line.
    NotHeld { path: PathBuf, prior: String },
    /// The plugin releases the recorded line without reading or writing its file.
    Release { path: PathBuf, prior: String },
}

/// What happened to the startup lines, each by its startup file's path and text: the new text for
/// a line added, already held, or replaced, and the recorded text for one removed, no longer held,
/// or released.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StartupLinesOutcome {
    /// Lines appended, or written into a file the module created.
    pub added: Vec<StartupLine>,
    /// Lines the file already held, recorded or not.
    pub held: Vec<StartupLine>,
    /// Lines whose recorded text was replaced where it stands.
    pub replaced: Vec<StartupLine>,
    /// Recorded lines removed.
    pub removed: Vec<StartupLine>,
    /// Recorded lines the file no longer holds.
    pub no_longer_held: Vec<StartupLine>,
    /// Recorded lines the plugin released.
    pub released: Vec<StartupLine>,
}

/// Why a listed startup file refuses an install: it resolves to something other than a regular
/// file or nothing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct LineRefusal {
    pub(super) path: PathBuf,
    pub(super) reason: NotFile,
}

/// The startup lines a run lists, the startup files whose recorded lines it releases because the
/// plugin may not change them, and whether it is an update.
pub(super) struct LineListing<'a> {
    pub(super) lines: &'a [InstalledLine],
    pub(super) release: BTreeSet<&'a Path>,
    pub(super) update: bool,
}

/// What a startup file the module would change holds: nothing, a refusal, or its text.
enum Found {
    Absent,
    Refused(LineRefusal),
    Text(StartupText),
}

/// The text of a startup file the module would change, `Absent` when nothing is there, or its
/// refusal. A file in an encoding the module does not read, or one the process may not read, is a
/// first-party plugin's bug, since the plugin judges the file first.
fn found_text(path: &Path) -> Result<Found, InstallationError> {
    Ok(match read_startup(path)? {
        StartupRead::Absent => Found::Absent,
        StartupRead::NotFile(reason) => Found::Refused(LineRefusal {
            path: path.to_path_buf(),
            reason,
        }),
        StartupRead::Unreadable => {
            return Err(InstallationError::UnreadableStartupFile(path.to_path_buf()));
        }
        StartupRead::UnknownEncoding => {
            return Err(InstallationError::UnknownStartupEncoding(
                path.to_path_buf(),
            ));
        }
        StartupRead::Text(content) => Found::Text(content),
    })
}

/// What an install does to a listed line, given the text recorded for its file and the file's
/// text: a recorded line whose text changed replaces each line equal to the old text where it
/// stands, a line the file holds stays recorded when the record holds that text and is otherwise
/// reported and never recorded, because the operator added it, an update adds no line where the
/// file no longer holds the recorded one, and every other line is added.
fn listed_action(
    listed: &InstalledLine,
    prior: Option<String>,
    found: Option<StartupText>,
    update: bool,
) -> LineAction {
    let holds = |text: &str| {
        found
            .as_ref()
            .is_some_and(|found| holds_line(&found.text, text))
    };
    if let (Some(recorded), Some(text)) = (&prior, &found)
        && *recorded != listed.line
        && holds(recorded)
    {
        return LineAction::Replace {
            listed: listed.clone(),
            prior: recorded.clone(),
            found: text.clone(),
        };
    }
    if holds(&listed.line) {
        return match prior {
            Some(recorded) if recorded == listed.line => LineAction::Hold {
                listed: listed.clone(),
                prior: recorded,
            },
            _ => LineAction::Present {
                listed: listed.clone(),
            },
        };
    }
    if let Some(recorded) = prior.clone()
        && update
    {
        return LineAction::NotHeld {
            path: listed.path.clone(),
            prior: recorded,
        };
    }
    LineAction::Add {
        listed: listed.clone(),
        prior,
        found,
    }
}

/// What a run does to a recorded line it does not list: release it, remove it, or report it gone.
fn unlisted_action(
    recorded: &StartupLine,
    release: &BTreeSet<&Path>,
) -> Result<LineAction, InstallationError> {
    let StartupLine { path, line: prior } = recorded.clone();
    if release.contains(path.as_path()) {
        return Ok(LineAction::Release { path, prior });
    }
    match read_startup(&path)? {
        StartupRead::Unreadable => Err(InstallationError::UnreadableStartupFile(path)),
        StartupRead::UnknownEncoding => Err(InstallationError::UnknownStartupEncoding(path)),
        StartupRead::Text(found) if holds_line(&found.text, &prior) => {
            Ok(LineAction::Remove { path, prior, found })
        }
        _ => Ok(LineAction::NotHeld { path, prior }),
    }
}

/// What a run plans for the lines it names, and the refusals of their startup files.
pub(super) struct NamedPlan {
    pub(super) refused: Vec<LineRefusal>,
    pub(super) actions: Vec<LineAction>,
}

/// What a run does to every startup line it lists or the plugin's file records, and the refusal
/// of each listed startup file that is not a regular file or nothing, which refuses the whole
/// install. It reads each startup file it would change and none it releases, and fails for one in
/// an encoding it does not read. Each listed line is planned with the text recorded for its file,
/// `None` for none.
pub(super) fn plan_lines(
    listing: &LineListing<'_>,
    recorded: &[StartupLine],
) -> Result<NamedPlan, InstallationError> {
    let priors: HashMap<&Path, &String> = recorded
        .iter()
        .map(|entry| (entry.path.as_path(), &entry.line))
        .collect();
    let reads = listing
        .lines
        .iter()
        .map(|listed| Ok((listed, found_text(&listed.path)?)))
        .collect::<Result<Vec<_>, InstallationError>>()?;
    let named: BTreeSet<&Path> = listing
        .lines
        .iter()
        .map(|listed| listed.path.as_path())
        .collect();
    let unlisted: Vec<StartupLine> = recorded
        .iter()
        .filter(|entry| !named.contains(entry.path.as_path()))
        .cloned()
        .collect();
    let mut actions = Vec::new();
    let mut refused = Vec::new();
    for (listed, found) in reads {
        let prior = priors
            .get(listed.path.as_path())
            .map(|line| (*line).clone());
        match found {
            Found::Refused(refusal) => refused.push(refusal),
            Found::Absent => actions.push(listed_action(listed, prior, None, listing.update)),
            Found::Text(text) => {
                actions.push(listed_action(listed, prior, Some(text), listing.update));
            }
        }
    }
    actions.extend(unlisted_actions(&unlisted, &listing.release)?);
    Ok(NamedPlan { refused, actions })
}

/// What a run does to recorded lines it does not list, as an uninstall does to every recorded
/// line: release each the plugin releases, without reading its file, and remove or report each
/// other one.
pub(super) fn unlisted_actions(
    recorded: &[StartupLine],
    release: &BTreeSet<&Path>,
) -> Result<Vec<LineAction>, InstallationError> {
    recorded
        .iter()
        .map(|entry| unlisted_action(entry, release))
        .collect()
}

impl LineAction {
    /// The startup file's path the action touches.
    fn path(&self) -> &Path {
        match self {
            LineAction::Add { listed, .. }
            | LineAction::Hold { listed, .. }
            | LineAction::Present { listed, .. }
            | LineAction::Replace { listed, .. } => &listed.path,
            LineAction::Remove { path, .. }
            | LineAction::NotHeld { path, .. }
            | LineAction::Release { path, .. } => path,
        }
    }

    /// The pending entry of the action. A released line has none, so recovery never reads its
    /// file, and neither has a line the operator added, so recovery never records it.
    pub(super) fn pending(&self) -> Option<PendingLine> {
        let path = self.path().to_path_buf();
        match self {
            LineAction::Add { listed, prior, .. } => Some(PendingLine {
                path,
                prior: prior.clone(),
                intended: Some(listed.line.clone()),
            }),
            LineAction::Hold { listed, prior } | LineAction::Replace { listed, prior, .. } => {
                Some(PendingLine {
                    path,
                    prior: Some(prior.clone()),
                    intended: Some(listed.line.clone()),
                })
            }
            LineAction::Remove { prior, .. } | LineAction::NotHeld { prior, .. } => {
                Some(PendingLine {
                    path,
                    prior: Some(prior.clone()),
                    intended: None,
                })
            }
            LineAction::Present { .. } | LineAction::Release { .. } => None,
        }
    }

    /// The line the action leaves recorded, if any.
    pub(super) fn committed(&self) -> Option<StartupLine> {
        match self {
            LineAction::Add { listed, .. }
            | LineAction::Hold { listed, .. }
            | LineAction::Replace { listed, .. } => Some(StartupLine {
                path: listed.path.clone(),
                line: listed.line.clone(),
            }),
            _ => None,
        }
    }

    /// The missing directories above a startup file the action creates.
    pub(super) fn created_parents(&self) -> Result<Vec<PathBuf>, InstallationError> {
        match self {
            LineAction::Add {
                listed,
                found: None,
                ..
            } => Ok(disk::missing_parents(&listed.path)?),
            _ => Ok(Vec::new()),
        }
    }

    /// Carries out the action: an append or a created file for an added line, and a rewrite for
    /// a replaced or removed one. A held, present, no longer held, or released line changes no
    /// startup file.
    pub(super) fn apply(&self, log: Option<&Log>) -> Result<(), InstallationError> {
        match self {
            LineAction::Add { listed, found, .. } => add_line(listed, found.as_ref()),
            LineAction::Replace {
                listed,
                prior,
                found,
            } => rewrite_lines(
                &listed.path,
                found,
                &LineEdit {
                    prior,
                    replacement: Some(&listed.line),
                },
            ),
            LineAction::Remove { path, prior, found } => rewrite_lines(
                path,
                found,
                &LineEdit {
                    prior,
                    replacement: None,
                },
            ),
            _ => return Ok(()),
        }?;
        if let Some(log) = log {
            file_written(log, self.path());
        }
        Ok(())
    }
}

/// Adds a listed line: appends it to the file it read, or creates the file when there was none. A
/// file another run created since it was read, as when two applications add their lines at once,
/// is read again and gets the line appended unless it already holds it.
fn add_line(listed: &InstalledLine, found: Option<&StartupText>) -> Result<(), InstallationError> {
    if let Some(found) = found {
        return Ok(append_line(&listed.path, found, &listed.line)?);
    }
    if create_startup_file(&listed.path, &listed.line)? {
        return Ok(());
    }
    let Found::Text(created) = found_text(&listed.path)? else {
        return Err(InstallationError::StartupFileChanged(listed.path.clone()));
    };
    if !holds_line(&created.text, &listed.line) {
        append_line(&listed.path, &created, &listed.line)?;
    }
    Ok(())
}

/// What happened to the startup lines, each action under its own list.
pub(super) fn outcome_of(actions: &[LineAction]) -> StartupLinesOutcome {
    let mut outcome = StartupLinesOutcome::default();
    for action in actions {
        let path = action.path().to_path_buf();
        let (list, line) = match action {
            LineAction::Add { listed, .. } => (&mut outcome.added, &listed.line),
            LineAction::Hold { listed, .. } | LineAction::Present { listed, .. } => {
                (&mut outcome.held, &listed.line)
            }
            LineAction::Replace { listed, .. } => (&mut outcome.replaced, &listed.line),
            LineAction::Remove { prior, .. } => (&mut outcome.removed, prior),
            LineAction::NotHeld { prior, .. } => (&mut outcome.no_longer_held, prior),
            LineAction::Release { prior, .. } => (&mut outcome.released, prior),
        };
        list.push(StartupLine {
            path,
            line: line.clone(),
        });
    }
    outcome
}

/// The line a pending startup line resolves to, read from its file without writing: the intended
/// text when the file holds it, else the prior text when it holds that, else no line.
pub(super) fn held_line(entry: &PendingLine) -> Result<Option<StartupLine>, InstallationError> {
    let StartupRead::Text(content) = read_startup(&entry.path)? else {
        return Ok(None);
    };
    Ok([&entry.intended, &entry.prior]
        .into_iter()
        .flatten()
        .find(|text| holds_line(&content.text, text))
        .map(|line| StartupLine {
            path: entry.path.clone(),
            line: line.clone(),
        }))
}

/// Resolves a pending startup line as [`held_line`] reads it, after removing the leftover staging
/// files beside its startup file's real path.
pub(super) fn recovered_line(
    entry: &PendingLine,
    log: Option<&Log>,
) -> Result<Option<StartupLine>, InstallationError> {
    disk::remove_staging_files(&real_path_of(&entry.path)?, log)?;
    held_line(entry)
}
