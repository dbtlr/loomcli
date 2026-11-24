//! The questions: text, secret, editor, confirm, select, and multiselect.

use std::future::Future;
use std::marker::PhantomData;
use std::sync::Arc;

use loomcli_core::{
    BoxFuture, Context, Error, Issue, SuppliedValue, ValidationContext, Validator, ValueLink,
    validate_linked_value,
};
use tokio_util::sync::CancellationToken;

use crate::link::{LinkKind, Resolved, linked_value, present, resolve_link};
use crate::question::{Begun, TypedKind, TypedQuestion, ask_typed, begin, first_issue};
use crate::views::QuestionKind;

/// A validator that accepts any answer as typed: the answer of a question with no check of its
/// own.
#[derive(Clone, Copy, Debug, Default)]
pub struct Verbatim;

impl Validator for Verbatim {
    type Output = String;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<String, Vec<Issue>> {
        Ok(input.to_owned())
    }
}

/// The link a settings value holds: an option or an argument by name, asked with the question's
/// message.
fn relinked(link: Option<&ValueLink>, message: &str) -> Option<ValueLink> {
    match link? {
        ValueLink::Option { name, .. } => Some(ValueLink::option(name.clone(), message)),
        ValueLink::Argument { name, .. } => Some(ValueLink::argument(name.clone(), message)),
        _ => None,
    }
}

/// The settings of a text question.
#[must_use]
pub struct TextSettings {
    pub(crate) message: String,
    pub(crate) link: Option<ValueLink>,
    pub(crate) default: Option<String>,
    pub(crate) skip_if_supplied: bool,
}

impl TextSettings {
    /// A question with this message, a marked string of one line.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            link: None,
            default: None,
            skip_if_supplied: false,
        }
    }

    /// Links an input of the routed Command: a local option or an argument. Its raw supplied value
    /// prefills the question, its validated value answers a skipped one, and with interaction off
    /// a missing value is its missing-input failure. The question asks with its own message.
    pub fn link(self, link: ValueLink) -> Self {
        Self {
            link: Some(link),
            ..self
        }
    }

    /// Links the local option `name`.
    pub fn option(self, name: impl Into<String>) -> Self {
        let link = ValueLink::option(name, self.message.clone());
        self.link(link)
    }

    /// Links the argument `name`.
    pub fn argument(self, name: impl Into<String>) -> Self {
        let link = ValueLink::argument(name, self.message.clone());
        self.link(link)
    }

    /// Skips the question at a terminal when the linked input was supplied.
    pub fn skip_if_supplied(self) -> Self {
        Self {
            skip_if_supplied: true,
            ..self
        }
    }

    /// The question hint: the answer an empty line takes.
    pub fn default(self, value: impl Into<String>) -> Self {
        Self {
            default: Some(value.into()),
            ..self
        }
    }
}

/// The settings of a secret question: a text question whose answer never echoes, with no default.
#[must_use]
pub struct SecretSettings {
    pub(crate) message: String,
    pub(crate) link: Option<ValueLink>,
    pub(crate) skip_if_supplied: bool,
}

impl SecretSettings {
    /// A question with this message.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            link: None,
            skip_if_supplied: false,
        }
    }

    /// Links an input of the routed Command, as [`TextSettings::link`] does. A secret takes no
    /// prefill: asked, it starts empty even when its input was supplied.
    pub fn link(self, link: ValueLink) -> Self {
        Self {
            link: Some(link),
            ..self
        }
    }

    /// Links the local option `name`.
    pub fn option(self, name: impl Into<String>) -> Self {
        let link = ValueLink::option(name, self.message.clone());
        self.link(link)
    }

    /// Links the argument `name`.
    pub fn argument(self, name: impl Into<String>) -> Self {
        let link = ValueLink::argument(name, self.message.clone());
        self.link(link)
    }

    /// Skips the question at a terminal when the linked input was supplied.
    pub fn skip_if_supplied(self) -> Self {
        Self {
            skip_if_supplied: true,
            ..self
        }
    }
}

/// The settings of an editor question: a text question answered in the operator's editor.
#[must_use]
pub struct EditorSettings {
    pub(crate) message: String,
    pub(crate) link: Option<ValueLink>,
    pub(crate) default: Option<String>,
    pub(crate) skip_if_supplied: bool,
    pub(crate) extension: Option<String>,
}

