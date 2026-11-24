//! YAML 1.2 under its core schema, through `saphyr-parser`'s event stream. The file holds one
//! document with unique keys and only the core schema's tags, and every alias names a preceding
//! anchor. A plain scalar resolves as the core schema reads it, a number as a 64-bit float as the
//! reference's runtime reads one, and a YAML `yes`, `no`, `on`, or `off` stays a string. An alias
//! shares the value its anchor names, so a profile reused across many environments costs one value.
//!
//! A file that is not valid YAML names the place of its first error, or else of its first tag
//! outside the core schema, or else of its first alias that names no preceding anchor. The place
//! of an error is the one the reference's `yaml` names: `saphyr-parser` reports most errors
//! elsewhere (at a quote, a colon, or the end of a line), so [`error_place`] moves each kind it
//! recognizes to the reference's place. Where the parser and `yaml` judge a text differently, the
//! reader follows `yaml`: a block collection or a quoted line indented with a tab or too few
//! spaces breaks, and a tab after a colon separates the value. The places that still differ are
//! in the YAML row of `docs/deviations.md`.

use std::collections::HashMap;

use saphyr_parser::{Event, Parser, ScalarStyle, Tag};

use super::document::{ObjectBuilder, Value};
use super::number::js_number_text;
use super::reading::{Clause, Reading, offset_of_character};

/// The handle the parser gives a tag of the core schema's own namespace, `!!`.
const CORE_HANDLE: &str = "tag:yaml.org,2002:";

/// What makes a document not valid YAML, at a character index.
#[derive(Default)]
struct Faults {
    /// A parse error, a second document, a repeated key, or a key or alias this reader cannot hold.
    error: Option<usize>,
    /// A tag outside the core schema.
    tag: Option<usize>,
    /// An alias that names no preceding anchor.
    alias: Option<usize>,
}

impl Faults {
    /// The character index the file breaks at, by precedence, or `None` when it does not.
    fn first(&self) -> Option<usize> {
        self.error.or(self.tag).or(self.alias)
    }
}

/// One open collection, with what it holds so far, where it starts, and the column of a block
/// collection (`None` for a flow one).
enum Frame {
    Sequence {
        anchor: usize,
        start: usize,
        column: Option<usize>,
        items: Vec<Value>,
    },
    Mapping {
        anchor: usize,
        start: usize,
        column: Option<usize>,
        entries: ObjectBuilder,
        /// The keys that came from scalars, which a later scalar key may not repeat. A key that
        /// came from an alias is not among them, as `yaml` compares no alias with a scalar.
        keys: Vec<Value>,
        pending: Option<String>,
    },
}

impl Frame {
    fn start(&self) -> usize {
        match self {
            Frame::Sequence { start, .. } | Frame::Mapping { start, .. } => *start,
        }
    }

    fn column(&self) -> Option<usize> {
        match self {
            Frame::Sequence { column, .. } | Frame::Mapping { column, .. } => *column,
        }
    }
}

/// Whether the whole text is one of the words.
fn is_one_of(text: &str, words: &[&str]) -> bool {
    words.contains(&text)
}

fn all_digits(text: &str, radix: u32) -> bool {
    !text.is_empty() && text.chars().all(|character| character.is_digit(radix))
}

/// The value of an unsigned run of digits in a radix, as the nearest float.
fn radix_value(digits: &str, radix: u32) -> f64 {
    digits.chars().fold(0.0, |value, character| {
        value * f64::from(radix) + f64::from(character.to_digit(radix).unwrap_or(0))
    })
}

/// `[-+]?[0-9]+`, `0o[0-7]+`, or `0x[0-9a-fA-F]+`, as a number.
fn core_int(text: &str) -> Option<f64> {
    if let Some(octal) = text.strip_prefix("0o") {
        return all_digits(octal, 8).then(|| radix_value(octal, 8));
    }
    if let Some(hex) = text.strip_prefix("0x") {
        return all_digits(hex, 16).then(|| radix_value(hex, 16));
    }
    let unsigned = text.strip_prefix(['-', '+']).unwrap_or(text);
    if all_digits(unsigned, 10) {
        return text.parse().ok();
    }
    None
}

