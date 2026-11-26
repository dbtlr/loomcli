//! Select and multiselect: one list question, which moves a highlight through its choices, keeps a
//! multiselect's selection, searches a list or reads it from a source, and resolves its prefill.

mod lines;

use crate::messages;
use std::any::Any;
use std::future::Future;
use std::pin::{Pin, pin};
use std::task::Poll;

use loomcli_core::{Context, Error, Issue, SuppliedValue, ValueLink};
use tokio_util::sync::CancellationToken;

use crate::line::TypedLine;
use crate::link::{
    LinkKind, Resolved, invalid, linked_value, linked_values, present, resolve_link,
};
use crate::question::{Asking, Begun, Shown, begin, first_issue, region_closed, stopped};
use crate::questions::{ChoiceEntry, ChoiceList, ChoiceSource, SelectSettings};
use crate::reader::{Key, Reader, Stop};
use crate::views::{ChoiceRow, ListFrame, ListKind, ListRow, QuestionFrame, QuestionKind};

/// What `select` and `multiselect` hand the list question.
pub(crate) struct ListQuestion<T> {
    pub(crate) settings: SelectSettings<T>,
    pub(crate) defaults: Option<Vec<T>>,
    pub(crate) min: usize,
    pub(crate) max: Option<usize>,
    pub(crate) multiple: bool,
}

/// One value a prefill names: an author's value, or a raw string an invocation supplied or an
/// input declared.
#[derive(Clone)]
enum Prefill<T> {
    Value(T),
    Raw(String),
}

impl<T: PartialEq + 'static> Prefill<T> {
    fn matches(&self, value: &T) -> bool {
        match self {
            Prefill::Value(own) => own == value,
            Prefill::Raw(raw) => text_of(value).is_some_and(|text| text == raw),
        }
    }

    fn same(&self, other: &Prefill<T>) -> bool {
        match (self, other) {
            (Prefill::Value(one), Prefill::Value(two)) => one == two,
            (Prefill::Raw(one), Prefill::Raw(two)) => one == two,
            _ => false,
        }
    }

    /// The text a sentence repeats for this prefill.
    fn shown(&self) -> String {
        match self {
            Prefill::Raw(raw) => raw.clone(),
            Prefill::Value(value) => text_of(value).unwrap_or_default().to_owned(),
        }
    }
}

/// A choice value's string, when it is a `String`.
pub(crate) fn text_of<T: 'static>(value: &T) -> Option<&str> {
    (value as &dyn Any)
        .downcast_ref::<String>()
        .map(String::as_str)
}

/// One choice as the question reads it: its value and its row.
#[derive(Clone)]
struct Item<T> {
    value: T,
    row: ChoiceRow,
}

fn item<T: Clone>(entry: &ChoiceEntry<T>) -> Option<Item<T>> {
    match entry {
        ChoiceEntry::Choice(choice) => {
            let mut row = ChoiceRow::new(choice.label.clone());
            row.description = choice.hint.clone();
            if let Some(reason) = &choice.disabled {
                row = row.disabled(reason.clone());
            }
            Some(Item {
                value: choice.value.clone(),
                row,
            })
        }
        _ => None,
    }
}

fn list_row<T: Clone>(entry: &ChoiceEntry<T>) -> ListRow {
    match entry {
        ChoiceEntry::Choice(_) => item(entry).map_or_else(
            || ListRow::Separator(String::new()),
            |item| ListRow::Choice(item.row),
        ),
        ChoiceEntry::Separator(label) => ListRow::Separator(label.clone()),
    }
}

fn selectable<T: Clone>(entries: &[ChoiceEntry<T>]) -> Vec<usize> {
    entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| item(entry).filter(|item| !item.row.disabled).map(|_| index))
        .collect()
}

/// A source call in flight.
type Call<T> = Pin<Box<dyn Future<Output = Result<Vec<ChoiceEntry<T>>, Error>> + Send>>;

/// Polls `future` once, answering its output when it was ready at once.
fn ready_now<F: Future + Unpin>(future: &mut F) -> Option<F::Output> {
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    match Pin::new(future).poll(&mut context) {
        Poll::Ready(output) => Some(output),
        Poll::Pending => None,
    }
}

