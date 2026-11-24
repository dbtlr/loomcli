//! Typed inputs: the `Inputs` trait `#[derive(Inputs)]` implements, the declarations it expands to,
//! and the value table it extracts from.

use std::any::{Any, TypeId};
use std::collections::BTreeMap;
use std::sync::Arc;

use crate::__private::RawValue;
use crate::commands::{Leaf, State, TakesArguments};
use crate::failures::Error;

use super::{ArgumentDecl, Content, OptionDecl, Stdin};

/// A struct whose fields are a Command's arguments and options.
///
/// [`#[derive(Inputs)]`](derive@crate::Inputs) implements it, and its documentation states the
/// attribute grammar and the field types. The expansion is public contract, so an author may write it by
/// hand: [`Inputs::declare`] makes one builder call per field, the calls `Command::argument` and
/// `Command::option` take, [`Inputs::extract`] reads each field from the validated invocation by
/// its declared name, and [`Inputs::into_values`] is its inverse, which a test's context builder
/// uses to hand typed values to code that reads by name.
pub trait Inputs: Sized + Send + Sync + 'static {
    /// [`Arguments`] when a field is an argument, [`NoArguments`] otherwise. It decides the authoring
    /// state `inputs::<I>()` moves a Command to: a Command declares arguments or children, not both.
    type Shape;

    /// The builder calls for each field, in field order.
    fn declare(declarations: Declarations) -> Declarations;

    /// The struct, read from the validated values by declared name.
    fn extract(values: &InputValues) -> Result<Self, Error>;

    /// The values, keyed by declared name in the shape [`Inputs::extract`] reads: the inverse of
    /// `extract`, so `I::extract(&i.into_values())` reads `i` back.
    fn into_values(self) -> InputValues;
}

/// An inputs struct whose every field may be a global option: no argument, no content option, no
/// stdin, and no presence rule. `#[derive(Inputs)]` implements it for exactly those structs, so
/// `Application::globals::<G>()` and `Plugin::options::<O>()` reject any other at the call, under
/// `cargo check`.
#[diagnostic::on_unimplemented(
    message = "`{Self}` cannot be global options: global options take no argument, content option, stdin, or presence rule",
    label = "a field of `{Self}` is an argument, a content option, stdin, or a required option",
    note = "declare those inputs on the Command with `inputs::<I>()` instead"
)]
pub trait GlobalInputs: Inputs {}

/// The inputs of a declaration that reads none typed. Its action reads by name.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoInputs;

impl Inputs for NoInputs {
    type Shape = NoArguments;

    fn declare(declarations: Declarations) -> Declarations {
        declarations
    }

    fn extract(_values: &InputValues) -> Result<Self, Error> {
        Ok(NoInputs)
    }

    fn into_values(self) -> InputValues {
        InputValues::default()
    }
}

impl GlobalInputs for NoInputs {}

/// The shape of an inputs struct that declares at least one argument.
pub struct Arguments;

/// The shape of an inputs struct that declares no argument.
pub struct NoArguments;

/// The authoring state a declaration moves to when it takes inputs of this shape in state `S`.
#[diagnostic::on_unimplemented(
    message = "a Command declares arguments or attaches children, never both",
    label = "these inputs declare arguments, and this Command already attached a child or registered its action"
)]
pub trait Shape<S: State> {
    /// The state after the inputs are declared.
    type After: State;
}

impl<S: TakesArguments> Shape<S> for Arguments {
    type After = Leaf;
}

impl<S: State> Shape<S> for NoArguments {
    type After = S::Declared;
}

/// The builder calls an `Inputs` struct makes, collected in call order and then applied to the
/// Command, Application, or plugin that takes the struct, at that call, through that declaration's
/// own `argument()`, `option()`, `stdin()`, and group calls.
#[derive(Clone, Default)]
#[must_use]
pub struct Declarations {
    pub(crate) calls: Vec<DeclarationCall>,
}

/// One collected builder call.
#[derive(Clone)]
pub(crate) enum DeclarationCall {
    Argument(String, ArgumentDecl),
    Option(String, OptionDecl),
    Stdin(Stdin),
    Group(crate::inspection::OptionGroupKind, Vec<String>),
}

impl Declarations {
    /// No declarations.
    pub fn new() -> Self {
        Self::default()
    }

    /// Declares an argument.
    pub fn argument(mut self, name: &str, argument: impl Into<ArgumentDecl>) -> Self {
        self.calls
            .push(DeclarationCall::Argument(name.to_owned(), argument.into()));
        self
    }

    /// Declares an option.
    pub fn option(mut self, name: &str, option: impl Into<OptionDecl>) -> Self {
        self.calls
            .push(DeclarationCall::Option(name.to_owned(), option.into()));
        self
    }

