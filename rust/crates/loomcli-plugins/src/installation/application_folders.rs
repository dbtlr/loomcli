//! The folders the installing plugins read from the host, and the refusals of a host that cannot
//! name one: the operator's home folder, `host.home`, and the installation record's directory. The
//! skills, completion, and manpage plugins share them, so each says the same thing.

use std::path::{Path, PathBuf};

use loomcli_core::{
    ApplicationDirectory, DirectoryFacts, DirectoryLookup, FatalError, Host, application_directory,
    escape_control_characters,
};

/// The refusal of a home folder that is not an absolute path, which exits 1:
/// `<name> cannot find your home folder because HOME is not an absolute path. Set HOME to an
/// absolute path, then run the command again.`
#[must_use]
pub fn home_refusal(name: &str) -> FatalError {
    FatalError::new(format!(
        "{} cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.",
        escape_control_characters(name)
    ))
}

/// The absolute path a variable of the host's environment holds, or none.
#[must_use]
pub fn absolute_variable<'a>(host: &'a Host, variable: &str) -> Option<&'a str> {
    host.env
        .get(variable)
        .map(String::as_str)
        .filter(|value| Path::new(value).is_absolute())
}

/// The home folder, `host.home` or a log destination's `home`, when it is an absolute path by the
/// running process's rules, or none.
#[must_use]
pub fn home_of(home: &Path) -> Option<&Path> {
    home.is_absolute().then_some(home)
}

/// The host's home folder, or the [`home_refusal`] of one that is not absolute.
///
/// # Errors
///
/// The refusal, naming the application `name`, when `host.home` is not an absolute path.
pub fn required_home<'a>(name: &str, host: &'a Host) -> Result<&'a Path, FatalError> {
    home_of(&host.home).ok_or_else(|| home_refusal(name))
}

/// The installation record's directory of the application `name`, or the refusal of an
/// environment that cannot name one: `<name> cannot find its installation record because
/// <variable> is not an absolute path. Set <variable> to an absolute path, then run the command
/// again.`
///
/// # Errors
///
/// The refusal, which exits 1, naming the variable the directory needs.
pub fn record_directory(name: &str, host: &Host) -> Result<PathBuf, FatalError> {
    match application_directory(
        ApplicationDirectory::Installation,
        name,
        &DirectoryFacts::from(host),
    ) {
        DirectoryLookup::Path(path) => Ok(path),
        DirectoryLookup::Variable(variable) => Err(FatalError::new(format!(
            "{} cannot find its installation record because {variable} is not an absolute path. Set {variable} to an absolute path, then run the command again.",
            escape_control_characters(name)
        ))),
        // A lookup core adds later names no directory this module can write to.
        _ => Err(home_refusal(name)),
    }
}
