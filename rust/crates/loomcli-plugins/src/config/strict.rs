//! Strict configuration coverage, graph checks, and the input failure shared by readers.

use loomcli_core::{
    CommandGraph, DeclarationError, DiagnosticParts, DiagnosticRule, Error, Finding, InputError,
    InputIdentity, InputKind, InputProblem, InvokedBy, Issue, diagnostic_rule,
    escape_control_characters,
};

use super::document::{Step, Value};
use super::drop::Removal;
use super::extension::is_dotted_path;
use super::links::{
    Reached, Shape, declares_optional_key, is_array_shape, leaves, published_schema, step_into,
};
use super::{IDENTITY, messages, settings};

const STRICT_PATH: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/config/strict-path",
    "Invalid strict configuration path",
    "The configuration plugin judges each path that strict lists as it judges the path of a linked option: it splits on dots, and each segment is one nonempty object key, with no escaping and no array indexing. A path of another form can never be at or under a key of the file, so the setting would cover nothing.",
);

const STRICT_SCHEMA_PATH: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/config/strict-schema-path",
    "Strict path the configuration schema does not hold",
    "A path that strict lists covers the values of the configuration file at or under it, and the configuration schema describes the whole file. A path whose keys the schema does not describe means the setting and the shape of the file disagree, and the check catches a typo, which would otherwise make the setting cover nothing, at build time. A listed path that passes through an array is a declaration fault, unless a member of the same shape that is not an array holds the next key or leaves it unchecked. Such a path would cover nothing too, because the index of an array item equals no key, and listing the path of the array itself covers every item.",
);

#[derive(Clone, Debug)]
enum Mode {
    Off,
    All,
    Paths(Vec<String>),
}

/// Why a removal is covered by strict.
pub(super) enum RemovalCoverage {
    Uncovered,
    Covered,
    MissingListedKey,
}

/// The configuration values and unknown keys whose rejection fails the run. An enabled setting
/// also fails a run that finds an unusable configuration file.
#[derive(Clone, Debug)]
pub struct Strict(Mode);

impl Default for Strict {
    fn default() -> Self {
        Self::OFF
    }
}

impl Strict {
    /// Drop rejected values and report unknown keys at debug.
    pub const OFF: Self = Self(Mode::Off);

    /// Fail on every rejected value or unknown key.
    pub const ALL: Self = Self(Mode::All);

    /// Cover the first path and any additional paths. Each path names nonempty object keys
    /// separated by dots. A listed path covers the values and unknown keys at or under it.
    ///
    /// ```compile_fail,E0308
    /// # use loomcli_plugins::config::Strict;
    /// let strict = Strict::paths("delivery", &[7]);
    /// ```
    #[must_use]
    pub fn paths(first: &str, additional: &[&str]) -> Self {
        Self(Mode::Paths(
            std::iter::once(first)
                .chain(additional.iter().copied())
                .map(str::to_owned)
                .collect(),
        ))
    }

    pub(super) fn enabled(&self) -> bool {
        !matches!(self.0, Mode::Off)
    }

    fn listed(&self) -> &[String] {
        match &self.0 {
            Mode::Paths(paths) => paths,
            _ => &[],
        }
    }

    fn finding(&self, index: usize) -> Finding {
        Finding::new(
            "ConfigurationSettings::strict",
            vec![loomcli_core::Literal::List(
                self.listed()
                    .iter()
                    .map(|path| path.as_str().into())
                    .collect(),
            )],
        )
        .mark(format!("0.{index}"))
    }

    #[track_caller]
    pub(super) fn judge_setting(&self) {
        for (index, path) in self.listed().iter().enumerate() {
            if !is_dotted_path(path) {
                settings::raise(
                    STRICT_PATH,
                    format!(
                        "Plugin \"{IDENTITY}\" strict lists a path that is not a dotted path of nonempty keys."
                    ),
                    "List dotted paths of nonempty keys, such as delivery or delivery.webhook.",
                    self.finding(index),
                );
            }
        }
    }

    pub(super) fn judge_schema(&self, graph: &CommandGraph) -> Result<(), Error> {
        let Some(schema) = published_schema(graph) else {
            return Ok(());
        };
        for (index, path) in self.listed().iter().enumerate() {
            if let Some(diagnostic) = path_fault(path, schema) {
                return Err(DeclarationError::new(
                    STRICT_SCHEMA_PATH,
                    diagnostic.finding(self.finding(index)),
                )
                .into());
            }
        }
        Ok(())
    }

    pub(super) fn covers(&self, path: &[Step]) -> bool {
        self.covers_keys(path.iter().map(Step::key))
    }

    pub(super) fn covers_link(&self, path: &str) -> bool {
        self.covers_keys(path.split('.').map(Some))
    }

