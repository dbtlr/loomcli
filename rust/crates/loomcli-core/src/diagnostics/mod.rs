//! Developer Diagnostics: diagnostic rules, findings, and rule identities.
//!
//! A Developer Diagnostic teaches the author what broke, where, why the rule exists, and how to fix
//! it: a banner with the rule's headline and identity, the sentence, the findings that rebuild the
//! declaration as Rust builder calls, the explanation, the correction, and the docs link.

pub(crate) mod defect;
pub(crate) mod developer;
pub(crate) mod rules;
pub(crate) mod text;

#[cfg(test)]
mod tests;

use std::fmt;

/// One reason a declaration is wrong, shared by every site that raises it.
///
/// Declare one as a constant with [`diagnostic_rule`]; an identity outside the grammar is a compile
/// error there.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DiagnosticRule {
    identity: &'static str,
    headline: &'static str,
    explanation: &'static str,
    docs: Option<&'static str>,
}

impl DiagnosticRule {
    /// Adds a docs link the diagnostic prints as `See <url>`.
    #[must_use]
    pub const fn docs(self, url: &'static str) -> Self {
        Self {
            docs: Some(url),
            ..self
        }
    }

    /// The identity: `<package>[/<subpath>...]/<rule-name>`.
    #[must_use]
    pub const fn identity(&self) -> &'static str {
        self.identity
    }

    /// The headline, a short noun phrase.
    #[must_use]
    pub const fn headline(&self) -> &'static str {
        self.headline
    }

    /// Why the rule exists.
    #[must_use]
    pub const fn explanation(&self) -> &'static str {
        self.explanation
    }

    /// The docs link, when the rule has one.
    #[must_use]
    pub const fn docs_url(&self) -> Option<&'static str> {
        self.docs
    }
}

/// Declares a diagnostic rule. An identity outside the rule-identity grammar panics, which in a
/// constant is a compile error.
#[must_use]
pub const fn diagnostic_rule(
    identity: &'static str,
    headline: &'static str,
    explanation: &'static str,
) -> DiagnosticRule {
    assert!(
        is_rule_identity(identity),
        "A rule identity is a package name, optional subpath segments, and a kebab-case rule name."
    );
    DiagnosticRule {
        identity,
        headline,
        explanation,
        docs: None,
    }
}

/// The longest package name npm accepts, scope included.
const PACKAGE_NAME_LIMIT: usize = 214;

/// Whether `byte` may open a package name or a scope: a lowercase letter, a digit, or `-`.
const fn opens_package(byte: u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
}

/// Whether `byte` may follow inside a package name or a scope: `.` and `_` as well.
const fn continues_package(byte: u8) -> bool {
    opens_package(byte) || byte == b'.' || byte == b'_'
}

/// The index just past one package-name part that starts at `start` and runs to the next `/`, or
/// `None` when the part is empty or holds a byte outside the grammar.
const fn package_part(bytes: &[u8], start: usize) -> Option<usize> {
    if start >= bytes.len() || !opens_package(bytes[start]) {
        return None;
    }
    let mut index = start + 1;
    while index < bytes.len() && bytes[index] != b'/' {
        if !continues_package(bytes[index]) {
            return None;
        }
        index += 1;
    }
    Some(index)
}

