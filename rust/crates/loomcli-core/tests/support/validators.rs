//! Small validators the tests declare, in place of the validator catalog a later crate ships.

use std::sync::{Arc, Mutex};

use loomcli_core::{Issue, OmissionValidator, ValidationContext, ValidationPhase, Validator};
use serde_json::{Value, json};

/// Accepts one or more ASCII digits, as itself.
#[derive(Clone)]
pub struct Digits(pub &'static str);

impl Validator for Digits {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        if !input.is_empty() && input.bytes().all(|byte| byte.is_ascii_digit()) {
            Ok(input.to_owned())
        } else {
            Err(vec![Issue::new(self.0)])
        }
    }
}

/// Accepts one or more ASCII digits, as a number.
#[derive(Clone)]
pub struct Number(pub &'static str);

impl Validator for Number {
    type Output = u64;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<u64, Vec<Issue>> {
        input.parse().map_err(|_| vec![Issue::new(self.0)])
    }
}

/// Accepts one of a fixed list of words.
#[derive(Clone)]
pub struct OneOf(pub &'static [&'static str], pub &'static str);

impl Validator for OneOf {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        if self.0.contains(&input) {
            Ok(input.to_owned())
        } else {
            Err(vec![Issue::new(self.1)])
        }
    }
}

/// Accepts one of a fixed list of words and answers it uppercased.
#[derive(Clone)]
pub struct OneOfUpper(pub &'static [&'static str], pub &'static str);

impl Validator for OneOfUpper {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        if self.0.contains(&input) {
            Ok(input.to_uppercase())
        } else {
            Err(vec![Issue::new(self.1)])
        }
    }
}

/// Rejects the empty string.
#[derive(Clone)]
pub struct NonEmpty(pub &'static str);

impl Validator for NonEmpty {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        if input.is_empty() {
            Err(vec![Issue::new(self.0)])
        } else {
            Ok(input.to_owned())
        }
    }
}

/// Answers its input uppercased.
#[derive(Clone)]
pub struct Upper;

impl Validator for Upper {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        Ok(input.to_uppercase())
    }
}

/// Rejects every value with these issues.
#[derive(Clone)]
pub struct Rejecting(pub Vec<Issue>);

impl Validator for Rejecting {
    type Output = String;

    fn validate(&self, _: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        Err(self.0.clone())
    }
}

/// What a recording validator saw on each call.
pub type Calls = Arc<Mutex<Vec<Value>>>;

/// A fresh record of calls.
pub fn calls() -> Calls {
    Arc::new(Mutex::new(Vec::new()))
}

/// The calls recorded so far.
pub fn seen(calls: &Calls) -> Vec<Value> {
    calls.lock().map(|calls| calls.clone()).unwrap_or_default()
}

fn phase(phase: ValidationPhase) -> &'static str {
    match phase {
        ValidationPhase::Default => "default",
        ValidationPhase::Invocation => "invocation",
        ValidationPhase::Question => "question",
    }
}

/// A validation context as the reference's fixtures reduce it: the host's argv and cwd, and every
/// other field as itself, a field the phase does not carry left out.
pub fn context_json(context: &ValidationContext) -> Value {
    let mut reduced = serde_json::Map::new();
    if let Some(command) = &context.command {
        reduced.insert("command".into(), json!(command));
    }
    reduced.insert(
        "host".into(),
        json!({ "argv": context.host.argv, "cwd": context.host.cwd }),
    );
    reduced.insert("input".into(), json!(context.input));
    if let Some(passthrough) = &context.passthrough {
        reduced.insert("passthrough".into(), json!(passthrough));
    }
    reduced.insert("phase".into(), json!(phase(context.phase)));
    if let Some(supplied) = &context.supplied {
        reduced.insert(
            "supplied".into(),
            json!({
                "args": super::record_json(&supplied.args),
                "options": super::record_json(&supplied.options),
            }),
        );
    }
    reduced.insert("suppliedKey".into(), json!(context.supplied.is_some()));
    Value::Object(reduced)
}

/// Accepts every value as itself and records `{ context, label, value }` for each call.
#[derive(Clone)]
pub struct Echo {
    pub label: &'static str,
    pub calls: Calls,
}

impl Validator for Echo {
    type Output = String;

    fn validate(&self, input: &str, context: &ValidationContext) -> Result<String, Vec<Issue>> {
        if let Ok(mut calls) = self.calls.lock() {
            calls.push(
                json!({ "context": context_json(context), "label": self.label, "value": input }),
            );
        }
        Ok(input.to_owned())
    }
}

/// The reference's omission fixture: a supplied value answers `file:<value>`; the omission answers
/// `stdin`, or rejects with the message when one is given. Each call records what it saw.
#[derive(Clone)]
pub struct Source {
    pub message: Option<&'static str>,
    pub calls: Calls,
}

impl Source {
    fn record(&self, absent: bool, context: &ValidationContext) {
        if let Ok(mut calls) = self.calls.lock() {
            calls.push(json!({
                "absent": absent,
                "input": context.input,
                "phase": phase(context.phase),
                "supplied": context.supplied.as_ref().map(|supplied| json!({
                    "args": super::record_json(&supplied.args),
                    "options": super::record_json(&supplied.options),
                })),
            }));
        }
    }
}

impl Validator for Source {
    type Output = String;

    fn validate(&self, input: &str, context: &ValidationContext) -> Result<String, Vec<Issue>> {
        self.record(false, context);
        Ok(format!("file:{input}"))
    }
}

impl OmissionValidator for Source {
    fn validate_omission(&self, context: &ValidationContext) -> Result<String, Vec<Issue>> {
        self.record(true, context);
        match self.message {
            Some(message) => Err(vec![Issue::new(message)]),
            None => Ok("stdin".to_owned()),
        }
    }
}

/// Cancels the caller's token on every call, counts its calls, and accepts the value: a run
/// cancelled from inside a validator, as the reference's `controller.abort()` there.
#[derive(Clone)]
pub struct Cancelling {
    pub token: tokio_util::sync::CancellationToken,
    pub calls: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

impl Cancelling {
    pub fn new(token: &tokio_util::sync::CancellationToken) -> Self {
        Self {
            token: token.clone(),
            calls: std::sync::Arc::default(),
        }
    }

    pub fn calls(&self) -> usize {
        self.calls.load(std::sync::atomic::Ordering::SeqCst)
    }
}

impl Validator for Cancelling {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.token.cancel();
        Ok(input.to_owned())
    }
}
