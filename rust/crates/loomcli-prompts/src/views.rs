//! The prompts' declared views, which an application overrides to restyle its questions and
//! progress lines, and the data each one draws.

use std::sync::Arc;

use loomcli_core::{
    DeclaredView, Glyph, View, ViewContext, escape, escape_control_characters, view,
};

use crate::line::graphemes;

/// The kind of a question, which its frame and its answered line carry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum QuestionKind {
    /// A line of text.
    Text,
    /// A secret, never echoed.
    Secret,
    /// Yes or no.
    Confirm,
    /// One of a list.
    Select,
    /// Any of a list.
    Multiselect,
    /// Text written in the operator's editor.
    Editor,
}

/// The frame of a text, secret, or confirm question: a typed line.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct TypedFrame {
    /// [`QuestionKind::Text`], [`QuestionKind::Secret`], or [`QuestionKind::Confirm`].
    pub kind: QuestionKind,
    /// The question's message, a marked string of one line.
    pub message: String,
    /// The issue the last answer met.
    pub issue: Option<String>,
    /// The text typed so far; always empty for a secret.
    pub typed: String,
    /// The cursor, a grapheme index into `typed`; `None` is the end of `typed`.
    pub cursor: Option<usize>,
    /// The question hint for text, and the legend, such as `[Y/n]`, for confirm.
    pub hint: Option<String>,
}

impl TypedFrame {
    /// A frame of `kind` with `message` and the line `typed`, the cursor at its end.
    #[must_use]
    pub fn new(kind: QuestionKind, message: impl Into<String>, typed: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            issue: None,
            typed: typed.into(),
            cursor: None,
            hint: None,
        }
    }

    /// Sets the cursor.
    #[must_use]
    pub fn cursor(mut self, cursor: usize) -> Self {
        self.cursor = Some(cursor);
        self
    }

    /// Sets the hint or the legend.
    #[must_use]
    pub fn hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    /// Sets the issue.
    #[must_use]
    pub fn issue(mut self, issue: impl Into<String>) -> Self {
        self.issue = Some(issue.into());
        self
    }
}

/// The frame of an editor question: no typed line, because the editor holds the text.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct EditorFrame {
    /// The question's message.
    pub message: String,
    /// The issue the last answer met.
    pub issue: Option<String>,
    /// Whether the editor is open.
    pub editing: bool,
}

impl EditorFrame {
    /// A frame with `message`, the editor open or not.
    #[must_use]
    pub fn new(message: impl Into<String>, editing: bool) -> Self {
        Self {
            message: message.into(),
            issue: None,
            editing,
        }
    }

    /// Sets the issue.
    #[must_use]
    pub fn issue(mut self, issue: impl Into<String>) -> Self {
        self.issue = Some(issue.into());
        self
    }
}

/// One choice's row in a list frame.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct ChoiceRow {
    /// The label, plain text.
    pub label: String,
    /// The description drawn under the list while the choice is highlighted, plain text.
    pub description: Option<String>,
    /// The choice's own disabled state; false for a choice `max` keeps out.
    pub disabled: bool,
    /// A disabled choice's reason, when it has one.
    pub reason: Option<String>,
    /// Whether the choice is in a multiselect's selection; false at a select.
    pub selected: bool,
}

impl ChoiceRow {
    /// A row with `label`, enabled and not selected.
    #[must_use]
    pub fn new(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            description: None,
            disabled: false,
            reason: None,
            selected: false,
        }
    }

    /// Sets the description.
    #[must_use]
    pub fn description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Disables the row, with `reason` when it is not empty.
    #[must_use]
    pub fn disabled(mut self, reason: impl Into<String>) -> Self {
        let reason = reason.into();
        self.disabled = true;
        self.reason = (!reason.is_empty()).then_some(reason);
        self
    }

    /// Marks the row selected.
    #[must_use]
    pub fn selected(mut self) -> Self {
        self.selected = true;
        self
    }
}

/// One row of a list frame: a choice, or a separator.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub enum ListRow {
    /// A choice.
    Choice(ChoiceRow),
    /// A separator with its text, plain; an empty one draws an empty row.
    Separator(String),
}

impl From<ChoiceRow> for ListRow {
    fn from(row: ChoiceRow) -> Self {
        ListRow::Choice(row)
    }
}

/// Which list question a list frame draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum ListKind {
    /// A select.
    Select,
    /// A multiselect, with its selection's size and its bounds.
    Multiselect {
        /// Choices in the selection, shown or not.
        count: usize,
        /// The fewest choices Enter submits.
        min: usize,
        /// The most choices the operator can select.
        max: Option<usize>,
    },
}

/// The frame a select or multiselect draws.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct ListFrame {
    /// Select or multiselect.
    pub kind: ListKind,
    /// The question's message.
    pub message: String,
    /// The issue, from `min`, an empty search, the linked input's validator, or a supplied value
    /// that selects nothing.
    pub issue: Option<String>,
    /// The rows the window shows.
    pub choices: Vec<ListRow>,
    /// An index into `choices`; `None` when no row is highlighted.
    pub highlighted: Option<usize>,
    /// Rows hidden above the window.
    pub above: usize,
    /// Rows hidden below the window.
    pub below: usize,
    /// Stderr's rows.
    pub rows: Option<u16>,
    /// The search term; `None` when the question does not search.
    pub term: Option<String>,
    /// The term's cursor; `None` is the end of the term.
    pub cursor: Option<usize>,
    /// Whether a source call has not settled.
    pub loading: bool,
}