impl EditorSettings {
    /// A question with this message.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            link: None,
            default: None,
            skip_if_supplied: false,
            extension: None,
        }
    }

    /// Links an input of the routed Command, as [`TextSettings::link`] does.
    pub fn link(self, link: ValueLink) -> Self {
        Self {
            link: Some(link),
            ..self
        }
    }

    /// Links the local option `name`.
    pub fn option(self, name: impl Into<String>) -> Self {
        let link = ValueLink::option(name, self.message.clone());
        self.link(link)
    }

    /// Links the argument `name`.
    pub fn argument(self, name: impl Into<String>) -> Self {
        let link = ValueLink::argument(name, self.message.clone());
        self.link(link)
    }

    /// Skips the question at a terminal when the linked input was supplied.
    pub fn skip_if_supplied(self) -> Self {
        Self {
            skip_if_supplied: true,
            ..self
        }
    }

    /// The text the editor's file starts with.
    pub fn default(self, value: impl Into<String>) -> Self {
        Self {
            default: Some(value.into()),
            ..self
        }
    }

    /// The file's extension, with or without its leading dot, such as `.md`, so the editor picks
    /// its syntax highlighting.
    pub fn extension(self, extension: impl Into<String>) -> Self {
        Self {
            extension: Some(extension.into()),
            ..self
        }
    }
}

/// The settings of a yes-or-no question.
#[must_use]
pub struct ConfirmSettings {
    pub(crate) message: String,
    pub(crate) default: Option<bool>,
    pub(crate) link: Option<ValueLink>,
    pub(crate) skip_if_supplied: bool,
}

impl ConfirmSettings {
    /// A question with this message.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            default: None,
            link: None,
            skip_if_supplied: false,
        }
    }

    /// The answer Enter takes.
    pub fn default(self, value: bool) -> Self {
        Self {
            default: Some(value),
            ..self
        }
    }

    /// Links a Boolean option of the routed Command.
    pub fn link(self, link: ValueLink) -> Self {
        Self {
            link: Some(link),
            ..self
        }
    }

    /// Links the local Boolean option `name`.
    pub fn option(self, name: impl Into<String>) -> Self {
        let link = ValueLink::option(name, self.message.clone());
        self.link(link)
    }

    /// Skips the question at a terminal when the linked option was supplied.
    pub fn skip_if_supplied(self) -> Self {
        Self {
            skip_if_supplied: true,
            ..self
        }
    }
}

/// One choice of a select or multiselect question.
#[derive(Clone, Debug)]
#[must_use]
pub struct Choice<T> {
    pub(crate) value: T,
    pub(crate) label: String,
    pub(crate) hint: Option<String>,
    pub(crate) disabled: Option<String>,
}

impl<T> Choice<T> {
    /// A choice with its value and label. The label is plain text.
    pub fn new(value: T, label: impl Into<String>) -> Self {
        Self {
            value,
            label: label.into(),
            hint: None,
            disabled: None,
        }
    }

    /// The description drawn under the list while the choice is highlighted, plain text.
    pub fn hint(self, hint: impl Into<String>) -> Self {
        Self {
            hint: Some(hint.into()),
            ..self
        }
    }

    /// Disables the choice, with the reason drawn beside it; an empty reason draws `(disabled)`.
    pub fn disabled(self, reason: impl Into<String>) -> Self {
        Self {
            disabled: Some(reason.into()),
            ..self
        }
    }
}

impl Choice<String> {
    /// A choice whose value is its label.
    pub fn text(value: impl Into<String>) -> Self {
        let value = value.into();
        Self::new(value.clone(), value)
    }
}

/// One entry of a list: a choice, or a separator drawn as a dimmed row of its text.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub enum ChoiceEntry<T> {
    /// A choice.
    Choice(Choice<T>),
    /// A separator, plain text; an empty one draws an empty row.
    Separator(String),
}

impl<T> From<Choice<T>> for ChoiceEntry<T> {
    fn from(choice: Choice<T>) -> Self {
        ChoiceEntry::Choice(choice)
    }
}

impl<T> ChoiceEntry<T> {
    /// A separator with this text.
    pub fn separator(text: impl Into<String>) -> Self {
        ChoiceEntry::Separator(text.into())
    }
}

