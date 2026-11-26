//! The read-only report of what is installed and what this version would write.

use std::path::{Path, PathBuf};

use loomcli_core::{Error, FatalError, ViewContext};
use serde::Serialize;

use super::Declared;
use super::global::{ChildRun, acting_places, prepare, record_name};
use super::load::{LoadedSkill, load_for_run};
use super::messages;
use super::project::{ProjectRequest, directory_needs_project, project_folder, project_skills};
use super::targets::{Target, selected_targets};
use crate::installation::{
    InstallationError, Observed, PluginRecord, RecordedFolder, RecordedRead, changed_references,
    exists, observe, stale_files,
};

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum State {
    Missing,
    Unmanaged,
    Modified,
    Stale,
    Current,
}

impl State {
    fn name(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Unmanaged => "unmanaged",
            Self::Modified => "modified",
            Self::Stale => "stale",
            Self::Current => "current",
        }
    }
}

/// One row per declared skill and selected agent target, in the JSON member order.
#[derive(Serialize)]
pub(super) struct SkillStatus {
    skill: String,
    target: &'static str,
    scope: &'static str,
    state: State,
    folder: String,
    files: Vec<String>,
    notes: Vec<String>,
}

pub(super) struct Report {
    pub(super) rows: Vec<SkillStatus>,
    pub(super) notices: Vec<String>,
}

#[derive(Clone, Copy)]
enum Scope<'a> {
    Global(Option<&'a RecordedFolder>),
    Project(Option<&'a Path>),
}

impl Scope<'_> {
    fn unmanaged(self, observed: &Observed) -> bool {
        match self {
            Self::Global(held) => held.is_none(),
            Self::Project(_) => *observed != Observed::Directory,
        }
    }
}

fn row_for(
    name: &str,
    skill: &LoadedSkill,
    target: Target,
    folder: PathBuf,
    scope: Scope<'_>,
) -> Result<SkillStatus, InstallationError> {
    let held = match scope {
        Scope::Global(held) => held,
        Scope::Project(_) => None,
    };
    let mut modified = held
        .map(changed_references)
        .transpose()?
        .unwrap_or_default();
    modified.sort();
    let stale = stale_files(
        &folder,
        &skill.files,
        held.and_then(|record| record.files.as_deref())
            .unwrap_or_default(),
    )?;
    let kind = observe(&folder)?;
    let (state, files) = if kind == Observed::Absent {
        (State::Missing, Vec::new())
    } else if scope.unmanaged(&kind) {
        (State::Unmanaged, Vec::new())
    } else if !modified.is_empty() {
        (State::Modified, modified)
    } else if !stale.is_empty() {
        (State::Stale, stale)
    } else {
        (State::Current, Vec::new())
    };
    let target = target.name();
    let (scope, note) = match scope {
        Scope::Global(_) => ("global", messages::global_status_note(name, target, state)),
        Scope::Project(root) => (
            "project",
            messages::project_status_note(name, target, root, state),
        ),
    };
    Ok(SkillStatus {
        skill: skill.name.clone(),
        target,
        scope,
        state,
        folder: folder.to_string_lossy().into_owned(),
        files,
        notes: note.into_iter().collect(),
    })
}

async fn global_report<R>(
    run: &ChildRun<'_, R>,
    declared: &Declared,
    agent: Option<Target>,
) -> Result<Report, Error> {
    let (places, record) = prepare(run, agent)?;
    let places = acting_places(run, places, true).await?;
    let loaded = load_for_run(run, declared).await?;
    let mut report = Report {
        rows: Vec::new(),
        notices: Vec::new(),
    };
    for place in places {
        let file = PluginRecord::new(&record, record_name(place.target));
        let folders = match file.read()? {
            RecordedRead::Read { folders, .. } => folders,
            RecordedRead::Refused(refused) => {
                return Err(
                    FatalError::new(messages::status_record(run.name, &refused.path)).into(),
                );
            }
        };
        for skill in &loaded {
            let folder = place.directory.join(&skill.name);
            let held = folders.iter().find(|held| held.path == folder);
            report.rows.push(row_for(
                run.name,
                skill,
                place.target,
                folder,
                Scope::Global(held),
            )?);
        }
        for folder in &folders {
            let declared = loaded
                .iter()
                .any(|skill| place.directory.join(&skill.name) == folder.path);
            if !declared && exists(&folder.path).map_err(InstallationError::from)? {
                let modified = !changed_references(folder)
                    .map_err(InstallationError::from)?
                    .is_empty();
                report
                    .notices
                    .push(messages::obsolete_skill(run.name, &folder.path, modified));
            }
        }
    }
    Ok(report)
}

async fn project_report<R>(
    run: &ChildRun<'_, R>,
    declared: &Declared,
    request: &ProjectRequest<'_>,
) -> Result<Report, Error> {
    let (root, loaded) = project_skills(run, declared, request, true).await?;
    let mut rows = Vec::new();
    let scope = Scope::Project(request.directory.map(|_| root.as_path()));
    for target in selected_targets(request.agent) {
        for skill in &loaded {
            let folder = project_folder(&root, target, &skill.name);
            rows.push(row_for(run.name, skill, target, folder, scope)?);
        }
    }
    Ok(Report {
        rows,
        notices: Vec::new(),
    })
}

pub(super) async fn report<R>(
    run: &ChildRun<'_, R>,
    declared: &Declared,
    project: bool,
    request: &ProjectRequest<'_>,
) -> Result<Report, Error> {
    let report = if project {
        project_report(run, declared, request).await?
    } else {
        if request.directory.is_some() {
            return Err(directory_needs_project().into());
        }
        global_report(run, declared, request.agent).await?
    };
    run.signal.throw_if_cancelled()?;
    Ok(report)
}

pub(super) fn text(row: &SkillStatus, index: usize, context: &ViewContext) -> String {
    let shown = |text: &str| context.style.escape(&messages::shown(text));
    let modified = row.state == State::Modified;
    let width = if modified { 9 } else { 8 };
    let mut text = format!(
        "{}{} for {}: {}\n  {:width$}{}\n",
        if index == 0 { "" } else { "\n" },
        shown(&row.skill),
        row.target,
        row.state.name(),
        "folder",
        shown(&row.folder),
    );
    if modified {
        for file in &row.files {
            text.push_str(&format!("  changed  {}\n", shown(file)));
        }
    }
    for note in &row.notes {
        text.push_str(&format!(
            "  {:width$}{}\n",
            "note",
            context.style.escape(note)
        ));
    }
    text
}
