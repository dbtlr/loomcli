//! The shells `completion install`, `update`, and `uninstall` act on: which shell the operator
//! means, where each one's script goes, what the script holds, and the startup line that loads it.

use std::path::{Path, PathBuf};

use loomcli_core::{Error, Host, InputError, InputIdentity, InputKind, InputProblem};

use super::messages;
use super::name::{identifier, posix_quoted, powershell_quoted};
use super::paths::{dirname, join};
use super::scripts::{bash_script, fish_script, powershell_script, zsh_installed_script};
use crate::installation::{absolute_variable, exists, required_home};

/// The shells completion installs for on Linux and macOS, in the order `uninstall` with no shell
/// follows. `pwsh` is PowerShell 7, which runs the script `completion powershell` prints.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shell {
    /// Bash.
    Bash,
    /// Zsh.
    Zsh,
    /// Fish.
    Fish,
    /// PowerShell 7.
    Pwsh,
}

/// The four shells in `uninstall`'s order.
pub const SHELLS: [Shell; 4] = [Shell::Bash, Shell::Zsh, Shell::Fish, Shell::Pwsh];

/// The four shell names `install` and `uninstall` accept.
pub const SHELL_NAMES: [&str; 4] = ["bash", "zsh", "fish", "pwsh"];

impl Shell {
    /// The shell's name as the operator types it.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Shell::Bash => "bash",
            Shell::Zsh => "zsh",
            Shell::Fish => "fish",
            Shell::Pwsh => "pwsh",
        }
    }

    /// The shell a name is, or none for any other name.
    #[must_use]
    pub fn named(name: &str) -> Option<Shell> {
        SHELLS.into_iter().find(|shell| shell.name() == name)
    }
}

/// The shell `SHELL` names by its last segment, none when it is unset or empty, or the operator's
/// usage error for any other value.
fn login_shell(name: &str, host: &Host) -> Result<Option<Shell>, Error> {
    let login = match host.env.get("SHELL") {
        Some(login) if !login.is_empty() => login,
        _ => return Ok(None),
    };
    let last = login.rsplit('/').next().unwrap_or_default();
    match Shell::named(last) {
        Some(shell) => Ok(Some(shell)),
        None => Err(unknown_shell(name, Some(login)).into()),
    }
}

/// The usage error of a login shell that names none of the four, or none at all: the `shell`
/// argument is missing.
fn unknown_shell(name: &str, login: Option<&str>) -> InputError {
    InputError::new(
        messages::shell_unknown(name, login),
        vec![InputProblem::Missing {
            input: InputIdentity::new(false, InputKind::Argument, "shell"),
            spelling: "shell".to_owned(),
        }],
    )
}

/// The shell `install` acts on: its argument, else the last segment of `SHELL` when it names one of
/// the four. An unset, empty, or any other `SHELL` is the operator's usage error.
pub(super) fn selected_shell(
    name: &str,
    host: &Host,
    argument: Option<Shell>,
) -> Result<Shell, Error> {
    let shell = match argument {
        Some(shell) => Some(shell),
        None => login_shell(name, host)?,
    };
    shell.ok_or_else(|| unknown_shell(name, None).into())
}

fn home_text(name: &str, host: &Host) -> Result<String, Error> {
    Ok(required_home(name, host)?.to_string_lossy().into_owned())
}

/// The data folder: an absolute `XDG_DATA_HOME`, else `.local/share` under the home.
fn data_folder(name: &str, host: &Host) -> Result<String, Error> {
    match absolute_variable(host, "XDG_DATA_HOME") {
        Some(folder) => Ok(folder.to_owned()),
        None => Ok(join(&[&home_text(name, host)?, ".local", "share"])),
    }
}

/// The configuration folder: an absolute `XDG_CONFIG_HOME`, else `.config` under the home.
fn config_folder(name: &str, host: &Host) -> Result<String, Error> {
    match absolute_variable(host, "XDG_CONFIG_HOME") {
        Some(folder) => Ok(folder.to_owned()),
        None => Ok(join(&[&home_text(name, host)?, ".config"])),
    }
}

/// The path of a shell's script, under the folders the host's environment names.
pub(super) fn script_path(shell: Shell, name: &str, host: &Host) -> Result<PathBuf, Error> {
    let path = match shell {
        Shell::Bash => join(&[
            &data_folder(name, host)?,
            name,
            "completion",
            &format!("{name}.bash"),
        ]),
        Shell::Zsh => join(&[
            &data_folder(name, host)?,
            name,
            "completion",
            "zsh",
            &format!("_loom_{}", identifier(name)),
        ]),
        Shell::Fish => join(&[
            &config_folder(name, host)?,
            "fish",
            "completions",
            &format!("{name}.fish"),
        ]),
        Shell::Pwsh => join(&[
            &data_folder(name, host)?,
            name,
            "completion",
            &format!("{name}.pwsh.ps1"),
        ]),
    };
    Ok(PathBuf::from(path))
}

/// The script a shell's file holds.
pub(super) fn script_content(shell: Shell, name: &str) -> String {
    match shell {
        Shell::Bash => bash_script(name),
        Shell::Zsh => zsh_installed_script(name),
        Shell::Fish => fish_script(name),
        Shell::Pwsh => powershell_script(name),
    }
}

/// The Bash startup file on `darwin`: the first login file that exists, else `.bash_profile`.
fn darwin_bash_startup(home: &str) -> Result<String, Error> {
    for file in [".bash_profile", ".bash_login", ".profile"] {
        let candidate = join(&[home, file]);
        if exists(Path::new(&candidate))? {
            return Ok(candidate);
        }
    }
    Ok(join(&[home, ".bash_profile"]))
}

/// The startup file of Bash or Zsh, which the plugin computes. Fish loads the script from its own
/// folder, and PowerShell reports its own startup file, which `profile.rs` asks it for.
pub(super) fn startup_path(shell: Shell, name: &str, host: &Host) -> Result<PathBuf, Error> {
    if shell == Shell::Zsh {
        let folder = match absolute_variable(host, "ZDOTDIR") {
            Some(folder) => folder.to_owned(),
            None => home_text(name, host)?,
        };
        return Ok(PathBuf::from(join(&[&folder, ".zshrc"])));
    }
    let home = home_text(name, host)?;
    if host.platform == "darwin" {
        return Ok(PathBuf::from(darwin_bash_startup(&home)?));
    }
    Ok(PathBuf::from(join(&[&home, ".bashrc"])))
}

/// What every startup line ends with: a comment naming the install Command.
fn marker(name: &str) -> String {
    format!("# added by {name} completion install")
}

/// The line a shell's startup file holds to load the script at `script`. Fish has none, because it
/// loads the script from its own folder.
#[must_use]
pub fn startup_line(shell: Shell, name: &str, script: &Path) -> String {
    let script_text = script.to_string_lossy();
    match shell {
        Shell::Bash => {
            let quoted = posix_quoted(&script_text);
            format!(
                "if [ -n \"${{BASH_VERSION-}}\" ] && [ -f {quoted} ]; then . {quoted}; fi {}",
                marker(name)
            )
        }
        Shell::Zsh => {
            let quoted = posix_quoted(&script_text);
            format!(
                "fpath=({} $fpath); if [ -f {quoted} ]; then . {quoted}; fi {}",
                posix_quoted(&dirname(&script_text)),
                marker(name)
            )
        }
        Shell::Pwsh | Shell::Fish => {
            let quoted = powershell_quoted(&script_text);
            format!(
                "if (Test-Path -LiteralPath {quoted}) {{ . {quoted} }} {}",
                marker(name)
            )
        }
    }
}
