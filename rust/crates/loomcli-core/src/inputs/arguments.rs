//! Argument builders: string and content arguments.

use crate::diagnostics::Literal;
use crate::plugins::{ArgumentTarget, ExtensionValue};

use super::options::{DefaultValue, ErasedValidator};
use super::{OmissionValidator, Validator};

/// The constructors of the argument builders.
pub struct Arg;

impl Arg {
    /// A string argument that takes one word by default. With [`StringArg::variadic`], it takes
    /// the words left after binding the other arguments.
    pub fn string() -> StringArg {
        <StringArg as Default>::default()
    }

    /// A content argument: a file path, or `-` and piped stdin with [`ContentArg::stdin`].
    pub fn content() -> ContentArg {
        <ContentArg as Default>::default()
    }
}

/// A string argument builder.
#[derive(Clone, Default)]
#[must_use]
pub struct StringArg {
    pub(crate) description: Option<String>,
    pub(crate) required: bool,
    pub(crate) required_non_interactive: bool,
    pub(crate) variadic: bool,
    pub(crate) default: Option<DefaultValue>,
    pub(crate) validator: Option<ErasedValidator>,
    pub(crate) validate_omitted: bool,
    pub(crate) extensions: Vec<ExtensionValue<ArgumentTarget>>,
    pub(crate) chain: Vec<(&'static str, Vec<Literal>)>,
}

impl StringArg {
    /// Sets the description every projection reads.
    pub fn description(mut self, text: impl Into<String>) -> Self {
        let text = text.into();
        called(&mut self.chain, "description", vec![text.as_str().into()]);
        self.description = Some(text);
        self
    }

    /// Makes the argument required: present, or for a variadic argument at least one word.
    pub fn required(mut self) -> Self {
        called(&mut self.chain, "required", Vec::new());
        self.required = true;
        self
    }

    /// Makes the argument required only when the run cannot ask the operator.
    pub fn required_when_non_interactive(mut self) -> Self {
        called(&mut self.chain, "required_when_non_interactive", Vec::new());
        self.required_non_interactive = true;
        self
    }

    /// Takes the words left after fixed arguments. Only required scalar string arguments may
    /// follow a variadic argument, and they bind from the end.
    pub fn variadic(mut self) -> Self {
        called(&mut self.chain, "variadic", Vec::new());
        self.variadic = true;
        self
    }

    /// Declares the default, a raw value in the validator's input type.
    pub fn default(mut self, value: impl Into<DefaultValue>) -> Self {
        let value = value.into();
        called(&mut self.chain, "default", vec![value.literal()]);
        self.default = Some(value);
        self
    }

    /// Validates each value with `validator`; the action reads its output.
    pub fn validate<V: Validator>(mut self, validator: V) -> Self {
        self.chain
            .retain(|(setter, _)| *setter != "validate_omitted");
        called(&mut self.chain, "validate", vec![Literal::Opaque]);
        self.validator = Some(ErasedValidator::new(validator));
        self.validate_omitted = false;
        self
    }

    /// Validates with `validator`, and sends the argument's omission to it too.
    pub fn validate_omitted<V: OmissionValidator>(mut self, validator: V) -> Self {
        self.chain.retain(|(setter, _)| *setter != "validate");
        called(&mut self.chain, "validate_omitted", vec![Literal::Opaque]);
        self.validator = Some(ErasedValidator::omitting(validator));
        self.validate_omitted = true;
        self
    }

    /// Attaches extension values.
    pub fn extend(mut self, values: impl crate::IntoList<ExtensionValue<ArgumentTarget>>) -> Self {
        let values = values.into_list();
        called(
            &mut self.chain,
            "extend",
            vec![crate::plugins::extension_values_literal(values.len())],
        );
        self.extensions = values;
        self
    }
}

/// A content argument builder.
#[derive(Clone, Default)]
#[must_use]
pub struct ContentArg {
    pub(crate) description: Option<String>,
    pub(crate) required: bool,
    pub(crate) variadic: bool,
    pub(crate) stdin: bool,
    pub(crate) min: Option<usize>,
    pub(crate) max: Option<usize>,
    pub(crate) extensions: Vec<ExtensionValue<ArgumentTarget>>,
    pub(crate) chain: Vec<(&'static str, Vec<Literal>)>,
}

impl ContentArg {
    /// Sets the description every projection reads.
    pub fn description(mut self, text: impl Into<String>) -> Self {
        let text = text.into();
        called(&mut self.chain, "description", vec![text.as_str().into()]);
        self.description = Some(text);
        self
    }

    /// Makes the argument required.
    pub fn required(mut self) -> Self {
        called(&mut self.chain, "required", Vec::new());
        self.required = true;
        self
    }

    /// Takes the words left after binding the other arguments and reads them as sources.
    pub fn variadic(mut self) -> Self {
        called(&mut self.chain, "variadic", Vec::new());
        self.variadic = true;
        self
    }

    /// Reads piped stdin when the argument is omitted, or supplied as `-`.
    pub fn stdin(mut self) -> Self {
        called(&mut self.chain, "stdin", Vec::new());
        self.stdin = true;
        self
    }

    /// The fewest sources a variadic argument accepts.
    pub fn min(mut self, count: usize) -> Self {
        called(&mut self.chain, "min", vec![Literal::from(count as f64)]);
        self.min = Some(count);
        self
    }

