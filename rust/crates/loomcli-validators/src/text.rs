//! `text`: any string, or one within length bounds or matching a pattern.

use loomcli_core::{Finding, InputSchema, Issue, Literal, ValidationContext, Validator};
use regex::Regex;

use crate::codes::{
    Length, Max, Min, NoParams, PatternMessage, Range, TEXT_EXACT_LENGTH_ISSUE,
    TEXT_LENGTH_RANGE_ISSUE, TEXT_MAX_LENGTH_ISSUE, TEXT_MIN_LENGTH_ISSUE, TEXT_NONEMPTY_ISSUE,
    TEXT_PATTERN_ISSUE,
};
use crate::fault;

/// The pattern rule: the compiled pattern, its source as written, and the author's sentence.
#[derive(Clone, Debug)]
struct PatternRule {
    expression: Regex,
    source: String,
    message: String,
}

/// Text: any string, or one within length bounds or matching a pattern.
#[derive(Clone, Debug, Default)]
#[must_use]
pub struct Text {
    min_length: Option<usize>,
    max_length: Option<usize>,
    pattern: Option<PatternRule>,
}

/// Validates text of at least one character: `text()` rejects the empty string, and
/// `text().min_length(0)` accepts it.
pub fn text() -> Text {
    Text::default()
}

impl Text {
    /// The fewest characters, 1 when left out; `min_length(0)` accepts the empty string. A
    /// `min_length` above `max_length` is a fault at the call.
    #[track_caller]
    pub fn min_length(mut self, length: usize) -> Self {
        self.min_length = Some(length);
        self.check_order("text().min_length", vec![count(length)])
    }

    /// The most characters. A `max_length` below the fewest is a fault at the call, the default
    /// fewest of 1 included, so `max_length(0)` follows a `min_length(0)`.
    #[track_caller]
    pub fn max_length(mut self, length: usize) -> Self {
        self.max_length = Some(length);
        self.check_order("text().max_length", vec![count(length)])
    }

    /// The exact number of characters, which sets the fewest and the most alike.
    #[track_caller]
    pub fn length(mut self, length: usize) -> Self {
        self.min_length = Some(length);
        self.max_length = Some(length);
        self.check_order("text().length", vec![count(length)])
    }

    /// An ECMAScript `u`-flag regular expression the text matches, with `message`, the one sentence that says
    /// what the pattern accepts, as the rejection. An unanchored pattern matches anywhere in the
    /// token, in the validator and the published schema alike, so write `^...$` to constrain the
    /// whole value. The text is matched by the `regex` crate, with `\d`, `\w`, `\s`, `\b`, and `.`
    /// read as ECMAScript reads them, so the published `pattern` accepts what the validator does.
    /// The `regex` crate has no lookaround and no backreferences. A pattern it cannot compile, one
    /// a JavaScript `RegExp` would refuse (inline flags such as `(?i)`, `\A`, `\z`, POSIX
    /// classes), and an empty `message` are faults at this call under
    /// `@loomcli/validators/invalid-pattern`. The published schema's `pattern` is the source as
    /// written.
    #[track_caller]
    pub fn pattern(mut self, pattern: &str, message: &str) -> Self {
        let finding = || {
            vec![
                Finding::new(
                    "text().pattern",
                    vec![Literal::from(pattern), Literal::from(message)],
                )
                .mark("0"),
            ]
        };
        let uncompilable = || {
            fault::raise(
                fault::INVALID_PATTERN,
                "text() pattern does not compile with the regex crate.",
                "Supply a pattern the regex crate compiles, with no lookaround and no backreference.",
                finding(),
            )
        };
        if Regex::new(pattern).is_err() {
            uncompilable();
        }
        let Ok(translated) = crate::ecma::to_regex(pattern) else {
            fault::raise(
                fault::INVALID_PATTERN,
                "text() pattern is not ECMAScript syntax.",
                "Supply a pattern a JavaScript u-flag RegExp accepts, with no inline flags, no \\A or \\z, and no POSIX classes.",
                finding(),
            )
        };
        let Ok(expression) = Regex::new(&translated) else {
            uncompilable()
        };
        if message.is_empty() {
            fault::raise(
                fault::INVALID_PATTERN,
                "text() pattern message is empty.",
                "Supply the one sentence that says what the pattern accepts.",
                vec![
                    Finding::new(
                        "text().pattern",
                        vec![Literal::from(pattern), Literal::from(message)],
                    )
                    .mark("1"),
                ],
            );
        }
        self.pattern = Some(PatternRule {
            expression,
            source: pattern.to_owned(),
            message: message.to_owned(),
        });
        self
    }

    /// Faults when the fewest characters are above the most.
    #[track_caller]
    fn check_order(self, call: &str, arguments: Vec<Literal>) -> Self {
        let (min, max) = self.bounds();
        if let Some(max) = max
            && min > max
        {
            fault::raise(
                fault::BOUNDS_ORDER,
                format!("text() min_length {min} is above max_length {max}."),
                "Supply a min_length at or below max_length.",
                vec![Finding::new(call, arguments).mark("0")],
            );
        }
        self
    }

    /// The effective length bounds in characters: the fewest, 1 unless `min_length` set it, and
    /// the most, if any.
    fn bounds(&self) -> (usize, Option<usize>) {
        (
            self.min_length.unwrap_or(DEFAULT_MIN_LENGTH),
            self.max_length,
        )
    }

    /// The issue a token outside the bounds is rejected with, or `None` when every length fits.
    fn length_issue(min: usize, max: Option<usize>) -> Option<Issue> {
        match max {
            Some(max) if min == max => Some(TEXT_EXACT_LENGTH_ISSUE.issue(Length { length: min })),
            Some(max) if min == 0 => Some(TEXT_MAX_LENGTH_ISSUE.issue(Max { max })),
            Some(max) => Some(TEXT_LENGTH_RANGE_ISSUE.issue(Range { max, min })),
            None if min == 0 => None,
            None if min == 1 => Some(TEXT_NONEMPTY_ISSUE.issue(NoParams {})),
            None => Some(TEXT_MIN_LENGTH_ISSUE.issue(Min { min })),
        }
    }
}

/// The fewest characters a `text()` accepts when `min_length` is left out, as the reference's
/// `minLength` default.
const DEFAULT_MIN_LENGTH: usize = 1;

/// A count as the finding writes it.
fn count(length: usize) -> Literal {
    Literal::Number(length as f64)
}

impl Validator for Text {
    type Output = String;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<String, Vec<Issue>> {
        // A length counts Unicode code points, as JSON Schema counts it.
        let (min, max) = self.bounds();
        let characters = input.chars().count();
        let fits = characters >= min && max.is_none_or(|max| characters <= max);
        if !fits && let Some(issue) = Text::length_issue(min, max) {
            return Err(vec![issue]);
        }
        if let Some(rule) = &self.pattern
            && !rule.expression.is_match(input)
        {
            return Err(vec![TEXT_PATTERN_ISSUE.issue(PatternMessage {
                message: rule.message.clone(),
            })]);
        }
        Ok(input.to_owned())
    }

    fn input_schema(&self) -> InputSchema {
        let (min, max) = self.bounds();
        let mut schema = serde_json::Map::new();
        schema.insert("type".to_owned(), "string".into());
        schema.insert("minLength".to_owned(), min.into());
        if let Some(max) = max {
            schema.insert("maxLength".to_owned(), max.into());
        }
        if let Some(rule) = &self.pattern {
            schema.insert("pattern".to_owned(), rule.source.clone().into());
        }
        Some(loomcli_core::with_schema_dialect(schema))
    }
}