/// The list question's state while it asks.
struct ListState<T> {
    message: String,
    multiple: bool,
    search: bool,
    min: usize,
    max: Option<usize>,
    source: Option<ChoiceSource<T>>,
    choices: Vec<ChoiceEntry<T>>,
    entries: Vec<ChoiceEntry<T>>,
    highlighted: Option<usize>,
    start: usize,
    issue: Option<String>,
    selection: Vec<Item<T>>,
    line: TypedLine,
    loading: bool,
    first: bool,
    supplied: bool,
    values: Vec<Prefill<T>>,
    /// The latest source call and its token.
    pending: Option<(Call<T>, CancellationToken)>,
    tokens: Vec<CancellationToken>,
    /// The answered line, once the question is answered.
    answered: Option<Shown>,
}

impl<T: Clone + PartialEq + Send + Sync + 'static> ListState<T> {
    fn reset(&mut self) {
        self.highlighted = selectable(&self.entries).first().copied();
        self.start = 0;
    }

    fn frame<I, R: 'static>(&mut self, context: &Context<I, R>) -> QuestionFrame {
        let positions = selectable(&self.entries);
        let rows = context.host.terminal.stderr().rows;
        let count = rows.map_or(7, |rows| (usize::from(rows).saturating_sub(4)).clamp(1, 7));
        let length = self.entries.len();
        self.start = self.start.min(length.saturating_sub(count));
        if self.highlighted.is_none() || self.highlighted == positions.first().copied() {
            self.start = 0;
        }
        if let Some(highlighted) = self.highlighted {
            if Some(highlighted) == positions.last().copied() {
                self.start = length.saturating_sub(count);
            }
            self.start = self.start.min(highlighted);
            if highlighted >= self.start + count {
                self.start = highlighted + 1 - count;
            }
        }
        let end = (self.start + count).min(length);
        let choices = self.entries[self.start..end]
            .iter()
            .map(|entry| {
                let mut row = list_row(entry);
                if let (ListRow::Choice(row), Some(item)) = (&mut row, item(entry)) {
                    row.selected = self.multiple
                        && self
                            .selection
                            .iter()
                            .any(|chosen| chosen.value == item.value);
                }
                row
            })
            .collect();
        let kind = if self.multiple {
            ListKind::Multiselect {
                count: self.selection.len(),
                min: self.min,
                max: self.max,
            }
        } else {
            ListKind::Select
        };
        let mut frame = ListFrame::new(kind, self.message.clone(), choices);
        frame.above = self.start;
        frame.below = length.saturating_sub(self.start + count);
        frame.highlighted = self.highlighted.map(|highlighted| highlighted - self.start);
        frame.issue = self.issue.clone();
        frame.loading = self.loading;
        frame.rows = rows;
        frame.term = self.search.then(|| self.line.value.clone());
        frame.cursor = Some(self.line.cursor);
        QuestionFrame::List(frame)
    }

    /// Starts a source call for the term, cancelling the one before it. A call that answers at
    /// once settles now.
    fn load(&mut self) -> Option<Result<Vec<ChoiceEntry<T>>, Error>> {
        if let Some((_, token)) = self.pending.take() {
            token.cancel();
        }
        let source = self.source.clone()?;
        let token = CancellationToken::new();
        self.tokens.push(token.clone());
        self.loading = false;
        let mut call: Call<T> = source(self.line.value.clone(), token.clone());
        if let Some(result) = ready_now(&mut call) {
            return Some(result);
        }
        self.loading = true;
        self.pending = Some((call, token));
        None
    }

    fn cancel_calls(&mut self) {
        for token in &self.tokens {
            token.cancel();
        }
        self.pending = None;
    }
}

/// Waits for `future` while reading stdin, so interrupt keys still act; the keys read meanwhile
/// stay queued. The run's cancellation or the region's close stops the wait.
async fn waiting<I, R: 'static, F: Future>(
    reader: &Reader,
    context: &Context<I, R>,
    region: &CancellationToken,
    future: F,
) -> Result<F::Output, Stop> {
    let mut future = pin!(future);
    loop {
        if context.signal.is_cancelled() {
            return Err(Stop::Cancelled);
        }
        if region.is_cancelled() {
            return Err(Stop::Abandoned);
        }
        let queued = reader.has_queued();
        let signal = context.signal.token();
        let mut cancelled = pin!(signal.cancelled());
        let mut closed = pin!(region.cancelled());
        let mut fill = pin!(reader.fill(context, region));
        let step = std::future::poll_fn(|cx| {
            if let Poll::Ready(output) = future.as_mut().poll(cx) {
                return Poll::Ready(Some(Ok(output)));
            }
            if queued {
                if cancelled.as_mut().poll(cx).is_ready() || closed.as_mut().poll(cx).is_ready() {
                    return Poll::Ready(None);
                }
                return Poll::Pending;
            }
            fill.as_mut().poll(cx).map(|filled| filled.err().map(Err))
        })
        .await;
        match step {
            Some(Ok(output)) => return Ok(output),
            Some(Err(stop)) => return Err(stop),
            None => {}
        }
    }
}

