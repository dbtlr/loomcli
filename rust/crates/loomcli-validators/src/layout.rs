//! The strftime layouts `date()`, `date_time()`, and `time()` read beside their default grammar.
//!
//! A layout compiles once, at the call that declares it, into the expression the validator
//! matches, the pattern the factory publishes, and the form its message writes. A layout the
//! factory cannot read faults at the call, marking the entry of the list at fault.

use loomcli_core::{Finding, Literal};
use regex::Regex;
use serde_json::{Map, Value, json};

use crate::calendar::{Fields, OFFSET_GROUPS, OFFSET_PATTERN};
use crate::fault;
use crate::js::escape_syntax;

/// A field a directive reads. `%H` and `%I` both read the hour.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Field {
    Day,
    Hour,
    Meridiem,
    Minute,
    Month,
    Offset,
    Second,
    Year,
}

impl Field {
    /// How a sentence names a field held twice.
    fn held_twice(self) -> &'static str {
        match self {
            Field::Day => "the day",
            Field::Hour => "the hour",
            Field::Meridiem => "%p",
            Field::Minute => "the minute",
            Field::Month => "the month",
            Field::Offset => "the offset",
            Field::Second => "the second",
            Field::Year => "the year",
        }
    }
}

/// The field a directive letter reads, or `None` for a letter that is no directive.
fn field_of(letter: char) -> Option<Field> {
    Some(match letter {
        'Y' => Field::Year,
        'm' => Field::Month,
        'd' => Field::Day,
        'H' | 'I' => Field::Hour,
        'M' => Field::Minute,
        'S' => Field::Second,
        'p' => Field::Meridiem,
        'z' => Field::Offset,
        _ => return None,
    })
}

/// The directives that read digits, before which a one-or-two-digit directive reads exactly two.
fn reads_digits(letter: char) -> bool {
    matches!(letter, 'H' | 'I' | 'M' | 'S' | 'Y' | 'd' | 'm')
}

/// The written form, the published pattern, and the capturing pattern of one directive.
fn directive_parts(letter: char, exactly_two: bool) -> (&'static str, String, String) {
    let digits = if exactly_two {
        "[0-9]{2}"
    } else {
        "[0-9]{1,2}"
    };
    let flexible =
        |name: &str, form: &'static str| (form, digits.to_owned(), format!("(?<{name}>{digits})"));
    match letter {
        'Y' => (
            "YYYY",
            "[0-9]{4}".to_owned(),
            "(?<year>[0-9]{4})".to_owned(),
        ),
        'm' => flexible("month", "MM"),
        'd' => flexible("day", "DD"),
        'H' | 'I' => flexible("hour", "hh"),
        'M' => flexible("minute", "mm"),
        'S' => flexible("second", "ss"),
        'p' => (
            "AM",
            "[AaPp][Mm]".to_owned(),
            "(?<meridiem>[AaPp][Mm])".to_owned(),
        ),
        _ => (
            "\u{b1}hh:mm",
            format!("(?:{OFFSET_PATTERN})"),
            format!("(?:{OFFSET_GROUPS})"),
        ),
    }
}

/// What one factory's layouts may hold, and how its faults word their corrections.
pub(crate) struct LayoutRules {
    /// The factory's name, as a sentence writes it.
    factory: &'static str,
    /// The directive letters the factory reads.
    reads: &'static str,
    /// The directives a correction lists.
    listed: &'static str,
    /// The fields every layout holds, each with its name and the correction that adds it.
    required: &'static [(Field, &'static str, &'static str)],
    /// Whether a literal `Z` or `z` is a fault, because only `%z` may read a UTC stamp.
    refuses_literal_zone: bool,
    /// A layout the factory reads, for the correction of an empty one.
    example: &'static str,
}

const DATE_FIELDS: [(Field, &str, &str); 3] = [
    (Field::Year, "year", "Add %Y."),
    (Field::Month, "month", "Add %m."),
    (Field::Day, "day", "Add %d."),
];

