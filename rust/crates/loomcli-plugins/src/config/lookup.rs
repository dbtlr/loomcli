//! The lookup: the one file a run reads. `--config` names it, or else the variable does, or else
//! the first of the pattern's candidates found in the scopes the author chose: the project scope's
//! walk from the start directory, then the user scope's home directory and user folder. A file the
//! variable names or the lookup discovers that cannot be used warns and ends the lookup with no
//! configuration, and the named file fails the run.
//!
//! The lookup is synchronous: it reads the file system and returns the lines the run writes, in
//! order, so the caller writes them once whichever reader asked first.

use std::io;
use std::path::{Component, Path, PathBuf};

use loomcli_core::{
    ContextualStyle, Host, InputError, InputIdentity, InputKind, InputProblem, InvokedBy, Issue,
    OptionGroupKind, escape_control_characters,
};

use super::document::Value;
use super::messages;
use super::reading::{Clause, Reading, parse_file, split_extension};

/// One line the lookup or the drop writes, by its level.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Line {
    Warn(String),
    Info(String),
    Debug(String),
}

/// One file the lookup reads: where it is, and how a label or a message shows it, its control
/// characters escaped.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ConfigFile {
    pub(crate) path: PathBuf,
    pub(crate) shown: String,
}

impl ConfigFile {
    fn new(path: PathBuf, shown: &str) -> Self {
        Self {
            path,
            shown: escape_control_characters(shown),
        }
    }
}

/// The file a run reads from, and the object its text holds.
#[derive(Clone, Debug)]
pub(crate) struct UsableFile {
    pub(crate) file: ConfigFile,
    pub(crate) object: Value,
}

/// The scopes the lookup reads and the markers that end its walk, judged once at the call.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Reach {
    pub(crate) project: bool,
    pub(crate) user: bool,
    pub(crate) markers: Vec<String>,
}

/// What decides the file one run reads.
pub(crate) struct Lookup<'a> {
    /// The pattern's candidates, relative paths in the order the lookup tries them.
    pub(crate) candidates: &'a [String],
    /// The directory option's value, which replaces `host.cwd` as the walk's start.
    pub(crate) directory: Option<&'a str>,
    /// The value of the author-named variable, empty or unset when it names nothing.
    pub(crate) from_variable: Option<&'a str>,
    pub(crate) host: &'a Host,
    /// The application's name, which the user folder and the notice use.
    pub(crate) app: &'a str,
    pub(crate) notice: bool,
    pub(crate) reach: &'a Reach,
    /// The file `--config` named.
    pub(crate) named: Option<&'a str>,
    /// Whether `--no-config` asked the run to read no file.
    pub(crate) ignored: bool,
    pub(crate) style: &'a ContextualStyle,
}

/// A path resolved against a base and normalized lexically, as `node:path` resolves one: `.`
/// segments dropped, `..` removing the segment before it, and no symbolic link followed.
pub(crate) fn resolve(base: &Path, path: &Path) -> PathBuf {
    let joined = base.join(path);
    let mut resolved = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if resolved.parent().is_some() {
                    resolved.pop();
                }
            }
            other => resolved.push(other.as_os_str()),
        }
    }
    resolved
}

/// A path as a message shows it.
fn shown(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Whether a failure means nothing is at the path, a missing directory or a file in its place
/// included.
fn is_absent(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
    )
}

/// Whether something is at a path, through a symbolic link. A failure other than absence counts as
/// present, so a read reports it.
fn is_present(path: &Path) -> bool {
    match std::fs::metadata(path) {
        Ok(_) => true,
        Err(error) => !is_absent(&error),
    }
}

/// Whether a directory holds an entry of a marker's name: a file, a directory, or any symbolic
/// link, a dangling one included.
fn holds_marker(directory: &Path, markers: &[String]) -> bool {
    markers.iter().any(
        |marker| match std::fs::symlink_metadata(directory.join(marker)) {
            Ok(_) => true,
            Err(error) => !is_absent(&error),
        },
    )
}

/// Whether a directory is the home directory or inside it, compared lexically.
fn is_inside(directory: &Path, home: &Path) -> bool {
    directory.starts_with(home)
}