    fn covers_keys<'a>(&self, path: impl Iterator<Item = Option<&'a str>> + Clone) -> bool {
        matches!(self.0, Mode::All)
            || self.listed().iter().any(|listed| {
                let mut path = path.clone();
                listed
                    .split('.')
                    .all(|key| path.next().flatten() == Some(key))
            })
    }

    /// A removal also covers a listed key missing from an object in the file as read unless
    /// the published shape declares the key optional.
    pub(super) fn removal_coverage(
        &self,
        removal: &Removal,
        round: &Value,
        original: &Value,
        schema: Option<&Shape>,
    ) -> RemovalCoverage {
        if self.covers(&removal.issue_path) {
            return RemovalCoverage::Covered;
        }
        let mut coverage = RemovalCoverage::Uncovered;
        for listed in self.listed() {
            let mut keys = listed.split('.');
            if removal
                .path
                .iter()
                .all(|step| step.key().is_some_and(|key| keys.next() == Some(key)))
            {
                if round.at_path(listed).is_some() {
                    return RemovalCoverage::Covered;
                }
                if missing_listed_key(listed, original, schema) {
                    coverage = RemovalCoverage::MissingListedKey;
                }
            }
        }
        coverage
    }
}

fn missing_listed_key(listed: &str, original: &Value, schema: Option<&Shape>) -> bool {
    let (parent, key) = listed
        .rsplit_once('.')
        .map_or((None, listed), |(parent, key)| (Some(parent), key));
    parent
        .map_or(Some(original), |parent| original.at_path(parent))
        .is_some_and(|object| object.entries().is_some() && object.get(key).is_none())
        && !schema.is_some_and(|schema| declares_optional_key(parent, key, schema))
}

/// A listed path follows the link check. An array at a step can be crossed only through a
/// non-array member that holds the next key or leaves it unchecked.
fn path_fault(path: &str, root: &Shape) -> Option<DiagnosticParts> {
    let mut shapes = leaves(root, root);
    let mut prefix = Vec::new();
    for key in path.split('.') {
        let len = shapes.len();
        shapes.retain(|shape| !is_array_shape(shape));
        match step_into(&shapes, key, root) {
            Reached::Held(next) => shapes = next,
            Reached::Unchecked => return None,
            Reached::Missing if shapes.len() == len => {
                let (sentence, correction) = missing_strict_path(path);
                return Some(DiagnosticParts::new(sentence).correction(correction));
            }
            Reached::Missing => {
                let (sentence, correction) = strict_path_through_array(path, &prefix.join("."));
                return Some(DiagnosticParts::new(sentence).correction(correction));
            }
        }
        prefix.push(key);
    }
    None
}

fn missing_strict_path(path: &str) -> (String, &'static str) {
    (
        format!(
            "Plugin \"{IDENTITY}\" strict lists {}, which the configuration schema does not hold.",
            escape_control_characters(path)
        ),
        "List a path the schema describes, or add the key to the schema.",
    )
}

fn strict_path_through_array(path: &str, array: &str) -> (String, &'static str) {
    (
        format!(
            "Plugin \"{IDENTITY}\" strict lists {}, which passes through the array at {}.",
            escape_control_characters(path),
            escape_control_characters(array)
        ),
        "List the array's own path, which covers every item.",
    )
}

/// One linked option that the source could not fill, with the text for its issues.
pub(super) struct LinkedProblem {
    pub(super) input: InputIdentity,
    pub(super) spelling: String,
    pub(super) issues: Vec<Issue>,
    pub(super) label: String,
}

/// The strict read's ordered input problems. The file's issues use the file diagnostic text.
/// A linked value keeps the option's spelling, issue paths, and source label.
pub(super) fn failure(
    file_lines: Vec<String>,
    linked: Vec<LinkedProblem>,
    invoked_by: InvokedBy,
) -> InputError {
    let mut problems = Vec::new();
    let mut lines = file_lines;
    if !lines.is_empty() {
        let spelling = if invoked_by == InvokedBy::Name {
            "config"
        } else {
            "--config"
        };
        problems.push(InputProblem::Invalid {
            input: InputIdentity::new(true, InputKind::Option, "config"),
            spelling: spelling.to_owned(),
            issues: lines.iter().map(Issue::new).collect(),
        });
    }
    for problem in linked {
        lines.extend(
            problem.issues.iter().map(|issue| {
                messages::strict_option_issue(&problem.spelling, &problem.label, issue)
            }),
        );
        problems.push(InputProblem::Invalid {
            input: problem.input,
            spelling: problem.spelling,
            issues: problem.issues,
        });
    }
    InputError::new(lines.join("\n"), problems)
}