/// The rules of `date()` layouts.
pub(crate) const DATE_RULES: LayoutRules = LayoutRules {
    factory: "date",
    reads: "Ymd",
    listed: "%Y, %m, and %d",
    required: &DATE_FIELDS,
    refuses_literal_zone: false,
    example: "\"%d/%m/%Y\"",
};

/// The rules of `date_time()` layouts.
pub(crate) const DATE_TIME_RULES: LayoutRules = LayoutRules {
    factory: "date_time",
    reads: "YmdHMSz",
    listed: "%Y, %m, %d, %H, %M, %S, and %z",
    required: &[
        DATE_FIELDS[0],
        DATE_FIELDS[1],
        DATE_FIELDS[2],
        (Field::Hour, "hour", "Add %H."),
        (Field::Minute, "minute", "Add %M."),
    ],
    refuses_literal_zone: true,
    example: "\"%d/%m/%Y %H:%M\"",
};

/// The rules of `time()` layouts.
pub(crate) const TIME_RULES: LayoutRules = LayoutRules {
    factory: "time",
    reads: "HIMSp",
    listed: "%H, %I, %M, %S, and %p",
    required: &[
        (Field::Hour, "hour", "Add %H, or %I with %p."),
        (Field::Minute, "minute", "Add %M."),
    ],
    refuses_literal_zone: false,
    example: "\"%I:%M%p\"",
};

/// One part of a layout: text it matches exactly, or a directive letter.
enum Piece {
    Text(String),
    Directive(char),
}

/// One compiled layout: what the validator matches, what the factory publishes, and its written form.
#[derive(Clone, Debug)]
struct Layout {
    expression: Regex,
    pattern: String,
    form: String,
}

/// Why a layout cannot be read, as its fault states it.
struct Problem {
    sentence: String,
    correction: String,
}

impl Problem {
    fn new(sentence: String, correction: impl Into<String>) -> Self {
        Self {
            sentence,
            correction: correction.into(),
        }
    }
}

/// The sentence's opening, the factory call and the layout it holds: `date() layout "%d/%m"`.
fn opening(rules: &LayoutRules, layout: &str) -> String {
    format!("{}() layout {}", rules.factory, quoted(layout))
}

/// A string as JSON writes it, quoted.
fn quoted(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| format!("\"{text}\""))
}

/// A layout's pieces in order, or the problem the first part that cannot be read poses.
fn scan(rules: &LayoutRules, layout: &str) -> Result<Vec<Piece>, Problem> {
    let mut pieces = Vec::new();
    let mut characters = layout.chars().peekable();
    while let Some(&next) = characters.peek() {
        if next == '%' {
            characters.next();
            pieces.push(directive_piece(rules, layout, characters.next())?);
            continue;
        }
        let mut text = String::new();
        while let Some(&each) = characters.peek() {
            if each == '%' {
                break;
            }
            text.push(each);
            characters.next();
        }
        if rules.refuses_literal_zone
            && let Some(letter) = text.chars().find(|each| matches!(each, 'Z' | 'z'))
        {
            return Err(Problem::new(
                format!(
                    "{} holds a literal {letter}, which would read a UTC time as local time.",
                    opening(rules, layout)
                ),
                "Write %z, which reads Z as UTC and every other offset as that offset.",
            ));
        }
        pieces.push(Piece::Text(text));
    }
    Ok(pieces)
}

/// A `%` and the character after it as a piece, or the problem it poses.
fn directive_piece(
    rules: &LayoutRules,
    layout: &str,
    letter: Option<char>,
) -> Result<Piece, Problem> {
    let Some(letter) = letter else {
        return Err(Problem::new(
            format!("{} ends with a lone %.", opening(rules, layout)),
            "Write %% for a percent sign.",
        ));
    };
    if letter == '%' {
        return Ok(Piece::Text("%".to_owned()));
    }
    if rules.reads.contains(letter) {
        return Ok(Piece::Directive(letter));
    }
    let reader = if field_of(letter).is_some() {
        format!("{}() does not read", rules.factory)
    } else {
        "no layout reads".to_owned()
    };
    Err(Problem::new(
        format!(
            "{} holds %{letter}, which {reader}.",
            opening(rules, layout)
        ),
        format!("Use only {}, with %% for a percent sign.", rules.listed),
    ))
}