impl ListFrame {
    /// A frame of `kind` with `message` and its visible rows, nothing highlighted.
    #[must_use]
    pub fn new(kind: ListKind, message: impl Into<String>, choices: Vec<ListRow>) -> Self {
        Self {
            kind,
            message: message.into(),
            issue: None,
            choices,
            highlighted: None,
            above: 0,
            below: 0,
            rows: None,
            term: None,
            cursor: None,
            loading: false,
        }
    }

    /// Highlights the row at `index`.
    #[must_use]
    pub fn highlighted(mut self, index: usize) -> Self {
        self.highlighted = Some(index);
        self
    }

    /// Sets the rows hidden above and below the window.
    #[must_use]
    pub fn hidden(mut self, above: usize, below: usize) -> Self {
        self.above = above;
        self.below = below;
        self
    }

    /// Sets stderr's rows.
    #[must_use]
    pub fn rows(mut self, rows: u16) -> Self {
        self.rows = Some(rows);
        self
    }

    /// Sets the search term.
    #[must_use]
    pub fn term(mut self, term: impl Into<String>) -> Self {
        self.term = Some(term.into());
        self
    }

    /// Sets the term's cursor.
    #[must_use]
    pub fn cursor(mut self, cursor: usize) -> Self {
        self.cursor = Some(cursor);
        self
    }

    /// Marks a source call unsettled.
    #[must_use]
    pub fn loading(mut self) -> Self {
        self.loading = true;
        self
    }

    /// Sets the issue.
    #[must_use]
    pub fn issue(mut self, issue: impl Into<String>) -> Self {
        self.issue = Some(issue.into());
        self
    }
}

/// The data a question's frame renders.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub enum QuestionFrame {
    /// Text, secret, or confirm.
    Typed(TypedFrame),
    /// Editor.
    Editor(EditorFrame),
    /// Select or multiselect.
    List(ListFrame),
}

impl QuestionFrame {
    /// The question's kind.
    #[must_use]
    pub fn kind(&self) -> QuestionKind {
        match self {
            QuestionFrame::Typed(frame) => frame.kind,
            QuestionFrame::Editor(_) => QuestionKind::Editor,
            QuestionFrame::List(frame) => match frame.kind {
                ListKind::Select => QuestionKind::Select,
                ListKind::Multiselect { .. } => QuestionKind::Multiselect,
            },
        }
    }
}

impl From<TypedFrame> for QuestionFrame {
    fn from(frame: TypedFrame) -> Self {
        QuestionFrame::Typed(frame)
    }
}

impl From<EditorFrame> for QuestionFrame {
    fn from(frame: EditorFrame) -> Self {
        QuestionFrame::Editor(frame)
    }
}

impl From<ListFrame> for QuestionFrame {
    fn from(frame: ListFrame) -> Self {
        QuestionFrame::List(frame)
    }
}

/// The line an answered question leaves.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct AnsweredLine {
    /// The question's message.
    pub message: String,
    /// The answer as a display string; `None` for a secret.
    pub answer: Option<String>,
    /// The question's kind; `None` reads as a typed answer.
    pub kind: Option<QuestionKind>,
    /// An editor answer's line count.
    pub lines: Option<usize>,
}

impl AnsweredLine {
    /// The line of `message` answered with `answer`, `None` for a secret.
    #[must_use]
    pub fn new(message: impl Into<String>, answer: Option<String>) -> Self {
        Self {
            message: message.into(),
            answer,
            kind: None,
            lines: None,
        }
    }

    /// Sets the question's kind.
    #[must_use]
    pub fn kind(mut self, kind: QuestionKind) -> Self {
        self.kind = Some(kind);
        self
    }

    /// Sets an editor answer's line count.
    #[must_use]
    pub fn lines(mut self, lines: usize) -> Self {
        self.lines = Some(lines);
        self
    }
}

/// The line a cancelled question leaves.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct CancelledLine {
    /// The question's message.
    pub message: String,
}

impl CancelledLine {
    /// The cancelled line of `message`.
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

/// A progress line's state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProgressState {
    /// The work runs.
    Running,
    /// The line ended.
    Ended,
    /// The line failed.
    Failed,
    /// The run was cancelled.
    Cancelled,
}

/// A progress bar's two cells.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[non_exhaustive]
pub struct BarCells {
    /// A complete cell.
    pub complete: String,
    /// An incomplete cell.
    pub incomplete: String,
}

impl BarCells {
    /// A bar of these cells.
    #[must_use]
    pub fn new(complete: impl Into<String>, incomplete: impl Into<String>) -> Self {
        Self {
            complete: complete.into(),
            incomplete: incomplete.into(),
        }
    }
}

/// What one progress line's view draws.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct ProgressLine {
    /// The state.
    pub state: ProgressState,
    /// The label while the line runs, and the end message once it has ended or failed.
    pub label: String,
    /// How much is done.
    pub completed: Option<f64>,
    /// The total.
    pub total: Option<f64>,
    /// The spinner's current frame.
    pub frame: String,
    /// The bar's cells.
    pub bar: BarCells,
    /// Milliseconds since `progress()` opened the line.
    pub elapsed: u64,
}

