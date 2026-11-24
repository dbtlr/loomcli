//! Issue codes: a typed code and parameters an issue carries, so a view rewords one sentence.

use std::marker::PhantomData;

use loomcli_core::Issue;
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::fault;

/// An issue code: builds issues that carry it, and reads its parameters back from an issue.
///
/// A code identifies one sentence, and its parameters are exactly that sentence's blanks. They hold
/// the rule's settings and never the rejected value. A view rewords the sentence by reading the
/// code from an issue: `INTEGER_RANGE_ISSUE.read(&issue)` answers the range, or `None` for any
/// other issue.
pub struct IssueCode<P> {
    code: &'static str,
    message: fn(&P) -> String,
    check: Option<fn(&P) -> bool>,
    _params: PhantomData<fn() -> P>,
}

impl<P: Serialize + DeserializeOwned> IssueCode<P> {
    /// The code, in the rule-identity grammar.
    #[must_use]
    pub fn code(&self) -> &'static str {
        self.code
    }

    /// An issue with this code, its parameters, and the message the code's sentence states.
    ///
    /// # Panics
    ///
    /// Panics with a declaration fault under `@loomcli/validators/issue-parameters` when the code
    /// declares a check that rejects `params`.
    #[track_caller]
    pub fn issue(&self, params: P) -> Issue {
        if self.check.is_some_and(|check| !check(&params)) {
            fault::raise(
                fault::ISSUE_PARAMETERS,
                format!(
                    "Issue code {} rejects the parameters passed to issue().",
                    quoted(self.code)
                ),
                "Supply parameters its code accepts.",
                vec![fault::call(
                    "issue",
                    vec![loomcli_core::Literal::Opaque],
                    "0",
                )],
            );
        }
        let message = (self.message)(&params);
        // A parameter record serde cannot write is no plain data; it reads as `null`.
        let params = serde_json::to_value(&params).unwrap_or(serde_json::Value::Null);
        Issue::new(message).code(self.code, plain_numbers(params))
    }

    /// The parameters of `issue`, when it carries this code and its parameters have exactly the
    /// shape the code declares.
    #[must_use]
    pub fn read(&self, issue: &Issue) -> Option<P> {
        if issue.code.as_deref() != Some(self.code) {
            return None;
        }
        // Derived struct readers also take a JSON array; only a plain object is a parameter record.
        let raw = issue.params.clone().filter(serde_json::Value::is_object)?;
        let params: P = serde_json::from_value(raw).ok()?;
        self.check
            .is_none_or(|check| check(&params))
            .then_some(params)
    }
}

impl<P> IssueCode<P> {
    /// This code with a check on its parameters: `issue` faults for parameters the check rejects,
    /// and `read` answers `None` for them.
    #[must_use]
    pub const fn accepting(self, check: fn(&P) -> bool) -> Self {
        Self {
            check: Some(check),
            ..self
        }
    }
}

/// A string as JSON writes it, quoted.
fn quoted(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| format!("\"{text}\""))
}

/// Writes a whole number held as a float the way `JSON.stringify` does, without a fraction.
fn plain_numbers(value: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match value {
        Value::Number(number) => match number.as_f64() {
            Some(float) if number.is_f64() => crate::js::json_number(float),
            _ => Value::Number(number),
        },
        Value::Array(items) => Value::Array(items.into_iter().map(plain_numbers).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, item)| (key, plain_numbers(item)))
                .collect(),
        ),
        other => other,
    }
}

/// Declares an issue code. A code outside the rule-identity grammar panics, a compile error in a
/// constant.
pub const fn issue_code<P>(code: &'static str, message: fn(&P) -> String) -> IssueCode<P> {
    assert!(
        loomcli_core::is_rule_identity(code),
        "An issue code follows the rule-identity grammar."
    );
    IssueCode {
        code,
        message,
        check: None,
        _params: PhantomData,
    }
}
