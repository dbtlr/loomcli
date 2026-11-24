//! The cells of the help page's rows: an option's spellings and placeholder, the usage forms, the
//! right cell's description, accepted values, and facts, and the two-column rule that lays a row
//! set out, wrapping or stacking it on a terminal.

use loomcli_core::style::{Alignment, nowrap};
use loomcli_core::{ArgumentNode, ContentType, OptionNode, Polarity, RequiredWhen, ViewContext};
use serde_json::Value;

use super::layout::{hanging, on_terminal, padded, signed, spaces, unit_width};

/// One row of a section: the two cells the column rule pads and joins.
pub(super) struct Row {
    pub(super) left: String,
    pub(super) right: String,
}

/// The spaces that separate the two columns of one section, and a description from its facts.
const GUTTER: &str = "  ";

/// The indent of an outer heading's direct rows.
pub(super) const ROW_INDENT: &str = "  ";

/// How far a stacked right cell sits past the furthest-in start of its set's left cells.
const STACKED_INDENT: &str = "    ";

/// Whether a character ends a line: LF, VT, FF, CR, NEL, LS, or PS.
fn is_terminator(character: char) -> bool {
    super::extension::is_terminator(character)
}

/// A text with each line break, CRLF or one terminator, read as one space, so a description or a
/// deprecation message an author wrote across lines prints on one line.
pub(crate) fn single_line(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        if is_terminator(character) {
            if character == '\r' && characters.peek() == Some(&'\n') {
                characters.next();
            }
            out.push(' ');
        } else {
            out.push(character);
        }
    }
    out
}

/// A text with each line terminator printed as its JSON escape, so a rendered default or a listed
/// value stays on one line.
pub(super) fn one_line(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '\n' => out.push_str("\\n"),
            '\u{b}' => out.push_str("\\u000b"),
            '\u{c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            '\u{85}' => out.push_str("\\u0085"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            other => out.push(other),
        }
    }
    out
}

/// The option's facts help reads from extensions: its placeholder, its accepted-values line,
/// whether it hides its bindings, and its configuration path.
pub(crate) struct OptionHelp {
    pub(crate) placeholder: Option<String>,
    pub(crate) accepts: Option<String>,
    pub(crate) hide_bindings: bool,
    pub(crate) config_path: Option<String>,
}

/// The parts of an option that takes a value: a string option or a content option.
struct ValueOption<'a> {
    long: Option<&'a str>,
    short: Option<&'a str>,
    name: &'a str,
    implied: Option<&'a str>,
    multiple: bool,
}

/// The value-taking view of an option, or `None` for a Boolean or counted option.
fn value_option(option: &OptionNode) -> Option<ValueOption<'_>> {
    match option {
        OptionNode::String(node) => Some(ValueOption {
            long: node.long.as_deref(),
            short: node.short.as_deref(),
            name: &node.name,
            implied: node.implied.as_deref(),
            multiple: node.multiple,
        }),
        OptionNode::Content(node) => Some(ValueOption {
            long: node.long.as_deref(),
            short: node.short.as_deref(),
            name: &node.name,
            implied: node.implied.as_deref(),
            multiple: node.multiple,
        }),
        _ => None,
    }
}

/// The long spelling one option publishes. A Boolean option's follows its polarity: the positive
/// form, the negative form, or the combined `--[no-]name` when both spellings set a value.
pub(crate) fn long_spelling(option: &OptionNode) -> Option<String> {
    match option {
        OptionNode::Boolean(node) => match (&node.polarity, &node.long) {
            (Polarity::Both, Some(long)) => Some(format!(
                "--[no-]{}",
                long.strip_prefix("--").unwrap_or(long)
            )),
            _ => node.long.clone().or_else(|| node.negative.clone()),
        },
        other => other.long().map(str::to_owned),
    }
}