impl ProgressLine {
    /// A line in `state` with `label`.
    #[must_use]
    pub fn new(state: ProgressState, label: impl Into<String>) -> Self {
        Self {
            state,
            label: label.into(),
            completed: None,
            total: None,
            frame: String::new(),
            bar: BarCells::new("▰", "▱"),
            elapsed: 0,
        }
    }

    /// Sets the counts.
    #[must_use]
    pub fn counts(mut self, completed: Option<f64>, total: Option<f64>) -> Self {
        self.completed = completed;
        self.total = total;
        self
    }

    /// Sets the spinner frame.
    #[must_use]
    pub fn frame(mut self, frame: impl Into<String>) -> Self {
        self.frame = frame.into();
        self
    }

    /// Sets the bar's cells.
    #[must_use]
    pub fn bar(mut self, bar: BarCells) -> Self {
        self.bar = bar;
        self
    }

    /// Sets the elapsed milliseconds.
    #[must_use]
    pub fn elapsed(mut self, elapsed: u64) -> Self {
        self.elapsed = elapsed;
        self
    }
}

/// `@loomcli/prompts/question-frame`.
pub fn question_frame() -> DeclaredView<QuestionFrame> {
    view(
        "@loomcli/prompts/question-frame",
        View::new(|data: &QuestionFrame, context: &ViewContext| render_question(data, context)),
    )
}

/// `@loomcli/prompts/answered-line`.
pub fn answered_line() -> DeclaredView<AnsweredLine> {
    view(
        "@loomcli/prompts/answered-line",
        View::new(|data: &AnsweredLine, context: &ViewContext| render_answered(data, context)),
    )
}

/// `@loomcli/prompts/cancelled-line`.
pub fn cancelled_line() -> DeclaredView<CancelledLine> {
    view(
        "@loomcli/prompts/cancelled-line",
        View::new(|data: &CancelledLine, context: &ViewContext| {
            format!(
                "{}\n",
                context
                    .style
                    .dim()
                    .apply(&format!("? {} · cancelled", data.message))
            )
        }),
    )
}

/// `@loomcli/prompts/progress`.
pub fn progress_line() -> DeclaredView<ProgressLine> {
    view(
        "@loomcli/prompts/progress",
        View::new(|data: &ProgressLine, context: &ViewContext| render_progress(data, context)),
    )
}

/// Operator values stay literal: control characters as their escapes, Loom's delimiters escaped.
fn literal(text: &str) -> String {
    escape(&escape_control_characters(text))
}

fn glyph(glyph: Glyph) -> String {
    glyph.to_string()
}

/// `text` clipped to `columns`: its leading graphemes, the ellipsis, and its trailing graphemes,
/// measured in the escaped form it draws.
fn clipped(text: &str, columns: usize, context: &ViewContext) -> String {
    let plain = context.plain(text);
    if context.width(&literal(&plain)) <= columns {
        return literal(&plain);
    }
    let ellipsis = context.plain(&glyph(Glyph::Ellipsis));
    let budget = columns.saturating_sub(context.width(&literal(&ellipsis)));
    let segments = graphemes(&plain);
    let mut prefix = String::new();
    for segment in &segments {
        if context.width(&literal(&format!("{prefix}{segment}"))) > budget / 2 {
            break;
        }
        prefix.push_str(segment);
    }
    let mut suffix = String::new();
    let room = budget.saturating_sub(context.width(&literal(&prefix)));
    for segment in segments.iter().rev() {
        if context.width(&literal(&format!("{segment}{suffix}"))) > room {
            break;
        }
        suffix = format!("{segment}{suffix}");
    }
    literal(&format!("{prefix}{ellipsis}{suffix}"))
}

fn render_question(data: &QuestionFrame, context: &ViewContext) -> String {
    let style = &context.style;
    let title = format!(
        "{} {}",
        style.info().bold().apply("?"),
        style.bold().apply(&message_of(data))
    );
    let issue_of = |issue: &Option<String>| {
        issue.as_ref().map_or_else(String::new, |issue| {
            format!(
                "\n  {}",
                style
                    .error()
                    .apply(&format!("{} {}", glyph(Glyph::Cross), literal(issue)))
            )
        })
    };
    match data {
        QuestionFrame::List(list) => select_text(list, context, &title),
        QuestionFrame::Editor(editor) => {
            let hint = if editor.editing {
                format!(
                    "Waiting for your editor to close the file{}",
                    context.plain(&glyph(Glyph::Ellipsis))
                )
            } else {
                "Press Enter to open your editor".to_owned()
            };
            let frame = TypedFrame::new(QuestionKind::Text, editor.message.clone(), "").hint(hint);
            typed_frame(&frame, true, context) + &issue_of(&editor.issue)
        }
        QuestionFrame::Typed(typed) => typed_frame(typed, false, context) + &issue_of(&typed.issue),
    }
}

fn message_of(data: &QuestionFrame) -> String {
    match data {
        QuestionFrame::Typed(frame) => frame.message.clone(),
        QuestionFrame::Editor(frame) => frame.message.clone(),
        QuestionFrame::List(frame) => frame.message.clone(),
    }
}

