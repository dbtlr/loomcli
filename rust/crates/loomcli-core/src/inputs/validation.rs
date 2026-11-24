//! Validators, issues, and the validation context.

use std::sync::Arc;

use serde::Serialize;

use crate::failures::Error;
use crate::host::{Host, ProcessHandle};
use crate::inspection::InputSchema;

use super::SuppliedInputs;

/// A segment of the path an issue names inside a value.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum PathSegment {
    /// An object key.
    Key(String),
    /// A list index, such as the second value of a multiple option.
    Index(usize),
}

/// One reason a validator rejected a value.
#[derive(Clone, Debug, PartialEq)]
#[must_use]
#[non_exhaustive]
pub struct Issue {
    /// The expectation, in one plain sentence that never repeats the rejected value.
    pub message: String,
    /// Where in the value the issue sits; empty for the value itself.
    pub path: Vec<PathSegment>,
    /// The issue code, such as `@loomcli/validators/integer-range`, when the validator declares one.
    pub code: Option<String>,
    /// The code's parameters, as plain data.
    pub params: Option<serde_json::Value>,
}

impl Issue {
    /// An issue with this message, about the value itself.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            path: Vec::new(),
            code: None,
            params: None,
        }
    }

    /// Prefixes a path segment.
    pub fn at(mut self, segment: PathSegment) -> Self {
        self.path.insert(0, segment);
        self
    }

    /// Attaches an issue code and its parameters.
    pub fn code(mut self, code: impl Into<String>, params: serde_json::Value) -> Self {
        self.code = Some(code.into());
        self.params = Some(params);
        self
    }
}

/// The dotted path an issue names inside a value, such as `1`, or `None` for the value itself.
#[must_use]
pub fn issue_path(issue: &Issue) -> Option<String> {
    let path = issue
        .path
        .iter()
        .map(|segment| match segment {
            PathSegment::Key(key) => key.clone(),
            PathSegment::Index(index) => index.to_string(),
        })
        .collect::<Vec<_>>()
        .join(".");
    (!path.is_empty()).then_some(path)
}

/// What kind of input a validator judges.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InputKind {
    /// A positional argument.
    Argument,
    /// An option.
    Option,
    /// A standalone stdin declaration.
    Stdin,
    /// A question a prompt asks.
    Question,
}

/// Which input a value belongs to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[non_exhaustive]
pub struct InputIdentity {
    /// Whether it is a global option.
    pub global: bool,
    /// Its kind.
    pub kind: InputKind,
    /// Its declared name.
    pub name: String,
}

impl InputIdentity {
    /// The identity of the input `name` of this kind, a global option when `global` holds.
    #[must_use]
    pub fn new(global: bool, kind: InputKind, name: impl Into<String>) -> Self {
        Self {
            global,
            kind,
            name: name.into(),
        }
    }
}

/// The phase a validator runs in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValidationPhase {
    /// A declared default or implied value, validated once per run before any token is read.
    Default,
    /// A value the invocation supplied or an input source filled.
    Invocation,
    /// An answer to a question a prompt asked.
    Question,
}

/// What a validator receives beside the string it judges.
#[derive(Clone)]
#[non_exhaustive]
pub struct ValidationContext {
    /// The phase.
    pub phase: ValidationPhase,
    /// The run's host.
    pub host: Arc<Host>,
    /// The input the value belongs to.
    pub input: InputIdentity,
    /// The routed path, in the invocation and question phases.
    pub command: Option<Vec<String>>,
    /// The passthrough words, in the invocation and question phases.
    pub passthrough: Option<Vec<String>>,
    /// What the invocation supplied, in the invocation and question phases.
    pub supplied: Option<SuppliedInputs>,
}

/// The facts a validation context holds outside a run, for a test that calls a validator alone.
#[derive(Clone, Debug)]
#[must_use]
pub struct ValidationFacts {
    pub(crate) phase: ValidationPhase,
    pub(crate) input: InputIdentity,
    pub(crate) command: Option<Vec<String>>,
    pub(crate) passthrough: Option<Vec<String>>,
    pub(crate) supplied: Option<SuppliedInputs>,
}

impl ValidationFacts {
    /// Facts for the default phase of `input`: the host and the input alone.
    pub fn default_phase(input: InputIdentity) -> Self {
        Self {
            phase: ValidationPhase::Default,
            input,
            command: None,
            passthrough: None,
            supplied: None,
        }
    }