    /// Declares standalone stdin.
    pub fn stdin(mut self, stdin: Stdin) -> Self {
        self.calls.push(DeclarationCall::Stdin(stdin));
        self
    }

    /// Declares that at most one of these options is supplied.
    pub fn exclusive(self, names: &[&str]) -> Self {
        self.group(crate::inspection::OptionGroupKind::Exclusive, names)
    }

    /// Declares that at least one of these options is supplied.
    pub fn one_required(self, names: &[&str]) -> Self {
        self.group(crate::inspection::OptionGroupKind::OneRequired, names)
    }

    /// Declares that these options are supplied together or not at all.
    pub fn required_together(self, names: &[&str]) -> Self {
        self.group(crate::inspection::OptionGroupKind::RequiredTogether, names)
    }

    fn group(mut self, kind: crate::inspection::OptionGroupKind, names: &[&str]) -> Self {
        self.calls.push(DeclarationCall::Group(
            kind,
            names.iter().map(|name| (*name).to_owned()).collect(),
        ));
        self
    }
}

/// A value read by name from validated inputs: `Option<T>` for one value, `Vec<T>` for several,
/// `bool` for a Boolean option, and an unsigned integer for a counted option.
pub trait FromInputValue: Sized {
    #[doc(hidden)]
    fn from_input(value: &RawValue) -> Option<Self>;
}

impl<T: Clone + Send + Sync + 'static> FromInputValue for Option<T> {
    fn from_input(value: &RawValue) -> Option<Self> {
        match value {
            RawValue::Absent => Some(None),
            RawValue::One(one) => one.downcast_ref::<T>().map(|one| Some(one.clone())),
            // A Boolean or a count reads through `Option` too, so a record that holds an option
            // only once it validated, such as a plugin's own options, reads its absence as `None`.
            RawValue::Flag(flag) => (flag as &dyn Any).downcast_ref::<T>().cloned().map(Some),
            RawValue::Count(count) => counted::<T>(*count).map(Some),
            RawValue::Many(_) => None,
        }
    }
}

/// A count read as the unsigned integer type `T`, its largest value beyond its range, or `None`
/// for a `T` that is no unsigned integer type.
fn counted<T: Clone + 'static>(count: u32) -> Option<T> {
    let saturated = |value: Option<Box<dyn Any>>| value?.downcast::<T>().ok().map(|value| *value);
    let target = TypeId::of::<T>();
    let value: Option<Box<dyn Any>> = if target == TypeId::of::<u8>() {
        Some(Box::new(u8::try_from(count).unwrap_or(u8::MAX)))
    } else if target == TypeId::of::<u16>() {
        Some(Box::new(u16::try_from(count).unwrap_or(u16::MAX)))
    } else if target == TypeId::of::<u32>() {
        Some(Box::new(count))
    } else if target == TypeId::of::<u64>() {
        Some(Box::new(u64::from(count)))
    } else if target == TypeId::of::<usize>() {
        Some(Box::new(usize::try_from(count).unwrap_or(usize::MAX)))
    } else {
        None
    };
    saturated(value)
}

impl<T: Clone + Send + Sync + 'static> FromInputValue for Vec<T> {
    fn from_input(value: &RawValue) -> Option<Self> {
        match value {
            RawValue::Absent => Some(Vec::new()),
            RawValue::Many(values) => values
                .iter()
                .map(|value| value.downcast_ref::<T>().cloned())
                .collect(),
            // A validator of one value may answer a list, which reads whole.
            RawValue::One(one) => one.downcast_ref::<Vec<T>>().cloned(),
            _ => None,
        }
    }
}

impl FromInputValue for bool {
    fn from_input(value: &RawValue) -> Option<Self> {
        match value {
            RawValue::Flag(flag) => Some(*flag),
            _ => None,
        }
    }
}

macro_rules! count_values {
    ($($integer:ty),+) => {
        $(
            impl FromInputValue for $integer {
                fn from_input(value: &RawValue) -> Option<Self> {
                    match value {
                        // A count beyond the type's range reads as its largest value.
                        RawValue::Count(count) => {
                            Some(<$integer>::try_from(*count).unwrap_or(<$integer>::MAX))
                        }
                        _ => None,
                    }
                }
            }
        )+
    };
}

count_values!(u8, u16, u32, u64, usize);

/// A value written by name into [`InputValues`], the inverse of [`FromInputValue`]: `Option<T>` for
/// one optional value, `Vec<T>` for several, `bool` for a Boolean option, an unsigned integer for a
/// counted option, and [`Required`] for a value validation guarantees.
pub trait IntoInputValue {
    #[doc(hidden)]
    fn into_input(self) -> RawValue;
}