fn list_help(data: &ListFrame, short: bool) -> String {
    if data.loading {
        return format!("Searching{}", glyph(Glyph::Ellipsis));
    }
    match data.kind {
        ListKind::Select => {
            if short {
                "↑↓ Enter".to_owned()
            } else if data.term.is_none() {
                "↑↓ move · Enter select".to_owned()
            } else {
                "↑↓ move · type to search · Enter select".to_owned()
            }
        }
        ListKind::Multiselect { count, max, .. } => {
            let key = if data.term.is_none() { "Space" } else { "Tab" };
            let count = max.map_or_else(|| count.to_string(), |max| format!("{count}/{max}"));
            let keys = if short {
                format!("↑↓ {key} Enter")
            } else {
                format!("↑↓ move · {key} toggle · Enter submit")
            };
            format!("{keys} · {count} selected")
        }
    }
}

/// Whether a multiselect's selection has reached its `max`.
fn at_max(data: &ListFrame) -> bool {
    matches!(data.kind, ListKind::Multiselect { count, max: Some(max), .. } if count >= max)
}

fn list_row(data: &ListFrame, row: &ListRow, highlighted: bool, context: &ViewContext) -> String {
    let style = &context.style;
    let row = match row {
        ListRow::Separator(label) => {
            return if label.is_empty() {
                String::new()
            } else {
                style.dim().apply(&format!("  {}", literal(label)))
            };
        }
        ListRow::Choice(row) => row,
    };
    let pointer = if highlighted {
        format!("{} ", glyph(Glyph::Pointer))
    } else {
        "  ".to_owned()
    };
    let mark = match data.kind {
        ListKind::Select => String::new(),
        ListKind::Multiselect { .. } => format!(
            "{} ",
            if row.selected {
                style.highlight().apply(&glyph(Glyph::CircleFilled))
            } else {
                style.dim().apply(&glyph(Glyph::Circle))
            }
        ),
    };
    let mut label = literal(&row.label);
    if row.disabled {
        label.push_str(&format!(
            " ({})",
            literal(row.reason.as_deref().unwrap_or("disabled"))
        ));
    }
    if row.disabled {
        return style.dim().apply(&format!("{pointer}{mark}{label}"));
    }
    if at_max(data) && !row.selected {
        let pointer = if highlighted {
            style.highlight().apply(&pointer)
        } else {
            pointer
        };
        return pointer + &style.dim().apply(&format!("{mark}{label}"));
    }
    if highlighted {
        style.highlight().apply(&format!("{pointer}{mark}{label}"))
    } else {
        format!("{pointer}{mark}{label}")
    }
}

/// The compact frame's highlighted row, clipped, with its styles restored.
fn compact_choice(
    data: &ListFrame,
    selected: &str,
    columns: usize,
    context: &ViewContext,
) -> String {
    let style = &context.style;
    let drawn = clipped(selected, columns, context);
    let active = data.highlighted.and_then(|index| data.choices.get(index));
    let Some(ListRow::Choice(active)) = active else {
        return style.dim().apply(&drawn);
    };
    if matches!(data.kind, ListKind::Multiselect { .. }) && !active.selected {
        if at_max(data) {
            let pointer = context.plain(&glyph(Glyph::Pointer));
            return match drawn.strip_prefix(&pointer) {
                Some(rest) => style.highlight().apply(&pointer) + &style.dim().apply(rest),
                None => style.highlight().apply(&drawn),
            };
        }
        let circle = context.plain(&glyph(Glyph::Circle));
        return style.highlight().apply(&drawn.replacen(
            &circle,
            &style.dim().apply(&glyph(Glyph::Circle)),
            1,
        ));
    }
    style.highlight().apply(&drawn)
}

/// The compact frame's key help with the markers that joined it, abbreviated when `columns` is
/// narrower than the whole.
fn key_help(data: &ListFrame, joined: &[String], columns: usize, context: &ViewContext) -> String {
    let mut whole = vec![list_help(data, false)];
    whole.extend(joined.iter().cloned());
    let whole = whole.join(" · ");
    if context.width(&whole) <= columns {
        return whole;
    }
    let mut short = vec![list_help(data, true)];
    short.extend(joined.iter().cloned());
    short.join(" · ")
}

/// One part of a shared row.
struct RowPart<'a> {
    width: usize,
    short: Option<usize>,
    draw: Box<dyn Fn(usize) -> String + 'a>,
    /// Parts drop highest first; 0 never drops.
    drop: u8,
}

/// The columns each part gets from `budget`.
fn shares(widths: &[usize], budget: usize) -> Vec<usize> {
    let mut result = vec![0; widths.len()];
    let mut open: Vec<usize> = (0..widths.len()).collect();
    let mut remaining = budget;
    while !open.is_empty() {
        let even = remaining / open.len();
        let narrow: Vec<usize> = open
            .iter()
            .copied()
            .filter(|index| widths[*index] <= even)
            .collect();
        if narrow.is_empty() {
            let mut extra = remaining - even * open.len();
            for index in &open {
                result[*index] = even + usize::from(extra > 0);
                extra = extra.saturating_sub(1);
            }
            break;
        }
        for index in &narrow {
            result[*index] = widths[*index];
            remaining -= widths[*index];
        }
        open.retain(|index| !narrow.contains(index));
    }
    result
}