/// A function that returns the choices for a search term, given a token the question cancels
/// when a newer call starts or the question ends. Its `Err` ends the question with that error.
pub type ChoiceSource<T> = Arc<
    dyn Fn(String, CancellationToken) -> BoxFuture<'static, Result<Vec<ChoiceEntry<T>>, Error>>
        + Send
        + Sync,
>;

/// What a select or multiselect offers: a list, searched or not, or a source.
pub(crate) enum ChoiceList<T> {
    Static {
        entries: Vec<ChoiceEntry<T>>,
        search: bool,
    },
    Source(ChoiceSource<T>),
}

/// The kind of a list settings value whose choices the author lists: [`SelectSettings::new`] and
/// [`MultiselectSettings::new`] make it, and only it takes `choice`, `separator`, and `search`.
#[derive(Clone, Copy, Debug)]
pub struct Listed;

/// The kind of a list settings value whose choices a source returns: `from_source` makes it. It
/// always searches, and it takes no `choice`, `separator`, or `search`, as the reference's types
/// reject `choices` and `search` beside `source`.
///
/// ```compile_fail
/// use loomcli_core::BoxFuture;
/// use loomcli_prompts::{Choice, ChoiceEntry, SelectSettings};
///
/// let settings = SelectSettings::from_source("Country", |_, _| -> BoxFuture<'static, _> {
///     Box::pin(async { Ok(vec![ChoiceEntry::from(Choice::text("Chile"))]) })
/// })
/// .choice(Choice::text("none"));
/// ```
///
/// ```
/// use loomcli_core::BoxFuture;
/// use loomcli_prompts::{Choice, ChoiceEntry, SelectSettings};
///
/// let settings = SelectSettings::from_source("Country", |_, _| -> BoxFuture<'static, _> {
///     Box::pin(async { Ok(vec![ChoiceEntry::from(Choice::text("Chile"))]) })
/// })
/// .default("Chile".to_owned());
/// ```
#[derive(Clone, Copy, Debug)]
pub struct Sourced;

/// The settings of a select question: `L` is [`Listed`] for choices the author lists, or
/// [`Sourced`] for choices a source returns.
#[must_use]
pub struct SelectSettings<T, L = Listed> {
    pub(crate) message: String,
    pub(crate) list: ChoiceList<T>,
    pub(crate) link: Option<ValueLink>,
    pub(crate) skip_if_supplied: bool,
    pub(crate) default: Option<T>,
    kind: PhantomData<L>,
}

impl<T: Clone + PartialEq + Send + Sync + 'static> SelectSettings<T, Listed> {
    /// A question with this message and these choices.
    pub fn new(message: impl Into<String>, choices: Vec<Choice<T>>) -> Self {
        Self {
            message: message.into(),
            list: ChoiceList::Static {
                entries: choices.into_iter().map(ChoiceEntry::Choice).collect(),
                search: false,
            },
            link: None,
            skip_if_supplied: false,
            default: None,
            kind: PhantomData,
        }
    }

    /// Appends a choice to the list.
    pub fn choice(mut self, choice: Choice<T>) -> Self {
        if let ChoiceList::Static { entries, .. } = &mut self.list {
            entries.push(ChoiceEntry::Choice(choice));
        }
        self
    }

    /// Appends a separator to the list.
    pub fn separator(mut self, text: impl Into<String>) -> Self {
        if let ChoiceList::Static { entries, .. } = &mut self.list {
            entries.push(ChoiceEntry::Separator(text.into()));
        }
        self
    }

    /// Filters the choices as the operator types: a choice shows while its label contains the
    /// term, compared in lowercase.
    pub fn search(mut self) -> Self {
        if let ChoiceList::Static { search, .. } = &mut self.list {
            *search = true;
        }
        self
    }
}

impl<T: Clone + PartialEq + Send + Sync + 'static> SelectSettings<T, Sourced> {
    /// A question whose choices `source` returns for each search term. It searches always, and
    /// takes no listed choice beside the source.
    pub fn from_source<F>(message: impl Into<String>, source: F) -> Self
    where
        F: Fn(String, CancellationToken) -> BoxFuture<'static, Result<Vec<ChoiceEntry<T>>, Error>>
            + Send
            + Sync
            + 'static,
    {
        Self {
            message: message.into(),
            list: ChoiceList::Source(Arc::new(source)),
            link: None,
            skip_if_supplied: false,
            default: None,
            kind: PhantomData,
        }
    }
}