/// The directive letters the pieces hold, in order.
fn directives_of(pieces: &[Piece]) -> Vec<char> {
    pieces
        .iter()
        .filter_map(|piece| match piece {
            Piece::Directive(letter) => Some(*letter),
            Piece::Text(_) => None,
        })
        .collect()
}

/// The problem of a field held twice, a field missing, or an unpaired clock, or `None`.
fn field_problem(rules: &LayoutRules, layout: &str, directives: &[char]) -> Option<Problem> {
    let fields: Vec<Field> = directives
        .iter()
        .filter_map(|letter| field_of(*letter))
        .collect();
    if let Some(repeated) = fields
        .iter()
        .enumerate()
        .find(|(index, field)| fields[..*index].contains(field))
        .map(|(_, field)| *field)
    {
        return Some(Problem::new(
            format!(
                "{} holds {} twice.",
                opening(rules, layout),
                repeated.held_twice()
            ),
            "Write each field once.",
        ));
    }
    if let Some((_, name, add)) = rules
        .required
        .iter()
        .find(|(field, ..)| !fields.contains(field))
    {
        return Some(Problem::new(
            format!("{} holds no {name}.", opening(rules, layout)),
            *add,
        ));
    }
    let twelve_hour = directives.contains(&'I');
    let meridiem = directives.contains(&'p');
    if twelve_hour && !meridiem {
        return Some(Problem::new(
            format!("{} holds %I without %p.", opening(rules, layout)),
            "Add %p, or write %H for an hour from 0 through 23.",
        ));
    }
    if meridiem && !twelve_hour {
        return Some(Problem::new(
            format!("{} holds %p without %I.", opening(rules, layout)),
            "Write %I for an hour from 1 through 12, or leave out %p.",
        ));
    }
    None
}

/// The pieces as a compiled layout: the expression, the published pattern, and the written form.
fn compile(pieces: &[Piece]) -> Layout {
    let (mut form, mut groups, mut pattern) = (String::new(), String::new(), String::new());
    for (index, piece) in pieces.iter().enumerate() {
        match piece {
            Piece::Text(text) => {
                let escaped = escape_syntax(text);
                form.push_str(text);
                groups.push_str(&escaped);
                pattern.push_str(&escaped);
            }
            Piece::Directive(letter) => {
                let follows_digits = matches!(
                    pieces.get(index + 1),
                    Some(Piece::Directive(next)) if reads_digits(*next)
                );
                let exactly_two = follows_digits && !matches!(letter, 'Y' | 'p' | 'z');
                let (written, plain, captured) = directive_parts(*letter, exactly_two);
                form.push_str(written);
                pattern.push_str(&plain);
                groups.push_str(&captured);
            }
        }
    }
    Layout {
        expression: crate::grammar::constant(&format!("^{groups}$")),
        pattern: format!("^{pattern}$"),
        form,
    }
}

/// One layout compiled, or the problem that keeps the factory from reading it.
fn compile_layout(rules: &LayoutRules, layout: &str) -> Result<Layout, Problem> {
    if layout.is_empty() {
        return Err(Problem::new(
            format!("{}() layouts lists an empty layout.", rules.factory),
            format!("Supply a layout such as {}.", rules.example),
        ));
    }
    let pieces = scan(rules, layout)?;
    match field_problem(rules, layout, &directives_of(&pieces)) {
        Some(problem) => Err(problem),
        None => Ok(compile(&pieces)),
    }
}

/// A factory's default grammar: what it matches, the schema member it publishes, and its form.
pub(crate) struct DefaultGrammar {
    pub(crate) expression: Regex,
    pub(crate) schema: Map<String, Value>,
    pub(crate) form: &'static str,
}

