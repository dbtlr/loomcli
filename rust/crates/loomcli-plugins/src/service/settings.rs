//! The service settings the types cannot check, judged when the author supplies them.

use std::num::NonZeroU64;

use loomcli_core::{
    DeclarationError, DiagnosticParts, DiagnosticRule, FailureFacts, Finding, diagnostic_rule,
};

use crate::PACKAGE_NAME;

/// `@loomcli/plugins/service/settings`.
const SETTINGS_RULE: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/service/settings",
    "Invalid service setting",
    "The service plugin names its unit by label: the systemd unit is <label>.service and the launchd agent's Label is the label. So label is a reverse-DNS name of two or more segments of letters, digits, and hyphens, each opening with a letter or digit, 247 characters at most, which keeps the unit name within systemd's 255 characters. When set, output must be a nonempty path and stop_timeout must be a positive whole number of milliseconds.",
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
    if !is_label(label) {
        invalid_setting(
            "label",
            "is not a reverse-DNS name",
            Finding::new("service", vec![label.into()]).mark("0"),
            "Supply a label such as com.acme.notes.",
        );
    }
}

/// Rejects an empty output path at the setter.
#[track_caller]
pub(super) fn judge_output(path: &str) {
    if path.is_empty() {
        invalid_setting(
            "output",
            "is empty",
            Finding::new(".output", vec![path.into()]).mark("0"),
            "Supply a file path or omit output.",
        );
    }
}

/// Rejects zero at the setter and returns the positive timeout otherwise.
#[track_caller]
pub(super) fn judge_stop_timeout(milliseconds: u64) -> NonZeroU64 {
    match NonZeroU64::new(milliseconds) {
        Some(timeout) => timeout,
        None => invalid_setting(
            "stop_timeout",
            "is not a positive whole number",
            Finding::new(".stop_timeout", vec![0.into()]).mark("0"),
            "Supply a positive whole number of milliseconds or omit stop_timeout.",
        ),
    }
}

#[track_caller]
fn invalid_setting(field: &str, problem: &str, finding: Finding, correction: &str) -> ! {
    let fault = DeclarationError::new(
        SETTINGS_RULE,
        DiagnosticParts::new(format!(
            "Plugin \"{PACKAGE_NAME}/service\" setting \"{field}\" {problem}."
        ))
        .finding(finding)
        .correction(correction),
    );
    panic!("{}", FailureFacts::message(&fault));
}
