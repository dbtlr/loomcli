//! Reading a declaration fault the way the reference's `ruleText` reads it: the sentence followed by
//! its correction, from a returned `DeclarationError` or from the diagnostic a faulty call panics
//! with.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::panic::{AssertUnwindSafe, catch_unwind};

use loomcli_core::DeclarationError;

/// The message a faulty call panics with.
pub fn panic_message(declare: impl FnOnce()) -> String {
    let payload = catch_unwind(AssertUnwindSafe(declare)).expect_err("the call faults");
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|text| (*text).to_owned())
        })
        .expect("the panic carries the diagnostic")
}

/// The paragraphs of a diagnostic, each with its wrapped lines joined by a space.
fn paragraphs(message: &str) -> Vec<String> {
    message
        .split("\n\n")
        .map(|paragraph| {
            paragraph
                .lines()
                .map(str::trim)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect()
}

/// The rule identity a diagnostic's banner ends with, without core's prefix.
pub fn panic_rule(message: &str) -> String {
    let banner = message.lines().next().unwrap_or_default();
    let identity = banner.rsplit(' ').next().unwrap_or_default();
    identity
        .strip_prefix("@loomcli/core/")
        .unwrap_or(identity)
        .to_owned()
}

/// The sentence and the correction of the diagnostic a faulty call panics with, joined by a space.
pub fn thrown(declare: impl FnOnce()) -> String {
    let message = panic_message(declare);
    let paragraphs = paragraphs(&message);
    format!(
        "{} {}",
        paragraphs[1],
        paragraphs.last().cloned().unwrap_or_default()
    )
}

/// A returned fault's sentence followed by each correction.
pub fn rule_text(fault: &DeclarationError) -> String {
    std::iter::once(fault.sentence().to_owned())
        .chain(fault.correction().iter().cloned())
        .collect::<Vec<_>>()
        .join(" ")
}

/// A returned fault's rule identity, without core's prefix.
pub fn rule_name(fault: &DeclarationError) -> String {
    let identity = fault.rule().map_or("none", |rule| rule.identity());
    identity
        .strip_prefix("@loomcli/core/")
        .unwrap_or(identity)
        .to_owned()
}