/// How a factory reads its tokens once its layouts compile: the expressions to try in order, the
/// schema it publishes, and each distinct form its message writes, which is `None` with no layouts,
/// because the default sentence names no form.
#[derive(Clone, Debug)]
pub(crate) struct Reading {
    expressions: Vec<Regex>,
    input_schema: Map<String, Value>,
    forms: Option<Vec<String>>,
}

impl Reading {
    /// The expressions to try, the default grammar's first.
    pub(crate) fn input_schema(&self) -> &Map<String, Value> {
        &self.input_schema
    }

    /// The distinct forms the message writes, or `None` for the default sentence.
    pub(crate) fn forms(&self) -> Option<&[String]> {
        self.forms.as_deref()
    }

    /// The value the first expression to read the token gives: the default grammar's, then each
    /// layout's in order. An expression reads a token when it matches and `read` finds every field
    /// in range; otherwise the next is tried.
    pub(crate) fn first<V>(&self, raw: &str, read: impl Fn(&Fields<'_>) -> Option<V>) -> Option<V> {
        self.expressions.iter().find_map(|expression| {
            let captures = expression.captures(raw)?;
            read(&Fields::of(&captures))
        })
    }
}

/// The reading of a factory call that declares `layouts`: an empty list is a fault, as is a layout
/// the factory cannot read.
#[track_caller]
pub(crate) fn declare(rules: &LayoutRules, layouts: &[&str], grammar: &DefaultGrammar) -> Reading {
    if layouts.is_empty() {
        fault::raise(
            fault::LAYOUT,
            format!("{}() layouts lists no layout.", rules.factory),
            &format!("Supply a layout such as {}.", rules.example),
            vec![
                Finding::new(
                    format!("{}().layouts", rules.factory),
                    vec![Literal::List(Vec::new())],
                )
                .mark("0"),
            ],
        );
    }
    reading_of(rules, layouts, grammar)
}

/// The reading of a factory call: its default grammar, then each layout it declares. With layouts,
/// it publishes `anyOf` its default schema and each layout's pattern, and writes the default form
/// then each layout's form at its first place. A fault marks the first layout it cannot read.
#[track_caller]
pub(crate) fn reading_of(
    rules: &LayoutRules,
    layouts: &[&str],
    grammar: &DefaultGrammar,
) -> Reading {
    let mut compiled = Vec::new();
    for (index, layout) in layouts.iter().enumerate() {
        match compile_layout(rules, layout) {
            Ok(each) => compiled.push(each),
            Err(problem) => fault::raise(
                fault::LAYOUT,
                problem.sentence,
                &problem.correction,
                vec![
                    Finding::new(
                        format!("{}().layouts", rules.factory),
                        vec![Literal::List(
                            layouts.iter().map(|each| Literal::from(*each)).collect(),
                        )],
                    )
                    .mark(format!("0.{index}")),
                ],
            ),
        }
    }
    let mut expressions = vec![grammar.expression.clone()];
    expressions.extend(compiled.iter().map(|layout| layout.expression.clone()));
    let mut schema = Map::new();
    schema.insert("type".to_owned(), json!("string"));
    if compiled.is_empty() {
        schema.extend(grammar.schema.clone());
        return Reading {
            expressions,
            input_schema: schema,
            forms: None,
        };
    }
    let mut forms: Vec<String> = Vec::new();
    for form in std::iter::once(grammar.form.to_owned())
        .chain(compiled.iter().map(|each| each.form.clone()))
    {
        if !forms.contains(&form) {
            forms.push(form);
        }
    }
    let members: Vec<Value> = std::iter::once(Value::Object(grammar.schema.clone()))
        .chain(
            compiled
                .iter()
                .map(|layout| json!({ "pattern": layout.pattern })),
        )
        .collect();
    schema.insert("anyOf".to_owned(), Value::Array(members));
    Reading {
        expressions,
        input_schema: schema,
        forms: Some(forms),
    }
}