impl<T: Clone + PartialEq + Send + Sync + 'static, L> SelectSettings<T, L> {
    /// The settings as the list question reads them, whose `list` holds their kind.
    pub(crate) fn erased(self) -> SelectSettings<T, Listed> {
        SelectSettings {
            message: self.message,
            list: self.list,
            link: self.link,
            skip_if_supplied: self.skip_if_supplied,
            default: self.default,
            kind: PhantomData,
        }
    }

    /// Links an input of the routed Command: a string option or argument that takes one value.
    /// A linked question's choices hold `String` values, and its answer is the input's validated
    /// value, asked or skipped.
    pub fn link(self, link: ValueLink) -> Self {
        Self {
            link: Some(link),
            ..self
        }
    }

    /// Links the local option `name`.
    pub fn option(self, name: impl Into<String>) -> Self {
        let link = ValueLink::option(name, self.message.clone());
        self.link(link)
    }

    /// Links the argument `name`.
    pub fn argument(self, name: impl Into<String>) -> Self {
        let link = ValueLink::argument(name, self.message.clone());
        self.link(link)
    }

    /// Skips the question at a terminal when the linked input was supplied.
    pub fn skip_if_supplied(self) -> Self {
        Self {
            skip_if_supplied: true,
            ..self
        }
    }

    /// The choice highlighted first, by value.
    pub fn default(self, value: T) -> Self {
        Self {
            default: Some(value),
            ..self
        }
    }
}

/// The settings of a multiselect question: `L` is [`Listed`] for choices the author lists, or
/// [`Sourced`] for choices a source returns.
#[must_use]
pub struct MultiselectSettings<T, L = Listed> {
    pub(crate) select: SelectSettings<T, L>,
    pub(crate) defaults: Option<Vec<T>>,
    pub(crate) min: usize,
    pub(crate) max: Option<usize>,
}

impl<T: Clone + PartialEq + Send + Sync + 'static> MultiselectSettings<T, Sourced> {
    /// A question whose choices `source` returns for each search term. It searches always, and
    /// takes no listed choice beside the source.
    pub fn from_source<F>(message: impl Into<String>, source: F) -> Self
    where
        F: Fn(String, CancellationToken) -> BoxFuture<'static, Result<Vec<ChoiceEntry<T>>, Error>>
            + Send
            + Sync
            + 'static,
    {
        Self {
            select: SelectSettings::from_source(message, source),
            defaults: None,
            min: 0,
            max: None,
        }
    }
}

impl<T: Clone + PartialEq + Send + Sync + 'static> MultiselectSettings<T, Listed> {
    /// A question with this message and these choices.
    pub fn new(message: impl Into<String>, choices: Vec<Choice<T>>) -> Self {
        Self {
            select: SelectSettings::new(message, choices),
            defaults: None,
            min: 0,
            max: None,
        }
    }

    /// Appends a choice to the list.
    pub fn choice(self, choice: Choice<T>) -> Self {
        Self {
            select: self.select.choice(choice),
            ..self
        }
    }

    /// Appends a separator to the list.
    pub fn separator(self, text: impl Into<String>) -> Self {
        Self {
            select: self.select.separator(text),
            ..self
        }
    }

    /// Filters the choices as the operator types.
    pub fn search(self) -> Self {
        Self {
            select: self.select.search(),
            ..self
        }
    }
}

impl<T: Clone + PartialEq + Send + Sync + 'static, L> MultiselectSettings<T, L> {
    /// Links a multiple string option or a variadic string argument of the routed Command.
    pub fn link(self, link: ValueLink) -> Self {
        Self {
            select: self.select.link(link),
            ..self
        }
    }

    /// Links the local option `name`.
    pub fn option(self, name: impl Into<String>) -> Self {
        Self {
            select: self.select.option(name),
            ..self
        }
    }

    /// Links the argument `name`.
    pub fn argument(self, name: impl Into<String>) -> Self {
        Self {
            select: self.select.argument(name),
            ..self
        }
    }

    /// Skips the question at a terminal when the linked input was supplied.
    pub fn skip_if_supplied(self) -> Self {
        Self {
            select: self.select.skip_if_supplied(),
            ..self
        }
    }

    /// The choices selected first, by value.
    pub fn default(self, values: Vec<T>) -> Self {
        Self {
            defaults: Some(values),
            ..self
        }
    }

    /// The fewest choices Enter submits.
    pub fn min(self, min: usize) -> Self {
        Self { min, ..self }
    }

    /// The most choices the operator can select.
    pub fn max(self, max: usize) -> Self {
        Self {
            max: Some(max),
            ..self
        }
    }
}

