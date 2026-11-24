//! Shared helpers for the validator tests: contexts, verdicts, published schemas, a small JSON
//! Schema checker for the soundness tables, and declaration-fault capture.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::panic::{AssertUnwindSafe, catch_unwind};

use loomcli_core::{
    InputIdentity, InputKind, Issue, ValidationContext, ValidationFacts, Validator,
    validation_context,
};
use loomcli_testing::{MockFields, mock_process};
use regex::Regex;
use serde_json::Value;

/// A validation context from a mock process with the working directory and time zone given.
pub fn context_in(cwd: &str, time_zone: &str) -> ValidationContext {
    let process = mock_process(MockFields::new().cwd(cwd).time_zone(time_zone));
    validation_context(
        process,
        ValidationFacts::invocation(InputIdentity::new(false, InputKind::Option, "value")),
    )
    .unwrap_or_else(|_| panic!("the mock process captures"))
}

/// A context in the root with the UTC time zone.
pub fn context() -> ValidationContext {
    context_in("/loom-test", "UTC")
}

/// The verdict of one direct call.
pub fn verdict<V: Validator>(validator: &V, token: &str) -> Result<V::Output, Vec<Issue>> {
    validator.validate(token, &context())
}

/// The accepted value of a token, failing the test with the issues when it is rejected.
pub fn accepted<V: Validator>(validator: &V, token: &str) -> V::Output {
    match verdict(validator, token) {
        Ok(value) => value,
        Err(issues) => panic!("{token:?} was rejected: {issues:?}"),
    }
}

/// The messages of one direct call's issues, and whether any of them repeats the token. The empty
/// token is inside every string, so it never counts as repeated.
pub fn rejection<V: Validator>(validator: &V, token: &str) -> (Vec<String>, bool) {
    match verdict(validator, token) {
        Ok(_) => panic!("{token:?} was accepted"),
        Err(issues) => {
            let messages: Vec<String> = issues.iter().map(|issue| issue.message.clone()).collect();
            let repeats =
                !token.is_empty() && messages.iter().any(|message| message.contains(token));
            (messages, repeats)
        }
    }
}

/// What `rejection` reads for a token rejected with exactly one issue carrying the message.
pub fn rejected_with(message: &str) -> (Vec<String>, bool) {
    (vec![message.to_owned()], false)
}

/// The one issue a rejected token earns.
pub fn issue_of<V: Validator>(validator: &V, token: &str) -> Issue {
    match verdict(validator, token) {
        Ok(_) => panic!("{token:?} was accepted"),
        Err(mut issues) => {
            assert_eq!(issues.len(), 1, "{issues:?}");
            issues.remove(0)
        }
    }
}

/// The published input schema as JSON text, in the reference's key order, the `$schema` dialect
/// first.
pub fn published<V: Validator>(validator: &V) -> String {
    let schema = validator
        .input_schema()
        .expect("the validator publishes a schema");
    serde_json::to_string(&Value::Object(schema)).expect("a schema is JSON")
}

/// The published input schema as a JSON value.
pub fn published_value<V: Validator>(validator: &V) -> Value {
    Value::Object(
        validator
            .input_schema()
            .expect("the validator publishes a schema"),
    )
}

/// Whether a JSON value satisfies a schema of the keywords the catalog publishes: `type`,
/// `minLength`, `maxLength`, `minimum`, `maximum`, `enum`, `pattern`, `anyOf`, and the formats
/// that a plain parse can check. A `uri` or `date-time` format is not checked here.
pub fn satisfies(schema: &Value, value: &Value) -> bool {
    let Some(keywords) = schema.as_object() else {
        return false;
    };
    keywords
        .iter()
        .all(|(keyword, expected)| match keyword.as_str() {
            "type" => match expected.as_str() {
                Some("string") => value.is_string(),
                Some("integer") => value.as_f64().is_some_and(|number| number.fract() == 0.0),
                Some("number") => value.is_number(),
                _ => false,
            },
            "minLength" => value
                .as_str()
                .is_none_or(|text| text.chars().count() as u64 >= expected.as_u64().unwrap_or(0)),
            "maxLength" => value.as_str().is_none_or(|text| {
                text.chars().count() as u64 <= expected.as_u64().unwrap_or(u64::MAX)
            }),
            "minimum" => value
                .as_f64()
                .is_none_or(|number| number >= expected.as_f64().unwrap_or(f64::MIN)),
            "maximum" => value
                .as_f64()
                .is_none_or(|number| number <= expected.as_f64().unwrap_or(f64::MAX)),
            "enum" => expected
                .as_array()
                .is_some_and(|values| values.contains(value)),
            "pattern" => value.as_str().is_none_or(|text| {
                expected
                    .as_str()
                    .and_then(|source| Regex::new(&js_whitespace(source)).ok())
                    .is_some_and(|expression| expression.is_match(text))
            }),
            "anyOf" => expected
                .as_array()
                .is_some_and(|members| members.iter().any(|member| satisfies(member, value))),
            "format" => value
                .as_str()
                .is_none_or(|text| format_holds(expected.as_str().unwrap_or(""), text)),
            _ => true,
        })
}