/// Asks a select or multiselect question.
#[allow(clippy::too_many_lines)]
pub(crate) fn begin_list<
    I,
    R: 'static,
    T: Clone + PartialEq + Send + Sync + 'static,
    O: Clone + Send + Sync + 'static,
>(
    context: &Context<I, R>,
    question: ListQuestion<T>,
) -> Result<ListStart<T, O>, Error> {
    let ListQuestion {
        settings,
        defaults,
        min,
        max,
        multiple,
    } = question;
    let kind = if multiple { "multiselect" } else { "select" };
    let message = settings.message.clone();
    if multiple && max.is_some_and(|max| min > max) {
        return Err(invalid(
            format!(
                "The multiselect question \"{message}\" has min {min} above max {}.",
                max.unwrap_or_default()
            ),
            "Set min at or below max.",
        ));
    }
    let (choices, search, source) = match settings.list {
        ChoiceList::Static { entries, search } => (entries, search, None),
        ChoiceList::Source(source) => (Vec::new(), true, Some(source)),
    };
    if source.is_none() {
        let available = selectable(&choices).len();
        if available == 0 {
            return Err(invalid(
                format!("The {kind} question \"{message}\" has no choice that is not disabled."),
                "Supply at least one choice that is not disabled.",
            ));
        }
        if multiple && available < min {
            return Err(invalid(
                format!(
                    "The multiselect question \"{message}\" has min {min} and {available} choices that are not disabled."
                ),
                "Supply at least min choices that are not disabled.",
            ));
        }
    }
    let link = settings.link.as_ref().and_then(|link| match link {
        ValueLink::Option { name, .. } => Some(ValueLink::option(name.clone(), message.clone())),
        ValueLink::Argument { name, .. } => {
            Some(ValueLink::argument(name.clone(), message.clone()))
        }
        _ => None,
    });
    let resolved = resolve_link(
        context,
        &message,
        link.as_ref(),
        settings.skip_if_supplied,
        if multiple {
            LinkKind::Multiselect
        } else {
            LinkKind::Select
        },
    )?;
    if let Some(link) = &link
        && std::any::TypeId::of::<T>() != std::any::TypeId::of::<String>()
    {
        let (what, name) = match link {
            ValueLink::Argument { name, .. } => ("argument", name.as_str()),
            ValueLink::Option { name, .. } => ("option", name.as_str()),
            _ => ("option", ""),
        };
        return Err(invalid(
            format!(
                "The question \"{message}\" links {what} \"{name}\", and its choices hold values that are not strings."
            ),
            "Give a linked question's choices String values.",
        ));
    }
    let (supplied_raw, declared) = match resolved {
        Resolved::Answered => {
            return Ok(ListStart::Answered(if multiple {
                linked_values(context, link.as_ref())?
            } else {
                vec![present(linked_value(context, link.as_ref())?, &message)?]
            }));
        }
        Resolved::Ask { supplied, declared } => (supplied, declared),
    };
    let supplied = supplied_raw.is_some();
    let values: Vec<Prefill<T>> = if let Some(raw) = supplied_raw {
        match raw {
            SuppliedValue::One(value) if !multiple => vec![Prefill::Raw(value)],
            SuppliedValue::Many(values) if multiple => {
                values.into_iter().map(Prefill::Raw).collect()
            }
            _ => Vec::new(),
        }
    } else if !multiple && settings.default.is_some() {
        settings
            .default
            .clone()
            .into_iter()
            .map(Prefill::Value)
            .collect()
    } else if multiple && defaults.is_some() {
        defaults
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(Prefill::Value)
            .collect()
    } else {
        match declared {
            Some(serde_json::Value::String(value)) if !multiple => vec![Prefill::Raw(value)],
            Some(serde_json::Value::Array(values)) if multiple => values
                .into_iter()
                .filter_map(|value| value.as_str().map(|value| Prefill::Raw(value.to_owned())))
                .collect(),
            _ => Vec::new(),
        }
    };
    let question_kind = if multiple {
        QuestionKind::Multiselect
    } else {
        QuestionKind::Select
    };
    let begun = begin(context, &message, question_kind)?;
    let state = ListState {
        message: message.clone(),
        multiple,
        search,
        min,
        max,
        source,
        entries: choices.clone(),
        choices,
        highlighted: None,
        start: 0,
        issue: None,
        selection: Vec::new(),
        line: TypedLine::default(),
        loading: false,
        first: true,
        supplied,
        values,
        pending: None,
        tokens: Vec::new(),
        answered: None,
    };
    Ok(ListStart::Ask(Box::new(ListRun { begun, state, link })))
}

