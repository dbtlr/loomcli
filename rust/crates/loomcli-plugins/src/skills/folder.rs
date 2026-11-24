//! The skills folder reader: each directory directly inside the folder is one skill named for it,
//! holding every file below it whose path has no segment that starts with `.`. It serves a source
//! or development run and the judging of a distributed run that carries no embedded copy.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::Path;

use loomcli_core::{
    DeclarationError, DiagnosticParts, DiagnosticRule, Error, diagnostic_rule,
    escape_control_characters,
};

use super::SkillFile;
use super::judge::{files_fault, judged};
use super::settings::is_skill_name;
use crate::PACKAGE_NAME;

/// `@loomcli/plugins/skills/folder`.
pub(super) const FOLDER_RULE: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/skills/folder",
    "Unreadable skills folder",
    "The skills plugin installs each directory of the folder its folder setting names as one skill named by the directory, and skips every entry whose name starts with ., so the folder exists, holds a skill unless the application lists its skills, each skill directory's name is a skill name, and each entry inside a skill is a file, a link to a file, or a folder, never a link to a folder. A relative folder resolves against nothing a run knows, so a run reads the folder through an absolute path, and a distributed run reads the copy its application embeds.",
);

/// One skill the folder holds: its directory's name and the files below it that it carries.
pub(super) struct FolderSkill {
    pub(super) name: String,
    pub(super) files: Vec<SkillFile>,
}

/// A fault of the skills folder, under the plugin's folder rule.
pub(super) fn folder_fault(sentence: String, correction: &str) -> DeclarationError {
    DeclarationError::new(
        FOLDER_RULE,
        DiagnosticParts::new(sentence).correction(correction),
    )
}

fn shown(path: &Path) -> String {
    escape_control_characters(&path.to_string_lossy())
}

fn bad_name(folder: &Path, name: &str) -> DeclarationError {
    folder_fault(
        format!(
            "The skills folder {} holds a folder that is not a skill name: {}.",
            shown(folder),
            escape_control_characters(name)
        ),
        "Name each skill's folder with lowercase letters, digits, and single hyphens, such as notes.",
    )
}

fn broken_link(folder: &Path, name: &str) -> DeclarationError {
    folder_fault(
        format!(
            "The skills folder {} holds {}, a link that names nothing.",
            shown(folder),
            escape_control_characters(name)
        ),
        "Point the link at the skill's folder, or remove it.",
    )
}

fn carried_none(folder: &Path) -> DeclarationError {
    folder_fault(
        format!(
            "The build carried no skills folder, and {} is not a folder.",
            shown(folder)
        ),
        "Embed the folder's skills with Skills::embedded_folder, which a distributed build reads.",
    )
}

fn empty(folder: &Path) -> DeclarationError {
    folder_fault(
        format!("The skills folder {} holds no skill.", shown(folder)),
        "Add a folder for each skill, holding its SKILL.md, such as skills/notes/SKILL.md.",
    )
}

fn link_to_folder(skill: &str, path: &str) -> DeclarationError {
    folder_fault(
        format!(
            "The skill {skill} holds {}, a link to a folder, which a skill cannot hold.",
            escape_control_characters(path)
        ),
        "Replace the link with the folder's files, or remove it.",
    )
}

fn missing(folder: &Path) -> DeclarationError {
    folder_fault(
        format!(
            "Plugin \"{PACKAGE_NAME}/skills\" setting \"folder\" names {}, which is not a folder.",
            shown(folder)
        ),
        "Create the folder, or name the folder that holds the skills.",
    )
}

fn not_file(skill: &str, path: &str) -> DeclarationError {
    folder_fault(
        format!(
            "The skill {skill} holds {}, which is not a file or a folder.",
            escape_control_characters(path)
        ),
        "Replace it with the file it stands for, or remove it.",
    )
}

/// The fault of a listed skill that holds a folder skill's name, under the files rule.
fn listed_twice(folder: &Path, name: &str) -> DeclarationError {
    files_fault(
        format!(
            "The skills setting lists the skill {name}, which the skills folder {} holds too.",
            shown(folder)
        ),
        "Give the listed skill another name, or remove it from the list or the folder.",
    )
}