/// How a string option's placeholder follows a spelling: the separator, the text before the
/// placeholder, the placeholder, and the text after it. A separate value follows after a space; an
/// implied value is replaced only by an attached one, so its placeholder sits in brackets, after
/// `=` on a long spelling and after the letter alone on a short one.
pub(crate) struct ValueParts {
    /// What sits between the spellings and the placeholder's first character: a space, or nothing.
    pub(crate) separator: &'static str,
    /// The text before the placeholder word: `<`, `[=<`, or `[<`.
    pub(crate) before: &'static str,
    /// The placeholder word.
    pub(crate) placeholder: String,
    /// The text after the placeholder word: `>` or `>]`.
    pub(crate) after: &'static str,
}

impl ValueParts {
    /// The placeholder with the text around it, such as `<path>` or `[=<control>]`.
    fn text(&self) -> String {
        format!("{}{}{}", self.before, self.placeholder, self.after)
    }
}

fn value_parts(implied: bool, long: bool, placeholder: &str) -> ValueParts {
    let placeholder = placeholder.to_owned();
    if !implied {
        return ValueParts {
            separator: " ",
            before: "<",
            placeholder,
            after: ">",
        };
    }
    ValueParts {
        separator: "",
        before: if long { "[=<" } else { "[<" },
        placeholder,
        after: ">]",
    }
}

/// Whether a counted option's spellings end with `...`: while one more occurrence adds anything,
/// which a quiet-marked count's second occurrence does not.
fn trailing_ellipsis(option: &OptionNode) -> bool {
    match option {
        OptionNode::Count(node) => node.verbose || !node.quiet,
        _ => false,
    }
}

/// The spellings one option row opens with: both of them, the long one alone indented four spaces
/// so the long spellings align, or the short one alone for a `short_only` option.
fn spellings(long: Option<&str>, short: Option<&str>, context: &ViewContext) -> String {
    let style = &context.style;
    let Some(long) = long else {
        return style.highlight().apply(&style.escape(short.unwrap_or("")));
    };
    let highlighted = style.highlight().apply(&style.escape(long));
    match short {
        None => format!("    {highlighted}"),
        Some(short) => format!(
            "{}{} {highlighted}",
            style.highlight().apply(&style.escape(short)),
            style.dim().apply(",")
        ),
    }
}

/// The left cell of one option row, its parts styled as help prints them.
pub(super) fn option_cell(option: &OptionNode, help: &OptionHelp, context: &ViewContext) -> String {
    let style = &context.style;
    let long = long_spelling(option);
    let cell = spellings(long.as_deref(), option.short(), context);
    if trailing_ellipsis(option) {
        return format!("{cell}{}", style.dim().italic().apply("..."));
    }
    let Some(valued) = value_option(option) else {
        return cell;
    };
    let placeholder = help.placeholder.as_deref().unwrap_or(valued.name);
    let parts = value_parts(valued.implied.is_some(), valued.long.is_some(), placeholder);
    format!(
        "{cell}{}{}",
        parts.separator,
        style.dim().italic().apply(&style.escape(&parts.text()))
    )
}

/// The parts of one option's left cell, unstyled, for a renderer that styles them its own way:
/// the short and long spellings, whether a counted option ends with `...`, and the value
/// placeholder of an option that takes a value.
#[cfg(feature = "manpage")]
pub(crate) struct OptionCellParts {
    pub(crate) short: Option<String>,
    pub(crate) long: Option<String>,
    pub(crate) trailing_ellipsis: bool,
    pub(crate) value: Option<ValueParts>,
}

/// The unstyled parts of an option's left cell.
#[cfg(feature = "manpage")]
pub(crate) fn option_cell_parts(option: &OptionNode, help: &OptionHelp) -> OptionCellParts {
    let long = long_spelling(option);
    let value = value_option(option).map(|valued| {
        let placeholder = help.placeholder.as_deref().unwrap_or(valued.name);
        value_parts(valued.implied.is_some(), valued.long.is_some(), placeholder)
    });
    OptionCellParts {
        short: option.short().map(str::to_owned),
        long,
        trailing_ellipsis: trailing_ellipsis(option),
        value,
    }
}

/// How a usage form styles its words: the routed path, an option's spelling, and every other word.
pub(crate) trait UsageStyle {
    /// The routed path.
    fn path(&self, text: &str) -> String;
    /// An option's spelling.
    fn spelling(&self, text: &str) -> String;
    /// Any other word: a placeholder, `[options]`, `<command>`.
    fn word(&self, text: &str) -> String;
}

