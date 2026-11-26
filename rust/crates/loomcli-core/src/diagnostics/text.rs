//! The Developer Diagnostic as plain text: the banner, the sentence, the findings, the evidence, the
//! explanation, the correction, and the docs link.

use std::collections::HashMap;

use crate::style::{escape_control_characters, wrap_plain};

use super::{DiagnosticRule, Finding, Literal};

/// The width a diagnostic takes in a fault's message, or when stderr's width is unknown.
pub(crate) const MESSAGE_WIDTH: usize = 80;

/// How far a finding's code sits from the left edge.
const FINDING_INDENT: &str = "    ";

/// How many containers deep a finding's argument is printed before the rest reads as an ellipsis.
const DEPTH_LIMIT: usize = 4;

/// The stand-in for a value a finding does not spell out: a function, a validator, or a value
/// nested past the depth limit.
pub(crate) const ELIDED: &str = "…";

/// The banner a fault with no rule prints.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Fallback {
    /// A `DeclarationError` with no rule.
    InvalidDeclaration,
    /// An `InternalError` with no rule.
    Defect,
}

impl Fallback {
    fn title(self) -> &'static str {
        match self {
            Fallback::InvalidDeclaration => "INVALID DECLARATION",
            Fallback::Defect => "DEFECT",
        }
    }
}

/// Everything one Developer Diagnostic prints, whichever class carries it.
pub(crate) struct Anatomy<'a> {
    pub(crate) rule: Option<&'a DiagnosticRule>,
    pub(crate) fallback: Fallback,
    pub(crate) sentence: &'a str,
    pub(crate) findings: &'a [Finding],
    /// A defect's own findings, already rendered: the author's source and the cause chain.
    pub(crate) evidence: Vec<String>,
    pub(crate) correction: &'a [String],
}

/// Where one diagnostic is printed: the columns its banner fills and its explanation wraps to, and
/// the application name a finding's path opens with when `run()` reports the fault.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Layout<'a> {
    pub(crate) width: usize,
    pub(crate) application: Option<&'a str>,
}

impl Layout<'_> {
    /// The layout of a fault's message: 80 columns, with no application name.
    pub(crate) const MESSAGE: Layout<'static> = Layout {
        width: MESSAGE_WIDTH,
        application: None,
    };
}

/// One diagnostic's banner, apart so a caller that styles it can, and its body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Sections {
    pub(crate) banner: String,
    pub(crate) body: String,
}

/// Whether a character is one the control-character escape replaces.
fn is_control(character: char) -> bool {
    matches!(
        character,
        '\u{0}'..='\u{1f}'
            | '\u{7f}'..='\u{9f}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2066}'..='\u{2069}'
            | '\u{200e}'
            | '\u{200f}'
            | '\u{61c}'
    )
}

/// One character inside a Rust literal: the quote and the backslash escaped, a line break, a
/// carriage return, and a tab as their short escapes, and every other character the
/// control-character escape replaces as a `\u{…}` escape, so the code stays on one line.
fn push_literal_character(out: &mut String, character: char, quote: char) {
    match character {
        '\\' => out.push_str("\\\\"),
        '\n' => out.push_str("\\n"),
        '\r' => out.push_str("\\r"),
        '\t' => out.push_str("\\t"),
        _ if character == quote => {
            out.push('\\');
            out.push(quote);
        }
        _ if is_control(character) => out.push_str(&format!("\\u{{{:x}}}", u32::from(character))),
        _ => out.push(character),
    }
}

/// A string as a Rust string literal in double quotes, with every control escaped.
pub(crate) fn quote_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for character in text.chars() {
        push_literal_character(&mut out, character, '"');
    }
    out.push('"');
    out
}

/// A character as a Rust character literal in single quotes, with a control escaped.
fn quote_char(character: char) -> String {
    let mut out = String::from("'");
    push_literal_character(&mut out, character, '\'');
    out.push('\'');
    out
}

/// A number as JavaScript's `String(number)` writes a finite one: a whole number with no fraction,
/// `-0` for negative zero. A non-finite number reads as the Rust constant that names it.
fn number_code(value: f64) -> String {
    if value.is_nan() {
        return "f64::NAN".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 {
            "f64::INFINITY".to_owned()
        } else {
            "f64::NEG_INFINITY".to_owned()
        };
    }
    if value == 0.0 {
        return if value.is_sign_negative() { "-0" } else { "0" }.to_owned();
    }
    if value.fract() == 0.0 && value.abs() < 1e21 {
        // A whole number below 10^21 fits an i128 exactly.
        #[allow(clippy::cast_possible_truncation)]
        let whole = value as i128;
        return whole.to_string();
    }
    value.to_string()
}