/// What a path names, following a link, or none for a link that names nothing.
fn followed(path: &Path) -> io::Result<Option<fs::Metadata>> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
            ) =>
        {
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

/// The names a directory holds, in name order (a byte order, so no locale reorders them), without
/// the dot entries, which are skipped by their names before they are examined.
fn sorted_names(directory: &Path) -> io::Result<Vec<OsString>> {
    let mut names = fs::read_dir(directory)?
        .map(|entry| entry.map(|entry| entry.file_name()))
        .collect::<io::Result<Vec<_>>>()?;
    names.sort();
    names.retain(|name| !name.to_string_lossy().starts_with('.'));
    Ok(names)
}

/// Any execute bit of a file's mode.
#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

/// A platform without execute bits carries none.
#[cfg(not(unix))]
fn is_executable(_: &fs::Metadata) -> bool {
    false
}

/// The files one entry of a skill's directory holds: a directory's files below it, or the file a
/// file or a link to a file is. A link to a folder, a link to nothing, or an entry that is neither a
/// file nor a folder, is a fault.
fn entry_files(skill: &str, path: &Path, relative: &str) -> Result<Vec<SkillFile>, Error> {
    let own = fs::symlink_metadata(path)?;
    if own.is_dir() {
        return skill_files(skill, path, &format!("{relative}/"));
    }
    let named = if own.file_type().is_symlink() {
        followed(path)?
    } else {
        Some(own)
    };
    if named.as_ref().is_some_and(fs::Metadata::is_dir) {
        return Err(link_to_folder(skill, relative).into());
    }
    let Some(named) = named.filter(fs::Metadata::is_file) else {
        return Err(not_file(skill, relative).into());
    };
    let mut file = SkillFile::new(relative, fs::read(path)?);
    if is_executable(&named) {
        file = file.executable();
    }
    Ok(vec![file])
}

/// Every file below a skill's directory, at its path relative to the skill's directory with `/`
/// between segments, in name order, or the first fault an entry holds.
fn skill_files(skill: &str, directory: &Path, prefix: &str) -> Result<Vec<SkillFile>, Error> {
    let mut files = Vec::new();
    for name in sorted_names(directory)? {
        let Some(text) = name.to_str() else {
            let lossy = format!("{prefix}{}", name.to_string_lossy());
            return Err(not_file(skill, &lossy).into());
        };
        files.extend(entry_files(
            skill,
            &directory.join(&name),
            &format!("{prefix}{text}"),
        )?);
    }
    Ok(files)
}

/// One skill directory directly inside the folder, judged as the plugin judges a loader's files.
fn read_skill(folder: &Path, name: &str) -> Result<FolderSkill, Error> {
    if !is_skill_name(name) {
        return Err(bad_name(folder, name).into());
    }
    let files = skill_files(name, &folder.join(name), "")?;
    Ok(FolderSkill {
        name: name.to_owned(),
        files: judged(name, files)?,
    })
}

/// The skills directly inside the folder, in name order: each directory, or link to one, read and
/// judged. A dot entry is skipped by its name before it is examined, a link that names nothing is a
/// fault, and a file or a link to one is ignored.
fn skills_in(folder: &Path) -> Result<Vec<FolderSkill>, Error> {
    let mut skills = Vec::new();
    for name in sorted_names(folder)? {
        let text = name.to_string_lossy();
        let Some(entry) = followed(&folder.join(&name))? else {
            return Err(broken_link(folder, &text).into());
        };
        if entry.is_dir() {
            skills.push(read_skill(folder, &text)?);
        }
    }
    Ok(skills)
}

/// How the reader names a folder that is missing: as the setting names it, or as a built run's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Missing {
    /// The setting names a folder that is not there.
    Setting,
    /// A distributed run carried no folder and the source folder is not there.
    Built,
}

/// Reads and judges the skills folder at an absolute path, returning the first fault: a path that
/// is not a folder, then in name order a link directly inside it that names nothing, a skill
/// directory whose name is not a skill name, and a skill's files' faults, then a folder that holds
/// no skill when no skill is listed, then a listed skill that holds a folder skill's name. The
/// skills come in name order.
pub(super) fn read_skills_folder(
    folder: &Path,
    listed: &[&str],
    missing_as: Missing,
) -> Result<Vec<FolderSkill>, Error> {
    if !followed(folder)?.is_some_and(|metadata| metadata.is_dir()) {
        return Err(match missing_as {
            Missing::Built => carried_none(folder),
            Missing::Setting => missing(folder),
        }
        .into());
    }
    let skills = skills_in(folder)?;
    check_folder_skills(folder, &skills, listed)?;
    Ok(skills)
}

/// The folder-wide faults of the skills a folder, or its embedded copy, holds: no skill when none
/// is listed, then a listed skill that holds a folder skill's name.
pub(super) fn check_folder_skills(
    folder: &Path,
    skills: &[FolderSkill],
    listed: &[&str],
) -> Result<(), Error> {
    if skills.is_empty() && listed.is_empty() {
        return Err(empty(folder).into());
    }
    if let Some(twice) = skills
        .iter()
        .find(|skill| listed.contains(&skill.name.as_str()))
    {
        return Err(listed_twice(folder, &twice.name).into());
    }
    Ok(())
}