/// The help page's styling of a usage form.
pub(super) struct UsageWriter<'a> {
    context: &'a ViewContext,
}

impl<'a> UsageWriter<'a> {
    pub(super) fn new(context: &'a ViewContext) -> Self {
        Self { context }
    }
}

impl UsageStyle for UsageWriter<'_> {
    fn path(&self, text: &str) -> String {
        let style = &self.context.style;
        style.highlight().apply(&style.escape(text))
    }

    fn spelling(&self, text: &str) -> String {
        let style = &self.context.style;
        style.highlight().apply(&style.escape(text))
    }

    fn word(&self, text: &str) -> String {
        let style = &self.context.style;
        style.dim().italic().apply(&style.escape(text))
    }
}

/// Whether the action form names this option: a visible required option that takes a value and
/// that piped stdin cannot satisfy.
pub(crate) fn named_in_usage(option: &OptionNode) -> bool {
    match option {
        OptionNode::String(node) => node.required && !node.hidden,
        OptionNode::Content(node) => node.required && !node.hidden && !node.stdin,
        _ => false,
    }
}

/// How the action form names one required option, with `...` for a multiple option.
pub(crate) fn option_form(
    option: &OptionNode,
    help: &OptionHelp,
    writer: &dyn UsageStyle,
) -> String {
    let Some(valued) = value_option(option) else {
        return String::new();
    };
    let long = long_spelling(option);
    let spelling = long.as_deref().or(valued.short).unwrap_or("");
    let placeholder = help.placeholder.as_deref().unwrap_or(valued.name);
    let parts = value_parts(valued.implied.is_some(), long.is_some(), placeholder);
    let ellipsis = if valued.multiple { "..." } else { "" };
    format!(
        "{}{}{}",
        writer.spelling(spelling),
        parts.separator,
        writer.word(&format!("{}{ellipsis}", parts.text()))
    )
}

/// How the action form names one argument: required or optional, and variadic or scalar. A content
/// argument that accepts stdin is optional in the form, because piped stdin can satisfy it.
pub(crate) fn argument_form(argument: &ArgumentNode, writer: &dyn UsageStyle) -> String {
    let name = if argument.variadic {
        format!("{}...", argument.name)
    } else {
        argument.name.clone()
    };
    let required =
        argument.required || argument.required_when == Some(RequiredWhen::NonInteractive);
    let stdin = argument.stdin == Some(true);
    writer.word(&if required && !stdin {
        format!("<{name}>")
    } else {
        format!("[{name}]")
    })
}

/// The tone a fact prints in.
#[derive(Clone, Copy)]
pub(super) enum Tone {
    Dim,
    Warning,
}

/// One fact of a row's parenthesis. A fact with `names` prints its `text` as a label, then each
/// name, then, with a `delimiter`, the words that name it; on a terminal wrapping keeps each name
/// and the delimiter whole.
pub(crate) struct Fact {
    text: String,
    tone: Tone,
    names: Option<Vec<String>>,
    delimiter: Option<String>,
}

#[cfg(feature = "manpage")]
impl Fact {
    /// The fact's text, which a binding fact prints before its names.
    pub(crate) fn text(&self) -> &str {
        &self.text
    }
}

/// A fact help prints dim.
fn dim_fact(text: impl Into<String>) -> Fact {
    Fact {
        text: text.into(),
        tone: Tone::Dim,
        names: None,
        delimiter: None,
    }
}

/// A dim fact that prints a label, then names help keeps whole, then a list's delimiter.
fn binding_fact(label: &str, names: Vec<String>, delimiter: Option<String>) -> Fact {
    Fact {
        text: label.to_owned(),
        tone: Tone::Dim,
        names: Some(names),
        delimiter,
    }
}

