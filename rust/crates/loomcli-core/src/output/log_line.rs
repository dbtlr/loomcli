//! Message Templates and the declared view for a log line.

use std::collections::HashSet;
use std::sync::{Arc, LazyLock};

use serde_json::{Map, Value};

use crate::style::{Glyph, escape, escape_control_characters, nowrap};
use crate::support::js_number_text;

use super::log::{LogEvent, LogLevel};
use super::view::{DeclaredView, View, ViewContext, under_gutter, view};

/// A level that can appear on a log line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum LogLineLevel {
    /// Trace.
    Trace,
    /// Debug.
    Debug,
    /// Info.
    Info,
    /// Warn.
    Warn,
    /// Error.
    Error,
}

impl LogLineLevel {
    pub(super) fn from_log(level: LogLevel) -> Option<Self> {
        Some(match level {
            LogLevel::Trace => Self::Trace,
            LogLevel::Debug => Self::Debug,
            LogLevel::Info => Self::Info,
            LogLevel::Warn => Self::Warn,
            LogLevel::Error => Self::Error,
            LogLevel::Fatal => return None,
        })
    }

    pub(super) fn shown_from(self) -> i8 {
        match self {
            Self::Trace => 2,
            _ => 1,
        }
    }
}

/// A field that the template leaves to trail the line.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct LogLineField {
    /// The field name, escaped for the terminal and Loom markup.
    pub name: String,
    /// The field's value as escaped text.
    pub value: String,
}

/// A log event prepared for the log-line view.
#[derive(Clone, Debug, PartialEq)]
#[non_exhaustive]
pub struct LogLine {
    /// The visible level.
    pub level: LogLineLevel,
    /// The filled template as escaped, marked text.
    pub text: String,
    /// The unplaced fields, in event order.
    pub fields: Vec<LogLineField>,
    /// The event's unchanged template and redacted field values.
    pub event: Arc<LogEvent>,
}

impl LogLine {
    pub(super) fn from_event(event: Arc<LogEvent>, level: LogLineLevel) -> Self {
        let (text, placed) = fill(&event.message, &event.fields);
        let fields = event
            .fields
            .iter()
            .filter(|(name, _)| !placed.contains(name.as_str()))
            .map(|(name, value)| LogLineField {
                name: shown(name),
                value: shown(&trailing(value)),
            })
            .collect();
        Self {
            level,
            text,
            fields,
            event,
        }
    }
}

fn shown(text: &str) -> String {
    escape(&escape_control_characters(text))
}

fn whitespace(ch: char) -> bool {
    // ECMAScript includes the BOM and excludes NEXT LINE from its whitespace class.
    ch == '\u{feff}' || (ch != '\u{0085}' && ch.is_whitespace())
}

fn error_text(value: &Value) -> Option<String> {
    let facts = value.as_object()?;
    let name = facts.get("name")?.as_str()?;
    let message = facts.get("message")?.as_str()?;
    Some(format!("{name}: {message}"))
}

fn placed(value: &Value) -> String {
    let text = error_text(value)
        .unwrap_or_else(|| value.as_str().map_or_else(|| compact(value), str::to_owned));
    let marked = shown(&text);
    if text.chars().any(whitespace) {
        marked
    } else {
        nowrap(&marked)
    }
}

fn trailing(value: &Value) -> String {
    if let Some(error) = error_text(value) {
        return error;
    }
    if let Some(text) = value.as_str()
        && !text.is_empty()
        && !text
            .chars()
            .any(|ch| whitespace(ch) || matches!(ch, '"' | '='))
    {
        return text.to_owned();
    }
    compact(value)
}

fn compact(value: &Value) -> String {
    match value {
        Value::Number(number) if number.is_f64() => number
            .as_f64()
            .map_or_else(|| "null".to_owned(), js_number_text),
        Value::Array(items) => {
            let items = items.iter().map(compact).collect::<Vec<_>>().join(",");
            format!("[{items}]")
        }
        Value::Object(object) => {
            let pairs = object
                .iter()
                .map(|(name, value)| format!("{}:{}", Value::String(name.clone()), compact(value)))
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{pairs}}}")
        }
        other => other.to_string(),
    }
}

/// Scans one template for escaped braces and ASCII property names.
fn fill<'a>(message: &str, fields: &'a Map<String, Value>) -> (String, HashSet<&'a str>) {
    let mut rest = message;
    let mut result = String::new();
    let mut names = HashSet::new();
    while let Some(at) = rest.find(['{', '}']) {
        result.push_str(&shown(&rest[..at]));
        rest = &rest[at..];
        if rest.starts_with("{{") || rest.starts_with("}}") {
            result.push_str(&rest[..1]);
            rest = &rest[2..];
            continue;
        }
        if let Some(tail) = rest.strip_prefix('{') {
            let length = tail
                .bytes()
                .take_while(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
                .count();
            if length > 0 && tail.as_bytes().get(length) == Some(&b'}') {
                let name = &tail[..length];
                if let Some((key, value)) = fields.get_key_value(name) {
                    result.push_str(&placed(value));
                    names.insert(key.as_str());
                } else {
                    result.push_str(&shown(&rest[..length + 2]));
                }
                rest = &rest[length + 2..];
                continue;
            }
        }
        result.push_str(&rest[..1]);
        rest = &rest[1..];
    }
    result.push_str(&shown(rest));
    (result, names)
}

fn render(line: &LogLine, context: &ViewContext) -> String {
    let style = &context.style;
    let trace = line.level == LogLineLevel::Trace;
    let token = match line.level {
        LogLineLevel::Trace => style.dim().faint(),
        LogLineLevel::Debug => style.dim(),
        LogLineLevel::Info => style.info(),
        LogLineLevel::Warn => style.warning(),
        LogLineLevel::Error => style.error(),
    };
    let (indent, glyph) = if trace {
        ("  ", Glyph::LineVerticalDashed0)
    } else {
        ("", Glyph::PointerSmall)
    };
    let glyph = glyph.to_string();
    let pairs = line
        .fields
        .iter()
        .map(|field| nowrap(&format!("{}={}", field.name, field.value)))
        .collect::<Vec<_>>()
        .join(" ");
    let pairs = if pairs.is_empty() || trace {
        pairs
    } else {
        style.dim().apply(&pairs)
    };
    let body = [&*line.text, &*pairs]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let body = under_gutter(&body, context, indent.len() + context.width(&glyph) + 1);
    let body = if trace { token.apply(&body) } else { body };
    format!("{indent}{} {body}", token.apply(&glyph))
}

static VIEW: LazyLock<DeclaredView<LogLine>> =
    LazyLock::new(|| view("@loomcli/core/log/line", View::new(render)));

/// The declared view core uses to show an event at verbose verbosity.
pub fn log_line() -> DeclaredView<LogLine> {
    VIEW.clone()
}
