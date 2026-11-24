//! `one_of`, `url`, `uuid`, `key_value`, and `email`.

use loomcli_core::{Finding, InputSchema, Issue, Literal, ValidationContext, Validator};
use serde_json::{Map, Value, json};

use crate::codes::{
    EMAIL_ISSUE, KEY_VALUE_ISSUE, NoParams, ONE_OF_ISSUE, Protocols, Separator, URL_ISSUE,
    URL_SCHEME_ISSUE, UUID_ISSUE, Values,
};
use crate::fault;
use crate::js::{escape_syntax, is_js_whitespace};
use crate::uri::{is_scheme, is_uri};

fn string_schema(members: &[(&str, Value)]) -> InputSchema {
    let mut schema = Map::new();
    schema.insert("type".to_owned(), "string".into());
    for (key, value) in members {
        schema.insert((*key).to_owned(), value.clone());
    }
    Some(loomcli_core::with_schema_dialect(schema))
}

fn strings(values: &[&str]) -> Literal {
    Literal::List(values.iter().map(|value| Literal::from(*value)).collect())
}

/// One of a fixed set of strings.
#[derive(Clone, Debug)]
#[must_use]
pub struct OneOf {
    values: Vec<String>,
}

/// Validates one of `values`, matched exactly and case-sensitively. An empty list, or a value
/// listed twice, is a fault at the call.
#[track_caller]
pub fn one_of<const N: usize>(values: [&str; N]) -> OneOf {
    if values.is_empty() {
        fault::raise(
            fault::ONE_OF_VALUES,
            "one_of() lists no values.",
            "List at least one value.",
            vec![Finding::new("one_of", vec![strings(&values)]).mark("0")],
        );
    }
    for (index, value) in values.iter().enumerate() {
        if let Some(first) = values[..index].iter().position(|earlier| earlier == value) {
            let call = || Finding::new("one_of", vec![strings(&values)]);
            let quoted = serde_json::to_string(value).unwrap_or_default();
            fault::raise(
                fault::ONE_OF_VALUES,
                format!("one_of() lists {quoted} twice."),
                "List each value once.",
                vec![
                    call().mark(format!("0.{first}")).note("the first"),
                    call().mark(format!("0.{index}")).note("the second"),
                ],
            );
        }
    }
    OneOf {
        values: values.iter().map(|value| (*value).to_owned()).collect(),
    }
}

impl Validator for OneOf {
    type Output = String;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<String, Vec<Issue>> {
        if self.values.iter().any(|value| value == input) {
            return Ok(input.to_owned());
        }
        Err(vec![ONE_OF_ISSUE.issue(Values {
            values: self.values.clone(),
        })])
    }

    fn input_schema(&self) -> InputSchema {
        string_schema(&[("enum", json!(self.values))])
    }
}

/// A URL with one of the allowed protocols.
#[derive(Clone, Debug)]
#[must_use]
pub struct Url {
    protocols: Option<Vec<String>>,
}

/// Validates a URL: an absolute RFC 3986 URI that the WHATWG parser also reads; any scheme unless
/// [`Url::protocols`] says otherwise.
pub fn url() -> Url {
    Url { protocols: None }
}

impl Url {
    /// The protocols accepted, such as `["https"]`, compared without regard to case. An entry that
    /// is not an RFC 3986 scheme name, or an empty list, is a fault at the call.
    #[track_caller]
    pub fn protocols<const N: usize>(mut self, protocols: [&str; N]) -> Self {
        let scheme =
            "List a letter followed by letters, digits, +, -, or ., with no trailing colon.";
        if protocols.is_empty() {
            fault::raise(
                fault::URL_PROTOCOLS,
                "url() protocols lists no scheme.",
                "List at least one scheme name.",
                vec![Finding::new("url().protocols", vec![strings(&protocols)]).mark("0")],
            );
        }
        if let Some(invalid) = protocols.iter().position(|protocol| !is_scheme(protocol)) {
            let quoted = serde_json::to_string(protocols[invalid]).unwrap_or_default();
            fault::raise(
                fault::URL_PROTOCOLS,
                format!("url() protocols lists {quoted}, which is not a scheme name."),
                scheme,
                vec![
                    Finding::new("url().protocols", vec![strings(&protocols)])
                        .mark(format!("0.{invalid}")),
                ],
            );
        }
        self.protocols = Some(
            protocols
                .iter()
                .map(|protocol| (*protocol).to_owned())
                .collect(),
        );
        self
    }

    /// One scheme as a case-free pattern: each letter as a two-case class, `+` and `.` escaped. A
    /// hyphen stays bare, because the `u` flag JSON Schema patterns use refuses `\-` outside a
    /// class.
    fn spell_scheme(scheme: &str) -> String {
        let mut spelled = String::new();
        for character in scheme.chars() {
            if matches!(character, '+' | '.') {
                spelled.push('\\');
                spelled.push(character);
            } else if character.is_ascii_alphabetic() {
                spelled.push_str(&format!(
                    "[{}{}]",
                    character.to_ascii_lowercase(),
                    character.to_ascii_uppercase()
                ));
            } else {
                spelled.push(character);
            }
        }
        spelled
    }
}