/// How one declared default prints: a string as it is, a list of strings separated by a space,
/// and any other value as JSON renders it, each line terminator printed as its JSON escape.
fn render_default(value: &Value) -> String {
    match value {
        Value::String(text) => one_line(text),
        Value::Array(items) if items.iter().all(Value::is_string) => one_line(
            &items
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" "),
        ),
        other => one_line(&other.to_string()),
    }
}

/// The fact one declared default contributes.
fn default_facts(declared: Option<&loomcli_core::DeclaredDefault>) -> Vec<Fact> {
    declared
        .map(|declared| dim_fact(format!("default: {}", render_default(&declared.value))))
        .into_iter()
        .collect()
}

/// The fact an implied value contributes, which prints and escapes as a string default does.
fn implied_facts(implied: Option<&str>) -> Vec<Fact> {
    implied
        .map(|implied| dim_fact(format!("implied: {}", one_line(implied))))
        .into_iter()
        .collect()
}

/// The noun of a source count.
fn sources(count: usize) -> &'static str {
    if count == 1 { "source" } else { "sources" }
}

/// A content input's source routing and count bounds.
fn content_facts(
    stdin: bool,
    collected: bool,
    min: Option<usize>,
    max: Option<usize>,
) -> Vec<Fact> {
    let routing = if !stdin {
        "file path"
    } else if collected {
        "files and piped stdin; - places stdin"
    } else {
        "file or piped stdin; - selects stdin"
    };
    let mut facts = vec![dim_fact(routing)];
    if let Some(min) = min {
        facts.push(dim_fact(format!("min: {min} {}", sources(min))));
    }
    if let Some(max) = max {
        facts.push(dim_fact(format!("max: {max} {}", sources(max))));
    }
    facts
}

/// The facts of an option that takes a value.
struct ValueFacts<'a> {
    content: Vec<Fact>,
    required: bool,
    required_when: Option<RequiredWhen>,
    multiple: bool,
    default: Option<&'a loomcli_core::DeclaredDefault>,
    implied: Option<&'a str>,
}

fn value_facts(facts: ValueFacts<'_>) -> Vec<Fact> {
    let mut list = facts.content;
    if facts.required {
        list.push(dim_fact("required"));
    }
    if facts.required_when == Some(RequiredWhen::NonInteractive) {
        list.push(dim_fact("required when not interactive"));
    }
    if facts.multiple {
        list.push(dim_fact("repeatable"));
    }
    list.extend(default_facts(facts.default));
    list.extend(implied_facts(facts.implied));
    list
}

/// The facts one option's kind contributes ahead of its bindings and its deprecation. A counted
/// option's `...` already says it repeats, and a count has no presence rule or default.
fn kind_facts(option: &OptionNode) -> Vec<Fact> {
    match option {
        OptionNode::String(node) => value_facts(ValueFacts {
            content: Vec::new(),
            required: node.required,
            required_when: node.required_when,
            multiple: node.multiple,
            default: node.default.as_ref(),
            implied: node.implied.as_deref(),
        }),
        OptionNode::Content(node) => value_facts(ValueFacts {
            content: content_facts(node.stdin, node.multiple, node.min, node.max),
            required: node.required,
            required_when: node.required_when,
            multiple: node.multiple,
            default: node.default.as_ref(),
            implied: node.implied.as_deref(),
        }),
        // A negative polarity means the absent value is `true`.
        OptionNode::Boolean(node) if node.polarity == Polarity::Negative => {
            vec![dim_fact("default: true")]
        }
        _ => Vec::new(),
    }
}

/// The fact a deprecated member contributes: its migration message, on one line, always last.
pub(crate) fn deprecated_facts(deprecated: Option<&str>) -> Vec<Fact> {
    deprecated
        .map(|message| Fact {
            text: format!("deprecated: {}", single_line(message)),
            tone: Tone::Warning,
            names: None,
            delimiter: None,
        })
        .into_iter()
        .collect()
}

/// The delimiter a multiple option's variable is a list under, as a JSON string literal.
pub(crate) fn delimiter_literal(option: &OptionNode) -> Option<String> {
    let delimiter = match option {
        OptionNode::String(node) => node.env_delimiter.as_deref(),
        OptionNode::Content(node) => node.env_delimiter.as_deref(),
        _ => None,
    }?;
    serde_json::to_string(delimiter).ok()
}

