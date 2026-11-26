//! The project install: an unrecorded copy of each skill's folder at the repository root, replaced
//! whole every time. Nothing is recorded, so a project folder has no update, uninstall, or takeover
//! check.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use loomcli_core::{Error, FatalError, InputError, InputIdentity, InputKind, InputProblem, Issue};

use super::Declared;
use super::global::ChildRun;
use super::load::{LoadedSkill, load_skills};
use super::messages;
use super::targets::{Target, real_folder, selected_targets, skills_directory};
use crate::installation::{exists, write_folder};

/// An input problem on the `--directory` option, which exits 2.
fn directory_problem(message: String, issue: &str) -> InputError {
    InputError::new(
        message,
        vec![InputProblem::Invalid {
            input: InputIdentity::new(false, InputKind::Option, "directory"),
            spelling: "--directory".to_owned(),
            issues: vec![Issue::new(issue)],
        }],
    )
}

/// The refusal of `--directory` without `--project`, which the action returns before anything else.
pub(super) fn directory_needs_project() -> InputError {
    directory_problem(
        messages::DIRECTORY_WITHOUT_PROJECT.to_owned(),
        messages::DIRECTORY_WITHOUT_PROJECT_ISSUE,
    )
}

/// `base` joined with `path` and normalized by its words alone, as Node's `path.resolve` does: a
/// `.` part goes, a `..` part removes the part before it, and an absolute `path` replaces `base`.
fn resolve(base: &Path, path: &Path) -> PathBuf {
    let mut resolved = PathBuf::new();
    for component in base.join(path).components() {
        match component {
            Component::ParentDir => {
                resolved.pop();
            }
            Component::CurDir => {}
            other => resolved.push(other.as_os_str()),
        }
    }
    resolved
}

/// The directory the walk starts at: the working directory, or `--directory` resolved against it.
fn start_of(run: &ChildRun<'_>, directory: Option<&str>) -> Result<PathBuf, Error> {
    let start = directory.map_or_else(
        || run.host.cwd.clone(),
        |directory| resolve(&run.host.cwd, Path::new(directory)),
    );
    if fs::metadata(&start).is_ok_and(|metadata| metadata.is_dir()) {
        return Ok(start);
    }
    Err(directory_problem(
        messages::directory_missing(&start.to_string_lossy()),
        messages::DIRECTORY_MISSING_ISSUE,
    )
    .into())
}

/// Whether an entry named `.git` of any kind is directly inside `directory`.
fn holds_git(directory: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(directory.join(".git")) {
        Ok(_) => Ok(true),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
            ) =>
        {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

/// The nearest directory from `start` up that holds an entry named `.git` of any kind, a directory
/// in a clone and a file in a worktree or a submodule; the start itself when none does.
fn repository_root(start: &Path) -> io::Result<PathBuf> {
    for directory in start.ancestors() {
        if holds_git(directory)? {
            return Ok(directory.to_path_buf());
        }
    }
    Ok(start.to_path_buf())
}

/// The folder of a skill under a root, for a target.
fn project_folder(root: &Path, target: Target, name: &str) -> PathBuf {
    root.join(format!(".{}", target.name()))
        .join("skills")
        .join(name)
}

/// The global folder a skill's project folder is, compared by real paths, or none.
fn clash_of(
    run: &ChildRun<'_>,
    root: &Path,
    target: Target,
    names: &[&str],
) -> Result<Option<PathBuf>, Error> {
    let Some(global) = skills_directory(target, run.host) else {
        return Ok(None);
    };
    for name in names {
        let folder = global.join(name);
        if real_folder(&project_folder(root, target, name))? == real_folder(&folder)? {
            return Ok(Some(folder));
        }
    }
    Ok(None)
}

/// Refuses a project folder that is the target's global folder, compared by real paths so a linked
/// root, a linked `.claude` or `.agents`, or a linked home is seen.
fn guard_global(
    run: &ChildRun<'_>,
    root: &Path,
    agent: Option<Target>,
    names: &[&str],
) -> Result<(), Error> {
    for target in selected_targets(agent) {
        if let Some(clash) = clash_of(run, root, target, names)? {
            return Err(FatalError::new(messages::never_global(run.name, &clash)).into());
        }
    }
    Ok(())
}

/// What `install --project` reads from the command line.
pub(super) struct ProjectRequest<'a> {
    pub(super) agent: Option<Target>,
    pub(super) directory: Option<&'a str>,
}

/// Replaces one skill's folder under the root whole and states it.
async fn replace_folder(
    run: &ChildRun<'_>,
    folder: &Path,
    loaded: &LoadedSkill,
    target: Target,
) -> Result<(), Error> {
    let replacing = exists(folder)?;
    if let Some(parent) = folder.parent() {
        fs::create_dir_all(parent)?;
    }
    write_folder(folder, &loaded.files)?;
    let line = if replacing {
        messages::installed_over(&loaded.name, target.name(), folder)
    } else {
        messages::installed(&loaded.name, target.name(), folder)
    };
    run.out.success(&line).await
}

/// `install --project`: the root, the guard against the global folder, the folder and the loaders,
/// and the guard again for the folder's skills, all before any write, then each skill's folder
/// replaced whole for each selected target.
pub(super) async fn install_project(
    run: &ChildRun<'_>,
    declared: &Declared,
    request: &ProjectRequest<'_>,
) -> Result<(), Error> {
    let root = repository_root(&start_of(run, request.directory)?)?;
    let listed: Vec<&str> = declared.listed.iter().map(super::Skill::name).collect();
    guard_global(run, &root, request.agent, &listed)?;
    let loaded = load_skills(declared, run.host.release.build).await?;
    // Only the folder knows its skills' names, so its skills meet the guard once they are read.
    let names: Vec<&str> = loaded.iter().map(|skill| skill.name.as_str()).collect();
    guard_global(run, &root, request.agent, &names)?;
    run.signal.throw_if_cancelled()?;
    for target in selected_targets(request.agent) {
        for skill in &loaded {
            let folder = project_folder(&root, target, &skill.name);
            replace_folder(run, &folder, skill, target).await?;
        }
    }
    Ok(())
}