/// `[-+]?(\.[0-9]+|[0-9]+\.[0-9]*)`, `[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)[eE][-+]?[0-9]+`,
/// `[-+]?\.(inf|Inf|INF)`, or `\.(nan|NaN|NAN)`, as a number: `yaml`'s core float tags, which
/// hold no plain integer.
fn core_float(text: &str) -> Option<f64> {
    if is_one_of(text, &[".nan", ".NaN", ".NAN"]) {
        return Some(f64::NAN);
    }
    let (negative, unsigned) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text.strip_prefix('+').unwrap_or(text)),
    };
    if is_one_of(unsigned, &[".inf", ".Inf", ".INF"]) {
        return Some(if negative {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        });
    }
    let (mantissa, exponent) = match unsigned.find(['e', 'E']) {
        Some(at) => (&unsigned[..at], Some(&unsigned[at + 1..])),
        None => (unsigned, None),
    };
    let mantissa_ok = match mantissa.split_once('.') {
        Some(("", fraction)) => all_digits(fraction, 10),
        Some((whole, fraction)) => {
            all_digits(whole, 10) && (fraction.is_empty() || all_digits(fraction, 10))
        }
        None => all_digits(mantissa, 10),
    };
    let exponent_ok = exponent.is_none_or(|exponent| {
        all_digits(exponent.strip_prefix(['-', '+']).unwrap_or(exponent), 10)
    });
    let fractional = exponent.is_some() || mantissa.contains('.');
    if !mantissa_ok || !exponent_ok || !fractional {
        return None;
    }
    text.parse().ok()
}

fn core_null(text: &str) -> bool {
    is_one_of(text, &["", "~", "null", "Null", "NULL"])
}

fn core_bool(text: &str) -> Option<bool> {
    if is_one_of(text, &["true", "True", "TRUE"]) {
        Some(true)
    } else if is_one_of(text, &["false", "False", "FALSE"]) {
        Some(false)
    } else {
        None
    }
}

/// A plain scalar under the core schema.
fn resolve_plain(text: &str) -> Value {
    if core_null(text) {
        Value::Null
    } else if let Some(flag) = core_bool(text) {
        Value::Bool(flag)
    } else if let Some(number) = core_int(text).or_else(|| core_float(text)) {
        Value::Number(number)
    } else {
        Value::Text(text.to_owned())
    }
}

/// A scalar under its tag, or `None` for a tag outside the core schema or a value its tag does not
/// resolve. A non-specific `!` tag reads the scalar as a string.
fn resolve_scalar(text: &str, style: ScalarStyle, tag: Option<&Tag>) -> Option<Value> {
    let Some(tag) = tag else {
        return Some(if style == ScalarStyle::Plain {
            resolve_plain(text)
        } else {
            Value::Text(text.to_owned())
        });
    };
    if is_non_specific(tag) {
        return Some(Value::Text(text.to_owned()));
    }
    if tag.handle != CORE_HANDLE {
        return None;
    }
    match tag.suffix.as_str() {
        "str" => Some(Value::Text(text.to_owned())),
        "null" => core_null(text).then_some(Value::Null),
        "bool" => core_bool(text).map(Value::Bool),
        "int" => core_int(text).map(Value::Number),
        "float" => core_float(text).map(Value::Number),
        _ => None,
    }
}

/// Whether a tag is the non-specific `!`, which the parser gives as an empty handle and the
/// suffix `!`.
fn is_non_specific(tag: &Tag) -> bool {
    tag.handle.is_empty() && tag.suffix == "!"
}

/// Whether a collection's tag is absent, the non-specific `!`, or the core schema's own for its
/// kind.
fn collection_tag_holds(tag: Option<&Tag>, kind: &str) -> bool {
    tag.is_none_or(|tag| (tag.handle == CORE_HANDLE && tag.suffix == kind) || is_non_specific(tag))
}