/// The names the option's bindings contribute: its variables as `env`, with a multiple option's
/// delimiter after them, then its configuration path as `config`. Names alone, never a value.
fn binding_facts(option: &OptionNode, help: &OptionHelp) -> Vec<Fact> {
    if help.hide_bindings {
        return Vec::new();
    }
    let env = match option {
        OptionNode::String(node) => &node.env,
        OptionNode::Content(node) => &node.env,
        OptionNode::Boolean(node) => &node.env,
        OptionNode::Count(node) => &node.env,
        _ => return Vec::new(),
    };
    let mut facts = Vec::new();
    if !env.is_empty() {
        facts.push(binding_fact("env:", env.clone(), delimiter_literal(option)));
    }
    if let Some(path) = &help.config_path {
        facts.push(binding_fact("config:", vec![path.clone()], None));
    }
    facts
}

/// The facts of one option row that are not its bindings: what its kind contributes, then its
/// deprecation. A renderer that prints the bindings on lines of their own lists these.
#[cfg(feature = "manpage")]
pub(crate) fn unbound_option_facts(option: &OptionNode) -> Vec<Fact> {
    let mut facts = kind_facts(option);
    facts.extend(deprecated_facts(option.deprecated()));
    facts
}

/// The facts a help page prints for one option row, in the order the right-cell rule names them.
pub(super) fn option_facts(option: &OptionNode, help: &OptionHelp) -> Vec<Fact> {
    let mut facts = kind_facts(option);
    facts.extend(binding_facts(option, help));
    facts.extend(deprecated_facts(option.deprecated()));
    facts
}

/// An argument's facts. Its presence and arity are read from the usage line instead.
pub(crate) fn argument_facts(argument: &ArgumentNode) -> Vec<Fact> {
    let mut facts = if argument.kind == Some(ContentType::Content) {
        content_facts(
            argument.stdin == Some(true),
            argument.variadic,
            argument.min,
            argument.max,
        )
    } else {
        Vec::new()
    };
    if argument.required_when == Some(RequiredWhen::NonInteractive) {
        facts.push(dim_fact("required when not interactive"));
    }
    facts.extend(default_facts(argument.default.as_ref()));
    facts
}

/// One fact as help styles it. The names of a binding fact and its delimiter sit in `nowrap` on a
/// terminal, so the wrap breaks between them and never inside one.
fn styled_fact(fact: &Fact, context: &ViewContext) -> String {
    let style = &context.style;
    let tone = match fact.tone {
        Tone::Dim => style.dim(),
        Tone::Warning => style.warning(),
    };
    let Some(names) = &fact.names else {
        return tone.apply(&style.escape(&fact.text));
    };
    let whole = |unit: &str| {
        let styled = tone.apply(&style.escape(unit));
        if on_terminal(context) {
            nowrap(&styled)
        } else {
            styled
        }
    };
    let list = fact
        .delimiter
        .as_deref()
        .map_or_else(String::new, |delimiter| {
            format!(
                "{}{}",
                tone.apply(" as a list separated by "),
                whole(delimiter)
            )
        });
    let joined: Vec<String> = names.iter().map(|name| whole(name)).collect();
    format!(
        "{}{}{list}",
        tone.apply(&style.escape(&format!("{} ", fact.text))),
        joined.join(&tone.apply(" "))
    )
}

/// The right cell of one row: the description on one line, then the accepted-values sentence,
/// then the facts that apply in one parenthesis. One space separates the description from the
/// sentence and two spaces separate the text from the parenthesis; a member with no text has the
/// parenthesis as its whole cell, and a member with none of the three has no right cell at all.
pub(super) fn right_cell(
    description: Option<&str>,
    accepts: Option<&str>,
    facts: &[Fact],
    context: &ViewContext,
) -> String {
    let style = &context.style;
    let parenthesis = if facts.is_empty() {
        String::new()
    } else {
        let listed: Vec<String> = facts
            .iter()
            .map(|fact| styled_fact(fact, context))
            .collect();
        format!(
            "{}{}{}",
            style.dim().apply("("),
            listed.join(&format!("{} ", style.dim().apply(","))),
            style.dim().apply(")")
        )
    };
    let written: Vec<String> = [description.map(single_line), accepts.map(str::to_owned)]
        .into_iter()
        .flatten()
        .map(|part| style.primary().apply(&style.escape(&part)))
        .collect();
    if written.is_empty() {
        return parenthesis;
    }
    let joined = written.join(" ");
    if parenthesis.is_empty() {
        joined
    } else {
        format!("{joined}{GUTTER}{parenthesis}")
    }
}