/// A value validation guarantees is present, written by name: the inverse of
/// [`InputValues::required_option`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Required<T>(pub T);

impl<T: Clone + Send + Sync + 'static> IntoInputValue for Required<T> {
    fn into_input(self) -> RawValue {
        RawValue::One(Arc::new(self.0))
    }
}

impl<T: Clone + Send + Sync + 'static> IntoInputValue for Option<T> {
    fn into_input(self) -> RawValue {
        self.map_or(RawValue::Absent, |value| RawValue::One(Arc::new(value)))
    }
}

impl<T: Clone + Send + Sync + 'static> IntoInputValue for Vec<T> {
    fn into_input(self) -> RawValue {
        RawValue::Many(
            self.into_iter()
                .map(|value| Arc::new(value) as Arc<dyn Any + Send + Sync>)
                .collect(),
        )
    }
}

impl IntoInputValue for bool {
    fn into_input(self) -> RawValue {
        RawValue::Flag(self)
    }
}

macro_rules! count_inputs {
    ($($integer:ty),+) => {
        $(
            impl IntoInputValue for $integer {
                fn into_input(self) -> RawValue {
                    RawValue::Count(u32::try_from(self).unwrap_or(u32::MAX))
                }
            }
        )+
    };
}

count_inputs!(u8, u16, u32, u64, usize);

/// The validated values of one scope, keyed by declared name: the routed Command's arguments and
/// local options, or the global options.
#[derive(Clone, Default)]
pub struct InputValues {
    pub(crate) arguments: BTreeMap<String, RawValue>,
    pub(crate) options: BTreeMap<String, RawValue>,
    pub(crate) stdin: Option<Content>,
}

impl InputValues {
    /// An empty table, for a test or a hand-written [`Inputs::into_values`].
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The table with the option `name` set to `value`.
    #[must_use]
    pub fn with_option(mut self, name: &str, value: impl IntoInputValue) -> Self {
        self.options.insert(name.to_owned(), value.into_input());
        self
    }

    /// The table with the argument `name` set to `value`.
    #[must_use]
    pub fn with_argument(mut self, name: &str, value: impl IntoInputValue) -> Self {
        self.arguments.insert(name.to_owned(), value.into_input());
        self
    }

    /// The table with the standalone stdin set.
    #[must_use]
    pub fn with_stdin(mut self, stdin: Option<Content>) -> Self {
        self.stdin = stdin;
        self
    }

    /// The option `name`, read as `T`. A name this scope does not declare, or a `T` that does not
    /// match its declaration, is the `input-read` declaration fault.
    pub fn option<T: FromInputValue>(&self, name: &str) -> Result<T, Error> {
        read_as(self.options.get(name), Read::option(name))
    }

    /// The argument `name`, read as `T`, under the rules [`InputValues::option`] states.
    pub fn argument<T: FromInputValue>(&self, name: &str) -> Result<T, Error> {
        read_as(self.arguments.get(name), Read::argument(name))
    }

    /// The option `name`, which validation guarantees is present, read as `T`. An absent value
    /// is the `input-read` declaration fault, as an undeclared name and another type are.
    pub fn required_option<T: Clone + Send + Sync + 'static>(
        &self,
        name: &str,
    ) -> Result<T, Error> {
        read_present(self.options.get(name), Read::option(name))
    }

    /// The argument `name`, which validation guarantees is present, read as `T`.
    pub fn required_argument<T: Clone + Send + Sync + 'static>(
        &self,
        name: &str,
    ) -> Result<T, Error> {
        read_present(self.arguments.get(name), Read::argument(name))
    }

    /// The standalone stdin, when the scope declares it and the operator piped it.
    #[must_use]
    pub fn stdin(&self) -> Option<Content> {
        self.stdin.clone()
    }

    /// The standalone stdin a required declaration guarantees. Its absence is the `input-read`
    /// declaration fault.
    pub fn required_stdin(&self) -> Result<Content, Error> {
        self.stdin.clone().ok_or_else(|| {
            input_read(
                "The inputs read stdin as required, which the run did not supply.".to_owned(),
            )
        })
    }

    /// The names of the options the table holds, in name order.
    pub(crate) fn option_names(&self) -> Vec<String> {
        self.options.keys().cloned().collect()
    }

    /// Whether the scope holds `name` as an option.
    pub(crate) fn has_option(&self, name: &str) -> bool {
        self.options.contains_key(name)
    }
}

/// Which input a typed read names, for its fault's sentence.
struct Read<'a> {
    kind: &'static str,
    name: &'a str,
}

