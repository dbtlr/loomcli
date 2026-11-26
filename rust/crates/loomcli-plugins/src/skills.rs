//! The skills plugin: installs the application's agent skills where coding agents read them, keeps
//! them current with the binary, and removes them.
//!
//! Its whole contribution is one `skills` Command group with four children. `skills install`
//! writes every skill's folder to the Claude folder (`<claude>/skills/<name>/`, where `<claude>`
//! is an absolute `CLAUDE_CONFIG_DIR`, else `<home>/.claude`) and to the shared agents folder
//! (`<home>/.agents/skills/<name>/`), and records each folder in the installation record;
//! `skills install --project` writes the same folders at the repository root with no record;
//! `skills update` brings the recorded folders up to date, `skills uninstall` removes them, and
//! `skills status` reports each skill at each selected target.
//! Install it once, and pass [`refresh_skills`] to the self-update plugin so a replaced binary
//! brings the skills along.
//!
//! # How an application carries its skills
//!
//! The reference bakes a skills folder into the bundle or the binary at build time. Rust needs no
//! build script and no procedural macro for that: the application passes its skills as **embedded
//! data**. A [`SkillFile`] holds a relative path and its bytes, and [`SkillFile::embedded`] takes
//! `&'static [u8]`, which `include_bytes!` produces, so the files live in the binary and nothing is
//! read from disk when the skills are installed. A [`Skill`] is a name and its files, or a name and
//! a loader that computes the files when a skills Command runs.
//!
//! During development, [`Skills::folder`] names a folder of skills on disk, one subfolder per
//! skill, and a source or development run reads it where it stands, so an edit to a `SKILL.md`
//! installs without a rebuild. [`Skills::embedded_folder`] gives the same folder's skills as
//! embedded data, which a distributed build installs instead of reading the folder. Skills listed
//! in [`skills`] install in every build. The `include_dir` crate can feed
//! [`Skills::embedded_folder`] when an application would rather not list each file.
//!
//! ```
//! use std::path::Path;
//!
//! use loomcli_core::Application;
//! use loomcli_plugins::skills::{Skill, SkillFile, skills};
//!
//! // The skill `notes`: its files are part of the binary.
//! let notes = Skill::new(
//!     "notes",
//!     [
//!         SkillFile::embedded(
//!             "SKILL.md",
//!             include_bytes!(concat!(
//!                 env!("CARGO_MANIFEST_DIR"),
//!                 "/tests/skills_data/notes/SKILL.md"
//!             )),
//!         ),
//!         SkillFile::embedded(
//!             "references/commands.md",
//!             include_bytes!(concat!(
//!                 env!("CARGO_MANIFEST_DIR"),
//!                 "/tests/skills_data/notes/references/commands.md"
//!             )),
//!         ),
//!         // A script the agent may run: written with mode 755.
//!         SkillFile::embedded(
//!             "scripts/run.sh",
//!             include_bytes!(concat!(
//!                 env!("CARGO_MANIFEST_DIR"),
//!                 "/tests/skills_data/notes/scripts/run.sh"
//!             )),
//!         )
//!         .executable(),
//!     ],
//! );
//!
//! let application = Application::new("notes")
//!     .description("Keep notes in sync.")
//!     .plugins((
//!         skills(Vec::new())
//!             // A development run reads the source folder where it stands, so an edit to a
//!             // SKILL.md installs without a rebuild.
//!             .folder(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/skills_data"))
//!             // A distributed binary installs the same skills from the data inside it.
//!             .embedded_folder(vec![notes])
//!             .plugin(),
//!     ));
//! # let _ = application;
//! ```
//!
//! A loader can compute a skill's files when a run installs, updates, or reports status.
//!
//! ```
//! use loomcli_plugins::skills::{Skill, SkillFile, skills};
//!
//! let generated = Skill::loaded("generated", || {
//!     Ok(vec![SkillFile::new("SKILL.md", "# Generated\n")])
//! });
//! let plugin = skills(vec![generated]).plugin();
//! # let _ = plugin;
//! ```
//!
//! # Settings faults
//!
//! A setting the plugin cannot use panics at its builder call with the
//! `@loomcli/plugins/skills/settings` diagnostic: a skill name outside the Agent Skills grammar
//! (lowercase letters and digits joined by single hyphens, 64 characters at most), a name listed
//! twice, or an empty folder path. The faults of what a run reads (a folder that is missing, a
//! skill with no `SKILL.md`, a path that leaves the skill's folder) are `DeclarationError`s the
//! Command reports before it writes anything.

mod commands;
pub mod extension;
mod folder;
mod global;
mod judge;
mod load;
mod markdown;
mod messages;
mod project;
mod references;
mod selection;
mod settings;
mod status;
mod targets;

