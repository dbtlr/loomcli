//! The field paths an Application replaces in the JSON copy of a log's fields.

use std::collections::{BTreeMap, HashSet};

use serde_json::{Map, Value};

use crate::diagnostics::{DiagnosticParts, Finding, Literal, rules::INVALID_REDACT_PATH};
use crate::failures::DeclarationError;

use super::messages;

#[derive(Clone, Default)]
pub(crate) struct Redaction(BTreeMap<String, Path>);

#[derive(Clone)]
enum Path {
    Replace,
    Descend(Redaction),
}

impl Redaction {
    pub(crate) fn new(paths: &[&str]) -> Result<Self, DeclarationError> {
        let mut tree = Self::default();
        for (index, path) in paths.iter().enumerate() {
            if path.split('.').any(str::is_empty) {
                return Err(DeclarationError::new(
                    INVALID_REDACT_PATH,
                    DiagnosticParts::new(messages::invalid_redact_path(path))
                        .finding(
                            Finding::new(
                                "log_redact",
                                vec![Literal::Slice(
                                    paths.iter().map(|path| Literal::from(*path)).collect(),
                                )],
                            )
                            .path(Vec::new())
                            .mark(format!("0.{index}")),
                        )
                        .correction(messages::REDACT_PATH_CORRECTION),
                ));
            }
            tree.insert(path);
        }
        Ok(tree)
    }

    fn insert(&mut self, path: &str) {
        if let Some((key, rest)) = path.split_once('.') {
            let node = self
                .0
                .entry(key.to_owned())
                .or_insert_with(|| Path::Descend(Self::default()));
            if let Path::Descend(children) = node {
                children.insert(rest);
            }
        } else {
            self.0.insert(path.to_owned(), Path::Replace);
        }
    }

    pub(super) fn apply(&self, fields: &mut Map<String, Value>, errors: &HashSet<String>) {
        for (key, path) in &self.0 {
            if let Some(value) = fields.get_mut(key) {
                path.apply(value, errors.contains(key));
            }
        }
    }

    fn object(&self, object: &mut Map<String, Value>, error: bool) {
        for (key, path) in &self.0 {
            if let Some(value) = object.get_mut(key) {
                // The only error nested in a typed error snapshot is its source.
                path.apply(value, error && key == "cause");
            }
        }
        if error
            && matches!(self.0.get("message"), Some(Path::Replace))
            && let Some(stack) = object.get_mut("stack")
        {
            *stack = replacement();
        }
    }
}

impl Path {
    fn apply(&self, value: &mut Value, error: bool) {
        match (self, value) {
            (Self::Replace, value) => *value = replacement(),
            (Self::Descend(tree), Value::Object(object)) => tree.object(object, error),
            (Self::Descend(_), Value::Array(items)) => {
                for item in items {
                    self.apply(item, false);
                }
            }
            (Self::Descend(_), _) => {}
        }
    }
}

fn replacement() -> Value {
    Value::String("[Redacted]".to_owned())
}
