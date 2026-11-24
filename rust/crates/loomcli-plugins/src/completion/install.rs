//! `completion install`: one shell's script written to a file and, for every shell but Fish, one
//! startup line that loads it, both recorded in the shell's plugin's file. Every check runs before
//! anything is written, and a startup file the plugin cannot change gets the line printed instead.

use std::path::{Path, PathBuf};

use loomcli_core::Error;

use super::messages::{Verb, lines, refusals};
use super::paths::normalize;
use super::profile::{ProfileRequest, ask_profile};
use super::run::{
    ChildRun, DIRECTORY_MODE, ScriptState, ShellRecord, Wanted, Written, installed_or_failure,
    read_shell, record_name, refuse_in_the_way, refuse_windows, remove_notice, report_written,
    script_file, script_state, write_notices,
};
use super::shells::{
    Shell, script_content, script_path, selected_shell, startup_line, startup_path,
};
use super::startup::{
    LinePlacement, LineRequest, StartupJudgement, judge_startup, must_release, place_line,
};
use crate::installation::{Installed, InstalledLine, StartupLine, record_directory, required_home};

/// Where a shell's script goes, and how its startup file is found.
enum Place {
    Fish {
        script: PathBuf,
    },
    File {
        shell: Shell,
        script: PathBuf,
        startup: PathBuf,
    },
    Profile {
        script: PathBuf,
        home: PathBuf,
    },
}

impl Place {
    fn script(&self) -> &Path {
        match self {
            Place::Fish { script } | Place::File { script, .. } | Place::Profile { script, .. } => {
                script
            }
        }
    }

    fn shell(&self) -> Shell {
        match self {
            Place::Fish { .. } => Shell::Fish,
            Place::File { shell, .. } => *shell,
            Place::Profile { .. } => Shell::Pwsh,
        }
    }
}

/// The place of the shell, from the folders it needs from the host's environment. PowerShell runs
/// from the home folder to report its profile.
fn place_of(run: &ChildRun, shell: Shell) -> Result<Place, Error> {
    let (host, name) = (&run.host, run.name.as_str());
    Ok(match shell {
        Shell::Fish => Place::Fish {
            script: script_path(shell, name, host)?,
        },
        Shell::Pwsh => {
            let home = required_home(name, host)?.to_path_buf();
            Place::Profile {
                home,
                script: script_path(shell, name, host)?,
            }
        }
        Shell::Bash | Shell::Zsh => {
            let script = script_path(shell, name, host)?;
            Place::File {
                shell,
                script,
                startup: startup_path(shell, name, host)?,
            }
        }
    })
}

/// The startup file the plugin computes or PowerShell reports, and the line it would hold.
struct Startup {
    path: PathBuf,
    line: String,
}

/// The startup file of the place, asking PowerShell for its profile; none for Fish.
async fn startup_of(run: &ChildRun, place: &Place) -> Result<Option<Startup>, Error> {
    match place {
        Place::Fish { .. } => Ok(None),
        Place::File {
            shell,
            script,
            startup,
        } => Ok(Some(Startup {
            line: startup_line(*shell, &run.name, script),
            path: startup.clone(),
        })),
        Place::Profile { script, home } => {
            let line = startup_line(Shell::Pwsh, &run.name, script);
            let profile = ask_profile(&ProfileRequest {
                name: &run.name,
                host: &run.host,
                home,
                signal: &run.signal,
            })
            .await?;
            Ok(Some(Startup {
                line,
                path: PathBuf::from(normalize(&profile.to_string_lossy())),
            }))
        }
    }
}

/// What an install does to startup lines, and whether the lines stay as recorded with no write.
pub(super) struct LinePlan {
    pub placement: LinePlacement,
    pub steady: bool,
}

/// Each recorded line in another startup file than the install's, which it no longer lists: in a
/// file the plugin cannot change that holds it, or may hold it, released with the line the operator
/// removes by hand, and in any other the module's to remove.
fn other_lines(run: &ChildRun, others: &[&StartupLine]) -> Result<LinePlacement, Error> {
    let mut placement = LinePlacement::default();
    for entry in others {
        if must_release(judge_startup(&entry.path, &entry.line, run.uid())?) {
            placement
                .notices
                .push(remove_notice(run, &entry.path, &entry.line));
            placement.release.push(entry.path.clone());
        }
    }
    Ok(placement)
}