/// A published pattern with each `\s` written as ECMAScript reads it, which includes U+FEFF and
/// leaves out U+0085, where the regex crate's `\s` is Unicode `White_Space`.
fn js_whitespace(source: &str) -> String {
    source.replace(
        "\\s",
        r"[\x{9}-\x{D} \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]",
    )
}

fn format_holds(format: &str, text: &str) -> bool {
    match format {
        "ipv4" => text.parse::<std::net::Ipv4Addr>().is_ok(),
        "ipv6" => text.parse::<std::net::Ipv6Addr>().is_ok(),
        "uuid" => Regex::new("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
            .is_ok_and(|expression| expression.is_match(text)),
        "date" => text.len() == 10 && text.parse::<jiff::civil::Date>().is_ok(),
        "hostname" => {
            text.len() <= 253
                && Regex::new(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$")
                    .is_ok_and(|expression| expression.is_match(text))
        }
        "uri" => url::Url::parse(text).is_ok(),
        _ => true,
    }
}

/// Whether the value a token stands for satisfies the schema the validator publishes.
pub fn conforms<V: Validator>(validator: &V, value: &Value) -> bool {
    satisfies(&published_value(validator), value)
}

/// What a declaration fault reports, read from the panic message of the call that raised it.
#[derive(Debug, PartialEq, Eq)]
pub struct Fault {
    pub identity: String,
    pub sentence: String,
    pub correction: String,
    /// The whole Developer Diagnostic.
    pub message: String,
}

/// Runs a call and returns the declaration fault it raised, or `None` when it returned.
pub fn fault_of<R>(call: impl FnOnce() -> R) -> Option<Fault> {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let result = catch_unwind(AssertUnwindSafe(call));
    std::panic::set_hook(previous);
    let payload = result.err()?;
    let message = payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|text| (*text).to_owned())
        })
        .expect("a declaration fault panics with its diagnostic");
    Some(parts(&message))
}

/// The identity, sentence, and correction of one Developer Diagnostic.
fn parts(message: &str) -> Fault {
    let mut sections = message.split("\n\n");
    let banner = sections.next().unwrap_or("");
    let identity = banner.rsplit(' ').next().unwrap_or("").to_owned();
    let rest: Vec<&str> = sections.collect();
    let sentence = rest.first().copied().unwrap_or("").replace('\n', " ");
    let correction = rest.last().copied().unwrap_or("").replace('\n', " ");
    Fault {
        identity,
        sentence,
        correction,
        message: message.to_owned(),
    }
}

/// What the fault of a call states: its sentence and correction, joined as the reference's fault
/// tables write them, after asserting it is a declaration fault.
pub fn fault_text<R>(call: impl FnOnce() -> R) -> String {
    let fault = fault_of(call).expect("the call raised no declaration fault");
    format!("{} {}", fault.sentence, fault.correction)
}

/// A fresh directory under the system temporary folder, removed when dropped.
pub struct TempDir {
    path: std::path::PathBuf,
}

impl TempDir {
    pub fn new(name: &str) -> Self {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "loomcli-validators-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).expect("a temporary directory");
        Self { path }
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// A `date()` with the layouts given, whatever their number up to four.
pub fn date_l(layouts: &[&str]) -> loomcli_validators::Date {
    let base = loomcli_validators::date();
    match layouts {
        [a] => base.layouts([a]),
        [a, b] => base.layouts([a, b]),
        [a, b, c] => base.layouts([a, b, c]),
        [a, b, c, d] => base.layouts([a, b, c, d]),
        _ => panic!("one to four layouts"),
    }
}

/// A `date_time()` with the layouts given, whatever their number up to three.
pub fn date_time_l(layouts: &[&str]) -> loomcli_validators::DateTime {
    let base = loomcli_validators::date_time();
    match layouts {
        [a] => base.layouts([a]),
        [a, b] => base.layouts([a, b]),
        [a, b, c] => base.layouts([a, b, c]),
        _ => panic!("one to three layouts"),
    }
}

/// A `time()` with the layouts given, whatever their number up to three.
pub fn time_l(layouts: &[&str]) -> loomcli_validators::Time {
    let base = loomcli_validators::time();
    match layouts {
        [a] => base.layouts([a]),
        [a, b] => base.layouts([a, b]),
        [a, b, c] => base.layouts([a, b, c]),
        _ => panic!("one to three layouts"),
    }
}

/// An instant as `Date.prototype.toISOString` writes it.
pub fn iso(instant: jiff::Timestamp) -> String {
    instant.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}