    /// Facts for the invocation phase of `input`: the root's route, no passthrough, and nothing
    /// supplied, until the setters below say otherwise.
    pub fn invocation(input: InputIdentity) -> Self {
        Self {
            phase: ValidationPhase::Invocation,
            input,
            command: Some(Vec::new()),
            passthrough: Some(Vec::new()),
            supplied: Some(SuppliedInputs::default()),
        }
    }

    /// Sets the routed path. The default phase has no route, so there it changes nothing.
    pub fn command(mut self, path: Vec<String>) -> Self {
        if self.phase == ValidationPhase::Invocation {
            self.command = Some(path);
        }
        self
    }

    /// Sets the passthrough words. The default phase has none, so there it changes nothing.
    pub fn passthrough(mut self, words: Vec<String>) -> Self {
        if self.phase == ValidationPhase::Invocation {
            self.passthrough = Some(words);
        }
        self
    }

    /// Sets what the invocation supplied. The default phase reads nothing supplied, so there it
    /// changes nothing.
    pub fn supplied(mut self, supplied: SuppliedInputs) -> Self {
        if self.phase == ValidationPhase::Invocation {
            self.supplied = Some(supplied);
        }
        self
    }
}

/// A validation context outside a run, captured from `handle` as a run captures its host at entry,
/// as the reference's `validationOptions` builds one. Nothing a run adds after entry applies: no
/// environment preparation runs, and the background is the one the handle's terminal states, with
/// no query written. Each call captures a host of its own. A handle a run would fail to capture
/// returns the failure the run would report: a `WorkingDirectoryError` for a working directory the
/// handle cannot read.
pub fn validation_context(
    handle: Arc<dyn ProcessHandle>,
    facts: ValidationFacts,
) -> Result<ValidationContext, Error> {
    // Outside a run no Application names an installation record, so the empty name reads none.
    let capture = crate::host::capture::capture_host("", handle);
    if let Some(error) = capture.unreadable_cwd {
        return Err(crate::failures::WorkingDirectoryError::new(error).into());
    }
    let mut host = capture.host;
    host.terminal.background = host.terminal.stated_background();
    Ok(ValidationContext {
        phase: facts.phase,
        host: Arc::new(host),
        input: facts.input,
        command: facts.command,
        passthrough: facts.passthrough,
        supplied: facts.supplied,
    })
}

/// Judges one string and returns a typed value or the issues that reject it.
///
/// A validator is synchronous: it judges one string. It holds no state between calls, so one value
/// serves many inputs, and on a multiple option or a variadic argument it judges each value. It
/// publishes the JSON Schema of the value its token stands for, which the graph carries; the schema
/// is sound, never stricter than the validator.
pub trait Validator: Send + Sync + 'static {
    /// The typed value an action reads.
    type Output: Clone + Send + Sync + 'static;

    /// Judges `input`. A rejection returns at least one issue; an empty list reads as core's
    /// "rejected without an explanation" issue.
    fn validate(
        &self,
        input: &str,
        context: &ValidationContext,
    ) -> Result<Self::Output, Vec<Issue>>;

    /// The input JSON Schema this validator publishes, or `None` when it publishes none.
    fn input_schema(&self) -> InputSchema {
        None
    }
}

/// A validator that also judges an omitted input. Declaring `validate_omitted` takes one, so the
/// omission reaches a validator that handles it.
pub trait OmissionValidator: Validator {
    /// Judges the omission of the input.
    fn validate_omission(&self, context: &ValidationContext) -> Result<Self::Output, Vec<Issue>>;
}

/// One problem the validation phase found.
#[derive(Clone, Debug, PartialEq)]
#[non_exhaustive]
pub enum InputProblem {
    /// A broken option group.
    Group {
        /// The group's kind.
        reason: crate::inspection::OptionGroupKind,
        /// The members.
        inputs: Vec<InputIdentity>,
        /// Each member's reported spelling.
        spellings: Vec<String>,
        /// The spellings the invocation supplied.
        supplied: Vec<String>,
    },
    /// A required input the invocation omitted.
    Missing {
        /// The input.
        input: InputIdentity,
        /// Its reported spelling.
        spelling: String,
    },
    /// A value a validator rejected.
    Invalid {
        /// The input.
        input: InputIdentity,
        /// Its reported spelling.
        spelling: String,
        /// The issues the validator returned; at least one.
        issues: Vec<Issue>,
    },
}