/// The project directories, nearest first. Home belongs to the user scope even at the ceiling.
fn walk_directories(start: &Path, home: Option<&Path>, ceiling: Option<&Path>) -> Vec<PathBuf> {
    if let Some(ceiling) = ceiling.filter(|ceiling| !start.starts_with(ceiling)) {
        return if Some(start) == home || ceiling.starts_with(start) {
            Vec::new()
        } else {
            vec![start.to_path_buf()]
        };
    }
    let home = home.filter(|home| is_inside(start, home));
    let mut directories = Vec::new();
    for directory in start
        .ancestors()
        .take_while(|directory| Some(*directory) != home)
    {
        directories.push(directory.to_path_buf());
        if Some(directory) == ceiling {
            break;
        }
    }
    directories
}

/// The extensions the user file may carry.
const USER_EXTENSIONS: [&str; 5] = ["json", "jsonc", "toml", "yaml", "yml"];

/// The user file's candidates, `config.<ext>`: each of the pattern's candidates names one
/// extension, its own when the plugin reads it and `json` otherwise, and an extension named twice
/// counts once.
fn user_candidates(candidates: &[String]) -> Vec<String> {
    let mut extensions: Vec<&str> = Vec::new();
    for candidate in candidates {
        let extension = split_extension(candidate)
            .map(|(_, extension)| extension)
            .filter(|extension| USER_EXTENSIONS.contains(extension))
            .unwrap_or("json");
        if !extensions.contains(&extension) {
            extensions.push(extension);
        }
    }
    extensions
        .iter()
        .map(|extension| format!("config.{extension}"))
        .collect()
}

/// The home directory: `host.home` when it is an absolute path, normalized.
fn home_of(host: &Host) -> Option<PathBuf> {
    host.home
        .is_absolute()
        .then(|| resolve(Path::new("/"), &host.home))
}

/// The folder of the application's own files under the user's configuration folder:
/// `$XDG_CONFIG_HOME/<app>`, or `<home>/.config/<app>` when the variable is unset, empty, or
/// relative. None when there is neither.
fn user_folder(app: &str, host: &Host, home: Option<&Path>) -> Option<PathBuf> {
    match host.env.get("XDG_CONFIG_HOME") {
        Some(xdg) if Path::new(xdg).is_absolute() => {
            Some(resolve(Path::new("/"), Path::new(xdg)).join(app))
        }
        _ => home.map(|home| home.join(".config").join(app)),
    }
}

/// The file's text as UTF-8, or the clause that says why it could not be read.
fn read_text(path: &Path) -> Result<String, Clause> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
        Err(error) if is_absent(&error) => Err(Clause::DoesNotExist),
        Err(_) => Err(Clause::CouldNotBeRead),
    }
}

/// Reads one file once.
fn read(file: &ConfigFile) -> Reading {
    match read_text(&file.path) {
        Ok(text) => parse_file(&shown(&file.path), &text),
        Err(clause) => Reading::Unusable { clause, at: None },
    }
}

/// How a run that cannot use its configuration fails.
#[derive(Clone, Debug)]
pub(crate) enum LookupFault {
    /// The file `--config` named cannot be used: the message after `File "<path>" `.
    Named(String),
    /// `--config` beside `--no-config`.
    Both,
}

impl LookupFault {
    /// The usage failure: on the `config` option itself, named by its spelling, or by its declared
    /// name in an invocation by name; or the exclusive group's form for the two options together.
    pub(crate) fn error(&self, invoked_by: InvokedBy) -> InputError {
        let by_name = invoked_by == InvokedBy::Name;
        let spelling = |name: &str| {
            if by_name {
                name.to_owned()
            } else {
                format!("--{name}")
            }
        };
        let identity = |name: &str| InputIdentity::new(true, InputKind::Option, name);
        match self {
            LookupFault::Named(message) => {
                let spelling = spelling("config");
                InputError::new(
                    messages::named_file_failure(&spelling, message),
                    vec![InputProblem::Invalid {
                        input: identity("config"),
                        spelling,
                        issues: vec![Issue::new(message.clone())],
                    }],
                )
            }
            LookupFault::Both => {
                let spellings = vec![spelling("config"), spelling("no-config")];
                InputError::new(
                    messages::exclusive_file_options(&spellings),
                    vec![InputProblem::Group {
                        reason: OptionGroupKind::Exclusive,
                        inputs: vec![identity("config"), identity("no-config")],
                        spellings: spellings.clone(),
                        supplied: spellings,
                    }],
                )
            }
        }
    }
}

