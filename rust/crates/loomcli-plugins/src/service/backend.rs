//! What a run's service is, and the two backends that act on it: systemd on Linux and launchd on
//! macOS.

use std::path::{Component, Path, PathBuf};

use loomcli_core::{Env, Error};

use super::manager::Manager;
use super::unit::UnitValues;
use super::{launchd, systemd};

/// One run's service: who runs it, its label, where its unit lives, and how its calls run.
pub(super) struct Unit<'a> {
    /// The application's name.
    pub(super) name: &'a str,
    pub(super) label: &'a str,
    /// The process's user id, the one fact the plugin reads from the process.
    pub(super) uid: u32,
    /// The unit file's path.
    pub(super) path: PathBuf,
    pub(super) manager: Manager<'a>,
}

/// What a manager reports about the unit, before status adds the probe's rows.
pub(super) struct Reading {
    pub(super) state: String,
    pub(super) running: bool,
    pub(super) pid: Option<u64>,
    pub(super) notes: Vec<String>,
}

impl Reading {
    /// The reading of a state the manager could not report: unknown and not running, its note
    /// first.
    pub(super) fn unknown(note: String, session: Vec<String>) -> Self {
        Self {
            state: "unknown".to_owned(),
            running: false,
            pid: None,
            notes: std::iter::once(note).chain(session).collect(),
        }
    }
}

/// The two managers a platform selects between.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Backend {
    Systemd,
    Launchd,
}

impl Backend {
    /// The backend of a platform, or none for a platform with neither manager.
    pub(super) fn of(platform: &str) -> Option<Self> {
        match platform {
            "linux" => Some(Backend::Systemd),
            "darwin" => Some(Backend::Launchd),
            _ => None,
        }
    }

    /// The unit's path under the home folder and the environment.
    pub(super) fn unit_path(self, label: &str, home: &Path, env: &Env) -> PathBuf {
        match self {
            Backend::Systemd => systemd::unit_path(label, home, env),
            Backend::Launchd => launchd::unit_path(label, home),
        }
    }

    /// The unit file's text.
    pub(super) fn render(self, values: &UnitValues<'_>) -> String {
        match self {
            Backend::Systemd => super::unit::systemd_unit(values),
            Backend::Launchd => super::unit::launchd_plist(values),
        }
    }

    /// Loads and starts the unit once its file is in place, `written` when the file changed.
    pub(super) async fn install(self, unit: &Unit<'_>, written: bool) -> Result<(), Error> {
        match self {
            Backend::Systemd => systemd::install(unit, written).await,
            Backend::Launchd => launchd::install(unit).await,
        }
    }

    /// Stops a recorded unit, and disables it where the manager does, before its file is removed.
    pub(super) async fn retire(self, unit: &Unit<'_>, path: &Path) -> Result<(), Error> {
        match self {
            Backend::Systemd => systemd::retire(unit, path).await,
            Backend::Launchd => launchd::retire(unit, path).await,
        }
    }

    /// What the manager needs once recorded files are removed.
    pub(super) async fn after_removal(self, unit: &Unit<'_>) -> Result<(), Error> {
        match self {
            Backend::Systemd => systemd::reload(unit).await,
            Backend::Launchd => Ok(()),
        }
    }

    pub(super) async fn start(self, unit: &Unit<'_>) -> Result<(), Error> {
        match self {
            Backend::Systemd => systemd::unit_call(unit, "start").await,
            Backend::Launchd => launchd::start(unit).await,
        }
    }

    pub(super) async fn stop(self, unit: &Unit<'_>) -> Result<(), Error> {
        match self {
            Backend::Systemd => systemd::unit_call(unit, "stop").await,
            Backend::Launchd => launchd::stop(unit).await,
        }
    }

    pub(super) async fn restart(self, unit: &Unit<'_>) -> Result<(), Error> {
        match self {
            Backend::Systemd => systemd::unit_call(unit, "restart").await,
            Backend::Launchd => launchd::restart(unit).await,
        }
    }

    /// The manager's state of the unit, and the session note for an installed one.
    pub(super) async fn read(self, unit: &Unit<'_>, installed: bool) -> Result<Reading, Error> {
        match self {
            Backend::Systemd => systemd::read(unit, installed).await,
            Backend::Launchd => launchd::read(unit, installed).await,
        }
    }
}

/// A path with `.` parts folded away and each `..` removed with the part before it, as a path join
/// reads it, without reading the file system.
pub(super) fn normalized(path: &Path) -> PathBuf {
    let mut folded = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                folded.pop();
            }
            other => folded.push(other.as_os_str()),
        }
    }
    folded
}