/// One column range of printed code, in characters, which a mark underlines.
#[derive(Clone, Copy, Debug)]
struct Span {
    start: usize,
    end: usize,
}

/// Printed code in progress, and the span each argument path covers, which a mark underlines.
struct CodePrinter {
    text: String,
    /// The printed text's length in characters, which spans count in.
    length: usize,
    spans: HashMap<String, Span>,
}

impl CodePrinter {
    fn new(opening: &str) -> Self {
        let mut printer = Self {
            text: String::new(),
            length: 0,
            spans: HashMap::new(),
        };
        printer.push(opening);
        printer
    }

    fn push(&mut self, code: &str) {
        self.text.push_str(code);
        self.length += code.chars().count();
    }

    /// Appends each value with a comma between, as a list of arguments or members is written.
    fn separated(&mut self, values: &[Literal], path: &str, depth: usize) {
        for (index, value) in values.iter().enumerate() {
            if index > 0 {
                self.push(", ");
            }
            let member = if path.is_empty() {
                index.to_string()
            } else {
                format!("{path}.{index}")
            };
            self.value(value, &member, depth);
        }
    }

    /// Appends one value and records the span it covers under its path. `depth` counts the lists
    /// and builder chains above it.
    fn value(&mut self, value: &Literal, path: &str, depth: usize) {
        let start = self.length;
        match value {
            Literal::String(text) => self.push(&quote_string(text)),
            Literal::Char(character) => self.push(&quote_char(*character)),
            Literal::Number(number) => self.push(&number_code(*number)),
            Literal::Bool(flag) => self.push(if *flag { "true" } else { "false" }),
            Literal::Opaque => self.push(ELIDED),
            Literal::List(_) | Literal::Slice(_) | Literal::Builder { .. }
                if depth >= DEPTH_LIMIT =>
            {
                self.push(ELIDED)
            }
            Literal::List(members) | Literal::Slice(members) => {
                if matches!(value, Literal::Slice(_)) {
                    self.push("&");
                }
                self.push("[");
                self.separated(members, path, depth + 1);
                self.push("]");
            }
            Literal::Builder {
                start: opening,
                calls,
            } => {
                self.push(&escape_control_characters(opening));
                for (setter, arguments) in calls {
                    self.push(".");
                    let setter_start = self.length;
                    self.push(&escape_control_characters(setter));
                    self.push("(");
                    let member = format!("{path}.{setter}");
                    self.separated(arguments, &member, depth + 1);
                    self.push(")");
                    self.spans.insert(
                        member,
                        Span {
                            start: setter_start,
                            end: self.length,
                        },
                    );
                }
            }
        }
        self.spans.insert(
            path.to_owned(),
            Span {
                start,
                end: self.length,
            },
        );
    }
}

/// One value as the code a finding prints for it.
pub(crate) fn value_code(value: &Literal) -> String {
    let mut printer = CodePrinter::new("");
    printer.value(value, "", 0);
    printer.text
}

/// One call with its arguments, and the span each argument and part covers inside the line.
fn print_call(prefix: &str, finding: &Finding) -> CodePrinter {
    let mut printer = CodePrinter::new(&format!(
        "{prefix}{}(",
        escape_control_characters(&finding.call)
    ));
    printer.separated(&finding.arguments, "", 0);
    printer.push(")");
    printer
}

/// The line of carets under a finding's mark, with its note beside it, or none.
fn mark_line(printed: &CodePrinter, finding: &Finding) -> Option<String> {
    let span = printed.spans.get(finding.mark.as_deref()?)?;
    let carets = "^".repeat((span.end - span.start).max(1));
    let note = finding
        .note
        .as_deref()
        .map(|note| format!(" {}", escape_control_characters(note)))
        .unwrap_or_default();
    Some(format!("{}{carets}{note}", " ".repeat(span.start)))
}

