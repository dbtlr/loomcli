//! A development build's Developer Diagnostic for a fault `run()` reports: laid out for the run's
//! stderr, with the application name before each finding's path, and, for a defect, its source and
//! cause chain.

use crate::failures::sentences::is_author_fault;
use crate::style::Style;
use crate::{DeclarationError, Failure, FailureFacts, InternalError};

use super::defect::{SourceAccess, defect_evidence};
use super::text::{Anatomy, Layout, MESSAGE_WIDTH, Sections, diagnostic_sections};

/// A fault only the author can fix, which a development build reports as its Developer
/// Diagnostic.
#[derive(Clone, Copy)]
pub(crate) enum AuthorFault<'a> {
    /// A declaration fault.
    Declaration(&'a DeclarationError),
    /// A defect, a `ResultError` included.
    Defect(&'a InternalError),
}

impl<'a> AuthorFault<'a> {
    /// The author fault one failure is, or `None` for an operator failure.
    pub(crate) fn of(failure: &'a dyn Failure) -> Option<Self> {
        if !is_author_fault(failure) {
            return None;
        }
        if let Some(fault) = failure.downcast_ref::<DeclarationError>() {
            return Some(AuthorFault::Declaration(fault));
        }
        failure
            .downcast_ref::<InternalError>()
            .map(AuthorFault::Defect)
    }
}

/// Where a development build's diagnostics print: the application name a finding's path opens
/// with, stderr's effective columns read now (`None` when stderr is not a terminal or reports no
/// width), and what a defect's source is read through.
pub(crate) struct DeveloperScene<'a> {
    pub(crate) application: &'a str,
    pub(crate) columns: Option<usize>,
    pub(crate) source: SourceAccess<'a>,
}

/// The banner and body of one fault's diagnostic, laid out for this run's stderr at its effective
/// width, or at 80 columns when it has none.
pub(crate) fn developer_sections(fault: AuthorFault<'_>, scene: &DeveloperScene<'_>) -> Sections {
    let layout = Layout {
        width: scene.columns.unwrap_or(MESSAGE_WIDTH),
        application: Some(scene.application),
    };
    match fault {
        AuthorFault::Declaration(fault) => diagnostic_sections(&fault.anatomy(), layout),
        AuthorFault::Defect(defect) => {
            let evidence = defect_evidence(defect.cause(), &scene.source);
            let anatomy: Anatomy<'_> = defect.anatomy(evidence);
            diagnostic_sections(&anatomy, layout)
        }
    }
}

/// One fault's Developer Diagnostic as marked text for stderr, the banner in the error style, and
/// the hints printed under it after one blank line. It is not a view, so no override replaces it.
pub(crate) fn developer_text(
    fault: AuthorFault<'_>,
    scene: &DeveloperScene<'_>,
    hints: &[String],
    style: &Style,
) -> String {
    let Sections { banner, body } = developer_sections(fault, scene);
    let hinted: String = if hints.is_empty() {
        String::new()
    } else {
        std::iter::once("\n".to_owned())
            .chain(hints.iter().map(|hint| format!("{hint}\n")))
            .collect()
    };
    format!(
        "{}\n\n{}\n{hinted}",
        style.error().apply(&style.escape(&banner)),
        style.escape(&body)
    )
}

/// One fault's Developer Diagnostic as plain text, for the plain fallback path.
pub(crate) fn developer_plain_text(fault: AuthorFault<'_>, scene: &DeveloperScene<'_>) -> String {
    let Sections { banner, body } = developer_sections(fault, scene);
    format!("{banner}\n\n{body}\n")
}
