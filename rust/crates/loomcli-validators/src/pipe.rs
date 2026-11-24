//! `pipe`: a validator followed by steps that refine or transform its output.

use loomcli_core::{InputSchema, Issue, OmissionValidator, ValidationContext, Validator};

/// A validator piped through a step. It publishes the first validator's input schema.
#[must_use]
pub struct Piped<V, S> {
    first: V,
    step: S,
}

/// Pipes `first`'s output through `step`, which refines it or rejects it with issues.
pub fn pipe<V, S, O>(first: V, step: S) -> Piped<V, S>
where
    V: Validator,
    O: Clone + Send + Sync + 'static,
    S: Fn(V::Output, &ValidationContext) -> Result<O, Vec<Issue>> + Send + Sync + 'static,
{
    Piped { first, step }
}

impl<V, S> Piped<V, S> {
    /// Pipes this validator's output through another step.
    pub fn pipe<T, O>(self, step: T) -> Piped<Self, T>
    where
        Self: Validator,
        O: Clone + Send + Sync + 'static,
        T: Fn(<Self as Validator>::Output, &ValidationContext) -> Result<O, Vec<Issue>>
            + Send
            + Sync
            + 'static,
    {
        Piped { first: self, step }
    }
}

impl<V, S, O> Validator for Piped<V, S>
where
    V: Validator,
    O: Clone + Send + Sync + 'static,
    S: Fn(V::Output, &ValidationContext) -> Result<O, Vec<Issue>> + Send + Sync + 'static,
{
    type Output = O;

    fn validate(&self, input: &str, context: &ValidationContext) -> Result<O, Vec<Issue>> {
        let value = self.first.validate(input, context)?;
        (self.step)(value, context)
    }

    fn input_schema(&self) -> InputSchema {
        self.first.input_schema()
    }
}

/// A pipe whose first stage judges an omitted input keeps that judgment: the omission goes through
/// first, and its value through the steps.
impl<V, S, O> OmissionValidator for Piped<V, S>
where
    V: OmissionValidator,
    O: Clone + Send + Sync + 'static,
    S: Fn(V::Output, &ValidationContext) -> Result<O, Vec<Issue>> + Send + Sync + 'static,
{
    fn validate_omission(&self, context: &ValidationContext) -> Result<O, Vec<Issue>> {
        let value = self.first.validate_omission(context)?;
        (self.step)(value, context)
    }
}