/// Whether a row set stacks: its indent, its left column, and its floor, the widest unit `wrap`
/// keeps whole in any of its right cells, together exceed the columns.
fn stacks(indent: &str, left_width: usize, rows: &[Row], context: &ViewContext) -> bool {
    let floor = rows
        .iter()
        .map(|row| unit_width(&row.right, context))
        .max()
        .unwrap_or(0);
    let columns = super::layout::columns(context).unwrap_or(0);
    signed(context.width(indent)) + signed(left_width) + floor > columns
}

/// Two columns, each right cell wrapped under the right column.
fn wrapped_rows(
    indent: &str,
    left_width: usize,
    rows: &[Row],
    context: &ViewContext,
) -> Vec<String> {
    rows.iter()
        .flat_map(|row| {
            if row.right.is_empty() {
                vec![format!("{indent}{}", row.left)]
            } else {
                let lead = format!("{indent}{}", padded(&row.left, left_width, Alignment::Left));
                hanging(&row.right, None, &lead, context)
            }
        })
        .collect()
}

/// The columns of spaces before a left cell's text, such as the four that align a long-only
/// option's spelling under the long spellings.
fn leading_spaces(left: &str, context: &ViewContext) -> usize {
    let text = context.plain(left);
    let trimmed = text.trim_start_matches(|character: char| {
        (character.is_whitespace() && character != '\u{85}') || character == '\u{feff}'
    });
    context.width(&text).saturating_sub(context.width(trimmed))
}

/// Each left cell alone at the set's indent, its right cell on the lines below, four columns past
/// the furthest-in start of a left cell's text in the set.
fn stacked_rows(indent: &str, rows: &[Row], context: &ViewContext) -> Vec<String> {
    let furthest = rows
        .iter()
        .map(|row| leading_spaces(&row.left, context))
        .max()
        .unwrap_or(0);
    let lead = format!("{indent}{}{STACKED_INDENT}", spaces(signed(furthest)));
    rows.iter()
        .flat_map(|row| {
            let mut lines = vec![format!("{indent}{}", row.left)];
            if !row.right.is_empty() {
                lines.extend(hanging(&row.right, None, &lead, context));
            }
            lines
        })
        .collect()
}

/// One row set's lines at `indent`. The left cell is padded to the longest one in the set plus two
/// spaces, and a row with no right cell has no trailing padding. Off a terminal nothing wraps. On
/// a terminal each right cell's tabs expand once and it wraps under the right column, and a set
/// whose indent, left column, and floor exceed the columns stacks.
pub(super) fn column(rows: &[Row], context: &ViewContext, indent: &str) -> Vec<String> {
    let left_width = rows
        .iter()
        .map(|row| context.width(&row.left))
        .max()
        .unwrap_or(0)
        + GUTTER.len();
    if !on_terminal(context) {
        return rows
            .iter()
            .map(|row| {
                if row.right.is_empty() {
                    format!("{indent}{}", row.left)
                } else {
                    format!(
                        "{indent}{}{}",
                        padded(&row.left, left_width, Alignment::Left),
                        row.right
                    )
                }
            })
            .collect();
    }
    let rows: Vec<Row> = rows
        .iter()
        .map(|row| Row {
            left: row.left.clone(),
            right: context.expand_tabs(&row.right),
        })
        .collect();
    if stacks(indent, left_width, &rows, context) {
        stacked_rows(indent, &rows, context)
    } else {
        wrapped_rows(indent, left_width, &rows, context)
    }
}