/// A list question at its call: answered from its link, or begun.
pub(crate) enum ListStart<T, O> {
    Answered(Vec<O>),
    Ask(Box<ListRun<T>>),
}

/// A begun list question and its state.
pub(crate) struct ListRun<T> {
    begun: Begun,
    state: ListState<T>,
    pub(crate) link: Option<ValueLink>,
}

/// Asks a begun list question.
pub(crate) async fn run_list<
    I,
    R: 'static,
    T: Clone + PartialEq + Send + Sync + 'static,
    O,
    C: Fn(&T, Option<&ValueLink>) -> Result<Result<O, Vec<Issue>>, Error>,
>(
    context: &Context<I, R>,
    run: ListRun<T>,
    convert: &C,
) -> Result<Vec<O>, Error> {
    let ListRun {
        begun: Begun {
            mut reader,
            mut draw,
        },
        mut state,
        link,
    } = run;
    let region = draw.signal();
    if draw.is_line() {
        let outcome = async {
            let Some(line) = draw.start_line(context).await? else {
                return Err(region_closed());
            };
            lines::AskingList {
                context,
                reader: &mut reader,
                region: &region,
                line: &line,
                link: link.as_ref(),
                convert,
            }
            .ask(&mut state)
            .await
        }
        .await;
        reader.close();
        let ended = draw.finish_line(outcome.is_ok()).await;
        let values = outcome?;
        ended?;
        return Ok(values);
    }
    let outcome = match reader.start(context).await {
        Ok(()) => {
            asking_list(
                context,
                &mut reader,
                &mut draw,
                &region,
                &mut state,
                link.as_ref(),
                convert,
            )
            .await
        }
        Err(error) => Err(error),
    };
    state.cancel_calls();
    let released = reader.close();
    let finished = draw.finish(context, state.answered.take(), released).await;
    let values = outcome?;
    finished?;
    Ok(values)
}

/// Applies the prefill against the list the question opened with, looking a supplied value the
/// first source call lacks up through the source.
async fn apply_prefill<I, R: 'static, T: Clone + PartialEq + Send + Sync + 'static>(
    context: &Context<I, R>,
    reader: &Reader,
    draw: &mut Asking,
    region: &CancellationToken,
    state: &mut ListState<T>,
) -> Result<(), Error> {
    let mut missing: Vec<Prefill<T>> = Vec::new();
    let mut limited: Vec<Prefill<T>> = Vec::new();
    let mut unique: Vec<Prefill<T>> = Vec::new();
    for value in &state.values {
        if !unique.iter().any(|other| other.same(value)) {
            unique.push(value.clone());
        }
    }
    for value in unique {
        let mut found_match = state
            .entries
            .iter()
            .filter_map(item)
            .find(|choice| value.matches(&choice.value));
        if found_match.is_none()
            && state.supplied
            && let (Prefill::Raw(raw), Some(source)) = (&value, state.source.clone())
        {
            let token = CancellationToken::new();
            state.tokens.push(token.clone());
            let mut call = source(raw.clone(), token);
            let found = match ready_now(&mut call) {
                Some(found) => found?,
                None => {
                    if !state.loading {
                        state.loading = true;
                        let frame = state.frame(context);
                        draw.frame(context, frame).await?;
                    }
                    waiting(reader, context, region, call)
                        .await
                        .map_err(|stop| stopped(context, stop))??
                }
            };
            found_match = found
                .iter()
                .filter_map(item)
                .find(|choice| value.matches(&choice.value));
            if !state.multiple
                && let Some(matched) = &found_match
                && !matched.row.disabled
            {
                state.entries = found;
                state.line.set(raw);
            }
        }
        let Some(matched) = found_match.filter(|matched| !matched.row.disabled) else {
            if state.supplied {
                missing.push(value);
            }
            continue;
        };
        if state.multiple {
            if state.max.is_some_and(|max| state.selection.len() >= max) {
                if state.supplied {
                    limited.push(value);
                }
            } else {
                state.selection.push(matched);
            }
        } else {
            state.highlighted = state
                .entries
                .iter()
                .position(|entry| item(entry).is_some_and(|choice| value.matches(&choice.value)));
        }
    }
    state.issue = prefill_issue(&missing, &limited, state.max);
    Ok(())
}

