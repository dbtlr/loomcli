//! Where the log file is: the default directory per platform, and how a `file` setting resolves.

use std::path::{Component, Path, PathBuf};

use loomcli_core::{ApplicationDirectory, DirectoryFacts, DirectoryLookup, application_directory};

use super::error::LoggingError;

const HOME_PREFIX: &str = "~/";

/// `path` with `.` and `..` segments and repeated separators resolved lexically, as the
/// reference's `path.join` normalizes its result.
fn normalized(path: &Path) -> PathBuf {
    let mut parts: Vec<Component<'_>> = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => match parts.last() {
                Some(Component::Normal(_)) => {
                    parts.pop();
                }
                Some(Component::RootDir | Component::Prefix(_)) => {}
                _ => parts.push(component),
            },
            other => parts.push(other),
        }
    }
    parts.iter().collect()
}

/// The log file: `<application>.jsonl` in the default directory without a `file` setting; a `file`
/// that starts with `~/` under the home directory (extra slashes after it do not leave home, as in
/// Node's `join`), an absolute one as written, and any other inside
/// the default directory. Nothing resolves against the working directory. A path the destination's
/// variables cannot give is the failure that names the missing variable.
pub fn resolve_log_file(
    file: Option<&str>,
    application: &str,
    facts: &DirectoryFacts,
) -> Result<PathBuf, LoggingError> {
    if let Some(rest) = file.and_then(|file| file.strip_prefix(HOME_PREFIX)) {
        if !facts.home().is_absolute() {
            return Err(LoggingError::unresolved("HOME"));
        }
        return Ok(normalized(&facts.home().join(rest.trim_start_matches('/'))));
    }
    if let Some(file) = file.filter(|file| Path::new(file).is_absolute()) {
        return Ok(PathBuf::from(file));
    }
    match application_directory(ApplicationDirectory::Logs, application, facts) {
        DirectoryLookup::Path(directory) => {
            let name = file.map_or_else(|| format!("{application}.jsonl"), str::to_owned);
            Ok(normalized(&directory.join(name)))
        }
        DirectoryLookup::Variable(variable) => Err(LoggingError::unresolved(&variable)),
        _ => Err(LoggingError::unresolved("HOME")),
    }
}