/// Whether `value` is in the rule-identity grammar: a package name as npm spells one, scoped or
/// not, of at most 214 characters, then one or more segments of lowercase letters and digits in
/// words joined by single hyphens, each after a `/`. The last segment is the rule name:
/// `@loomcli/core/spelling-taken` or `@loomcli/plugins/manifest/failure-code-conflict`. It is the
/// grammar of a diagnostic rule's identity and of a validator package's issue codes.
#[must_use]
pub const fn is_rule_identity(value: &str) -> bool {
    let bytes = value.as_bytes();
    // The package part: `@scope/name` or `name`.
    let mut index = 0;
    if !bytes.is_empty() && bytes[0] == b'@' {
        index = match package_part(bytes, 1) {
            Some(end) => end,
            None => return false,
        };
        if index >= bytes.len() {
            return false;
        }
        // Past the `/` that closes the scope.
        index += 1;
    }
    index = match package_part(bytes, index) {
        Some(end) => end,
        None => return false,
    };
    if index > PACKAGE_NAME_LIMIT {
        return false;
    }
    // One or more kebab-case segments after the package part; the last is the rule name.
    let mut segments = 0;
    while index < bytes.len() {
        // At a `/`.
        index += 1;
        let start = index;
        while index < bytes.len() && bytes[index] != b'/' {
            let byte = bytes[index];
            let word = byte.is_ascii_lowercase() || byte.is_ascii_digit();
            let hyphen = byte == b'-' && index > start && bytes[index - 1] != b'-';
            if !(word || hyphen) {
                return false;
            }
            index += 1;
        }
        if index == start || bytes[index - 1] == b'-' {
            return false;
        }
        segments += 1;
    }
    segments > 0
}

/// A value a finding prints when it rebuilds an authoring call, as the Rust an author wrote.
#[derive(Clone, Debug, PartialEq)]
#[non_exhaustive]
pub enum Literal {
    /// A string, printed as a Rust string literal in double quotes.
    String(String),
    /// A character, printed as a Rust character literal in single quotes.
    Char(char),
    /// A number: a whole number below 10^21 with no fraction (`50`), `-0` for negative zero, any
    /// other finite number as Rust's `Display` writes it (`0.5`), and a non-finite one as the Rust
    /// constant that names it (`f64::NAN`).
    Number(f64),
    /// A Boolean.
    Bool(bool),
    /// A list, printed as an array: `["a", "b"]`.
    List(Vec<Literal>),
    /// A borrowed array, printed as a slice literal.
    Slice(Vec<Literal>),
    /// A builder chain, such as `Opt::string().short('F')`: the opening call and each setter call
    /// with its arguments. A builder with no calls prints its opening call alone, so
    /// `Command::new("get")` stands for a Command value.
    Builder {
        /// The opening call, such as `Opt::string()`, printed as it is.
        start: String,
        /// Each setter and its arguments, in order.
        calls: Vec<(String, Vec<Literal>)>,
    },
    /// A value printed as `…`, such as a validator or a function.
    Opaque,
}

impl Literal {
    /// A builder chain that opens with `start`, such as `Opt::string()`; add setters with
    /// [`Literal::call`].
    #[must_use]
    pub fn builder(start: impl Into<String>) -> Self {
        Literal::Builder {
            start: start.into(),
            calls: Vec::new(),
        }
    }

    /// This builder chain with one more setter call. On any other literal it returns the literal
    /// unchanged.
    #[must_use]
    pub fn call(self, setter: impl Into<String>, arguments: Vec<Literal>) -> Self {
        match self {
            Literal::Builder { start, mut calls } => {
                calls.push((setter.into(), arguments));
                Literal::Builder { start, calls }
            }
            other => other,
        }
    }
}

impl From<&str> for Literal {
    fn from(value: &str) -> Self {
        Literal::String(value.to_owned())
    }
}

impl From<String> for Literal {
    fn from(value: String) -> Self {
        Literal::String(value)
    }
}

impl From<char> for Literal {
    fn from(value: char) -> Self {
        Literal::Char(value)
    }
}

impl From<bool> for Literal {
    fn from(value: bool) -> Self {
        Literal::Bool(value)
    }
}

impl From<f64> for Literal {
    fn from(value: f64) -> Self {
        Literal::Number(value)
    }
}

macro_rules! number_literal {
    ($($type:ty),+) => {
        $(
            impl From<$type> for Literal {
                fn from(value: $type) -> Self {
                    Literal::Number(f64::from(value))
                }
            }
        )+
    };
}