    /// The most sources a variadic argument accepts.
    pub fn max(mut self, count: usize) -> Self {
        called(&mut self.chain, "max", vec![Literal::from(count as f64)]);
        self.max = Some(count);
        self
    }

    /// Attaches extension values.
    pub fn extend(mut self, values: impl crate::IntoList<ExtensionValue<ArgumentTarget>>) -> Self {
        let values = values.into_list();
        called(
            &mut self.chain,
            "extend",
            vec![crate::plugins::extension_values_literal(values.len())],
        );
        self.extensions = values;
        self
    }
}

/// An argument declaration of either kind, as `argument()` takes it.
#[derive(Clone)]
#[non_exhaustive]
pub enum ArgumentDecl {
    /// A string argument.
    String(StringArg),
    /// A content argument.
    Content(ContentArg),
}

impl From<StringArg> for ArgumentDecl {
    fn from(argument: StringArg) -> Self {
        ArgumentDecl::String(argument)
    }
}

impl From<ContentArg> for ArgumentDecl {
    fn from(argument: ContentArg) -> Self {
        ArgumentDecl::Content(argument)
    }
}

/// Records a setter call for the printed chain, replacing an earlier call of the same setter.
fn called(
    chain: &mut Vec<(&'static str, Vec<Literal>)>,
    setter: &'static str,
    arguments: Vec<Literal>,
) {
    chain.retain(|(known, _)| *known != setter);
    chain.push((setter, arguments));
}

impl ArgumentDecl {
    /// The builder chain a finding prints.
    pub(crate) fn literal(&self) -> Literal {
        let (start, chain) = match self {
            ArgumentDecl::String(argument) => ("Arg::string()", &argument.chain),
            ArgumentDecl::Content(argument) => ("Arg::content()", &argument.chain),
        };
        chain
            .iter()
            .fold(Literal::builder(start), |literal, (setter, arguments)| {
                literal.call(*setter, arguments.clone())
            })
    }

    /// Whether `required()` was declared.
    pub(crate) fn required(&self) -> bool {
        match self {
            ArgumentDecl::String(argument) => argument.required,
            ArgumentDecl::Content(argument) => argument.required,
        }
    }

    /// Whether it counts as required where arguments are ordered: `required()`, or a content
    /// argument whose `min` is positive.
    pub(crate) fn ordered_required(&self) -> bool {
        match self {
            ArgumentDecl::String(argument) => argument.required,
            ArgumentDecl::Content(argument) => argument.required || argument.min.unwrap_or(0) > 0,
        }
    }

    /// Whether it is required only when the run cannot ask.
    pub(crate) fn non_interactive(&self) -> bool {
        matches!(self, ArgumentDecl::String(argument) if argument.required_non_interactive)
    }

    /// Whether it takes the words left after fixed arguments.
    pub(crate) fn variadic(&self) -> bool {
        match self {
            ArgumentDecl::String(argument) => argument.variadic,
            ArgumentDecl::Content(argument) => argument.variadic,
        }
    }

    /// Whether it is a content argument that claims stdin.
    pub(crate) fn claims_stdin(&self) -> bool {
        matches!(self, ArgumentDecl::Content(argument) if argument.stdin)
    }

    /// Its extension values.
    pub(crate) fn extensions(&self) -> &[ExtensionValue<ArgumentTarget>] {
        match self {
            ArgumentDecl::String(argument) => &argument.extensions,
            ArgumentDecl::Content(argument) => &argument.extensions,
        }
    }

    /// The first pair of facts this builder combines that exclude each other: the setter that
    /// breaks the rule and the sentence's reason.
    pub(crate) fn config_conflict(&self) -> Option<(&'static str, String)> {
        match self {
            ArgumentDecl::String(argument) => {
                if argument.required && argument.required_non_interactive {
                    return Some((
                        "required_when_non_interactive",
                        "declares both required and required_when_non_interactive".to_owned(),
                    ));
                }
                if (argument.required || argument.required_non_interactive)
                    && argument.default.is_some()
                {
                    return Some(("default", "declares a default beside required".to_owned()));
                }
                if argument.validate_omitted {
                    for (present, setter) in [
                        (
                            argument.required || argument.required_non_interactive,
                            "required",
                        ),
                        (argument.default.is_some(), "default"),
                        (argument.variadic, "variadic"),
                    ] {
                        if present {
                            return Some((
                                "validate_omitted",
                                format!("declares validate_omitted beside {setter}"),
                            ));
                        }
                    }
                }
                if matches!(argument.default, Some(DefaultValue::Tuples(_))) {
                    return Some((
                        "default",
                        "declares a grouped default, which only a multiple arity option takes"
                            .to_owned(),
                    ));
                }
                if let Some(DefaultValue::Many(_)) = argument.default
                    && !argument.variadic
                {
                    return Some((
                        "default",
                        "declares a list default on an argument that is not variadic".to_owned(),
                    ));
                }
                None
            }
            ArgumentDecl::Content(argument) => {
                if !argument.variadic && (argument.min.is_some() || argument.max.is_some()) {
                    let setter = if argument.min.is_some() { "min" } else { "max" };
                    return Some((setter, format!("declares {setter} without variadic")));
                }
                None
            }
        }
    }
}