use std::borrow::Cow;
use std::fmt;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;

use loomcli_core::{AnyPlugin, Error, Plugin};

pub use crate::installation::RefreshContext;
use crate::installation::{Refresh, refresh_by_running};

pub use references::{CommandReference, command_references};
use selection::{Selection, collect_paths};

/// One file of a skill's folder: its path relative to the skill's folder, its bytes, and whether it
/// is written as an executable.
#[derive(Clone, Debug, PartialEq, Eq)]
#[must_use]
pub struct SkillFile {
    path: String,
    content: Cow<'static, [u8]>,
    executable: bool,
}

impl SkillFile {
    /// A file at `path`, such as `references/commands.md`, holding `content`. The path is relative,
    /// uses `/`, and stays inside the skill's folder; a path that does not fails the install.
    pub fn new(path: impl Into<String>, content: impl Into<Vec<u8>>) -> Self {
        Self {
            path: path.into(),
            content: Cow::Owned(content.into()),
            executable: false,
        }
    }

    /// A file whose bytes are part of the binary, such as `include_bytes!` produces.
    pub fn embedded(path: impl Into<String>, content: &'static [u8]) -> Self {
        Self {
            path: path.into(),
            content: Cow::Borrowed(content),
            executable: false,
        }
    }

    /// Writes the file with mode 755 in place of 644.
    pub fn executable(self) -> Self {
        Self {
            executable: true,
            ..self
        }
    }

    /// The path relative to the skill's folder.
    #[must_use]
    pub fn path(&self) -> &str {
        &self.path
    }

    /// The file's bytes.
    #[must_use]
    pub fn content(&self) -> &[u8] {
        &self.content
    }

    /// Whether the file is written with mode 755.
    #[must_use]
    pub fn is_executable(&self) -> bool {
        self.executable
    }
}

/// The future a loader answers.
type LoadFuture = Pin<Box<dyn Future<Output = Result<Vec<SkillFile>, Error>> + Send>>;

/// A loader of a skill's files.
type Loader = Arc<dyn Fn() -> LoadFuture + Send + Sync>;

/// Where a skill's files come from.
#[derive(Clone)]
enum Files {
    Listed(Vec<SkillFile>),
    Loaded(Loader),
}

/// One skill the application installs for coding agents: the skill's folder name and its files.
#[derive(Clone)]
#[must_use]
pub struct Skill {
    name: String,
    files: Files,
}

impl fmt::Debug for Skill {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Skill")
            .field("name", &self.name)
            .finish_non_exhaustive()
    }
}

impl Skill {
    /// A skill named `name`, such as `notes`, holding these files. The name is a skill name:
    /// lowercase letters and digits joined by single hyphens, 64 characters at most, which
    /// [`skills`] checks. The files include a `SKILL.md`, which the install checks.
    pub fn new(name: impl Into<String>, files: impl IntoIterator<Item = SkillFile>) -> Self {
        Self {
            name: name.into(),
            files: Files::Listed(files.into_iter().collect()),
        }
    }

    /// A skill whose files `loader` computes for install, update, and status. A loader failure
    /// ends the Command before it writes any files.
    pub fn loaded(
        name: impl Into<String>,
        loader: impl Fn() -> Result<Vec<SkillFile>, Error> + Send + Sync + 'static,
    ) -> Self {
        Self::loaded_async(name, move || {
            let answer = loader();
            async move { answer }
        })
    }

    /// A skill whose files an asynchronous `loader` computes, as [`Skill::loaded`].
    pub fn loaded_async<F, Fut>(name: impl Into<String>, loader: F) -> Self
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Vec<SkillFile>, Error>> + Send + 'static,
    {
        Self {
            name: name.into(),
            files: Files::Loaded(Arc::new(move || -> LoadFuture { Box::pin(loader()) })),
        }
    }

    /// The skill's folder name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The skill's files, calling its loader when it has one.
    async fn files(&self) -> Result<Vec<SkillFile>, Error> {
        match &self.files {
            Files::Listed(files) => Ok(files.clone()),
            Files::Loaded(loader) => loader().await,
        }
    }
}

/// What the plugin installs: the listed skills, a skills folder on disk, and the folder's embedded
/// copy.
#[derive(Clone, Debug)]
pub(crate) struct Declared {
    pub(crate) listed: Vec<Skill>,
    pub(crate) folder: Option<PathBuf>,
    pub(crate) embedded: Option<Vec<Skill>>,
    selections: Vec<Selection>,
}

/// The skills plugin's settings builder.
#[must_use]
pub struct Skills {
    declared: Declared,
}