fn prefill_issue<T: PartialEq + 'static>(
    missing: &[Prefill<T>],
    limited: &[Prefill<T>],
    max: Option<usize>,
) -> Option<String> {
    let mut sentences = Vec::new();
    if !missing.is_empty() {
        let shown: Vec<String> = missing.iter().map(Prefill::shown).collect();
        sentences.push(messages::unselectable(&shown));
    }
    if !limited.is_empty() {
        let shown: Vec<String> = limited.iter().map(Prefill::shown).collect();
        sentences.push(messages::over_limit(&shown, max.unwrap_or_default()));
    }
    (!sentences.is_empty()).then(|| sentences.join(" "))
}

/// Takes a settled source call's list: the highlight moves to its first choice, the first call
/// applies the prefill, and a frame draws.
async fn settle<I, R: 'static, T: Clone + PartialEq + Send + Sync + 'static>(
    context: &Context<I, R>,
    reader: &Reader,
    draw: &mut Asking,
    region: &CancellationToken,
    state: &mut ListState<T>,
    found: Vec<ChoiceEntry<T>>,
) -> Result<(), Error> {
    state.entries = found;
    state.reset();
    if state.first {
        state.first = false;
        apply_prefill(context, reader, draw, region, state).await?;
    }
    state.loading = false;
    let frame = state.frame(context);
    draw.frame(context, frame).await
}

/// Waits for the latest source call to settle and takes its list.
async fn settle_pending<I, R: 'static, T: Clone + PartialEq + Send + Sync + 'static>(
    context: &Context<I, R>,
    reader: &Reader,
    draw: &mut Asking,
    region: &CancellationToken,
    state: &mut ListState<T>,
) -> Result<(), Error> {
    let Some((call, token)) = state.pending.take() else {
        return Ok(());
    };
    let result = waiting(reader, context, region, call)
        .await
        .map_err(|stop| stopped(context, stop))?;
    if token.is_cancelled() {
        return Ok(());
    }
    settle(context, reader, draw, region, state, result?).await
}

/// What the key loop waits for: a key, or the latest source call settling first.
enum Event<T> {
    Key(Result<Key, Stop>),
    Settled(Result<Vec<ChoiceEntry<T>>, Error>, CancellationToken),
}

#[allow(clippy::too_many_lines)]
async fn asking_list<
    I,
    R: 'static,
    T: Clone + PartialEq + Send + Sync + 'static,
    O,
    C: Fn(&T, Option<&ValueLink>) -> Result<Result<O, Vec<Issue>>, Error>,