/// Parts that share one row, joined by ` · `, each whole when they fit and clipped when not.
fn shared(parts: Vec<Option<RowPart<'_>>>, columns: usize, context: &ViewContext) -> String {
    let mut present: Vec<RowPart<'_>> = parts.into_iter().flatten().collect();
    while present.len() > 1
        && (columns as isize - 3 * (present.len() as isize - 1)) < present.len() as isize
    {
        let highest = present.iter().map(|part| part.drop).max().unwrap_or(0);
        present.retain(|part| part.drop != highest);
    }
    let budget = columns.saturating_sub(3 * (present.len().saturating_sub(1)));
    let whole = present.iter().map(|part| part.width).sum::<usize>() <= budget;
    let widths: Vec<usize> = present
        .iter()
        .map(|part| {
            if whole {
                part.width
            } else {
                part.short.unwrap_or(part.width)
            }
        })
        .collect();
    let given = shares(&widths, budget);
    let separator = format!(" {} ", context.style.dim().apply("·"));
    present
        .iter()
        .zip(given)
        .map(|(part, given)| (part.draw)(given.max(1)))
        .collect::<Vec<_>>()
        .join(&separator)
}

/// The rows `text` takes at `columns` less one, one a line when the width is unknown.
fn height(text: &str, context: &ViewContext, columns: usize) -> usize {
    text.split('\n')
        .map(|line| match context.columns {
            None => 1,
            Some(_) => {
                let per = columns.saturating_sub(1).max(1);
                context.width(line).div_ceil(per).max(1)
            }
        })
        .sum()
}

#[allow(clippy::too_many_lines)]
fn select_text(data: &ListFrame, context: &ViewContext, title: &str) -> String {
    let style = &context.style;
    let columns = usize::from(context.columns.unwrap_or(80)).max(1);
    let rows = data
        .rows
        .map_or(usize::MAX, |rows| usize::from(rows).max(1));
    let searching = data.term.is_some();
    let first_line = if searching {
        let mut frame = TypedFrame::new(
            QuestionKind::Text,
            data.message.clone(),
            data.term.clone().unwrap_or_default(),
        );
        frame.cursor = data.cursor;
        typed_frame(&frame, false, context)
    } else {
        title.to_owned()
    };
    let issue = data.issue.as_ref().map(|issue| {
        style
            .error()
            .apply(&format!("  {} {}", glyph(Glyph::Cross), literal(issue)))
    });
    let active = data.highlighted.and_then(|index| data.choices.get(index));
    let render = |start: usize, end: usize| {
        let description = match active {
            Some(ListRow::Choice(row)) => row.description.clone(),
            _ => None,
        };
        let mut lines = vec![first_line.clone()];
        if data.above + start > 0 {
            lines.push(style.dim().apply(&format!("↑ {} more", data.above + start)));
        }
        for (index, row) in data.choices[start..end].iter().enumerate() {
            lines.push(list_row(
                data,
                row,
                Some(index + start) == data.highlighted,
                context,
            ));
        }
        if data.choices.is_empty() && !data.loading {
            lines.push(style.dim().apply("  No matches"));
        }
        let below = data.below + data.choices.len() - end;
        if below > 0 {
            lines.push(style.dim().apply(&format!("↓ {below} more")));
        }
        if let Some(description) = description
            && columns > 2
        {
            lines.push(style.dim().apply(&format!(
                "  {}",
                clipped(&literal(&description), columns - 2, context)
            )));
        }
        lines.push(style.dim().apply(&list_help(data, false)));
        if let Some(issue) = &issue {
            lines.push(issue.clone());
        }
        lines.join("\n")
    };
    let mut start = 0;
    let mut end = data.choices.len();
    let mut frame = render(start, end);
    while end - start > 1 && height(&frame, context, columns) > rows {
        match data.highlighted {
            Some(highlighted)
                if highlighted as isize - start as isize
                    > end as isize - 1 - highlighted as isize =>
            {
                start += 1;
            }
            _ => end -= 1,
        }
        frame = render(start, end);
    }
    if height(&frame, context, columns) <= rows {
        return frame;
    }
    let title_at = |budget: usize| {
        let mut title = style.info().bold().apply("?");
        if budget > 2 {
            title.push(' ');
            title.push_str(
                &style
                    .bold()
                    .apply(&clipped(&data.message, budget - 2, context)),
            );
        }
        title
    };
    let compact_title = if searching {
        first_line.clone()
    } else {
        title_at(columns)
    };
    let selected = if let Some(active) = active {
        Some(list_row(data, active, true, context))
    } else if !data.choices.is_empty() {
        Some("No choice can be selected".to_owned())
    } else if !data.loading {
        Some("No matches".to_owned())
    } else {
        None
    };
    let above = data.above + data.highlighted.unwrap_or(0);
    let below = data.below + data.choices.len()
        - data
            .highlighted
            .map_or(data.choices.len(), |highlighted| highlighted + 1);
    let mut markers = Vec::new();
    if above > 0 {
        markers.push(format!("↑ {above} more"));
    }
    if below > 0 {
        markers.push(format!("↓ {below} more"));
    }
    let mut joined: Vec<String> = Vec::new();
    while !markers.is_empty()
        && 2 + usize::from(selected.is_some()) + markers.len() + usize::from(issue.is_some()) > rows
    {
        if let Some(marker) = markers.pop() {
            joined.insert(0, marker);
        }
    }
    let help = |budget: usize| key_help(data, &joined, budget, context);
    let choice_part = |selected: &Option<String>| {
        selected.clone().map(|selected| {
            let width = context.width(&literal(&context.plain(&selected)));
            RowPart {
                width,
                short: None,
                draw: Box::new(move |budget| compact_choice(data, &selected, budget, context)),
                drop: 1,
            }
        })
    };
    let issue_text = format!(
        "{} {}",
        glyph(Glyph::Cross),
        literal(data.issue.as_deref().unwrap_or_default())
    );
    let footer_part = || {
        if data.issue.is_none() {
            RowPart {
                width: context.width(&help(usize::MAX)),
                short: Some(context.width(&help(0))),
                draw: Box::new(move |budget| {
                    style.dim().apply(&clipped(&help(budget), budget, context))
                }),
                drop: 0,
            }
        } else {
            let text = issue_text.clone();
            RowPart {
                width: context.width(&issue_text),
                short: None,
                draw: Box::new(move |budget| style.error().apply(&clipped(&text, budget, context))),
                drop: 0,
            }
        }
    };
    let issue_row = |issue: &String| style.error().apply(&clipped(issue, columns, context));
    if rows <= 2 {
        if searching {
            if rows == 1 {
                return issue.as_ref().map_or(compact_title, issue_row);
            }
            return format!(
                "{compact_title}\n{}",
                shared(
                    vec![choice_part(&selected), Some(footer_part())],
                    columns,
                    context
                )
            );
        }
        let title_part = || RowPart {
            width: 2 + context.width(&literal(&context.plain(&data.message))),
            short: None,
            draw: Box::new(title_at),
            drop: 2,
        };
        if rows == 1 {
            return shared(
                vec![
                    choice_part(&selected),
                    Some(title_part()),
                    Some(footer_part()),
                ],
                columns,
                context,
            );
        }
        let second = match &issue {
            None => (footer_part().draw)(columns),
            Some(issue) => issue_row(issue),
        };
        return format!(
            "{}\n{second}",
            shared(
                vec![choice_part(&selected), Some(title_part())],
                columns,
                context
            )
        );
    }
    let mut lines = vec![compact_title];
    if let Some(part) = choice_part(&selected) {
        lines.push((part.draw)(columns));
    }
    for marker in &markers {
        lines.push(style.dim().apply(&clipped(marker, columns, context)));
    }
    if !(rows == 3 && issue.is_some()) {
        lines.push(
            style
                .dim()
                .apply(&clipped(&help(columns), columns, context)),
        );
    }
    if let Some(issue) = &issue {
        lines.push(issue_row(issue));
    }
    lines.join("\n")
}