/// How a step of the lookup ended: with a file, or with no configuration and no later step.
enum Outcome {
    Ended,
    File(UsableFile),
}

/// One directory a discovered step looks in, with the candidates it tries there, in order.
struct Step {
    directory: PathBuf,
    candidates: Vec<String>,
    /// Whether the walk looks here, so a file in the working directory shows as its candidate.
    walked: bool,
}

impl Lookup<'_> {
    /// The working directory as the lookup compares it.
    fn cwd(&self) -> PathBuf {
        resolve(Path::new("/"), &self.host.cwd)
    }

    /// The directory the walk starts in: the directory option's value, or else `host.cwd`.
    fn start(&self) -> PathBuf {
        resolve(&self.cwd(), Path::new(self.directory.unwrap_or(".")))
    }

    /// The candidates in one directory, in candidate order. A file the walk finds in the working
    /// directory shows as the candidate names it, and every other file as its full path.
    fn files_in(&self, step: &Step) -> Vec<ConfigFile> {
        let working = step.walked && step.directory == self.cwd();
        step.candidates
            .iter()
            .map(|candidate| {
                let path = resolve(&step.directory, Path::new(candidate));
                let label = if working {
                    candidate.clone()
                } else {
                    shown(&path)
                };
                ConfigFile::new(path, &label)
            })
            .collect()
    }

    /// The project scope's steps: the walk's directories, nearest first, ending after a directory
    /// that holds a root marker, which is checked once the directory has been looked in.
    fn project_steps(&self, home: Option<&Path>) -> impl Iterator<Item = Step> {
        let ceiling = self
            .host
            .ceiling
            .as_ref()
            .map(|path| resolve(&self.cwd(), path));
        walk_directories(&self.start(), home, ceiling.as_deref())
            .into_iter()
            .map(|directory| Step {
                directory,
                candidates: self.candidates.to_vec(),
                walked: true,
            })
    }

    /// The user scope's steps: the home directory, then the user folder. The home file shows as
    /// its candidate when it is in `host.cwd` and the start is inside home, as a walked file would.
    fn user_steps(&self, home: Option<&Path>) -> Vec<Step> {
        let mut steps = Vec::new();
        if let Some(home) = home {
            steps.push(Step {
                directory: home.to_path_buf(),
                candidates: self.candidates.to_vec(),
                walked: is_inside(&self.start(), home),
            });
        }
        if let Some(folder) = user_folder(self.app, self.host, home) {
            steps.push(Step {
                directory: folder,
                candidates: user_candidates(self.candidates),
                walked: false,
            });
        }
        steps
    }

    /// A discovered file read once: its object, or the end of the lookup after one warning when it
    /// cannot be used. One that does not exist is silent, and the lookup goes on.
    fn discovered(&self, file: ConfigFile, lines: &mut Vec<Line>) -> Option<Outcome> {
        match read(&file) {
            Reading::Usable(object) => Some(Outcome::File(UsableFile { file, object })),
            Reading::Unusable { clause, at } => {
                let step = messages::discovered_step(clause)?;
                lines.push(Line::Warn(messages::skipped_unusable(
                    &file.shown,
                    clause,
                    at,
                    step,
                    self.style,
                )));
                Some(Outcome::Ended)
            }
        }
    }

    /// The outcome one directory gives, or `None` when it holds nothing. The first present
    /// candidate is the file found there. Every later present one is skipped unread with one
    /// warning, ahead of any warning about the found file.
    fn directory_file(&self, step: &Step, lines: &mut Vec<Line>) -> Option<Outcome> {
        let mut present = self
            .files_in(step)
            .into_iter()
            .filter(|file| is_present(&file.path));
        let found = present.next()?;
        let skipped: Vec<ConfigFile> = present.collect();
        if !skipped.is_empty() {
            let names: Vec<&str> = skipped.iter().map(|file| file.shown.as_str()).collect();
            lines.push(Line::Warn(messages::skipped_candidates(
                &names,
                &found.shown,
                self.style,
            )));
        }
        self.discovered(found, lines)
    }

    /// The outcome of the first discovered step that holds a file, the project scope's steps
    /// before the user scope's.
    fn searched(&self, lines: &mut Vec<Line>) -> Option<Outcome> {
        let home = home_of(self.host);
        if self.reach.project {
            for step in self.project_steps(home.as_deref()) {
                if let Some(outcome) = self.directory_file(&step, lines) {
                    return Some(outcome);
                }
                if holds_marker(&step.directory, &self.reach.markers) {
                    break;
                }
            }
        }
        if self.reach.user {
            for step in self.user_steps(home.as_deref()) {
                if let Some(outcome) = self.directory_file(&step, lines) {
                    return Some(outcome);
                }
            }
        }
        None
    }

    /// The line that says no file was found, naming the first candidate in the first directory the
    /// lookup looks in: the start directory, or, when the walk looks nowhere or the project scope
    /// is not read, the home directory, or else the user folder. None when it looks nowhere.
    fn notice_line(&self) -> Option<Line> {
        let home = home_of(self.host);
        let walked = if self.reach.project {
            self.project_steps(home.as_deref()).next()
        } else {
            None
        };
        let step = walked.or_else(|| {
            if self.reach.user {
                self.user_steps(home.as_deref()).into_iter().next()
            } else {
                None
            }
        })?;
        let first = self.files_in(&step).into_iter().next()?;
        Some(Line::Info(messages::no_file_notice(
            &first.shown,
            self.app,
            self.style,
        )))
    }

    /// The one file a run reads, or `None` when it finds none it can use, with the lines the run
    /// writes. `--no-config` reads no file and writes no notice, and with `--config` beside it
    /// fails. The named file answers alone and fails the run when it cannot be used. Then the
    /// variable's file answers alone, and the walk, the home directory, and the user folder answer
    /// in that order. A file that cannot be used ends the lookup with a warning.
    pub(crate) fn find(&self, lines: &mut Vec<Line>) -> Result<Option<UsableFile>, LookupFault> {
        if self.ignored {
            return match self.named {
                Some(_) => Err(LookupFault::Both),
                None => Ok(None),
            };
        }
        if let Some(named) = self.named {
            let file = ConfigFile::new(resolve(&self.cwd(), Path::new(named)), named);
            return match read(&file) {
                Reading::Usable(object) => Ok(Some(UsableFile { file, object })),
                Reading::Unusable { clause, at } => Err(LookupFault::Named(
                    messages::named_file_issue(&file.shown, clause, at),
                )),
            };
        }
        let outcome = match self.from_variable.filter(|value| !value.is_empty()) {
            Some(value) => {
                let file = ConfigFile::new(resolve(&self.cwd(), Path::new(value)), value);
                // The variable's file always ends the lookup, so only a search is noticed.
                Some(self.discovered(file, lines).unwrap_or(Outcome::Ended))
            }
            None => {
                let outcome = self.searched(lines);
                if outcome.is_none() && self.notice {
                    lines.extend(self.notice_line());
                }
                outcome
            }
        };
        Ok(match outcome {
            Some(Outcome::File(usable)) => Some(usable),
            _ => None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_resolves_lexically() {
        assert_eq!(
            resolve(Path::new("/a/b"), Path::new("../c/./d")),
            PathBuf::from("/a/c/d")
        );
        assert_eq!(
            resolve(Path::new("/a"), Path::new("/x/")),
            PathBuf::from("/x")
        );
        assert_eq!(
            resolve(Path::new("/"), Path::new("../..")),
            PathBuf::from("/")
        );
    }

    #[test]
    fn the_walk_ends_below_home_inside_home_and_at_the_root_outside_it() {
        let home = Path::new("/h");
        assert_eq!(
            walk_directories(Path::new("/h/w/d"), Some(home), None),
            [PathBuf::from("/h/w/d"), PathBuf::from("/h/w")]
        );
        assert!(walk_directories(home, Some(home), None).is_empty());
        assert_eq!(
            walk_directories(Path::new("/p/a"), Some(home), None),
            [
                PathBuf::from("/p/a"),
                PathBuf::from("/p"),
                PathBuf::from("/")
            ]
        );
    }

    #[test]
    fn each_candidate_names_one_user_file_extension() {
        let candidates: Vec<String> = [".a.toml", ".arc", ".a.conf", ".a.toml", ".a.yml"]
            .iter()
            .map(|candidate| (*candidate).to_owned())
            .collect();
        assert_eq!(
            user_candidates(&candidates),
            ["config.toml", "config.json", "config.yml"]
        );
    }
}