number_literal!(i8, i16, i32, u8, u16, u32, f32);

impl<T: Into<Literal>> From<Vec<T>> for Literal {
    fn from(value: Vec<T>) -> Self {
        Literal::List(value.into_iter().map(Into::into).collect())
    }
}

impl fmt::Display for Literal {
    /// The code a finding prints for this value.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&text::value_code(self))
    }
}

/// One declaration a fault concerns, rebuilt as the authoring call that made it.
///
/// A finding with a [`path`](Finding::path) prints under the Command it sits on, as
/// `Command::new("get")` above `.option("raw", Opt::boolean())`; one without prints the call
/// alone, as a plugin factory's `retry(50)`. A [`mark`](Finding::mark) underlines one argument, a
/// member of a list, or one setter of a builder chain, and a [`note`](Finding::note) prints beside
/// the marks.
#[derive(Clone, Debug, PartialEq)]
#[must_use]
pub struct Finding {
    pub(crate) path: Option<Vec<String>>,
    pub(crate) call: String,
    pub(crate) arguments: Vec<Literal>,
    pub(crate) mark: Option<String>,
    pub(crate) note: Option<String>,
}

impl Finding {
    /// A finding for `call` with its arguments as core holds them.
    pub fn new(call: impl Into<String>, arguments: Vec<Literal>) -> Self {
        Self {
            path: None,
            call: call.into(),
            arguments,
            mark: None,
            note: None,
        }
    }

    /// The Command the declaration sits on; empty is the root.
    pub fn path(self, path: Vec<String>) -> Self {
        Self {
            path: Some(path),
            ..self
        }
    }

    /// Underlines one argument, or one part inside it, as a dotted path: `1` is the second
    /// argument, `1.0` the first member of a list there, `1.short` the `.short(…)` setter of a
    /// builder chain there, and `1.short.0` that setter's first argument. A path that names no part
    /// prints no mark.
    pub fn mark(self, mark: impl Into<String>) -> Self {
        Self {
            mark: Some(mark.into()),
            ..self
        }
    }

    /// One line printed beside the mark.
    pub fn note(self, note: impl Into<String>) -> Self {
        Self {
            note: Some(note.into()),
            ..self
        }
    }

    /// The authoring call.
    #[must_use]
    pub fn call_name(&self) -> &str {
        &self.call
    }

    /// The call's arguments.
    #[must_use]
    pub fn arguments(&self) -> &[Literal] {
        &self.arguments
    }

    /// The Command the declaration sits on, when the finding names one.
    #[must_use]
    pub fn command_path(&self) -> Option<&[String]> {
        self.path.as_deref()
    }

    /// The dotted path the finding underlines.
    #[must_use]
    pub fn marked(&self) -> Option<&str> {
        self.mark.as_deref()
    }

    /// The note beside the mark.
    #[must_use]
    pub fn noted(&self) -> Option<&str> {
        self.note.as_deref()
    }
}

/// The parts of one fault: its sentence, its findings, and its correction.
#[derive(Clone, Debug, Default, PartialEq)]
#[must_use]
pub struct DiagnosticParts {
    pub(crate) sentence: String,
    pub(crate) findings: Vec<Finding>,
    pub(crate) correction: Vec<String>,
}

impl DiagnosticParts {
    /// Parts with the sentence that says what is wrong.
    pub fn new(sentence: impl Into<String>) -> Self {
        Self {
            sentence: sentence.into(),
            findings: Vec::new(),
            correction: Vec::new(),
        }
    }

    /// Adds a finding.
    pub fn finding(mut self, finding: Finding) -> Self {
        self.findings.push(finding);
        self
    }

    /// Adds one correction: an imperative sentence. One prints as the sentence; several print one
    /// per line under `- `.
    pub fn correction(mut self, correction: impl Into<String>) -> Self {
        self.correction.push(correction.into());
        self
    }
}