/// One drawn cell of a typed line.
struct Cell {
    drawn: String,
    width: usize,
    start: usize,
    cursor: bool,
}

/// One editable field fitted to `columns`, with a window around the cursor's cell.
fn field(
    text: &str,
    cursor: usize,
    hint: bool,
    columns: usize,
    editor: bool,
    context: &ViewContext,
) -> String {
    let style = &context.style;
    let ellipsis = style.dim().apply(&glyph(Glyph::Ellipsis));
    let mut cells: Vec<(String, usize)> = graphemes(text)
        .into_iter()
        .map(|part| {
            let drawn = literal(part);
            let width = context.width(&drawn);
            (
                if width == 0 {
                    format!("{drawn} ")
                } else {
                    drawn
                },
                width.max(1),
            )
        })
        .collect();
    if (!hint && cursor == cells.len()) || cells.is_empty() {
        cells.push((" ".to_owned(), 1));
    }
    let mut position = 0;
    let placed: Vec<Cell> = cells
        .into_iter()
        .enumerate()
        .map(|(index, (drawn, width))| {
            let start = position;
            position += width;
            Cell {
                drawn,
                width,
                start,
                cursor: index == cursor,
            }
        })
        .collect();
    let fallback = Cell {
        drawn: " ".to_owned(),
        width: 1,
        start: 0,
        cursor: true,
    };
    let active = placed.iter().find(|cell| cell.cursor).unwrap_or(&fallback);
    let paint = |drawn: &str, selected: bool| {
        let value = if hint {
            style.dim().apply(drawn)
        } else {
            drawn.to_owned()
        };
        if selected && !editor {
            style.inverse().apply(&value)
        } else {
            value
        }
    };
    if hint && position > columns {
        let mut result = String::new();
        let mut used = 0;
        for cell in &placed {
            if used + cell.width > columns.saturating_sub(1) {
                break;
            }
            result.push_str(&paint(&cell.drawn, cell.cursor));
            used += cell.width;
        }
        if used == 0 {
            return if editor {
                String::new()
            } else {
                style.inverse().apply(" ")
            };
        }
        return result + &" ".repeat(columns - 1 - used) + &ellipsis;
    }
    if position <= columns {
        return placed
            .iter()
            .map(|cell| paint(&cell.drawn, cell.cursor))
            .collect();
    }
    if columns < active.width + 2 {
        return style.inverse().apply(&if active.width > columns {
            glyph(Glyph::Ellipsis)
        } else {
            active.drawn.clone()
        });
    }
    let columns = columns as isize;
    let position = position as isize;
    let start = active.start as isize - (columns - active.width as isize).div_euclid(2);
    let head = start <= 0;
    let tail = !head && start + columns >= position;
    let from = if head {
        0
    } else if tail {
        position - (columns - 1)
    } else {
        start + 1
    };
    let to = if head {
        columns - 1
    } else if tail {
        position
    } else {
        start + columns - 1
    };
    let mut result = if head {
        String::new()
    } else {
        ellipsis.clone()
    };
    let mut offset = from;
    for cell in &placed {
        let cell_start = cell.start as isize;
        if cell_start < from || cell_start + cell.width as isize > to {
            continue;
        }
        result.push_str(&" ".repeat((cell_start - offset).max(0) as usize));
        result.push_str(&paint(&cell.drawn, cell.cursor));
        offset = cell_start + cell.width as isize;
    }
    result.push_str(&" ".repeat((to - offset).max(0) as usize));
    if !tail {
        result.push_str(&ellipsis);
    }
    result
}