/// The skills plugin, installing these skills in every build. An empty list declares no listed
/// skill, which is what a plugin whose skills all come from [`Skills::folder`] passes.
///
/// # Panics
///
/// With the `@loomcli/plugins/skills/settings` diagnostic when a name is not a skill name or two
/// skills hold one name.
#[track_caller]
pub fn skills(skills: Vec<Skill>) -> Skills {
    settings::judge_names("skills", "skills", &skills);
    Skills {
        declared: Declared {
            listed: skills,
            folder: None,
            embedded: None,
            selections: Vec::new(),
        },
    }
}

impl Skills {
    /// A folder whose subfolders are skills, each named for its subfolder, read from disk when a
    /// skills Command installs, updates, or reports status. The path is absolute, such as
    /// `Path::new(env!("CARGO_MANIFEST_DIR")).join("skills")`; a relative path fails the Command,
    /// because no run resolves it. A source or development run reads the folder where it stands. A
    /// distributed run reads it too unless [`Skills::embedded_folder`] gave it a copy, and when the
    /// folder is not there, says the build carried none.
    ///
    /// An entry whose name starts with `.` is skipped at any depth, a file directly inside the
    /// folder is ignored, and the folder's skills install in name order before the listed ones.
    ///
    /// # Panics
    ///
    /// With the `@loomcli/plugins/skills/settings` diagnostic when the path is empty.
    #[track_caller]
    pub fn folder(self, folder: impl Into<PathBuf>) -> Self {
        let folder = folder.into();
        settings::judge_folder(&folder);
        Self {
            declared: Declared {
                folder: Some(folder),
                ..self.declared
            },
        }
    }

    /// The skills of [`Skills::folder`] as embedded data, which a distributed build installs in
    /// place of reading the folder. Each skill is judged like a skill of the folder, and installs in
    /// name order.
    ///
    /// # Panics
    ///
    /// With the `@loomcli/plugins/skills/settings` diagnostic when a name is not a skill name or two
    /// skills hold one name.
    #[track_caller]
    pub fn embedded_folder(self, skills: Vec<Skill>) -> Self {
        settings::judge_names("Skills::embedded_folder", "embedded_folder", &skills);
        Self {
            declared: Declared {
                embedded: Some(skills),
                ..self.declared
            },
        }
    }

    /// Selects canonical Command paths for the named skill. An empty path selects the root, and
    /// an empty list selects no Commands. A later call for the skill replaces its selection.
    ///
    /// # Panics
    ///
    /// With the `@loomcli/plugins/skills/settings` diagnostic when the name is outside the skill
    /// name grammar.
    #[track_caller]
    pub fn select_commands(
        mut self,
        skill: impl Into<String>,
        paths: impl IntoIterator<Item = impl IntoIterator<Item = impl AsRef<str>>>,
    ) -> Self {
        let skill = skill.into();
        settings::judge_selection_name(&skill);
        let paths = collect_paths(paths);
        if let Some(selection) = self
            .declared
            .selections
            .iter_mut()
            .find(|entry| entry.skill == skill)
        {
            selection.paths = paths;
        } else {
            self.declared.selections.push(Selection { skill, paths });
        }
        self
    }

    /// The plugin.
    ///
    /// # Panics
    ///
    /// With the `@loomcli/plugins/skills/settings` diagnostic when [`Skills::embedded_folder`] is
    /// set and [`Skills::folder`] is not, because the embedded copy stands for a folder.
    #[track_caller]
    pub fn plugin(self) -> Plugin {
        if let (Some(embedded), None) = (&self.declared.embedded, &self.declared.folder) {
            settings::embedded_without_folder(embedded);
        }
        commands::plugin(self.declared)
    }
}

impl From<Skills> for AnyPlugin {
    fn from(settings: Skills) -> Self {
        settings.plugin().into()
    }
}

/// What the skills refresh runs and says.
const REFRESH: Refresh = Refresh {
    words: &["skills", "update"],
    warning: messages::SKILLS_REFRESH_FAILED,
    not_started: messages::skills_not_refreshed,
};

/// An `after_replace` function for the self-update plugin: it runs the new binary with
/// `skills update`, because the replaced process holds the old skills, and passes the child's
/// output through. A child that fails or cannot start adds a `warn` log event and returns `Ok`,
/// because the binary update succeeded; the cancellation of the run ends the child.
///
/// An application that runs more after a replace calls it from its own function and awaits it.
///
/// # Errors
///
/// None today; the result keeps the shape an `after_replace` function has.
pub async fn refresh_skills(context: RefreshContext<'_>) -> Result<(), Error> {
    refresh_by_running(context, &REFRESH).await;
    Ok(())
}
