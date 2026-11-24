//! The systemd backend: `systemctl --user` for the unit, and `loginctl` for lingering.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use loomcli_core::{Env, Error};

use super::backend::{Reading, Unit, normalized};
use super::manager::{Answer, Call, READ_LIMIT, READ_LIMIT_SECONDS, Read, SUCCEEDED};
use super::messages::{self, UnreadableCall};
use crate::installation::exists;

/// `systemctl stop`'s code for a unit that is not loaded.
const NOT_LOADED: i32 = 5;

/// The unit name systemd knows the label's unit by.
fn unit_name(label: &str) -> String {
    format!("{label}.service")
}

/// The command whose report a failure about `name` points at.
fn status_command(name: &str) -> String {
    format!("systemctl --user status {name}")
}

/// One `systemctl --user` call, its failure pointing at the status of `name`.
fn systemctl(name: &str, args: &[&str]) -> Call {
    Call {
        program: "systemctl",
        args: std::iter::once("--user")
            .chain(args.iter().copied())
            .map(str::to_owned)
            .collect(),
        report: status_command(name),
    }
}

/// Reloads the manager's units, its failure pointing at the label's unit.
pub(super) async fn reload(unit: &Unit<'_>) -> Result<(), Error> {
    let call = systemctl(&unit_name(unit.label), &["daemon-reload"]);
    unit.manager.expect(&call, &[SUCCEEDED]).await?;
    Ok(())
}

/// Runs one `systemctl --user` call about the label's unit.
pub(super) async fn unit_call(unit: &Unit<'_>, verb: &str) -> Result<(), Error> {
    let name = unit_name(unit.label);
    unit.manager
        .expect(&systemctl(&name, &[verb, &name]), &[SUCCEEDED])
        .await?;
    Ok(())
}

/// The unit's path: `<config>/systemd/user/<label>.service`.
pub(super) fn unit_path(label: &str, home: &Path, env: &Env) -> PathBuf {
    let config = match env.get("XDG_CONFIG_HOME") {
        Some(configured) if Path::new(configured).is_absolute() => PathBuf::from(configured),
        _ => home.join(".config"),
    };
    normalized(&config.join("systemd").join("user").join(unit_name(label)))
}

/// Installs the unit: reloads when its file changed, then enables and restarts it.
pub(super) async fn install(unit: &Unit<'_>, written: bool) -> Result<(), Error> {
    if written {
        reload(unit).await?;
    }
    unit_call(unit, "enable").await?;
    unit_call(unit, "restart").await
}

/// Stops a recorded unit and disables it while its file is there.
pub(super) async fn retire(unit: &Unit<'_>, path: &Path) -> Result<(), Error> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    unit.manager
        .expect(
            &systemctl(&name, &["stop", &name]),
            &[SUCCEEDED, NOT_LOADED],
        )
        .await?;
    if exists(path)? {
        unit.manager
            .expect(&systemctl(&name, &["disable", &name]), &[SUCCEEDED])
            .await?;
    }
    Ok(())
}

/// The values one `systemctl show` output holds, by property name.
fn shown_properties(stdout: &str) -> HashMap<String, String> {
    let mut properties = HashMap::new();
    for line in stdout.split('\n') {
        if let Some((key, value)) = line.split_once('=') {
            if !key.is_empty() {
                properties.insert(key.to_owned(), value.trim().to_owned());
            }
        }
    }
    properties
}

/// The state one `show --property=ActiveState,MainPID` output reads: the `ActiveState` value,
/// running when it is `active` with a `MainPID` above 0, and that pid. A unit with no file that is
/// inactive reads not installed.
pub(super) fn read_shown(stdout: &str, installed: bool) -> (String, bool, Option<u64>) {
    let properties = shown_properties(stdout);
    let active = properties
        .get("ActiveState")
        .map_or("unknown", String::as_str);
    let main_pid = properties.get("MainPID").map_or("", String::as_str);
    let pid = (main_pid.bytes().all(|byte| byte.is_ascii_digit())
        && !main_pid.starts_with('0')
        && !main_pid.is_empty())
    .then(|| main_pid.parse::<u64>().ok())
    .flatten();
    if !installed && active == "inactive" {
        return ("not installed".to_owned(), false, None);
    }
    let running = active == "active" && pid.is_some();
    (active.to_owned(), running, pid)
}

/// The note `Linger=no` adds, or none for any other answer.
async fn linger_notes(unit: &Unit<'_>) -> Result<Vec<String>, Error> {
    let call = Call {
        program: "loginctl",
        args: vec![
            "show-user".to_owned(),
            unit.uid.to_string(),
            "--property=Linger".to_owned(),
        ],
        report: String::new(),
    };
    let answer = unit.manager.read(&call, READ_LIMIT).await?;
    Ok(match answer {
        Read::Answered(Answer::Exited { code, stdout })
            if code == SUCCEEDED
                && shown_properties(&stdout).get("Linger").map(String::as_str) == Some("no") =>
        {
            vec![messages::linger(unit.label)]
        }
        _ => Vec::new(),
    })
}

/// The note of a `show` call that could not report the unit.
fn unreadable_note(unit: &Unit<'_>, name: &str, answer: &Read) -> String {
    let report = status_command(name);
    let call = UnreadableCall {
        manager: "systemctl --user",
        target: name,
        report: &report,
    };
    match answer {
        Read::Answered(Answer::Missing(_)) => {
            messages::missing_sentence(unit.manager.name, "systemctl")
        }
        Read::TimedOut => messages::timed_out(&call, READ_LIMIT_SECONDS),
        Read::Answered(Answer::Exited { code, .. }) => messages::unreadable(&call, *code),
    }
}

/// The manager's state of the label's unit, and the session note for an installed one.
pub(super) async fn read(unit: &Unit<'_>, installed: bool) -> Result<Reading, Error> {
    let name = unit_name(unit.label);
    let call = systemctl(&name, &["show", &name, "--property=ActiveState,MainPID"]);
    let answer = unit.manager.read(&call, READ_LIMIT).await?;
    let session = if installed {
        linger_notes(unit).await?
    } else {
        Vec::new()
    };
    Ok(match &answer {
        Read::Answered(Answer::Exited { code, stdout }) if *code == SUCCEEDED => {
            let (state, running, pid) = read_shown(stdout, installed);
            Reading {
                state,
                running,
                pid,
                notes: session,
            }
        }
        _ => Reading::unknown(unreadable_note(unit, &name, &answer), session),
    })
}