/// A typed frame's asking line, fitted to one row: the message and the separator give their
/// columns to the field as the row narrows.
fn typed_frame(data: &TypedFrame, editor: bool, context: &ViewContext) -> String {
    let style = &context.style;
    let columns = usize::from(context.columns.unwrap_or(80)).max(1);
    let label = if data.kind == QuestionKind::Confirm {
        data.hint.clone().unwrap_or_else(|| "[y/n]".to_owned())
    } else {
        "›".to_owned()
    };
    let separator = format!(" {} ", style.dim().apply(&label));
    let separator_width = context.width(&label) + 2;
    let mark = style.info().bold().apply("?");
    let prefix = if columns >= 2 + 1 + separator_width + 16 {
        let message_columns = columns - 2 - separator_width - 16;
        let message = if context.width(&data.message) <= message_columns {
            data.message.clone()
        } else {
            clipped(&data.message, message_columns, context)
        };
        format!("{mark} {}{separator}", style.bold().apply(&message))
    } else if columns > separator_width + 4 {
        format!("{mark}{separator}")
    } else if columns >= 3 {
        format!("{mark} ")
    } else if columns == 2 {
        mark
    } else {
        String::new()
    };
    let budget = columns.saturating_sub(context.width(&prefix));
    if data.kind == QuestionKind::Secret {
        return prefix + &style.inverse().apply(" ");
    }
    let hint = data.kind == QuestionKind::Text
        && data.typed.is_empty()
        && data.hint.as_deref().is_some_and(|hint| !hint.is_empty());
    let (text, cursor) = if hint {
        (data.hint.clone().unwrap_or_default(), 0)
    } else {
        (
            data.typed.clone(),
            data.cursor.unwrap_or_else(|| graphemes(&data.typed).len()),
        )
    };
    prefix + &field(&text, cursor, hint, budget, editor, context)
}

/// An editor's answered line: the answer clips before the message, then the count gives way.
fn editor_answer(message: &str, answer: &str, lines: usize, context: &ViewContext) -> String {
    let style = &context.style;
    let columns = usize::from(context.columns.unwrap_or(80)).max(1);
    let empty = answer.is_empty();
    let paint = |text: &str| {
        if empty {
            style.dim().apply(text)
        } else {
            style.highlight().apply(text)
        }
    };
    let mut message = message.to_owned();
    let mut drawn = paint(&if empty {
        "empty".to_owned()
    } else {
        literal(answer)
    });
    let mut count = if !empty && lines > 1 {
        format!(
            " {}",
            style.dim().apply(&format!(
                "(+{} {})",
                lines - 1,
                if lines == 2 { "line" } else { "lines" }
            ))
        )
    } else {
        String::new()
    };
    let row = |message: &str, drawn: &str, count: &str| {
        format!(
            "{} {message} {} {drawn}{count}",
            style.dim().apply("?"),
            style.dim().apply("·")
        )
    };
    let leading = |text: &str, budget: usize| {
        let mut result = String::new();
        for part in graphemes(text) {
            if context.width(&literal(&format!("{result}{part}"))) > budget {
                break;
            }
            result.push_str(part);
        }
        result
    };
    let ellipsis_width = context.width(&glyph(Glyph::Ellipsis));
    let full = context.width(&row(&message, &drawn, &count));
    if full > columns {
        let budget = ellipsis_width.max((columns + context.width(&drawn)).saturating_sub(full));
        let kept = leading(
            if empty { "empty" } else { answer },
            budget.saturating_sub(ellipsis_width),
        );
        drawn = paint(&format!("{}{}", literal(&kept), glyph(Glyph::Ellipsis)));
    }
    let full = context.width(&row(&message, &drawn, &count));
    if full > columns {
        let budget = (columns + context.width(&message)).saturating_sub(full);
        message = clipped(&message, ellipsis_width.max(budget), context);
    }
    if context.width(&row(&message, &drawn, &count)) > columns {
        count = String::new();
    }
    if context.width(&row(&message, &drawn, &count)) <= columns {
        return format!("{}\n", row(&message, &drawn, &count));
    }
    let plain_message = context.plain(&message);
    let plain_answer = context.plain(&drawn);
    let identity = |text: &str| text.to_owned();
    let dim = |text: &str| style.dim().apply(text);
    let literal_message = |text: &str| literal(text);
    let painted = |text: &str| paint(&literal(text));
    let parts: [(&str, &Painter<'_>); 7] = [
        ("?", &dim),
        (" ", &identity),
        (&plain_message, &literal_message),
        (" ", &identity),
        ("·", &dim),
        (" ", &identity),
        (&plain_answer, &painted),
    ];
    let mut room = columns;
    let mut fitted = String::new();
    for (text, draw) in parts {
        let kept = leading(text, room);
        if !kept.is_empty() {
            fitted.push_str(&draw(&kept));
        }
        if kept != text {
            break;
        }
        room = room.saturating_sub(context.width(&literal(&kept)));
    }
    format!("{fitted}\n")
}

fn render_answered(data: &AnsweredLine, context: &ViewContext) -> String {
    let style = &context.style;
    if data.kind == Some(QuestionKind::Editor) {
        return editor_answer(
            &data.message,
            data.answer.as_deref().unwrap_or_default(),
            data.lines.unwrap_or(0),
            context,
        );
    }
    let Some(answer) = &data.answer else {
        return format!("{} {}\n", style.dim().apply("?"), data.message);
    };
    let drawn = if answer.is_empty() && data.kind == Some(QuestionKind::Multiselect) {
        style.dim().apply("none")
    } else {
        style.highlight().apply(&literal(answer))
    };
    format!(
        "{} {} {} {drawn}\n",
        style.dim().apply("?"),
        data.message,
        style.dim().apply("·")
    )
}

/// How one part of a clipped row draws its kept text.
type Painter<'a> = dyn Fn(&str) -> String + 'a;

/// The cells of a progress bar.
const BAR_CELLS: usize = 10;

fn complete_cells(completed: f64, total: f64) -> usize {
    if total == 0.0 {
        return BAR_CELLS;
    }
    let cells = ((BAR_CELLS as f64) * completed / total).floor();
    if cells.is_nan() {
        return 0;
    }
    cells.clamp(0.0, BAR_CELLS as f64) as usize
}

/// A number as JavaScript's `String(number)` writes it.
fn number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    if value == value.trunc() && value.abs() < 1e21 {
        return format!("{}", value as i128);
    }
    format!("{value}")
}

