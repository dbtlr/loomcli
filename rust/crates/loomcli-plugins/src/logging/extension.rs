//! The logging file fact and its host-aware resolver.

use loomcli_core::{CommandTarget, Extension, LogLevel};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub use super::directory::resolve_log_file;
pub use super::error::{LoggingError, LoggingErrorKind};
pub use super::resolution::{
    RejectedLogVariable, RejectedLogVariables, ResolvedLogFile, ResolvedLogFiles,
    resolve_logging_files,
};

/// The variable binding for a logging override.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[non_exhaustive]
pub enum LogVariable {
    /// Use the name derived from the application.
    #[default]
    Application,
    /// Read this name instead of the derived name.
    Named(String),
    /// Read no variable for this override.
    Disabled,
}

impl LogVariable {
    fn is_application(&self) -> bool {
        matches!(self, Self::Application)
    }
}

impl Serialize for LogVariable {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Application => serializer.serialize_none(),
            Self::Named(name) => serializer.serialize_str(name),
            Self::Disabled => serializer.serialize_bool(false),
        }
    }
}

impl<'de> Deserialize<'de> for LogVariable {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Binding {
            Name(String),
            Flag(bool),
        }
        match Binding::deserialize(deserializer)? {
            Binding::Name(name) => Ok(Self::Named(name)),
            Binding::Flag(false) => Ok(Self::Disabled),
            Binding::Flag(true) => Err(serde::de::Error::custom(
                "expected a variable name or false",
            )),
        }
    }
}

/// One file destination as declared by the author.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
#[must_use]
pub struct DeclaredLogFile {
    /// The declared file name or path, absent for the application's default file name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// The declared threshold before operator overrides.
    pub level: LogLevel,
}

impl DeclaredLogFile {
    /// Declares the file at this level with the application's default file name.
    pub fn new(level: LogLevel) -> Self {
        Self { file: None, level }
    }

    /// Sets the file name or path as the author declared it.
    pub fn file(mut self, file: impl Into<String>) -> Self {
        self.file = Some(file.into());
        self
    }
}

/// The logging plugin's file destinations and variable bindings as declared, independent of a host.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
#[must_use]
pub struct LoggingFilesFacts {
    /// The file override's variable binding.
    #[serde(default, skip_serializing_if = "LogVariable::is_application")]
    pub file_env: LogVariable,
    /// File destinations in declaration order.
    pub files: Vec<DeclaredLogFile>,
    /// The level override's variable binding.
    #[serde(default, skip_serializing_if = "LogVariable::is_application")]
    pub level_env: LogVariable,
}

impl LoggingFilesFacts {
    /// Declares the file list with both variable names derived from the application.
    pub fn new(files: impl IntoIterator<Item = DeclaredLogFile>) -> Self {
        Self {
            file_env: LogVariable::default(),
            files: files.into_iter().collect(),
            level_env: LogVariable::default(),
        }
    }

    /// Sets the variable binding for the file levels.
    pub fn level_env(mut self, binding: LogVariable) -> Self {
        self.level_env = binding;
        self
    }

    /// Sets the variable binding for the first file's path.
    pub fn file_env(mut self, binding: LogVariable) -> Self {
        self.file_env = binding;
        self
    }
}

/// The logging plugin's root Command extension, `@loomcli/plugins/logging/files`.
pub const LOGGING_FILES: Extension<CommandTarget, LoggingFilesFacts> =
    Extension::new("@loomcli/plugins/logging/files");