/// A key's text as the reference's conversion writes it: a string as it is, a number as its
/// JavaScript text, a Boolean as `true` or `false`, and a null as the empty string. A collection
/// key has no text this reader holds.
fn key_text(key: &Value) -> Option<String> {
    match key {
        Value::Text(text) => Some(text.clone()),
        Value::Number(number) if number.is_nan() => Some("NaN".to_owned()),
        Value::Number(number) if number.is_infinite() => Some(
            if number.is_sign_negative() {
                "-Infinity"
            } else {
                "Infinity"
            }
            .to_owned(),
        ),
        Value::Number(number) => Some(js_number_text(*number)),
        Value::Integer(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Null => Some(String::new()),
        Value::Array(_) | Value::Object(_) => None,
    }
}

/// The document being built: the open collections, the anchors, the finished root, and the faults.
struct Builder {
    /// The text, by character, as the parser's places count it.
    chars: Vec<char>,
    frames: Vec<Frame>,
    /// Each anchor's value, `None` while its collection is still open.
    anchors: HashMap<usize, Option<Value>>,
    root: Option<Value>,
    documents: usize,
    /// Where the last event read starts and ends.
    last_start: usize,
    last_end: usize,
    faults: Faults,
}

impl Builder {
    fn new(text: &str) -> Self {
        Self {
            chars: text.chars().collect(),
            frames: Vec::new(),
            anchors: HashMap::new(),
            root: None,
            documents: 0,
            last_start: 0,
            last_end: 0,
            faults: Faults::default(),
        }
    }

    /// Places a finished value, which starts at a character index: as a mapping's key or value, a
    /// sequence's item, or the whole document. A key from an alias is never a repeated key, as
    /// `yaml` compares no alias with a scalar. Answers `false` when it breaks the file.
    fn place(&mut self, value: Value, start: usize, from_alias: bool) -> bool {
        match self.frames.last_mut() {
            Some(Frame::Sequence { items, .. }) => items.push(value),
            Some(Frame::Mapping {
                entries,
                keys,
                pending,
                ..
            }) => match pending.take() {
                Some(key) => entries.insert(key, value),
                None => {
                    let Some(text) = key_text(&value) else {
                        self.faults.error = Some(start);
                        return false;
                    };
                    if !from_alias {
                        if keys.contains(&value) {
                            self.faults.error = Some(start);
                            return false;
                        }
                        keys.push(value);
                    }
                    *pending = Some(text);
                }
            },
            None => self.root = Some(value),
        }
        true
    }

    /// Records an anchor's value.
    fn anchor(&mut self, anchor: usize, value: &Value) {
        if anchor > 0 {
            self.anchors.insert(anchor, Some(value.clone()));
        }
    }

    /// Reads one event, and answers `false` when the file breaks there and reading stops.
    fn read(&mut self, event: Event<'_>, start: usize) -> bool {
        match event {
            Event::DocumentStart(_) => {
                self.documents += 1;
                if self.documents > 1 {
                    self.faults.error = Some(start);
                    return false;
                }
                true
            }
            Event::Alias(anchor) => match self.anchors.get(&anchor) {
                Some(Some(value)) => {
                    let value = value.clone();
                    self.place(value, start, true)
                }
                // An alias inside the collection its anchor names would make a cycle, which an
                // owned value cannot hold.
                Some(None) => {
                    self.faults.error = Some(start);
                    false
                }
                None => {
                    self.faults.alias = Some(start);
                    false
                }
            },
            Event::Scalar(text, style, anchor, tag) => {
                // The parser reads a quoted line indented less than `yaml` takes.
                if matches!(style, ScalarStyle::SingleQuoted | ScalarStyle::DoubleQuoted)
                    && let Some(at) = quoted_break(&self.chars, start, self.indent_next())
                        .filter(|at| *at < self.chars.len())
                {
                    self.faults.error = Some(at);
                    return false;
                }
                let value = match resolve_scalar(&text, style, tag.as_deref()) {
                    Some(value) => value,
                    None => {
                        self.faults.tag.get_or_insert(start);
                        Value::Text(text.into_owned())
                    }
                };
                self.anchor(anchor, &value);
                self.place(value, start, false)
            }
            Event::SequenceStart(anchor, tag) => {
                if !collection_tag_holds(tag.as_deref(), "seq") {
                    self.faults.tag.get_or_insert(start);
                }
                let column = self.block_column(start);
                self.open(
                    anchor,
                    Frame::Sequence {
                        anchor,
                        start,
                        column,
                        items: Vec::new(),
                    },
                )
            }
            Event::MappingStart(anchor, tag) => {
                if !collection_tag_holds(tag.as_deref(), "map") {
                    self.faults.tag.get_or_insert(start);
                }
                let column = self.block_column(start);
                self.open(
                    anchor,
                    Frame::Mapping {
                        anchor,
                        start,
                        column,
                        entries: ObjectBuilder::default(),
                        keys: Vec::new(),
                        pending: None,
                    },
                )
            }
            Event::SequenceEnd | Event::MappingEnd => self.close(),
            Event::StreamStart | Event::StreamEnd | Event::DocumentEnd | Event::Nothing => true,
        }
    }

    /// The column of a collection that starts at a character index, or `None` for a flow one,
    /// which starts at its bracket.
    fn block_column(&self, start: usize) -> Option<usize> {
        match self.chars.get(start) {
            Some('[' | '{') => None,
            _ => Some(start - line_start(&self.chars, start)),
        }
    }

    fn open(&mut self, anchor: usize, frame: Frame) -> bool {
        if let (Some(_), Some(tab)) = (frame.column(), self.indenting_tab(frame.start())) {
            self.faults.error = Some(tab);
            return false;
        }
        if anchor > 0 {
            self.anchors.insert(anchor, None);
        }
        self.frames.push(frame);
        true
    }

    /// The first tab of the whitespace that indents a block collection starting at a character
    /// index, which `yaml` does not take as indentation.
    fn indenting_tab(&self, start: usize) -> Option<usize> {
        let start = start.min(self.chars.len());
        let from = line_start(&self.chars, start);
        let indentation = &self.chars[from..start];
        if !indentation
            .iter()
            .all(|character| matches!(character, ' ' | '\t'))
        {
            return None;
        }
        indentation
            .iter()
            .position(|character| *character == '\t')
            .map(|at| from + at)
    }

    fn close(&mut self) -> bool {
        let (anchor, start, value) = match self.frames.pop() {
            Some(Frame::Sequence {
                anchor,
                start,
                items,
                ..
            }) => (anchor, start, Value::array(items)),
            Some(Frame::Mapping {
                anchor,
                start,
                entries,
                ..
            }) => (anchor, start, entries.build()),
            None => return true,
        };
        self.anchor(anchor, &value);
        self.place(value, start, false)
    }

    /// The indentation a quoted scalar's continuation lines need: one column more than the
    /// innermost block collection, or none at the top level.
    fn indent_next(&self) -> usize {
        self.frames
            .iter()
            .rev()
            .find_map(Frame::column)
            .map_or(0, |column| column + 1)
    }

    /// The character index `yaml` names for the error the parser reports at `marker`.
    fn error_place(&self, info: &str, marker: usize) -> usize {
        error_place(
            &self.chars,
            info,
            marker,
            (self.last_start, self.last_end),
            self.indent_next(),
        )
    }
}

/// The index of the first character on the line that holds a character index.
fn line_start(chars: &[char], at: usize) -> usize {
    let at = at.min(chars.len());
    chars[..at]
        .iter()
        .rposition(|character| matches!(character, '\n' | '\r'))
        .map_or(0, |found| found + 1)
}

/// The index of the line break that ends the line holding a character index, or the end.
fn line_end(chars: &[char], at: usize) -> usize {
    chars[at.min(chars.len())..]
        .iter()
        .position(|character| matches!(character, '\n' | '\r'))
        .map_or(chars.len(), |found| at + found)
}

/// The index of the first line after the one holding a character index, or the end.
fn next_line(chars: &[char], at: usize) -> usize {
    let end = line_end(chars, at);
    match chars.get(end..end + 2) {
        Some(['\r', '\n']) => end + 2,
        _ => (end + 1).min(chars.len()),
    }
}

/// The first character from an index on that starts a node: past whitespace, comments, and the
/// indicators `:`, `-`, `?`, and `,` that stand before one.
fn next_node(chars: &[char], mut at: usize) -> usize {
    while let Some(character) = chars.get(at) {
        let follower = chars.get(at + 1).copied();
        match character {
            ' ' | '\t' | '\n' | '\r' | '\u{feff}' | ',' => at += 1,
            '#' => at = line_end(chars, at),
            ':' | '-' | '?' if follower.is_none_or(|next| next.is_whitespace()) => at += 1,
            _ => break,
        }
    }
    at.min(chars.len())
}

/// The first tab in the indentation of the line holding a character index.
fn tab_in_indentation(chars: &[char], at: usize) -> Option<usize> {
    let from = line_start(chars, at);
    chars[from..]
        .iter()
        .take_while(|character| matches!(character, ' ' | '\t'))
        .position(|character| *character == '\t')
        .map(|found| from + found)
}

/// The first tab that indents a line after the one holding a character index.
fn tab_in_later_indentation(chars: &[char], at: usize) -> Option<usize> {
    let mut line = next_line(chars, at);
    while line < chars.len() {
        if let Some(tab) = tab_in_indentation(chars, line) {
            return Some(tab);
        }
        line = next_line(chars, line);
    }
    None
}

/// Where `yaml` breaks a quoted scalar whose quote stands at a character index: at the end of the
/// text when no quote closes it, or else at the line break before the first line inside it that
/// is indented less than `indent_next`, which ends it unclosed there. `None` when neither holds.
fn quoted_break(chars: &[char], quote: usize, indent_next: usize) -> Option<usize> {
    let mark = *chars.get(quote).filter(|mark| matches!(mark, '"' | '\''))?;
    let mut end = None;
    let mut at = quote + 1;
    while at < chars.len() {
        if chars[at] == mark {
            if mark == '\'' && chars.get(at + 1) == Some(&'\'') {
                at += 2;
                continue;
            }
            let escapes = chars[quote + 1..at]
                .iter()
                .rev()
                .take_while(|character| **character == '\\')
                .count();
            if mark == '\'' || escapes % 2 == 0 {
                end = Some(at);
                break;
            }
        }
        at += 1;
    }
    let Some(end) = end else {
        return Some(chars.len());
    };
    let mut line_break = chars[quote..end].iter().position(|c| *c == '\n')? + quote;
    loop {
        let next = line_break + 1;
        if !continues(chars, next, indent_next) {
            let carriage = line_break > 0 && chars[line_break - 1] == '\r';
            return Some(if carriage { line_break - 1 } else { line_break });
        }
        line_break = chars[next..end].iter().position(|c| *c == '\n')? + next;
    }
}

/// Whether the line starting at a character index continues a quoted scalar, as `yaml`'s lexer
/// judges it: a blank line, or one indented at least `indent_next` spaces; at the top level, any
/// line but a document marker.
fn continues(chars: &[char], line: usize, indent_next: usize) -> bool {
    if indent_next == 0 {
        let marker = chars.get(line..line + 3);
        let ends = chars
            .get(line + 3)
            .is_none_or(|character| character.is_whitespace());
        return !(matches!(marker, Some(['-', '-', '-'] | ['.', '.', '.'])) && ends);
    }
    let indent = chars[line..].iter().take_while(|c| **c == ' ').count();
    match chars.get(line + indent) {
        None | Some('\n') => true,
        Some('\r') => matches!(chars.get(line + indent + 1), None | Some('\n')),
        Some(_) => indent >= indent_next,
    }
}

/// The backslash of the first escape in a double-quoted scalar, whose quote stands at a character
/// index, that `yaml` does not read.
fn bad_escape(chars: &[char], quote: usize) -> Option<usize> {
    let mut at = quote + 1;
    while at < chars.len() && chars[at] != '"' {
        if chars[at] != '\\' {
            at += 1;
            continue;
        }
        let digits = match chars.get(at + 1) {
            Some('x') => 2,
            Some('u') => 4,
            Some('U') => 8,
            Some(
                '0' | 'a' | 'b' | 'e' | 'f' | 'n' | 'r' | 't' | 'v' | 'N' | '_' | 'L' | 'P' | ' '
                | '"' | '/' | '\\' | '\t' | '\n',
            ) => 0,
            Some('\r') if chars.get(at + 2) == Some(&'\n') => 1,
            _ => return Some(at),
        };
        if matches!(chars.get(at + 1), Some('x' | 'u' | 'U')) {
            let code = chars
                .get(at + 2..at + 2 + digits)
                .and_then(|hex| u32::from_str_radix(&hex.iter().collect::<String>(), 16).ok());
            if code.is_none_or(|code| code > 0x10_FFFF) {
                return Some(at);
            }
        }
        at += 2 + digits;
    }
    None
}

/// The character index `yaml` names for an error `saphyr-parser` reports at `marker`, where the
/// last event read spans `last` and a quoted scalar's lines need `indent_next` spaces. An error
/// of a kind this does not recognize keeps the parser's place.
fn error_place(
    chars: &[char],
    info: &str,
    marker: usize,
    (last_start, last_end): (usize, usize),
    indent_next: usize,
) -> usize {
    let line = line_start(chars, marker);
    let before = &chars[line..marker.min(chars.len())];
    if info.contains("unknown escape character") || info.contains("expected hexadecimal number") {
        bad_escape(chars, marker).unwrap_or(marker)
    } else if info.contains("quoted scalar") {
        // The parser names the opening quote.
        quoted_break(chars, marker, indent_next).unwrap_or(marker)
    } else if info.contains("tab cannot be used as indentation") {
        // A tab that indents a quoted scalar's line: the parser names the line, and the quote
        // stands at the node after the event read last.
        quoted_break(chars, next_node(chars, last_end), indent_next).unwrap_or(marker)
    } else if info.contains("found a tab") {
        tab_in_later_indentation(chars, marker).unwrap_or(marker)
    } else if info.contains("'-' must be followed by a valid YAML whitespace") {
        // White space with a tab after a sequence's dash, before another dash: `yaml` names
        // where the white space starts.
        before
            .iter()
            .rposition(|c| !matches!(c, ' ' | '\t'))
            .map_or(line, |found| line + found + 1)
    } else if info.contains("tabs disallowed") {
        tab_in_indentation(chars, marker).unwrap_or(marker)
    } else if info.contains("mapping values are not allowed") {
        // The value read last runs into a colon, so `yaml` takes it as a key and names its start.
        last_start
    } else if info.contains("simple key expect") {
        // A key with no colon: `yaml` names the key, which starts after the value read last.
        next_node(chars, last_end)
    } else if (info.contains("illegal placement of ':'")
        || info.contains("did not find expected ',' or '}'")
        || info.contains("expected ',' or ']'"))
        && last_start < line
    {
        // A flow collection left open on an earlier line: `yaml` ends it at the first node of
        // the line that cannot continue it.
        line + before
            .iter()
            .take_while(|c| matches!(c, ' ' | '\t'))
            .count()
    } else if info.contains("did not find expected key") {
        // A line that starts where no key of the open mapping can: `yaml` names its start.
        if before.iter().all(|c| matches!(c, ' ' | '\t' | '-')) {
            line
        } else {
            marker
        }
    } else if info.contains("did not find expected '-' indicator") {
        if chars.get(marker) == Some(&'-') {
            marker
        } else {
            line
        }
    } else if info.contains("comment intercepting") {
        let comment = chars[marker.min(chars.len())..]
            .iter()
            .position(|c| *c == '#')
            .map_or(marker, |found| marker + found);
        next_line(chars, comment)
    } else if info.contains("wrongly indented line in block scalar") {
        line
    } else {
        marker
    }
}

/// The mapping a YAML document holds, or where it breaks. An empty document, or one that holds
/// only comments, holds no mapping.
pub(crate) fn read_yaml(text: &str) -> Reading {
    let chars: Vec<char> = text.chars().collect();
    let mut spaced = tabs_after_colons(&chars);
    let builder = loop {
        let mut source = chars.clone();
        for at in &spaced {
            source[*at] = ' ';
        }
        let source: String = source.into_iter().collect();
        match build(&source, &spaced) {
            Built::Read(builder) => break builder,
            Built::Restore(kept) => spaced.retain(|at| !kept.contains(at)),
        }
    };
    if let Some(index) = builder.faults.first() {
        return Reading::broken(Clause::InvalidYaml, text, offset_of_character(text, index));
    }
    match builder.root {
        Some(root) => Reading::of(root, Clause::NotYamlMapping),
        None => Reading::Unusable {
            clause: Clause::NotYamlMapping,
            at: None,
        },
    }
}

/// The tabs in the white space after each colon. YAML takes a tab there as white space, as
/// `yaml` does, where `saphyr-parser` stops at one before a value; the reader parses them as
/// spaces, which keeps every character's index. Outside a quoted or block scalar, a colon before
/// white space is an indicator, so only such a scalar's text can hold one of these tabs.
fn tabs_after_colons(chars: &[char]) -> Vec<usize> {
    let mut tabs = Vec::new();
    for (at, character) in chars.iter().enumerate() {
        if *character != ':' {
            continue;
        }
        let run = chars[at + 1..]
            .iter()
            .take_while(|character| matches!(character, ' ' | '\t'));
        for (offset, character) in run.enumerate() {
            if *character == '\t' {
                tabs.push(at + 1 + offset);
            }
        }
    }
    tabs
}

/// What one pass of the parser over a text gives.
enum Built {
    /// The document, or where it breaks.
    Read(Builder),
    /// The spaced tabs that stand inside a quoted or block scalar, whose text keeps them.
    Restore(Vec<usize>),
}

/// One pass over a text whose tabs at `spaced` the reader made spaces.
fn build(text: &str, spaced: &[usize]) -> Built {
    let mut builder = Builder::new(text);
    for item in Parser::new_from_str(text) {
        match item {
            Ok((event, span)) => {
                let (start, end) = (span.start.index(), span.end.index());
                if let Event::Scalar(_, style, ..) = &event
                    && *style != ScalarStyle::Plain
                {
                    let kept: Vec<usize> = spaced
                        .iter()
                        .copied()
                        .filter(|at| (start..end).contains(at))
                        .collect();
                    if !kept.is_empty() {
                        return Built::Restore(kept);
                    }
                }
                if !builder.read(event, start) {
                    break;
                }
                builder.last_start = start;
                builder.last_end = end;
            }
            Err(error) => {
                let marker = error.marker().index();
                if error.info().contains("unknown anchor") {
                    builder.faults.alias = Some(marker);
                } else {
                    builder.faults.error = Some(builder.error_place(error.info(), marker));
                }
                break;
            }
        }
    }
    Built::Read(builder)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::reading::Position;

    fn broken(line: usize, column: usize) -> Reading {
        Reading::Unusable {
            clause: Clause::InvalidYaml,
            at: Some(Position { line, column }),
        }
    }

    // config-formats.test.ts: the YAML cases.
    #[test]
    fn a_yaml_file_that_does_not_parse_names_its_line_and_column() {
        assert_eq!(read_yaml("a: 1\nb: [1, 2\n"), broken(3, 1));
        assert_eq!(read_yaml("a: 1\na: 2\n"), broken(2, 1));
        assert_eq!(read_yaml("a: 1\nb: !!binary aGk=\n"), broken(2, 4));
        assert_eq!(read_yaml("a: 1\nb: *missing\n"), broken(2, 4));
    }

    #[test]
    fn plain_scalars_resolve_under_the_core_schema() {
        let Reading::Usable(value) = read_yaml(
            "a: True\nb: FALSE\nc: 2001-12-14\nd: 0x1F\ne: 1.0\nf: no\ng: ~\nh: .inf\ni: 0o17\nj: '5'\nk: +.5e1\n",
        ) else {
            panic!("the document parses");
        };
        let read = |key: &str| value.get(key).cloned();
        assert_eq!(read("a"), Some(Value::Bool(true)));
        assert_eq!(read("b"), Some(Value::Bool(false)));
        assert_eq!(read("c"), Some(Value::Text("2001-12-14".into())));
        assert_eq!(read("d"), Some(Value::Number(31.0)));
        assert_eq!(read("e"), Some(Value::Number(1.0)));
        assert_eq!(read("f"), Some(Value::Text("no".into())));
        assert_eq!(read("g"), Some(Value::Null));
        assert_eq!(read("h"), Some(Value::Number(f64::INFINITY)));
        assert_eq!(read("i"), Some(Value::Number(15.0)));
        assert_eq!(read("j"), Some(Value::Text("5".into())));
        assert_eq!(read("k"), Some(Value::Number(5.0)));
    }

    #[test]
    fn a_key_reads_as_its_javascript_text() {
        let Reading::Usable(value) = read_yaml("1: a\ntrue: b\n~: c\n0x10: d\n") else {
            panic!("the document parses");
        };
        let keys: Vec<&str> = value
            .entries()
            .unwrap_or_default()
            .iter()
            .map(|(key, _)| key.as_str())
            .collect();
        assert_eq!(keys, ["1", "true", "", "16"]);
    }

    #[test]
    fn an_alias_shares_its_anchor_and_a_self_reference_is_not_valid_yaml() {
        let Reading::Usable(value) = read_yaml("a: &x { b: 1 }\nc: *x\n") else {
            panic!("the document parses");
        };
        assert_eq!(value.get("a"), value.get("c"));
        assert_eq!(
            read_yaml("tree: &t\n  name: root\n  child: *t\n"),
            broken(3, 10)
        );
    }

    /// Each case is a text and the line and column `yaml` names for it.
    fn assert_breaks(cases: &[(&str, usize, usize)]) {
        for (text, line, column) in cases {
            assert_eq!(read_yaml(text), broken(*line, *column), "{text:?}");
        }
    }

    #[test]
    fn a_quoted_scalar_left_open_breaks_at_the_end_or_at_the_line_that_ends_it() {
        assert_breaks(&[
            ("a: \"unterminated\n", 2, 1),
            ("a: 'x\n", 2, 1),
            ("a: \"x", 1, 6),
            ("a: \"x\nb: 2\n", 3, 1),
            ("a: \"x\\\"\n", 2, 1),
            ("a: \"ok\"\nb: 'it''s\n", 3, 1),
            ("a:\n  b: \"x\ny\"\n", 2, 8),
            ("a: \"x\n\ny\"\n", 2, 1),
            ("a: \"x\r\ny\"\r\n", 1, 6),
            ("- - \"x\n  y\"\n", 1, 7),
            ("a:\n- a: \"x\n  y\"\n", 2, 8),
            ("a:\n  b: [\"x\n  y\"]\n", 2, 9),
            ("a: \"x\n\ty\"\n", 1, 6),
            ("a: \"x\n---\ny\"\n", 1, 6),
        ]);
        let Reading::Usable(value) = read_yaml("a:\n  b: \"x\n   y\"\n") else {
            panic!("the document parses");
        };
        assert_eq!(
            value.get("a").and_then(|a| a.get("b")).cloned(),
            Some(Value::Text("x y".into()))
        );
    }

    #[test]
    fn a_bad_escape_breaks_at_its_backslash() {
        assert_breaks(&[
            ("a: \"\\q\"\n", 1, 5),
            ("a: \"\\x4\"\n", 1, 5),
            ("a: \"ab\\u12\"\n", 1, 7),
            ("a: \"\\U0001F600\\z\"\n", 1, 15),
            ("a: \"\u{e9}\\q\"\n", 1, 6),
        ]);
    }

    #[test]
    fn a_tab_that_indents_breaks_at_the_tab() {
        assert_breaks(&[
            ("a: 1\n\tb: 2", 2, 1),
            ("a: 1\r\n\tb: 2\r\n", 2, 1),
            ("a:\n  b: 1\n  \tc: 2\n", 3, 3),
            ("a:\n\t- 1\n", 2, 1),
            ("\ta: 1\n", 1, 1),
            ("  \ta: 1\n", 1, 3),
            ("a:\n  \t- 1\n", 2, 3),
            ("-\t- a\n", 1, 2),
            ("- \t- a\n", 1, 2),
        ]);
    }

    #[test]
    fn a_tab_after_a_colon_separates_the_value() {
        let Reading::Usable(value) = read_yaml("host:\tlocalhost\nport:\t\t8080\n") else {
            panic!("the document parses");
        };
        assert_eq!(value.get("host"), Some(&Value::Text("localhost".into())));
        assert_eq!(value.get("port"), Some(&Value::Number(8080.0)));
        let Reading::Usable(value) = read_yaml("a: \"x:\ty\"\nb: 'x:\ty'\nc: |\n  x:\ty\nd:\tz\n")
        else {
            panic!("the document parses");
        };
        assert_eq!(value.get("a"), Some(&Value::Text("x:\ty".into())));
        assert_eq!(value.get("b"), Some(&Value::Text("x:\ty".into())));
        assert_eq!(value.get("c"), Some(&Value::Text("x:\ty\n".into())));
        assert_eq!(value.get("d"), Some(&Value::Text("z".into())));
    }

    #[test]
    fn a_value_that_runs_into_a_colon_breaks_where_the_value_starts() {
        assert_breaks(&[
            ("key: value\n  bad: indent", 1, 6),
            ("a: 1\n b: 2", 1, 4),
            ("a: 1\nb: 2\n  c: 3", 2, 4),
            ("a: b: c", 1, 4),
            ("a: b:\n", 1, 4),
            ("a:\n- b\n c: 1\n", 2, 3),
            ("a: \"q\": b\n", 1, 4),
            ("a: &x b: c\n", 1, 4),
            ("foo:\n  bar: 1\n   baz: 2\n", 2, 8),
        ]);
    }

    #[test]
    fn a_key_without_a_colon_breaks_at_the_key() {
        assert_breaks(&[
            ("a: 1\nb\n", 2, 1),
            ("a: 1\nb", 2, 1),
            ("a: b\nc d\n", 2, 1),
            ("a: |\nx\n", 2, 1),
            ("a: b #c\n#d\ne\n", 3, 1),
            ("a: 1\n\n\nb\n", 4, 1),
            ("foo:\n  bar: 1\n  baz\n", 3, 3),
            ("- a\n- b\nc\n", 3, 1),
        ]);
    }

    #[test]
    fn a_line_no_open_collection_takes_breaks_at_its_start() {
        assert_breaks(&[
            ("a:\n  - 1\n - 2", 3, 1),
            ("a: |\n  text\n b: 2", 3, 1),
            ("a: b\n- c", 2, 1),
            ("a:\n    b: 1\n  c: 2\n", 3, 1),
            ("list:\n  - name: x\n    port: 1\n   bad: 2", 4, 1),
            ("- - a\n  - b\n - c\n", 3, 2),
            ("a: 1 # x\n  b: 2\n", 2, 1),
            ("a: |2\n x\n", 2, 1),
            ("a: &x &y 1\n", 1, 7),
        ]);
    }

    #[test]
    fn a_flow_collection_left_open_breaks_at_the_line_that_ends_it() {
        assert_breaks(&[
            ("a: [1, 2\nb: 3\n", 2, 1),
            ("a:\n  b: [c, d\n  e: 1\n", 3, 3),
            ("a: {b: c\nd: e\n", 2, 1),
            ("a: {b: [c}\n", 1, 10),
        ]);
    }

    #[test]
    fn a_float_tag_takes_no_integer_and_the_non_specific_tag_reads_a_string() {
        assert_breaks(&[("c: !!float 1\n", 1, 4), ("c: !!float 0x1F\n", 1, 4)]);
        let Reading::Usable(value) =
            read_yaml("a: ! 5\nb: !!float 1.\nc: !!float 1e3\nd: !!float -.inf\ne: ! [x]\n")
        else {
            panic!("the document parses");
        };
        assert_eq!(value.get("a"), Some(&Value::Text("5".into())));
        assert_eq!(value.get("b"), Some(&Value::Number(1.0)));
        assert_eq!(value.get("c"), Some(&Value::Number(1000.0)));
        assert_eq!(value.get("d"), Some(&Value::Number(f64::NEG_INFINITY)));
        assert_eq!(
            value.get("e"),
            Some(&Value::array(vec![Value::Text("x".into())]))
        );
    }

    #[test]
    fn an_alias_used_as_a_key_is_never_a_repeated_key() {
        let Reading::Usable(value) = read_yaml("&a a: 1\n*a : 2\n") else {
            panic!("the document parses");
        };
        let entries: Vec<(String, Value)> = value.entries().unwrap_or_default().to_vec();
        assert_eq!(entries, vec![("a".to_owned(), Value::Number(2.0))]);
        assert_eq!(read_yaml("a: 1\na: 2\n"), broken(2, 1));
    }
}
