//! The one setting the types cannot carry: the label's grammar, judged at the `service()` call.

use loomcli_core::{
    DeclarationError, DiagnosticParts, DiagnosticRule, FailureFacts, Finding, diagnostic_rule,
};

use crate::PACKAGE_NAME;

/// `@loomcli/plugins/service/settings`.
const SETTINGS_RULE: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/service/settings",
    "Invalid service setting",
    "The service plugin names its unit by label: the systemd unit is <label>.service and the launchd agent's Label is the label. So label is a reverse-DNS name of two or more segments of letters, digits, and hyphens, each opening with a letter or digit, 247 characters at most, which keeps the unit name within systemd's 255 characters.",
);

/// The longest label, so `<label>.service` fits systemd's 255-character unit name.
const LONGEST_LABEL: usize = 247;

/// Whether a segment is a letter or digit followed by letters, digits, and `-`.
fn is_segment(segment: &str) -> bool {
    let mut characters = segment.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphanumeric())
        && characters.all(|each| each.is_ascii_alphanumeric() || each == '-')
}

/// Whether a label follows the grammar and fits its length: two or more segments joined by `.`.
pub(super) fn is_label(label: &str) -> bool {
    label.len() <= LONGEST_LABEL && label.contains('.') && label.split('.').all(is_segment)
}

/// Panics with the Developer Diagnostic of a label outside the grammar, marked on the argument.
#[track_caller]
pub(super) fn judge_label(label: &str) {
    if is_label(label) {
        return;
    }
    let fault = DeclarationError::new(
        SETTINGS_RULE,
        DiagnosticParts::new(format!(
            "Plugin \"{PACKAGE_NAME}/service\" setting \"label\" is not a reverse-DNS name."
        ))
        .finding(Finding::new("service", vec![label.into()]).mark("0"))
        .correction("Supply a label such as com.acme.notes."),
    );
    panic!("{}", FailureFacts::message(&fault));
}