impl<'a> Read<'a> {
    fn option(name: &'a str) -> Self {
        Self {
            kind: "option",
            name,
        }
    }

    fn argument(name: &'a str) -> Self {
        Self {
            kind: "argument",
            name,
        }
    }
}

/// The correction every typed read's fault states.
const READ_CORRECTION: &str = "Read an input the routed Command or the Application declares, as the type its declaration produces: Option<T> for one value, Vec<T> for several, bool for a Boolean option, and an unsigned integer for a counted option, where T is the validator's output, or String without one.";

/// The `input-read` fault with this sentence.
pub(crate) fn input_read(sentence: String) -> Error {
    crate::failures::DeclarationError::new(
        crate::diagnostics::rules::INPUT_READ,
        crate::diagnostics::DiagnosticParts::new(sentence).correction(READ_CORRECTION),
    )
    .into()
}

fn undeclared(read: &Read<'_>) -> Error {
    input_read(format!(
        "The inputs read {} {}, which the routed Command does not declare.",
        read.kind,
        crate::failures::sentences::quoted(read.name)
    ))
}

fn mismatched(read: &Read<'_>) -> Error {
    input_read(format!(
        "The inputs read {} {} as another type than its declaration produces.",
        read.kind,
        crate::failures::sentences::quoted(read.name)
    ))
}

/// The correction of a read that needs a value the run does not hold.
const ABSENT_CORRECTION: &str = "Read an input that may hold no value as Option<T>: Option<bool> for a Boolean option and Option<u32> for a counted one. A middleware reads every global option as absent while its options are None, which they are when a global option did not validate.";

/// A read as a type that always holds a value, of an input the run holds no value for.
fn unheld(read: &Read<'_>) -> Error {
    crate::failures::DeclarationError::new(
        crate::diagnostics::rules::INPUT_READ,
        crate::diagnostics::DiagnosticParts::new(format!(
            "The inputs read {} {} as a type that always holds a value, and the run holds none for it.",
            read.kind,
            crate::failures::sentences::quoted(read.name)
        ))
        .correction(ABSENT_CORRECTION),
    )
    .into()
}

/// One value read as `T`, or the fault the read is.
fn read_as<T: FromInputValue>(value: Option<&RawValue>, read: Read<'_>) -> Result<T, Error> {
    let value = value.ok_or_else(|| undeclared(&read))?;
    T::from_input(value).ok_or_else(|| match value {
        RawValue::Absent => unheld(&read),
        _ => mismatched(&read),
    })
}

/// One present value read as `T`, or the fault the read is.
fn read_present<T: Clone + Send + Sync + 'static>(
    value: Option<&RawValue>,
    read: Read<'_>,
) -> Result<T, Error> {
    match value.ok_or_else(|| undeclared(&read))? {
        RawValue::One(one) => one
            .downcast_ref::<T>()
            .cloned()
            .ok_or_else(|| mismatched(&read)),
        RawValue::Absent => Err(input_read(format!(
            "The inputs read {} {} as required, which the run did not supply.",
            read.kind,
            crate::failures::sentences::quoted(read.name)
        ))),
        _ => Err(mismatched(&read)),
    }
}

/// What an operator supplied for one input, before validation.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum SuppliedValue {
    /// One raw string.
    One(String),
    /// Several raw strings.
    Many(Vec<String>),
    /// A Boolean option's value.
    Flag(bool),
    /// A counted option's count.
    Count(u32),
}

/// The raw values the invocation supplied, by declared name, before validation.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct SuppliedInputs {
    /// Argument values.
    pub args: BTreeMap<String, SuppliedValue>,
    /// Option values, local and global.
    pub options: BTreeMap<String, SuppliedValue>,
}

/// Type equality, which `#[derive(Inputs)]` asserts between a field's type and the type its input
/// reads.
#[diagnostic::on_unimplemented(
    message = "this field is `{Self}`, but its input reads a `{T}`",
    label = "the field type must be `{T}`",
    note = "an input without `validate` reads a `String`; one with `validate` reads the validator's `Output`"
)]
pub trait IsType<T> {}

impl<T> IsType<T> for T {}

/// Compile-time proof that `Field` is the validator's output type. `#[derive(Inputs)]` calls it, at
/// the field type's span, in code that never runs; a hand-written impl may omit it.
pub fn assert_validator_output<Field, V>(_validator: &V)
where
    V: crate::Validator,
    Field: IsType<V::Output>,
{
}

/// Compile-time proof that an unvalidated string input's field is a `String`. `#[derive(Inputs)]`
/// calls it, at the field type's span; a hand-written impl may omit it.
pub fn assert_string_input<Field: IsType<String>>() {}