/// The raw supplied value of a typed question's link, its default, then the input's declared
/// default.
fn typed_prefill(
    supplied: Option<&SuppliedValue>,
    default: Option<&String>,
    declared: Option<&serde_json::Value>,
) -> Option<String> {
    if let Some(SuppliedValue::One(raw)) = supplied {
        return Some(raw.clone());
    }
    default
        .cloned()
        .or_else(|| declared.and_then(|value| value.as_str().map(str::to_owned)))
}

/// Checks `raw` with `validator` in the question phase.
fn judged<V: Validator>(
    validator: &V,
    raw: &str,
    validation: &ValidationContext,
) -> Result<(V::Output, Option<String>), String> {
    validator
        .validate(raw, validation)
        .map(|value| (value, None))
        .map_err(|issues| first_issue(&issues))
}

/// A question at its call: answered at once, or begun, with what it asks.
enum Start<T, S> {
    Done(Result<T, Error>),
    Ask(Begun, S),
}

/// Runs what a question decided at its call: its answer, or its asking.
async fn finish<T, S, F: Future<Output = Result<T, Error>>>(
    start: Start<T, S>,
    ask: impl FnOnce(Begun, S) -> F,
) -> Result<T, Error> {
    match start {
        Start::Done(result) => result,
        Start::Ask(begun, asked) => ask(begun, asked).await,
    }
}

/// Resolves a typed question at its call: skipped, or begun with its hint.
fn start_typed<I, R: 'static, T: Clone + Send + Sync + 'static>(
    context: &Context<I, R>,
    message: &str,
    link: Option<&ValueLink>,
    skip_if_supplied: bool,
    kind: (LinkKind, QuestionKind),
    default: Option<&String>,
) -> Start<T, Option<String>> {
    let resolved = context
        .signal
        .throw_if_cancelled()
        .and_then(|()| resolve_link(context, message, link, skip_if_supplied, kind.0));
    match resolved {
        Err(error) => Start::Done(Err(error)),
        Ok(Resolved::Answered) => {
            Start::Done(linked_value(context, link).and_then(|value| present(value, message)))
        }
        Ok(Resolved::Ask { supplied, declared }) => {
            let hint = typed_prefill(supplied.as_ref(), default, declared.as_ref());
            match begin(context, message, kind.1) {
                Ok(begun) => Start::Ask(begun, hint),
                Err(error) => Start::Done(Err(error)),
            }
        }
    }
}

/// Asks for one line of text; the answer passes `validator`, which may transform it. A linked
/// question skipped answers its input's validated value, which is then `V::Output`.
///
/// The question begins at the call, as the reference's does: raw mode holds and its input region
/// opens before the returned future is first polled, so questions asked at once take turns in
/// call order.
pub fn text<'a, I, R: 'static, V: Validator + 'a>(
    context: &'a Context<I, R>,
    settings: TextSettings,
    validator: V,
) -> impl Future<Output = Result<V::Output, Error>> + 'a {
    let link = relinked(settings.link.as_ref(), &settings.message);
    let start = start_typed(
        context,
        &settings.message,
        link.as_ref(),
        settings.skip_if_supplied,
        (LinkKind::Text, QuestionKind::Text),
        settings.default.as_ref(),
    );
    let message = settings.message;
    finish(start, move |begun, hint| async move {
        ask_typed(
            context,
            TypedQuestion {
                message: &message,
                kind: TypedKind::Text,
                hint,
                link: link.as_ref(),
            },
            begun,
            |raw, validation| judged(&validator, raw, validation),
        )
        .await
    })
}