>(
    context: &Context<I, R>,
    reader: &mut Reader,
    draw: &mut Asking,
    region: &CancellationToken,
    state: &mut ListState<T>,
    link: Option<&ValueLink>,
    convert: &C,
) -> Result<Vec<O>, Error> {
    if state.source.is_some() {
        if let Some(result) = state.load() {
            settle(context, reader, draw, region, state, result?).await?;
        } else {
            let frame = state.frame(context);
            draw.frame(context, frame).await?;
            if state.supplied {
                settle_pending(context, reader, draw, region, state).await?;
            }
        }
    } else {
        state.reset();
        apply_prefill(context, reader, draw, region, state).await?;
        let frame = state.frame(context);
        draw.frame(context, frame).await?;
    }
    loop {
        let event = match state.pending.as_mut() {
            Some((call, token)) => {
                let token = token.clone();
                let mut read = pin!(reader.read(context, region));
                std::future::poll_fn(|cx| {
                    if let Poll::Ready(result) = call.as_mut().poll(cx) {
                        return Poll::Ready(Event::Settled(result, token.clone()));
                    }
                    read.as_mut().poll(cx).map(Event::Key)
                })
                .await
            }
            None => Event::Key(reader.read(context, region).await),
        };
        let key = match event {
            Event::Settled(result, token) => {
                state.pending = None;
                if !token.is_cancelled() {
                    settle(context, reader, draw, region, state, result?).await?;
                }
                continue;
            }
            Event::Key(key) => key.map_err(|stop| stopped(context, stop))?,
        };
        let toggle = state.multiple
            && (key == Key::Tab || (!state.search && key == Key::Text(" ".to_owned())));
        let navigation = matches!(key, Key::Up | Key::Down | Key::Previous | Key::Next)
            || (!state.search && matches!(key, Key::Home | Key::End));
        if toggle || navigation || key == Key::Enter {
            settle_pending(context, reader, draw, region, state).await?;
        }
        if key == Key::Eof && state.line.value.is_empty() {
            context.cancel();
            context.signal.throw_if_cancelled()?;
            return Err(region_closed());
        }
        if key == Key::Enter {
            let current = state
                .highlighted
                .and_then(|index| state.entries.get(index))
                .and_then(item)
                .filter(|item| !item.row.disabled);
            if !state.multiple && current.is_none() {
                state.issue = Some(messages::NO_SELECTABLE_CHOICE.to_owned());
                let frame = state.frame(context);
                draw.frame(context, frame).await?;
                continue;
            }
            if state.multiple && state.selection.len() < state.min {
                state.issue = Some(messages::choose_at_least(state.min));
                let frame = state.frame(context);
                draw.frame(context, frame).await?;
                continue;
            }
            let chosen: Vec<Item<T>> = if state.multiple {
                state.selection.clone()
            } else {
                current.into_iter().collect()
            };
            let outputs = match validate_chosen(context, &chosen, state.multiple, link, convert)? {
                Ok(outputs) => outputs,
                Err(issue) => {
                    state.issue = Some(issue);
                    let frame = state.frame(context);
                    draw.frame(context, frame).await?;
                    continue;
                }
            };
            state.answered = Some(Shown {
                value: Some(
                    chosen
                        .iter()
                        .map(|choice| choice.row.label.clone())
                        .collect::<Vec<_>>()
                        .join(", "),
                ),
                lines: None,
            });
            return Ok(outputs);
        }
        if navigation {
            let positions = selectable(&state.entries);
            state.highlighted = match key {
                Key::Home => positions.first().copied(),
                Key::End => positions.last().copied(),
                _ => {
                    let position = state
                        .highlighted
                        .and_then(|highlighted| positions.iter().position(|p| *p == highlighted))
                        .map_or(-1, |position| position as isize);
                    let step = if matches!(key, Key::Up | Key::Previous) {
                        -1
                    } else {
                        1
                    };
                    let target = (position + step).min(positions.len() as isize - 1).max(0);
                    positions.get(target as usize).copied()
                }
            };
        } else if toggle {
            if let Some(choice) = state
                .highlighted
                .and_then(|index| state.entries.get(index))
                .and_then(item)
                .filter(|choice| !choice.row.disabled)
            {
                if let Some(index) = state
                    .selection
                    .iter()
                    .position(|chosen| chosen.value == choice.value)
                {
                    state.selection.remove(index);
                    state.issue = None;
                } else if state.max.is_none_or(|max| state.selection.len() < max) {
                    state.selection.push(choice);
                    state.issue = None;
                }
            }
        } else if state.search {
            let before = state.line.value.clone();
            if key == Key::Escape {
                state.line = TypedLine::default();
            } else {
                state.line.edit(&key);
            }
            if before != state.line.value {
                state.issue = None;
                if state.source.is_some() {
                    if let Some(result) = state.load() {
                        settle(context, reader, draw, region, state, result?).await?;
                    }
                } else {
                    let term = state.line.value.to_lowercase();
                    state.entries = if term.is_empty() {
                        state.choices.clone()
                    } else {
                        state
                            .choices
                            .iter()
                            .filter(|entry| {
                                item(entry).is_some_and(|item| {
                                    item.row.label.to_lowercase().contains(&term)
                                })
                            })
                            .cloned()
                            .collect()
                    };
                    state.reset();
                }
            }
        }
        let frame = state.frame(context);
        draw.frame(context, frame).await?;
    }
}

fn validate_chosen<I, R: 'static, T, O, C>(
    context: &Context<I, R>,
    choices: &[Item<T>],
    multiple: bool,
    link: Option<&ValueLink>,
    convert: &C,
) -> Result<Result<Vec<O>, String>, Error>
where
    C: Fn(&T, Option<&ValueLink>) -> Result<Result<O, Vec<Issue>>, Error>,
{
    let mut outputs = Vec::with_capacity(choices.len());
    for choice in choices {
        let output = convert(&choice.value, link)?;
        context.signal.throw_if_cancelled()?;
        match output {
            Ok(value) => outputs.push(value),
            Err(issues) => {
                let sentence = first_issue(&issues);
                let issue = if multiple {
                    messages::choice_issue(&choice.row.label, &sentence)
                } else {
                    sentence
                };
                return Ok(Err(issue));
            }
        }
    }
    Ok(Ok(outputs))
}
