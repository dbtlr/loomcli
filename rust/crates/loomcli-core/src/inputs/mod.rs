//! Options, arguments, option groups, input sources, validation, and content inputs.
//!
//! The dynamic builders ([`Opt`], [`Arg`]) are the one runtime representation of an input.
//! `#[derive(Inputs)]` expands a struct to calls on them through [`Declarations`] and to a typed
//! extraction from [`InputValues`], so an action reads typed fields while plugins read by name.

mod arguments;
pub(crate) mod content;
pub(crate) mod declared;
pub(crate) mod groups;
pub(crate) mod interaction;
pub(crate) mod messages;
mod options;
pub(crate) mod pass;
pub(crate) mod sources;
pub(crate) mod table;
mod typed;
mod validation;

pub use arguments::{Arg, ArgumentDecl, ContentArg, StringArg};
pub use content::{Content, ContentKind, Stdin};
pub use interaction::{
    ValueLink, missing_input_error, question_validation_context, validate_linked_value,
};
pub use options::{
    BooleanOpt, ContentOpt, CountOpt, DefaultValue, GlobalOptionDecl, Opt, OptionDecl, Polarity,
    StringOpt,
};
pub(crate) use typed::DeclarationCall;
pub use typed::{
    Arguments, Declarations, FromInputValue, GlobalInputs, InputValues, Inputs, IntoInputValue,
    IsType, NoArguments, NoInputs, Required, Shape, SuppliedInputs, SuppliedValue,
    assert_string_input, assert_validator_output,
};
pub use validation::{
    InputIdentity, InputKind, InputProblem, Issue, OmissionValidator, PathSegment,
    ValidationContext, ValidationFacts, ValidationPhase, Validator, issue_path, validation_context,
};