/// Asks for a secret; the answer passes `validator` and never echoes. A secret takes no prefill.
pub fn secret<'a, I, R: 'static, V: Validator + 'a>(
    context: &'a Context<I, R>,
    settings: SecretSettings,
    validator: V,
) -> impl Future<Output = Result<V::Output, Error>> + 'a {
    let link = relinked(settings.link.as_ref(), &settings.message);
    let start = start_typed(
        context,
        &settings.message,
        link.as_ref(),
        settings.skip_if_supplied,
        (LinkKind::Secret, QuestionKind::Secret),
        None,
    );
    let message = settings.message;
    finish(start, move |begun, _| async move {
        ask_typed(
            context,
            TypedQuestion {
                message: &message,
                kind: TypedKind::Secret,
                hint: None,
                link: link.as_ref(),
            },
            begun,
            |raw, validation| judged(&validator, raw, validation),
        )
        .await
    })
}

/// Asks for text written in the operator's editor; the answer passes `validator`.
pub fn editor<'a, I, R: 'static, V: Validator + 'a>(
    context: &'a Context<I, R>,
    settings: EditorSettings,
    validator: V,
) -> impl Future<Output = Result<V::Output, Error>> + 'a {
    let link = relinked(settings.link.as_ref(), &settings.message);
    let start = start_typed(
        context,
        &settings.message,
        link.as_ref(),
        settings.skip_if_supplied,
        (LinkKind::Text, QuestionKind::Editor),
        settings.default.as_ref(),
    );
    let message = settings.message;
    let extension = settings.extension;
    finish(start, move |begun, hint| async move {
        crate::editor::ask_editor(
            context,
            crate::editor::EditorQuestion {
                message: &message,
                hint,
                extension: extension.as_deref(),
                link: link.as_ref(),
            },
            begun,
            |raw, validation| judged(&validator, raw, validation).map(|(value, _)| value),
        )
        .await
    })
}

/// Asks a yes-or-no question. Enter accepts `y`, `yes`, `n`, and `no` in any case.
pub fn confirm<'a, I, R: 'static>(
    context: &'a Context<I, R>,
    settings: ConfirmSettings,
) -> impl Future<Output = Result<bool, Error>> + 'a {
    let link = relinked(settings.link.as_ref(), &settings.message);
    let resolved = context.signal.throw_if_cancelled().and_then(|()| {
        resolve_link(
            context,
            &settings.message,
            link.as_ref(),
            settings.skip_if_supplied,
            LinkKind::Confirm,
        )
    });
    let start: Start<bool, Option<bool>> = match resolved {
        Err(error) => Start::Done(Err(error)),
        Ok(Resolved::Answered) => Start::Done(
            linked_value::<bool, I, R>(context, link.as_ref()).map(|value| value.unwrap_or(false)),
        ),
        Ok(Resolved::Ask { supplied, .. }) => {
            let prefill = match supplied {
                Some(SuppliedValue::Flag(flag)) => Some(flag),
                _ => settings.default,
            };
            match begin(context, &settings.message, QuestionKind::Confirm) {
                Ok(begun) => Start::Ask(begun, prefill),
                Err(error) => Start::Done(Err(error)),
            }
        }
    };
    let message = settings.message;
    finish(start, move |begun, prefill| async move {
        ask_typed(
            context,
            TypedQuestion {
                message: &message,
                kind: TypedKind::Confirm,
                hint: prefill.map(|yes| if yes { "yes" } else { "no" }.to_owned()),
                link: None,
            },
            begun,
            |raw, _| match raw.to_lowercase().as_str() {
                "y" | "yes" => Ok((true, Some("yes".to_owned()))),
                "n" | "no" => Ok((false, Some("no".to_owned()))),
                _ => Err("Type y or n.".to_owned()),
            },
        )
        .await
    })
}

/// Begins a list question at its call and asks it when awaited; `convert` turns each chosen value
/// into the answer.
fn list<'a, I, R: 'static, T, O, C>(
    context: &'a Context<I, R>,
    question: crate::list::ListQuestion<T>,
    convert: C,
) -> impl Future<Output = Result<Vec<O>, Error>> + 'a
where
    T: Clone + PartialEq + Send + Sync + 'static,
    O: Clone + Send + Sync + 'static,
    C: Fn(&T, Option<&ValueLink>) -> Result<Result<O, Vec<Issue>>, Error> + 'a,
{
    let start = context
        .signal
        .throw_if_cancelled()
        .and_then(|()| crate::list::begin_list::<I, R, T, O>(context, question));
    async move {
        match start? {
            crate::list::ListStart::Answered(values) => Ok(values),
            crate::list::ListStart::Ask(run) => {
                crate::list::run_list(context, *run, &convert).await
            }
        }
    }
}

