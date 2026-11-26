//! Loading the skills a Command installs: the folder's skills first, in name order, then the listed
//! skills, each judged before anything is written.

use std::path::{Component, Path, PathBuf};

use loomcli_core::{Build, Error, LogFields};

use super::folder::{FolderSkill, Missing, check_folder_skills, folder_fault, read_skills_folder};
use super::global::ChildRun;
use super::judge::judged;
use super::selection::{REFERENCES, owns_reference};
use super::{Declared, Skill, SkillFile};
use super::{messages, references};
use crate::PACKAGE_NAME;
use crate::installation::FolderFile;

/// A skill whose files the plugin read or a loader answered and the plugin judged, ready to write.
pub(super) struct LoadedSkill {
    pub(super) name: String,
    /// The files with the mode each is written with, whatever the umask.
    pub(super) files: Vec<FolderFile>,
}

/// The mode of an executable file.
const EXECUTABLE_MODE: u32 = 0o755;

/// The mode of any other file.
const PLAIN_MODE: u32 = 0o644;

/// The files of a judged result with the mode each is written with.
fn with_modes(files: Vec<SkillFile>) -> Vec<FolderFile> {
    files
        .into_iter()
        .map(|file| {
            let mode = if file.is_executable() {
                EXECUTABLE_MODE
            } else {
                PLAIN_MODE
            };
            FolderFile::new(file.path, file.content.into_owned()).mode(mode)
        })
        .collect()
}

/// A path normalized by its words alone, as Node's `path.resolve` does: a `.` part goes, a `..`
/// part removes the part before it, and a trailing separator goes.
fn normalized(path: &Path) -> PathBuf {
    let mut resolved = PathBuf::new();
    for component in path.components() {
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

/// The folder a setting names, normalized: an absolute path, else the fault of a relative one.
fn folder_path(setting: &Path) -> Result<PathBuf, Error> {
    if setting.is_absolute() {
        return Ok(normalized(setting));
    }
    let shown = loomcli_core::escape_control_characters(&setting.to_string_lossy());
    Err(folder_fault(
        format!(
            "Plugin \"{PACKAGE_NAME}/skills\" setting \"folder\" is the relative path {shown}, which no run resolves."
        ),
        "Name the folder with an absolute path, such as Path::new(env!(\"CARGO_MANIFEST_DIR\")).join(\"skills\").",
    )
    .into())
}

/// Whether a path holds a segment that starts with `.`, which the folder read skips.
fn has_dot_segment(path: &str) -> bool {
    path.split('/').any(|part| part.starts_with('.'))
}

/// The embedded copy of the folder: each skill's files answered, the dot entries dropped as the
/// folder read skips them, and judged, in name order. The copy is judged as the folder is: it holds
/// a skill unless a skill is listed, and holds no listed skill's name.
async fn embedded_skills(
    folder: &Path,
    embedded: &[Skill],
    listed: &[&str],
    selecting: &[&str],
) -> Result<Vec<FolderSkill>, Error> {
    let mut sorted: Vec<&Skill> = embedded.iter().collect();
    sorted.sort_by(|a, b| a.name().cmp(b.name()));
    let mut skills = Vec::new();
    for skill in sorted {
        let mut files = skill.files().await?;
        files.retain(|file| !has_dot_segment(file.path()));
        skills.push(FolderSkill {
            name: skill.name().to_owned(),
            files: judged(skill.name(), files)?,
        });
    }
    check_folder_skills(folder, &skills, listed, selecting)?;
    Ok(skills)
}

/// The folder skills a run installs, in name order. A setting that names no folder reads none. A
/// distributed run with an embedded copy reads the copy; any other run reads the folder from disk,
/// and a folder that is missing in a distributed run says the build carried none.
async fn folder_skills(declared: &Declared, build: Build) -> Result<Vec<FolderSkill>, Error> {
    let Some(setting) = &declared.folder else {
        return Ok(Vec::new());
    };
    let listed: Vec<&str> = declared.listed.iter().map(Skill::name).collect();
    let selecting = declared
        .selections
        .iter()
        .map(|selection| selection.skill.as_str())
        .filter(|name| !listed.contains(name))
        .collect::<Vec<_>>();
    let folder = folder_path(setting)?;
    if let (Build::Distributed, Some(embedded)) = (build, &declared.embedded) {
        return embedded_skills(&folder, embedded, &listed, &selecting).await;
    }
    let missing = if build == Build::Distributed {
        Missing::Built
    } else {
        Missing::Setting
    };
    read_skills_folder(&folder, &listed, &selecting, missing)
}

/// Reads the skills folder, then calls each listed skill's loader once, in declaration order,
/// awaiting each, then judges every result before anything is written. The folder's skills come
/// first, in name order, then the listed skills. The first fault is returned as a
/// `DeclarationError`, and a loader that fails fails the run as it did.
async fn load_skills(declared: &Declared, build: Build) -> Result<Vec<LoadedSkill>, Error> {
    let from_folder = folder_skills(declared, build).await?;
    let mut answers = Vec::new();
    for skill in &declared.listed {
        answers.push((skill.name(), skill.files().await?));
    }
    let mut loaded: Vec<LoadedSkill> = from_folder
        .into_iter()
        .map(|skill| LoadedSkill {
            name: skill.name,
            files: with_modes(skill.files),
        })
        .collect();
    for (name, files) in answers {
        loaded.push(LoadedSkill {
            name: name.to_owned(),
            files: with_modes(judged(name, files)?),
        });
    }
    Ok(loaded)
}

/// Shares the loader and generated file set across both install scopes and status.
pub(super) async fn load_for_run<R>(
    run: &ChildRun<'_, R>,
    declared: &Declared,
) -> Result<Vec<LoadedSkill>, Error> {
    let mut loaded = load_skills(declared, run.host.release.build).await?;
    let mut left_out = Vec::new();
    for skill in &mut loaded {
        let Some(selection) = declared
            .selections
            .iter()
            .find(|selection| selection.skill == skill.name)
        else {
            continue;
        };
        if selection.paths.is_empty() {
            continue;
        }
        skill.files.retain(|file| {
            let owned = owns_reference(&file.path, run.name);
            if owned {
                left_out.push((file.path.clone(), skill.name.clone()));
            }
            !owned
        });
        for reference in references::render(run.graph, &selection.paths, true, Some(&skill.name))? {
            let mut file =
                FolderFile::new(format!("{REFERENCES}{}", reference.name), reference.content)
                    .mode(PLAIN_MODE);
            file.generated = true;
            skill.files.push(file);
        }
    }
    for (path, skill) in left_out {
        run.log.trace(
            messages::SKILL_FILE_LEFT_OUT,
            LogFields::new().field("path", &path).field("skill", &skill),
        );
        run.out
            .trace(&messages::skill_file_left_out(&skill, &path))
            .await?;
    }
    Ok(loaded)
}