/// The receiver a finding's call sits on, `Command::new("get")` for the Command its path names or
/// `Application::new("app")` for the root, and the comment above it that opens with the path,
/// after the application name when known.
fn receiver_lines(path: &[String], application: Option<&str>) -> Vec<String> {
    let words: Vec<&str> = application
        .into_iter()
        .chain(path.iter().map(String::as_str))
        .collect();
    let mut lines = Vec::new();
    if !words.is_empty() {
        lines.push(format!(
            "// {}",
            escape_control_characters(&words.join(" "))
        ));
    }
    match path.last() {
        Some(last) => lines.push(format!("Command::new({})", quote_string(last))),
        None => lines.push(format!(
            "Application::new({})",
            application.map_or_else(|| ELIDED.to_owned(), quote_string)
        )),
    }
    lines
}

/// One finding as indented code: the receiver, the rebuilt call, and the marks under the part at
/// fault.
fn finding_section(finding: &Finding, application: Option<&str>) -> String {
    let mut lines = finding
        .path
        .as_deref()
        .map(|path| receiver_lines(path, application))
        .unwrap_or_default();
    let prefix = if finding.path.is_some() { "  ." } else { "" };
    let printed = print_call(prefix, finding);
    let mark = mark_line(&printed, finding);
    lines.push(printed.text);
    lines.extend(mark);
    lines
        .iter()
        .map(|line| format!("{FINDING_INDENT}{line}").trim_end().to_owned())
        .collect::<Vec<_>>()
        .join("\n")
}

/// The sentence with every control escaped. A declaration fault's sentence keeps the line breaks
/// its author wrote; a defect's sentence can carry a thrown reason, so it stays on one line.
fn sentence_text(anatomy: &Anatomy<'_>) -> String {
    match anatomy.fallback {
        Fallback::Defect => escape_control_characters(anatomy.sentence),
        Fallback::InvalidDeclaration => anatomy
            .sentence
            .split('\n')
            .map(escape_control_characters)
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

/// The banner: two hyphens, the headline in capitals, a run of hyphens, and the rule's identity,
/// filling `width` columns, with at least two hyphens between.
fn banner_line(anatomy: &Anatomy<'_>, width: usize) -> String {
    let title = anatomy.rule.map_or_else(
        || anatomy.fallback.title().to_owned(),
        |rule| rule.headline.to_uppercase(),
    );
    let left = format!("-- {} ", escape_control_characters(&title));
    let right = anatomy
        .rule
        .map(|rule| format!(" {}", escape_control_characters(rule.identity)))
        .unwrap_or_default();
    let used = left.chars().count() + right.chars().count();
    let fill = width.saturating_sub(used).max(2);
    format!("{left}{}{right}", "-".repeat(fill))
}

/// The correction: one imperative sentence, or one fix per line under `- ` when several fit.
fn correction_section(correction: &[String]) -> Option<String> {
    match correction {
        [] => None,
        [only] => Some(escape_control_characters(only)),
        several => Some(
            several
                .iter()
                .map(|fix| format!("- {}", escape_control_characters(fix)))
                .collect::<Vec<_>>()
                .join("\n"),
        ),
    }
}

/// One Developer Diagnostic as plain text with no trailing newline, its banner apart: the sentence,
/// the findings, the evidence, the explanation, the correction, and the docs link, separated by one
/// blank line, each left out when the fault does not carry it.
pub(crate) fn diagnostic_sections(anatomy: &Anatomy<'_>, layout: Layout<'_>) -> Sections {
    let width = if layout.width == 0 {
        MESSAGE_WIDTH
    } else {
        layout.width
    };
    let mut sections = vec![sentence_text(anatomy)];
    sections.extend(
        anatomy
            .findings
            .iter()
            .map(|finding| finding_section(finding, layout.application)),
    );
    sections.extend(anatomy.evidence.iter().cloned());
    if let Some(rule) = anatomy.rule {
        let explanation = escape_control_characters(rule.explanation);
        sections.push(wrap_plain(&explanation, width).unwrap_or(explanation));
    }
    sections.extend(correction_section(anatomy.correction));
    if let Some(docs) = anatomy.rule.and_then(|rule| rule.docs) {
        sections.push(format!("See {}", escape_control_characters(docs)));
    }
    Sections {
        banner: banner_line(anatomy, width),
        body: sections.join("\n\n"),
    }
}

/// The whole diagnostic as plain text with no trailing newline.
pub(crate) fn diagnostic_text(anatomy: &Anatomy<'_>, layout: Layout<'_>) -> String {
    let Sections { banner, body } = diagnostic_sections(anatomy, layout);
    format!("{banner}\n\n{body}")
}
