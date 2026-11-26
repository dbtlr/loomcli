//! A numbered list and its line-based choice and search loops.

use std::collections::HashSet;

use loomcli_core::{Context, Error, Issue, ValueLink};
use tokio_util::sync::{CancellationToken, DropGuard};

use super::{Item, ListState, item, prefill_issue, validate_chosen, waiting};
use crate::lines::LineAsking;
use crate::messages;
use crate::question::stopped;
use crate::questions::ChoiceEntry;
use crate::reader::Reader;
use crate::views::{NumberedChoice, NumberedRow, QuestionLine};

/// Selectable choices in the order in which the question numbers them.
struct NumberedList<T>(Vec<Item<T>>);

impl<T: Clone + PartialEq + Send + Sync + 'static> NumberedList<T> {
    async fn print(entries: &[ChoiceEntry<T>], line: &LineAsking) -> Result<Self, Error> {
        let mut choices = Vec::new();
        let mut rows = Vec::with_capacity(entries.len());
        for entry in entries {
            let row = match entry {
                ChoiceEntry::Choice(_) => {
                    let Some(choice) = item(entry) else { continue };
                    let number = (!choice.row.disabled).then(|| choices.len() + 1);
                    let mut row = NumberedChoice::new(choice.row.label.clone(), number);
                    row.description.clone_from(&choice.row.description);
                    row.reason.clone_from(&choice.row.reason);
                    if number.is_some() {
                        choices.push(choice);
                    }
                    NumberedRow::Choice(row)
                }
                ChoiceEntry::Separator(text) => NumberedRow::Separator(text.clone()),
            };
            rows.push(row);
        }
        line.print(QuestionLine::List(rows)).await?;
        Ok(Self(choices))
    }

    fn choose(&self, numbers: &[usize], state: &ListState<T>) -> Result<Vec<Item<T>>, String> {
        let highest = self.0.len();
        if !state.multiple {
            return match numbers {
                [n] if (1..=highest).contains(n) => Ok(vec![self.0[n - 1].clone()]),
                _ => Err(messages::type_one_number(highest)),
            };
        }
        let mut seen = HashSet::new();
        let mut choices = Vec::new();
        for number in numbers {
            if !(1..=highest).contains(number) {
                return Err(messages::type_numbers(highest));
            }
            if seen.insert(*number) {
                choices.push(self.0[number - 1].clone());
            }
        }
        if choices.len() < state.min {
            return Err(messages::choose_at_least(state.min));
        }
        if let Some(max) = state.max
            && choices.len() > max
        {
            return Err(messages::choose_at_most(max));
        }
        Ok(choices)
    }
}

fn numbers_in(text: &str) -> Option<Vec<usize>> {
    text.split(',')
        .map(|part| part.trim_matches(|ch: char| ch.is_whitespace() || ch == '\u{feff}'))
        .filter(|part| !part.is_empty())
        .map(|part| {
            part.bytes()
                .all(|byte| byte.is_ascii_digit())
                .then(|| part.parse().unwrap_or(usize::MAX))
        })
        .collect()
}

/// Prefills find the first occurrence of a value among the entries, in the prefill's order.
fn prefilled<T: Clone + PartialEq + Send + Sync + 'static>(
    entries: &[ChoiceEntry<T>],
    state: &ListState<T>,
    supplied: bool,
) -> (Vec<Item<T>>, Option<String>) {
    let mut chosen = Vec::new();
    let mut missing = Vec::new();
    let mut limited = Vec::new();
    for (index, value) in state.values.iter().enumerate() {
        if state.values[..index].iter().any(|other| other.same(value)) {
            continue;
        }
        let matched = entries
            .iter()
            .filter_map(item)
            .find(|choice| !choice.row.disabled && value.matches(&choice.value));
        match matched {
            Some(_) if state.multiple && state.max.is_some_and(|max| chosen.len() >= max) => {
                if supplied {
                    limited.push(value.clone());
                }
            }
            Some(choice) => chosen.push(choice),
            None if supplied => missing.push(value.clone()),
            None => {}
        }
    }
    (chosen, prefill_issue(&missing, &limited, state.max))
}

fn labels<T>(choices: &[Item<T>]) -> Option<String> {
    (!choices.is_empty()).then(|| {
        choices
            .iter()
            .map(|choice| choice.row.label.as_str())
            .collect::<Vec<_>>()
            .join(",")
    })
}

fn numbers_text(numbers: &[usize]) -> Option<String> {
    (!numbers.is_empty()).then(|| {
        numbers
            .iter()
            .map(usize::to_string)
            .collect::<Vec<_>>()
            .join(",")
    })
}

/// The input and validation shared by the fixed list and the search.
pub(super) struct AskingList<'a, I, R, C> {
    pub(super) context: &'a Context<I, R>,
    pub(super) reader: &'a mut Reader,
    pub(super) region: &'a CancellationToken,
    pub(super) line: &'a LineAsking,
    pub(super) link: Option<&'a ValueLink>,
    pub(super) convert: &'a C,
}

impl<I, R: 'static, C> AskingList<'_, I, R, C> {
    async fn read(&mut self) -> Result<String, Error> {
        self.line
            .read(self.context, self.reader, self.region, false)
            .await
    }

