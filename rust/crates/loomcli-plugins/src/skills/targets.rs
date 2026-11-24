//! Where each agent target keeps its skills: the global folders under the operator's home, and the
//! real paths two folders resolve to, so a link between them is seen.

use std::path::{Path, PathBuf};

use loomcli_core::{Error, Host};

use crate::installation::{home_of, home_refusal, real_path};

/// The agents the plugin installs for, in the order every child follows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Target {
    /// Claude Code's own skills folder.
    Claude,
    /// The shared agents folder that Codex and others read.
    Agents,
}

/// Both targets, `claude` first.
pub(super) const TARGETS: [Target; 2] = [Target::Claude, Target::Agents];

impl Target {
    /// The target's name, as `--agent` spells it and as the record's file is named.
    pub(super) fn name(self) -> &'static str {
        match self {
            Target::Claude => "claude",
            Target::Agents => "agents",
        }
    }

    /// The target `--agent` names.
    pub(super) fn named(name: &str) -> Option<Self> {
        TARGETS.into_iter().find(|target| target.name() == name)
    }
}

/// The targets a child acts on: the one `--agent` names, or both.
pub(super) fn selected_targets(agent: Option<Target>) -> Vec<Target> {
    agent.map_or_else(|| TARGETS.to_vec(), |target| vec![target])
}

/// The absolute `CLAUDE_CONFIG_DIR` the host's environment names, or none.
fn claude_config_of(host: &Host) -> Option<PathBuf> {
    host.env
        .get("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .filter(|directory| directory.is_absolute())
}

/// The skills directory of a target under the operator's home, or none when no home names it.
pub(super) fn skills_directory(target: Target, host: &Host) -> Option<PathBuf> {
    if target == Target::Claude {
        if let Some(configured) = claude_config_of(host) {
            return Some(configured.join("skills"));
        }
    }
    home_of(&host.home).map(|home| home.join(format!(".{}", target.name())).join("skills"))
}

/// One target's global skills directory.
pub(super) struct Place {
    pub(super) target: Target,
    pub(super) directory: PathBuf,
}

/// The global skills directory of each selected target, or the refusal of a home folder that is not
/// an absolute path when a selected target needs one.
pub(super) fn global_places(
    name: &str,
    host: &Host,
    selected: &[Target],
) -> Result<Vec<Place>, Error> {
    selected
        .iter()
        .map(|&target| {
            skills_directory(target, host)
                .map(|directory| Place { target, directory })
                .ok_or_else(|| home_refusal(name).into())
        })
        .collect()
}

/// The real path of a skill folder: its directory resolved through every link, and its own name
/// kept as it is, because installing replaces a link at the folder and never follows it.
pub(super) fn real_folder(folder: &Path) -> Result<PathBuf, Error> {
    let parent = folder.parent().unwrap_or(folder);
    let resolved = real_path(parent)?;
    Ok(folder
        .file_name()
        .map_or(resolved.clone(), |name| resolved.join(name)))
}