fn counts(completed: f64, total: f64) -> String {
    let whole = |value: f64| value.is_finite() && value == value.trunc();
    if whole(completed) && whole(total) {
        return format!("{}/{}", number(completed), number(total));
    }
    if total == 0.0 {
        return "100%".to_owned();
    }
    format!("{}%", number((100.0 * completed / total).floor()))
}

/// Elapsed time, rounded down: `2.4s`, `1m 05s`, or `1h 02m`.
pub(crate) fn elapsed_time(elapsed: u64) -> String {
    const SECOND: u64 = 1000;
    const MINUTE: u64 = 60 * SECOND;
    const HOUR: u64 = 60 * MINUTE;
    if elapsed < MINUTE {
        let tenths = elapsed / 100;
        return format!("{}.{}s", tenths / 10, tenths % 10);
    }
    if elapsed < HOUR {
        return format!("{}m {:02}s", elapsed / MINUTE, (elapsed % MINUTE) / SECOND);
    }
    format!("{}h {:02}m", elapsed / HOUR, (elapsed % HOUR) / MINUTE)
}

fn render_progress(data: &ProgressLine, context: &ViewContext) -> String {
    let style = &context.style;
    let time = format!(
        "{} {}",
        style.dim().apply("·"),
        style.dim().apply(&elapsed_time(data.elapsed))
    );
    match data.state {
        ProgressState::Cancelled => {
            return style.dim().apply(&format!(
                "{} {} (cancelled)",
                glyph(Glyph::SquareCenter),
                data.label
            ));
        }
        ProgressState::Ended => {
            return format!(
                "{} {} {time}",
                style.success().apply(&glyph(Glyph::Success)),
                data.label
            );
        }
        ProgressState::Failed => {
            return format!(
                "{} {} {time}",
                style.error().apply(&glyph(Glyph::Error)),
                data.label
            );
        }
        ProgressState::Running => {}
    }
    let completed = data.completed.unwrap_or(0.0);
    let measure = match (data.total, data.completed) {
        (Some(total), _) => {
            let complete = complete_cells(completed, total);
            let bar = style
                .highlight()
                .apply(&escape(&data.bar.complete.repeat(complete)))
                + &style
                    .dim()
                    .apply(&escape(&data.bar.incomplete.repeat(BAR_CELLS - complete)));
            format!(" {bar} {}", counts(completed, total))
        }
        (None, Some(completed)) => format!(" {}", number(completed)),
        (None, None) => String::new(),
    };
    format!(
        "{} {}{measure} {time}",
        style.highlight().apply(&escape(&data.frame)),
        data.label
    )
}

/// A shared handle on the question views, so one question builds each once.
#[derive(Clone)]
pub(crate) struct QuestionViews {
    pub(crate) frame: Arc<DeclaredView<QuestionFrame>>,
    pub(crate) answered: Arc<DeclaredView<AnsweredLine>>,
    pub(crate) cancelled: Arc<DeclaredView<CancelledLine>>,
}

impl QuestionViews {
    pub(crate) fn new() -> Self {
        Self {
            frame: Arc::new(question_frame()),
            answered: Arc::new(answered_line()),
            cancelled: Arc::new(cancelled_line()),
        }
    }
}
