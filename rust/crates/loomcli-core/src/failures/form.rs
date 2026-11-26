//! The failure form, failure views, and the key a failure view overrides.

use std::marker::PhantomData;
use std::sync::Arc;

use serde::Serialize;

use crate::invocation::InvokedBy;
use crate::output::ViewContext;

use crate::output::IntoRendered;

use super::messages::{GENERIC_MESSAGE, is_author_fault, marked_sentence};
use super::{DeclarationError, Failure, FailureExitCode, FailureFacts, InternalError};

/// One failure as plain data, for a reader that cannot parse prose: `invoke`'s outcome, a failure
/// encoder, and the MCP plugin. It serializes with the keys `code`, `exitCode`, `message`, and
/// `hints`, in that order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct FailureForm {
    /// The class's failure code; `internal` for a defect or a declaration fault.
    pub code: String,
    /// The failure's declared exit code.
    pub exit_code: FailureExitCode,
    /// The sentence as plain text, without the application-name prefix. For a defect, the build
    /// decides: the generic message in a distributed build, the fault's sentence in a development one.
    pub message: String,
    /// The `on_failure` hints as plain text, in the order the failure view receives them.
    pub hints: Vec<String>,
}

/// What one form reads beside its failure: the run's build, the hints, and the plain resolution.
pub(crate) struct FormScene<'a> {
    /// Whether the run is a development build, whose defect reads its sentence.
    pub(crate) development: bool,
    /// The hints the failure view receives, as marked text.
    pub(crate) hints: &'a [String],
    /// Resolves marked text as plain text, with no color, modifier, or hyperlink.
    pub(crate) plain: &'a dyn Fn(&str) -> String,
}

/// The form of one failure, built after the translators and the hooks. A defect or a declaration
/// fault reads `internal`, and its message follows the build: its sentence in a development build
/// and the generic message in a distributed one, so no form carries a cause, a stack, a finding,
/// or a rule identity. Every other failure reads its message as core's default text does, escaped
/// unless it is the authored marked message of a `FatalError`, resolved as plain text.
pub(crate) fn failure_form(failure: &dyn Failure, scene: &FormScene<'_>) -> FailureForm {
    let plain = scene.plain;
    let author = is_author_fault(failure);
    let message = if !author {
        plain(&marked_sentence(failure, failure.message()))
    } else if scene.development {
        plain(&crate::style::escape(author_sentence(failure)))
    } else {
        GENERIC_MESSAGE.to_owned()
    };
    FailureForm {
        code: if author { "internal" } else { failure.code() }.to_owned(),
        exit_code: failure.exit_code(),
        message,
        hints: scene.hints.iter().map(|hint| plain(hint)).collect(),
    }
}

/// The sentence of a declaration fault or a defect.
fn author_sentence(failure: &dyn Failure) -> &str {
    if let Some(fault) = failure.downcast_ref::<DeclarationError>() {
        return fault.sentence();
    }
    failure
        .downcast_ref::<InternalError>()
        .map_or("", InternalError::sentence)
}

/// What a failure view reads beside the failure: the view context for stderr plus the run's facts.
#[derive(Clone)]
#[non_exhaustive]
pub struct FailureViewContext {
    /// The view context for stderr.
    pub view_context: ViewContext,
    /// The application name.
    pub application: String,
    /// The routed path, or the partial path routing walked.
    pub path: Vec<String>,
    /// The hint lines the `on_failure` hooks added, in installation order.
    pub hints: Vec<String>,
    /// How the run received its inputs.
    pub invoked_by: InvokedBy,
    /// The view the result would have rendered through.
    pub view: Option<String>,
    /// That view's media type.
    pub media_type: Option<String>,
}

/// A view that renders a failure of class `F` for a person.
#[must_use]
pub struct FailureView<F: ?Sized> {
    pub(crate) render: crate::__private::RenderFn<F, FailureViewContext>,
}

impl<F: Failure> FailureView<F> {
    /// A failure view from its render function, which returns the text or a `Result` of it. A view
    /// that fails is `broken-failure-view`: core first writes the failure's default text through the
    /// plain fallback path, so a broken override never leaves a failure unreported, and the run
    /// exits 1, or its signal's code when cancelled.
    pub fn new<T: IntoRendered>(
        render: impl Fn(&F, &FailureViewContext) -> T + Send + Sync + 'static,
    ) -> Self {
        Self {
            render: Arc::new(move |failure, context| render(failure, context).into_rendered()),
        }
    }
}

impl<F: ?Sized> Clone for FailureView<F> {
    fn clone(&self) -> Self {
        Self {
            render: Arc::clone(&self.render),
        }
    }
}

/// The override key of failure class `F`: overriding it replaces the view of `F` and of every
/// class that extends `F` and has no nearer override.
pub struct FailureKey<F> {
    _class: PhantomData<fn() -> F>,
}

impl<F> Clone for FailureKey<F> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<F> Copy for FailureKey<F> {}

/// The override key of failure class `F`, for `override_view(failure::<FatalError>(), view)`.
#[must_use]
pub fn failure<F: Failure>() -> FailureKey<F> {
    FailureKey {
        _class: PhantomData,
    }
}
