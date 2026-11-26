//! The formatter's field list validator and its transforms for values and rows.

use std::collections::HashSet;

use loomcli_core::{
    CommandTarget, Error, Extension, InputError, InputIdentity, InputKind, InputProblem,
    InputSchema, InvokedBy, Issue, MiddlewareContext, NoOptions, ResultKindName, ResultTransform,
    ValidationContext, Validator, read_extension, with_schema_dialect,
};
use serde_json::{Map, Value};

use super::messages;

pub(super) const PROVIDED_VIEWS: Extension<CommandTarget, Vec<String>> =
    Extension::new("@loomcli/plugins/format/provided-views");

/// Reads one comma list without changing the literal spelling of each field.
pub(super) struct FieldList;

impl Validator for FieldList {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        if input.split(',').any(str::is_empty) {
            return Err(vec![Issue::new(messages::FIELDS_ISSUE)]);
        }
        Ok(input.to_owned())
    }

    fn input_schema(&self) -> InputSchema {
        Some(with_schema_dialect(Map::from_iter([(
            "type".to_owned(),
            Value::String("string".to_owned()),
        )])))
    }
}

/// Assigns the transform after the formatter selected the view. Only an appended view
/// accepts field selection, and a held fault takes precedence over the refusal.
pub(super) fn select_fields(context: &MiddlewareContext<NoOptions>) -> Result<(), Error> {
    let Some(result) = context
        .command
        .result
        .as_ref()
        .filter(|_| context.request.is_some())
    else {
        return Ok(());
    };
    let occurrences = context.own_options.option::<Vec<String>>("fields")?;
    if occurrences.is_empty() {
        return Ok(());
    }
    let mut seen = HashSet::new();
    let names = occurrences
        .iter()
        .flat_map(|list| list.split(','))
        .filter(|name| seen.insert(*name))
        .map(str::to_owned)
        .collect();
    let (spelling, format) = match context.invoked_by {
        InvokedBy::Argv => ("--fields", "--format"),
        InvokedBy::Name => ("fields", "format"),
    };
    let fields = Fields { names, spelling };
    let appended = read_extension(&context.command, &PROVIDED_VIEWS)?.unwrap_or_default();
    if !context.view().is_some_and(|name| appended.contains(&name)) {
        return Err(fields.failure(messages::fields_need_encoding(spelling, format, &appended)));
    }
    let transform = match result.kind {
        ResultKindName::Rows => {
            let mut first = true;
            ResultTransform::json(move |value| {
                let object = fields.object(value)?;
                if first {
                    fields.judge(object.keys())?;
                    first = false;
                }
                Ok(fields.pick(object))
            })
        }
        ResultKindName::Value => ResultTransform::json(move |value| fields.value(value)),
    };
    context.set_transform(transform);
    Ok(())
}

struct Fields {
    names: Vec<String>,
    spelling: &'static str,
}

impl Fields {
    fn failure(&self, sentence: String) -> Error {
        let issue = Issue::new(sentence.clone());
        InputError::new(
            sentence,
            vec![InputProblem::Invalid {
                input: InputIdentity::new(false, InputKind::Option, "fields"),
                spelling: self.spelling.to_owned(),
                issues: vec![issue],
            }],
        )
        .into()
    }

    fn object(&self, value: Value) -> Result<Map<String, Value>, Error> {
        match value {
            Value::Object(object) => Ok(object),
            other => Err(self.failure(messages::fields_need_objects(self.spelling, &other))),
        }
    }

    fn judge<'a>(&self, keys: impl Iterator<Item = &'a String>) -> Result<(), Error> {
        let mut seen = HashSet::new();
        let available: Vec<&str> = keys
            .map(String::as_str)
            .filter(|key| seen.insert(*key))
            .collect();
        let unknown: Vec<&str> = self
            .names
            .iter()
            .map(String::as_str)
            .filter(|name| !seen.contains(name))
            .collect();
        if unknown.is_empty() {
            return Ok(());
        }
        Err(self.failure(messages::unknown_fields(
            self.spelling,
            &unknown,
            &available,
        )))
    }

    fn pick(&self, mut object: Map<String, Value>) -> Value {
        Value::Object(
            self.names
                .iter()
                .filter_map(|key| object.swap_remove(key).map(|value| (key.clone(), value)))
                .collect(),
        )
    }

    fn value(&self, value: Value) -> Result<Value, Error> {
        match value {
            Value::Array(values) => {
                let records = values
                    .into_iter()
                    .map(|value| self.object(value))
                    .collect::<Result<Vec<_>, _>>()?;
                if !records.is_empty() {
                    self.judge(records.iter().flat_map(Map::keys))?;
                }
                Ok(Value::Array(
                    records
                        .into_iter()
                        .map(|object| self.pick(object))
                        .collect(),
                ))
            }
            value => {
                let object = self.object(value)?;
                self.judge(object.keys())?;
                Ok(self.pick(object))
            }
        }
    }
}
