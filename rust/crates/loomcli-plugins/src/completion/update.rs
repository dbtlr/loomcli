//! `completion update`: each shell whose plugin's file records a script gets this version's script
//! at its recorded path, and its recorded line replaced where it stands when this version's line
//! differs. It reads no variable the paths come from and runs no shell, and it checks every shell
//! before it writes any.

use std::path::{Path, PathBuf};

use loomcli_core::Error;

use super::messages::{Verb, lines};
use super::run::{
    ChildRun, DIRECTORY_MODE, ScriptState, ShellRecord, Wanted, Written, installed_or_failure,
    read_shell, record_name, refuse_in_the_way, refuse_windows, report_written, script_file,
    script_state,
};
use super::shells::{SHELLS, Shell, script_content, startup_line};
use super::startup::{LinePlacement, LineRequest, StartupJudgement, judge_startup, place_line};
use crate::installation::{Installed, InstalledLine, PluginRecord, StartupLine, record_directory};

/// What an update does to one recorded line, and whether the line stays as recorded with no write.
struct LineStep {
    placement: LinePlacement,
    steady: bool,
}

/// The step of a line whose startup file is no longer a file: nothing listed or released, so the
/// module drops it and reports the file no longer holds it.
fn dropped() -> LineStep {
    LineStep {
        placement: LinePlacement::default(),
        steady: false,
    }
}

/// The step of one recorded line, given this version's text of it: written where it stands in a
/// startup file the plugin may change, and released with no line recorded in one it may not, the
/// operator told to replace a line whose text this version changes.
fn line_step(run: &ChildRun, recorded: &StartupLine, line: &str) -> Result<LineStep, Error> {
    let path = recorded.path.as_path();
    let judgement = judge_startup(path, line, run.uid())?;
    let StartupJudgement::File { changeable, holds } = judgement else {
        return Ok(dropped());
    };
    let placement = place_line(
        run,
        &LineRequest {
            path,
            line,
            recorded: Some(&recorded.line),
            update: true,
        },
        changeable,
        holds,
    )?;
    let steady = !placement.lines.is_empty() && holds == Some(true) && recorded.line == line;
    Ok(LineStep { placement, steady })
}

/// A shell an update writes: its record, the recorded script, and what it does to each line.
struct Planned {
    recorded: ShellRecord,
    script: PathBuf,
    steps: Vec<LineStep>,
}

/// What an update does to each recorded line of a shell, given the recorded script's path.
fn plan_shell(run: &ChildRun, recorded: ShellRecord, script: PathBuf) -> Result<Planned, Error> {
    let mut steps = Vec::with_capacity(recorded.lines.len());
    for entry in &recorded.lines {
        steps.push(if recorded.shell == Shell::Fish {
            dropped()
        } else {
            line_step(
                run,
                entry,
                &startup_line(recorded.shell, &run.name, &script),
            )?
        });
    }
    Ok(Planned {
        recorded,
        script,
        steps,
    })
}

/// Rewrites the script and lines through the module, or fails as a refusal does.
fn rewrite(
    run: &ChildRun,
    record: &Path,
    planned: &Planned,
    content: &str,
) -> Result<Installed, Error> {
    let shell = planned.recorded.shell;
    let request = crate::installation::InstallRequest::new()
        .directory_mode(DIRECTORY_MODE)
        .files([script_file(&planned.script, content)])
        .lines(
            planned
                .steps
                .iter()
                .flat_map(|step| &step.placement.lines)
                .map(|line| InstalledLine::new(&line.path, &line.line)),
        )
        .release(
            planned
                .steps
                .iter()
                .flat_map(|step| &step.placement.release),
        )
        .update(true);
    let outcome = PluginRecord::new(record, record_name(shell)).install(&request, &run.signal)?;
    installed_or_failure(run, outcome, shell, Verb::Update)
}

/// Rewrites one shell's script and lines, or states them unchanged, then states each change.
async fn update_shell(run: &ChildRun, record: &Path, planned: &Planned) -> Result<(), Error> {
    let Planned {
        recorded,
        script,
        steps,
    } = planned;
    let content = script_content(recorded.shell, &run.name);
    let state = script_state(recorded, script, &content)?;
    if state == ScriptState::Steady && steps.iter().all(|step| step.steady) {
        return run.info(&lines::unchanged(script)).await;
    }
    let outcome = rewrite(run, record, planned, &content)?;
    if state == ScriptState::Changed {
        run.success(&lines::updated(recorded.shell.name(), script))
            .await?;
    } else {
        run.info(&lines::unchanged(script)).await?;
    }
    let notices: Vec<_> = steps
        .iter()
        .flat_map(|step| step.placement.notices.iter())
        .cloned()
        .collect();
    report_written(
        run,
        &Written {
            outcome: &outcome,
            held: false,
            loaded: &[],
            notices: &notices,
        },
    )
    .await
}

/// The shells whose plugin's file records a script, each with the first script it records.
fn recorded_shells(run: &ChildRun, record: &Path) -> Result<Vec<(ShellRecord, PathBuf)>, Error> {
    let mut found = Vec::new();
    for shell in SHELLS {
        let recorded = read_shell(run, record, shell, Verb::Install)?;
        if let Some(file) = recorded.files.first() {
            let script = file.path.clone();
            found.push((recorded, script));
        }
    }
    Ok(found)
}

/// `update`: the platform, the record's directory, every shell's plugin's file, every recorded
/// script, and every recorded startup file, each checked for every shell before any is written,
/// then each shell rewritten and its changes stated.
pub(super) async fn update_shells(run: &ChildRun) -> Result<(), Error> {
    refuse_windows(run, None)?;
    let record = record_directory(&run.name, &run.host)?;
    let found = recorded_shells(run, &record)?;
    if found.is_empty() {
        return run.success(&lines::none_to_update(&run.name)).await;
    }
    let wanted: Vec<Wanted<'_>> = found
        .iter()
        .map(|(recorded, script)| Wanted {
            shell: recorded.shell,
            script,
            files: &recorded.files,
        })
        .collect();
    refuse_in_the_way(run, Verb::Update, &wanted).await?;
    let mut planned = Vec::with_capacity(found.len());
    for (recorded, script) in found {
        planned.push(plan_shell(run, recorded, script)?);
    }
    for entry in &planned {
        update_shell(run, &record, entry).await?;
    }
    Ok(())
}