/// The plan for the startup lines: the new startup file judged first, which fails as not a file,
/// then each recorded line in another file, then the new line, written and recorded in a file the
/// plugin may change, and printed with no line recorded in one it may not. Fish lists none.
fn plan_lines(
    run: &ChildRun,
    startup: Option<&Startup>,
    recorded: &[StartupLine],
) -> Result<LinePlan, Error> {
    let Some(startup) = startup else {
        let all: Vec<&StartupLine> = recorded.iter().collect();
        return Ok(LinePlan {
            placement: other_lines(run, &all)?,
            steady: recorded.is_empty(),
        });
    };
    let judgement = judge_startup(&startup.path, &startup.line, run.uid())?;
    let StartupJudgement::File { changeable, holds } = judgement else {
        return Err(refusals::not_a_file(&run.name, &startup.path).into());
    };
    let others: Vec<&StartupLine> = recorded
        .iter()
        .filter(|entry| entry.path != startup.path)
        .collect();
    let before = other_lines(run, &others)?;
    let here = recorded
        .iter()
        .find(|entry| entry.path == startup.path)
        .map(|entry| entry.line.as_str());
    let placed = place_line(
        run,
        &LineRequest {
            path: &startup.path,
            line: &startup.line,
            recorded: here,
            update: false,
        },
        changeable,
        holds,
    )?;
    let new_steady = if placed.lines.is_empty() {
        here.is_none()
    } else {
        holds == Some(true) && here == Some(startup.line.as_str())
    };
    let mut notices = before.notices;
    notices.extend(placed.notices);
    let mut release = before.release;
    release.extend(placed.release);
    Ok(LinePlan {
        steady: others.is_empty() && new_steady,
        placement: LinePlacement {
            lines: placed.lines,
            loaded: placed.loaded,
            notices,
            release,
        },
    })
}

/// What an install writes for one shell, after every check.
struct Writing {
    record: PathBuf,
    recorded: ShellRecord,
    place: Place,
    content: String,
    plan: LinePlan,
}

/// States a script and line that are already in place, and the line the operator adds by hand.
async fn report_steady(run: &ChildRun, writing: &Writing) -> Result<(), Error> {
    run.info(&lines::unchanged(writing.place.script())).await?;
    let placement = &writing.plan.placement;
    for path in placement
        .lines
        .iter()
        .map(|entry| &entry.path)
        .chain(&placement.loaded)
    {
        run.info(&lines::already_loads(path)).await?;
    }
    write_notices(run, &placement.notices).await
}

/// Installs the script and lines through the module, or fails as a refusal does.
fn install_through(run: &ChildRun, writing: &Writing) -> Result<Installed, Error> {
    let Writing {
        content,
        place,
        plan,
        record,
        ..
    } = writing;
    let request = crate::installation::InstallRequest::new()
        .directory_mode(DIRECTORY_MODE)
        .files([script_file(place.script(), content)])
        .lines(
            plan.placement
                .lines
                .iter()
                .map(|line| InstalledLine::new(&line.path, &line.line)),
        )
        .release(plan.placement.release.iter());
    let file = crate::installation::PluginRecord::new(record, record_name(place.shell()));
    let outcome = file.install(&request, &run.signal)?;
    installed_or_failure(run, outcome, place.shell(), Verb::Install)
}

/// Whether an install changed anything: the script or a startup line. A recorded script it removes
/// sits at another path than the one it writes, so the script changed too.
fn changed_anything(script_changed: bool, outcome: &Installed) -> bool {
    let line_changes = outcome.lines.as_ref().is_some_and(|changes| {
        !(changes.added.is_empty() && changes.replaced.is_empty() && changes.removed.is_empty())
    });
    script_changed || line_changes
}

/// States the script, by what the record said of it before the write, everything else the install
/// did, and, when anything changed, to open a new shell.
async fn report_installed(
    run: &ChildRun,
    writing: &Writing,
    script_changed: bool,
    outcome: &Installed,
) -> Result<(), Error> {
    let place = &writing.place;
    if script_changed {
        run.success(&lines::installed(place.shell().name(), place.script()))
            .await?;
    } else {
        run.info(&lines::unchanged(place.script())).await?;
    }
    report_written(
        run,
        &Written {
            outcome,
            held: true,
            loaded: &writing.plan.placement.loaded,
            notices: &writing.plan.placement.notices,
        },
    )
    .await?;
    if changed_anything(script_changed, outcome) {
        run.info(lines::OPEN_SHELL).await?;
    }
    Ok(())
}

/// Writes the script and lines through the module, then states each change.
async fn write(run: &ChildRun, writing: &Writing) -> Result<(), Error> {
    let state = script_state(&writing.recorded, writing.place.script(), &writing.content)?;
    if state == ScriptState::Steady && writing.plan.steady {
        return report_steady(run, writing).await;
    }
    let outcome = install_through(run, writing)?;
    report_installed(run, writing, state == ScriptState::Changed, &outcome).await
}

/// `install`: the platform, the shell, the folders and the script's path, the record's directory,
/// the shell's plugin's file, the script, PowerShell's profile, and the startup files, each checked
/// in that order, then the script and line written and each change stated.
pub(super) async fn install_shell(run: &ChildRun, argument: Option<Shell>) -> Result<(), Error> {
    refuse_windows(run, argument)?;
    let shell = selected_shell(&run.name, &run.host, argument)?;
    let place = place_of(run, shell)?;
    let record = record_directory(&run.name, &run.host)?;
    let recorded = read_shell(run, &record, shell, Verb::Install)?;
    refuse_in_the_way(
        run,
        Verb::Install,
        &[Wanted {
            shell,
            script: place.script(),
            files: &recorded.files,
        }],
    )
    .await?;
    let startup = startup_of(run, &place).await?;
    let plan = plan_lines(run, startup.as_ref(), &recorded.lines)?;
    let content = script_content(shell, &run.name);
    write(
        run,
        &Writing {
            content,
            place,
            plan,
            record,
            recorded,
        },
    )
    .await
}