    async fn attempt<T, O>(
        &self,
        choices: Result<Vec<Item<T>>, String>,
        multiple: bool,
    ) -> Result<Option<Vec<O>>, Error>
    where
        C: Fn(&T, Option<&ValueLink>) -> Result<Result<O, Vec<Issue>>, Error>,
    {
        let checked = match choices {
            Ok(choices) => {
                validate_chosen(self.context, &choices, multiple, self.link, self.convert)?
            }
            Err(issue) => Err(issue),
        };
        match checked {
            Ok(value) => Ok(Some(value)),
            Err(issue) => {
                self.line.reject(issue).await?;
                Ok(None)
            }
        }
    }

    pub(super) async fn ask<T, O>(&mut self, state: &mut ListState<T>) -> Result<Vec<O>, Error>
    where
        T: Clone + PartialEq + Send + Sync + 'static,
        C: Fn(&T, Option<&ValueLink>) -> Result<Result<O, Vec<Issue>>, Error>,
    {
        self.line
            .print(QuestionLine::Title(state.message.clone()))
            .await?;
        if state.search {
            return self.search(state).await;
        }
        let list = NumberedList::print(&state.choices, self.line).await?;
        let (picked, issue) = prefilled(&state.choices, state, state.supplied);
        if let Some(issue) = issue {
            self.line.reject(issue).await?;
        }
        let mut defaults: Vec<usize> = picked
            .iter()
            .filter_map(|choice| list.0.iter().position(|other| choice.value == other.value))
            .map(|index| index + 1)
            .collect();
        if defaults.is_empty() && !state.multiple && !list.0.is_empty() {
            defaults.push(1);
        }
        let hint = numbers_text(&defaults);
        let row = if state.multiple {
            QuestionLine::Numbers(hint)
        } else {
            QuestionLine::Number(hint)
        };
        loop {
            self.line.print(row.clone()).await?;
            let typed = self.read().await?;
            let numbers = if typed.trim().is_empty() {
                Some(defaults.clone())
            } else {
                numbers_in(&typed)
            };
            let chosen = list.choose(numbers.as_deref().unwrap_or(&[0]), state);
            if let Some(answer) = self.attempt(chosen, state.multiple).await? {
                return Ok(answer);
            }
        }
    }

    async fn search<T, O>(&mut self, state: &mut ListState<T>) -> Result<Vec<O>, Error>
    where
        T: Clone + PartialEq + Send + Sync + 'static,
        C: Fn(&T, Option<&ValueLink>) -> Result<Result<O, Vec<Issue>>, Error>,
    {
        let mut seen = Vec::new();
        let mut previous: Option<DropGuard> = None;
        // Under a source the choices are unknown until it answers, so a supplied value is checked
        // only against fixed choices, as the reference's `searchLines` does.
        let (mut defaults, issue) = if state.source.is_some() {
            (Vec::new(), None)
        } else {
            prefilled(&state.choices, state, state.supplied)
        };
        if let Some(issue) = issue {
            self.line.reject(issue).await?;
        }
        self.line.print(QuestionLine::Search).await?;
        let mut term = self.read().await?;
        loop {
            let entries = if let Some(source) = &state.source {
                drop(previous.take());
                let token = CancellationToken::new();
                previous = Some(token.clone().drop_guard());
                let entries = waiting(self.reader, self.context, self.region, source(term, token))
                    .await
                    .map_err(|stop| stopped(self.context, stop))??;
                seen.extend(entries.iter().cloned());
                defaults = prefilled(&seen, state, false).0;
                entries
            } else if term.is_empty() {
                state.choices.clone()
            } else {
                let term = term.to_lowercase();
                state
                    .choices
                    .iter()
                    .filter(|entry| {
                        item(entry)
                            .is_some_and(|item| item.row.label.to_lowercase().contains(&term))
                    })
                    .cloned()
                    .collect()
            };
            let list = NumberedList::print(&entries, self.line).await?;
            if list.0.is_empty() {
                self.line
                    .reject(messages::NO_SELECTABLE_CHOICE.to_owned())
                    .await?;
                self.line.print(QuestionLine::Search).await?;
                term = self.read().await?;
            } else {
                match self.refine(state, &list, &defaults).await? {
                    Ok(answer) => return Ok(answer),
                    Err(refined) => term = refined,
                }
            }
        }
    }

    /// Refine a search with a number, a default, or another term.
    async fn refine<T, O>(
        &mut self,
        state: &mut ListState<T>,
        list: &NumberedList<T>,
        defaults: &[Item<T>],
    ) -> Result<Result<Vec<O>, String>, Error>
    where
        T: Clone + PartialEq + Send + Sync + 'static,
        C: Fn(&T, Option<&ValueLink>) -> Result<Result<O, Vec<Issue>>, Error>,
    {
        let hint = labels(defaults)
            .or_else(|| (state.multiple && state.min == 0).then(|| "none".to_owned()));
        loop {
            self.line.print(QuestionLine::Refine(hint.clone())).await?;
            let typed = self.read().await?;
            let chosen = if typed.is_empty() && hint.is_some() {
                if state.multiple && defaults.len() < state.min {
                    Err(messages::choose_at_least(state.min))
                } else {
                    Ok(defaults.to_vec())
                }
            } else if let Some(numbers) = numbers_in(&typed).filter(|numbers| !numbers.is_empty()) {
                list.choose(&numbers, state)
            } else {
                return Ok(Err(typed));
            };
            if let Some(answer) = self.attempt(chosen, state.multiple).await? {
                return Ok(Ok(answer));
            }
        }
    }
}
