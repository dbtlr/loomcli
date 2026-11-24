//! A validator from a parse function, for an author who needs one the catalog does not offer.

use loomcli_core::{InputSchema, Issue, ValidationContext, Validator};

/// A validator built by [`create_validator`].
#[must_use]
pub struct Custom<F> {
    parse: F,
    input_schema: InputSchema,
}

/// A validator from `parse`, which judges one raw string in its validation context.
pub fn create_validator<O, F>(parse: F) -> Custom<F>
where
    O: Clone + Send + Sync + 'static,
    F: Fn(&str, &ValidationContext) -> Result<O, Vec<Issue>> + Send + Sync + 'static,
{
    Custom {
        parse,
        input_schema: None,
    }
}

impl<F> Custom<F> {
    /// Publishes this input schema behind the `$schema` dialect the validator adds itself, so the
    /// schema declares no `$schema` of its own.
    ///
    /// The author owns the schema's soundness: every token the validator accepts satisfies it. A
    /// schema that declares its own `$schema` is a fault at the call under
    /// `@loomcli/validators/input-schema`.
    #[track_caller]
    pub fn input_schema(mut self, schema: serde_json::Map<String, serde_json::Value>) -> Self {
        if schema.contains_key("$schema") {
            crate::fault::raise(
                crate::fault::INPUT_SCHEMA,
                "create_validator() input_schema declares its own $schema.",
                "Leave out $schema, which the validator publishes itself.",
                vec![
                    loomcli_core::Finding::new(
                        "create_validator(..).input_schema",
                        vec![loomcli_core::Literal::Opaque],
                    )
                    .mark("0"),
                ],
            );
        }
        self.input_schema = Some(schema);
        self
    }
}

impl<O, F> Validator for Custom<F>
where
    O: Clone + Send + Sync + 'static,
    F: Fn(&str, &ValidationContext) -> Result<O, Vec<Issue>> + Send + Sync + 'static,
{
    type Output = O;

    fn validate(&self, input: &str, context: &ValidationContext) -> Result<O, Vec<Issue>> {
        (self.parse)(input, context)
    }

    fn input_schema(&self) -> InputSchema {
        self.input_schema
            .clone()
            .map(loomcli_core::with_schema_dialect)
    }
}
