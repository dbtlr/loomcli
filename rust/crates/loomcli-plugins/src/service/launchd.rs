//! The launchd backend: `launchctl` in the user's `gui/<uid>` domain.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use loomcli_core::Error;

use super::backend::{Reading, Unit, normalized};
use super::manager::{Answer, Call, READ_LIMIT, READ_LIMIT_SECONDS, Read, SUCCEEDED};
use super::messages::{self, UnreadableCall};

/// `launchctl`'s code for a service or domain that is not loaded.
const NOT_LOADED: i32 = 113;

/// `bootout`'s code for a service with no such process, which is not loaded.
const NO_SUCH_PROCESS: i32 = 3;

/// `bootout`'s code for an unload already in progress.
const IN_PROGRESS: i32 = 36;

/// `bootout`'s codes that are no failure: not loaded, and an unload already in progress.
const UNLOADED: [i32; 4] = [SUCCEEDED, NO_SUCH_PROCESS, IN_PROGRESS, NOT_LOADED];

/// How long the unload wait pauses between two `print` calls, with no deadline.
const POLL_INTERVAL: Duration = Duration::from_millis(250);

/// The plist's file extension.
const EXTENSION: &str = ".plist";

/// The user's launchd domain.
fn domain(unit: &Unit<'_>) -> String {
    format!("gui/{}", unit.uid)
}

/// The launchd service target of one label in the user's domain.
fn target(unit: &Unit<'_>, label: &str) -> String {
    format!("{}/{label}", domain(unit))
}

/// One `launchctl` call about `label`, its failure pointing at that service's own report.
fn launchctl(unit: &Unit<'_>, label: &str, args: &[&str]) -> Call {
    Call {
        program: "launchctl",
        args: args.iter().map(|word| (*word).to_owned()).collect(),
        report: format!("launchctl print {}", target(unit, label)),
    }
}

/// Whether `label`'s agent is loaded: `print` exits 0 when it is and 113 when it is not.
async fn is_loaded(unit: &Unit<'_>, label: &str) -> Result<bool, Error> {
    let call = launchctl(unit, label, &["print", &target(unit, label)]);
    let (code, _) = unit.manager.expect(&call, &[SUCCEEDED, NOT_LOADED]).await?;
    Ok(code == SUCCEEDED)
}

/// Unloads `label`'s agent, then polls `print` every 250 milliseconds until it is not loaded, with
/// no deadline; the run signal ends the wait.
async fn unload(unit: &Unit<'_>, label: &str) -> Result<(), Error> {
    let call = launchctl(unit, label, &["bootout", &target(unit, label)]);
    unit.manager.expect(&call, &UNLOADED).await?;
    while is_loaded(unit, label).await? {
        unit.manager.pause(POLL_INTERVAL).await?;
    }
    Ok(())
}

/// Loads the plist at the unit's path into the user's domain.
async fn bootstrap(unit: &Unit<'_>) -> Result<(), Error> {
    let path = unit.path.to_string_lossy();
    let call = launchctl(unit, unit.label, &["bootstrap", &domain(unit), &path]);
    unit.manager.expect(&call, &[SUCCEEDED]).await?;
    Ok(())
}

/// Runs `kickstart` on the label's agent, with `-k` to kill a running process first.
async fn kickstart(unit: &Unit<'_>, kill: bool) -> Result<(), Error> {
    let target = target(unit, unit.label);
    let args: Vec<&str> = ["kickstart"]
        .into_iter()
        .chain(kill.then_some("-k"))
        .chain([target.as_str()])
        .collect();
    unit.manager
        .expect(&launchctl(unit, unit.label, &args), &[SUCCEEDED])
        .await?;
    Ok(())
}

/// Kickstarts a loaded agent, or bootstraps one that is not loaded.
async fn kickstart_or_bootstrap(unit: &Unit<'_>, kill: bool) -> Result<(), Error> {
    if is_loaded(unit, unit.label).await? {
        kickstart(unit, kill).await
    } else {
        bootstrap(unit).await
    }
}

/// The unit's path: `<home>/Library/LaunchAgents/<label>.plist`.
pub(super) fn unit_path(label: &str, home: &Path) -> PathBuf {
    normalized(
        &home
            .join("Library")
            .join("LaunchAgents")
            .join(format!("{label}{EXTENSION}")),
    )
}