/// A chosen value as the answer: itself, or, linked, its input's validated value.
fn chosen<I, R, T: Clone + Send + Sync + 'static>(
    context: &Context<I, R>,
) -> impl Fn(&T, Option<&ValueLink>) -> Result<Result<T, Vec<Issue>>, Error> + '_ {
    move |value, link| match (link, crate::list::text_of(value)) {
        (Some(link), Some(raw)) => validate_linked_value::<T, I, R>(context, link, raw),
        _ => Ok(Ok(value.clone())),
    }
}

/// A chosen string through the linked input's validator, as type `O`; with no link, a string `O`
/// is the value itself.
fn validated_as<I, R, O: Clone + Send + Sync + 'static>(
    context: &Context<I, R>,
    message: String,
) -> impl Fn(&String, Option<&ValueLink>) -> Result<Result<O, Vec<Issue>>, Error> + '_ {
    move |value, link| match link {
        Some(link) => validate_linked_value::<O, I, R>(context, link, value),
        None => {
            let any: Box<dyn std::any::Any> = Box::new(value.clone());
            any.downcast::<O>().map(|value| Ok(*value)).map_err(|_| {
                crate::link::invalid(
                    format!("The question \"{message}\" answers its input's value, and it links no input."),
                    "Link an option or argument, or ask with select or multiselect.",
                )
            })
        }
    }
}

fn single<T>(mut values: Vec<T>) -> Result<T, Error> {
    values
        .pop()
        .ok_or_else(|| Error::from_foreign("The select question answered no value.".into()))
}

/// Asks for one of the choices, and returns its value. A linked question's choices hold `String`
/// values, and it answers its input's validated value, asked or skipped, which is then a `String`:
/// [`select_as`] answers another type.
pub fn select<'a, I, R: 'static, T: Clone + PartialEq + Send + Sync + 'static, L>(
    context: &'a Context<I, R>,
    settings: SelectSettings<T, L>,
) -> impl Future<Output = Result<T, Error>> + 'a {
    let asked = list(
        context,
        crate::list::ListQuestion {
            settings: settings.erased(),
            defaults: None,
            min: 0,
            max: None,
            multiple: false,
        },
        chosen::<I, R, T>(context),
    );
    async move { single(asked.await?) }
}

/// Asks a linked select whose choices hold the input's raw values, and answers the input's
/// validated value of type `O`, asked or skipped: the reference's `ChoiceAnswer`.
pub fn select_as<'a, I, R: 'static, O: Clone + Send + Sync + 'static, L>(
    context: &'a Context<I, R>,
    settings: SelectSettings<String, L>,
) -> impl Future<Output = Result<O, Error>> + 'a {
    let message = settings.message.clone();
    let asked = list(
        context,
        crate::list::ListQuestion {
            settings: settings.erased(),
            defaults: None,
            min: 0,
            max: None,
            multiple: false,
        },
        validated_as::<I, R, O>(context, message),
    );
    async move { single(asked.await?) }
}

/// Asks for any of the choices, and returns their values in the order they were selected.
pub fn multiselect<'a, I, R: 'static, T: Clone + PartialEq + Send + Sync + 'static, L>(
    context: &'a Context<I, R>,
    settings: MultiselectSettings<T, L>,
) -> impl Future<Output = Result<Vec<T>, Error>> + 'a {
    list(
        context,
        crate::list::ListQuestion {
            settings: settings.select.erased(),
            defaults: settings.defaults,
            min: settings.min,
            max: settings.max,
            multiple: true,
        },
        chosen::<I, R, T>(context),
    )
}

/// Asks a linked multiselect whose choices hold the input's raw values, and answers the input's
/// validated values of type `O`, in selection order, asked or skipped.
pub fn multiselect_as<'a, I, R: 'static, O: Clone + Send + Sync + 'static, L>(
    context: &'a Context<I, R>,
    settings: MultiselectSettings<String, L>,
) -> impl Future<Output = Result<Vec<O>, Error>> + 'a {
    let message = settings.select.message.clone();
    list(
        context,
        crate::list::ListQuestion {
            settings: settings.select.erased(),
            defaults: settings.defaults,
            min: settings.min,
            max: settings.max,
            multiple: true,
        },
        validated_as::<I, R, O>(context, message),
    )
}