impl Validator for Url {
    type Output = url::Url;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<url::Url, Vec<Issue>> {
        let rejection = || {
            vec![match &self.protocols {
                None => URL_ISSUE.issue(NoParams {}),
                Some(protocols) => URL_SCHEME_ISSUE.issue(Protocols {
                    protocols: protocols.clone(),
                }),
            }]
        };
        if !is_uri(input) {
            return Err(rejection());
        }
        let parsed = url::Url::parse(input).map_err(|_| rejection())?;
        match &self.protocols {
            Some(protocols)
                if !protocols
                    .iter()
                    .any(|protocol| protocol.eq_ignore_ascii_case(parsed.scheme())) =>
            {
                Err(rejection())
            }
            _ => Ok(parsed),
        }
    }

    fn input_schema(&self) -> InputSchema {
        let mut members = vec![("format", json!("uri"))];
        if let Some(protocols) = &self.protocols {
            let spelled: Vec<String> = protocols
                .iter()
                .map(|each| Url::spell_scheme(each))
                .collect();
            members.push(("pattern", json!(format!("^(?:{}):", spelled.join("|")))));
        }
        string_schema(&members)
    }
}

/// A UUID, as its canonical lowercase string.
#[derive(Clone, Debug)]
#[must_use]
pub struct Uuid {}

/// Validates a UUID of any version in any letter case, read as lowercase so two spellings compare
/// equal.
pub fn uuid() -> Uuid {
    Uuid {}
}

impl Validator for Uuid {
    type Output = String;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<String, Vec<Issue>> {
        let groups: Vec<&str> = input.split('-').collect();
        let widths = [8, 4, 4, 4, 12];
        let valid = groups.len() == widths.len()
            && groups.iter().zip(widths).all(|(group, width)| {
                group.len() == width && group.bytes().all(|byte| byte.is_ascii_hexdigit())
            });
        if valid {
            Ok(input.to_ascii_lowercase())
        } else {
            Err(vec![UUID_ISSUE.issue(NoParams {})])
        }
    }

    fn input_schema(&self) -> InputSchema {
        string_schema(&[("format", json!("uuid"))])
    }
}

/// A `key=value` pair.
#[derive(Clone, Debug)]
#[must_use]
pub struct KeyValue {
    separator: String,
}

/// A key and a value split at the first separator.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct KeyValuePair {
    /// The key, as written.
    pub key: String,
    /// The value, as written; it may be empty.
    pub value: String,
}

/// Validates a `key=value` pair split at the first separator, both sides as written. The key holds
/// one character or more, and the value may be empty.
pub fn key_value() -> KeyValue {
    KeyValue {
        separator: "=".to_owned(),
    }
}

impl KeyValue {
    /// The separator between key and value. An empty one, or one that holds whitespace, is a
    /// fault at the call.
    #[track_caller]
    pub fn separator(mut self, separator: &str) -> Self {
        let problem = if separator.is_empty() {
            Some("is empty")
        } else if separator.chars().any(is_js_whitespace) {
            Some("holds whitespace")
        } else {
            None
        };
        if let Some(problem) = problem {
            fault::raise(
                fault::KEY_VALUE_SEPARATOR,
                format!("key_value() separator {problem}."),
                "Supply one character or more with no whitespace, such as \"=\" or \":\".",
                vec![
                    Finding::new("key_value().separator", vec![Literal::from(separator)]).mark("0"),
                ],
            );
        }
        self.separator = separator.to_owned();
        self
    }
}

impl Validator for KeyValue {
    type Output = KeyValuePair;

    fn validate(
        &self,
        input: &str,
        _context: &ValidationContext,
    ) -> Result<KeyValuePair, Vec<Issue>> {
        match input.find(&self.separator) {
            Some(at) if at >= 1 => Ok(KeyValuePair {
                key: input[..at].to_owned(),
                value: input[at + self.separator.len()..].to_owned(),
            }),
            _ => Err(vec![KEY_VALUE_ISSUE.issue(Separator {
                separator: self.separator.clone(),
            })]),
        }
    }

    fn input_schema(&self) -> InputSchema {
        // One character or more, line terminators included, then the separator.
        let pattern = format!(r"^[\s\S]+{}", escape_syntax(&self.separator));
        string_schema(&[("pattern", json!(pattern))])
    }
}

/// An email address.
#[derive(Clone, Debug)]
#[must_use]
pub struct Email {}

/// One domain label of the WHATWG rule: letters, digits, and hyphens, 1 through 63, no hyphen at an end.
const EMAIL_LABEL: &str = "[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?";

/// The part before the `@`: one or more letters, digits, and the punctuation the WHATWG rule lists.
const EMAIL_LOCAL: &str = "[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+";

/// The WHATWG HTML standard's valid email address production, the rule browsers apply to
/// `<input type="email">`, which the validator publishes as it is.
fn email_pattern() -> String {
    format!(r"^{EMAIL_LOCAL}@{EMAIL_LABEL}(?:\.{EMAIL_LABEL})*$")
}

/// Validates an email address under the WHATWG rule, output as written.
pub fn email() -> Email {
    Email {}
}

impl Validator for Email {
    type Output = String;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<String, Vec<Issue>> {
        static GRAMMAR: std::sync::LazyLock<regex::Regex> =
            std::sync::LazyLock::new(|| crate::grammar::constant(&email_pattern()));
        if GRAMMAR.is_match(input) {
            Ok(input.to_owned())
        } else {
            Err(vec![EMAIL_ISSUE.issue(NoParams {})])
        }
    }

    fn input_schema(&self) -> InputSchema {
        string_schema(&[("pattern", json!(email_pattern()))])
    }
}