/// Enables the agent, unloads it, and loads it again, changed or not, so launchd always runs the
/// plist on disk. An earlier install that stopped between its write and its bootstrap is finished
/// this way.
pub(super) async fn install(unit: &Unit<'_>) -> Result<(), Error> {
    let call = launchctl(unit, unit.label, &["enable", &target(unit, unit.label)]);
    unit.manager.expect(&call, &[SUCCEEDED]).await?;
    unload(unit, unit.label).await?;
    bootstrap(unit).await
}

/// Unloads the agent a recorded plist names.
pub(super) async fn retire(unit: &Unit<'_>, path: &Path) -> Result<(), Error> {
    let file = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let label = file.strip_suffix(EXTENSION).unwrap_or(&file);
    unload(unit, label).await
}

pub(super) async fn start(unit: &Unit<'_>) -> Result<(), Error> {
    kickstart_or_bootstrap(unit, false).await
}

pub(super) async fn stop(unit: &Unit<'_>) -> Result<(), Error> {
    unload(unit, unit.label).await
}

pub(super) async fn restart(unit: &Unit<'_>) -> Result<(), Error> {
    kickstart_or_bootstrap(unit, true).await
}

/// The members of `print`'s top level, one tab in, by name.
fn top_level(stdout: &str) -> HashMap<String, String> {
    let mut members = HashMap::new();
    for line in stdout.split('\n') {
        let Some(rest) = line.strip_prefix('\t') else {
            continue;
        };
        let Some((name, value)) = rest.split_once('=') else {
            continue;
        };
        let Some(name) = name.strip_suffix(' ') else {
            continue;
        };
        let Some(value) = value.strip_prefix(' ') else {
            continue;
        };
        if name.is_empty() || name.contains('\t') {
            continue;
        }
        members
            .entry(name.to_owned())
            .or_insert_with(|| value.trim().to_owned());
    }
    members
}

/// The state of a loaded agent from `print`'s top level: its `state` line, running when that state
/// is `running` or a `pid` line of digits is there, and that pid.
pub(super) fn read_printed(stdout: &str) -> (String, bool, Option<u64>) {
    let members = top_level(stdout);
    let state = members.get("state").map_or("unknown", String::as_str);
    let pid = members
        .get("pid")
        .filter(|digits| !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()))
        .and_then(|digits| digits.parse::<u64>().ok());
    let running = state == "running" || pid.is_some();
    (state.to_owned(), running, pid)
}

/// The note a domain with no login session adds, or none for any other answer.
async fn session_notes(unit: &Unit<'_>) -> Result<Vec<String>, Error> {
    let call = Call {
        program: "launchctl",
        args: vec!["print".to_owned(), domain(unit)],
        report: String::new(),
    };
    let answer = unit.manager.read(&call, READ_LIMIT).await?;
    Ok(match answer {
        Read::Answered(Answer::Exited { code, .. }) if code == NOT_LOADED => {
            vec![messages::no_session(unit.label)]
        }
        _ => Vec::new(),
    })
}

/// The note of a `print` call that could not report the agent.
fn unreadable_note(unit: &Unit<'_>, name: &str, answer: &Read) -> String {
    let report = format!("launchctl print {name}");
    let call = UnreadableCall {
        manager: "launchctl",
        target: name,
        report: &report,
    };
    match answer {
        Read::Answered(Answer::Missing(_)) => {
            messages::missing_sentence(unit.manager.name, "launchctl")
        }
        Read::TimedOut => messages::timed_out(&call, READ_LIMIT_SECONDS),
        Read::Answered(Answer::Exited { code, .. }) => messages::unreadable(&call, *code),
    }
}

/// The state `print` reports for the label's agent, and the session note for an installed one.
pub(super) async fn read(unit: &Unit<'_>, installed: bool) -> Result<Reading, Error> {
    let name = target(unit, unit.label);
    let answer = unit
        .manager
        .read(&launchctl(unit, unit.label, &["print", &name]), READ_LIMIT)
        .await?;
    let session = if installed {
        session_notes(unit).await?
    } else {
        Vec::new()
    };
    Ok(match &answer {
        Read::Answered(Answer::Exited { code, .. }) if *code == NOT_LOADED => Reading {
            state: if installed {
                "not loaded"
            } else {
                "not installed"
            }
            .to_owned(),
            running: false,
            pid: None,
            notes: session,
        },
        Read::Answered(Answer::Exited { code, stdout }) if *code == SUCCEEDED => {
            let (state, running, pid) = read_printed(stdout);
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
