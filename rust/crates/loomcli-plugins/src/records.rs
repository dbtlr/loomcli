//! The records view: each row as a block of labeled fields, keyed by an identifier field.
//!
//! [`records`] returns a row view, `RowView<R>`, so a record prints as its source yields it and no
//! row waits on the rows behind it. Each field is a line: the key padded to the key column, styled
//! `dim`, two spaces, then the value, which wraps under itself on a terminal. A blank line separates
//! one record from the next, and the tail prints the count, `2 records`. The identifier's value is
//! styled `highlight`, every other default value `primary`. Nothing is installed: the value is a
//! bare pack view.

use std::fmt;
use std::sync::Arc;

use loomcli_core::style::{Alignment, escape};
use loomcli_core::{Error, IntoRendered, RowView, ViewContext};
use serde::Serialize;
use serde_json::Value;

use crate::layout::block::{RecordEntry, record_block};
use crate::layout::data::{data_value, text_value};
use crate::layout::{data_string, field, own_keys};

/// A field's value function: the field's serialized value, the row, and the context.
type FormatFn<R> = Arc<dyn Fn(&Value, &R, &ViewContext) -> Result<String, Error> + Send + Sync>;

/// One field of a record: the key it reads and prints as its label, and an optional `format` that
/// renders its value.
#[must_use]
pub struct Field<R> {
    key: String,
    format: Option<FormatFn<R>>,
}

impl<R> Field<R> {
    /// A field reading the key `key` of each row's serialized form, its value the default one.
    pub fn new(key: &str) -> Self {
        Self {
            key: key.to_owned(),
            format: None,
        }
    }

    /// Renders the field's value from its serialized value (`Value::Null` for a key the row does
    /// not carry), the row, and the context. The result is marked text its author owns, which the
    /// view neither escapes nor styles, the identifier's field included; an `Err` fails the view.
    pub fn format<T: IntoRendered>(
        self,
        format: impl Fn(&Value, &R, &ViewContext) -> T + Send + Sync + 'static,
    ) -> Self {
        Self {
            format: Some(Arc::new(move |value, row, context| {
                format(value, row, context).into_rendered()
            })),
            ..self
        }
    }
}

impl<R> Clone for Field<R> {
    fn clone(&self) -> Self {
        Self {
            key: self.key.clone(),
            format: self.format.clone(),
        }
    }
}

impl<R> fmt::Debug for Field<R> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Field")
            .field("key", &self.key)
            .field("format", &self.format.is_some())
            .finish()
    }
}

impl<R> From<&str> for Field<R> {
    /// A bare key: `Field::new(key)`.
    fn from(key: &str) -> Self {
        Self::new(key)
    }
}

/// The records view's configuration: the identifier field and the fields to show.
#[must_use]
pub struct RecordsConfig<R> {
    identifier: String,
    fields: Option<Vec<Field<R>>>,
}

impl<R> RecordsConfig<R> {
    /// Records keyed by the field `identifier`, whose value the view styles `highlight`. It adds
    /// no line of its own. With no field list, every own key of each record is a field, in its
    /// order, and the key column is as wide as that record's widest key.
    pub fn new(identifier: &str) -> Self {
        Self {
            identifier: identifier.to_owned(),
            fields: None,
        }
    }

    /// The fields shown, in order, by bare key. The key column is as wide as the widest key in the
    /// list, so every record aligns against the same column. A list that omits the identifier
    /// prints no line for it and highlights nothing.
    pub fn fields(self, fields: &[&str]) -> Self {
        self.field_list(fields.iter().map(|key| Field::new(key)).collect())
    }

    /// The fields shown, in order, each a [`Field`] with an optional `format`.
    pub fn field_list(self, fields: Vec<Field<R>>) -> Self {
        Self {
            fields: Some(fields),
            ..self
        }
    }
}

impl<R> Clone for RecordsConfig<R> {
    fn clone(&self) -> Self {
        Self {
            identifier: self.identifier.clone(),
            fields: self.fields.clone(),
        }
    }
}

impl<R> fmt::Debug for RecordsConfig<R> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RecordsConfig")
            .field("identifier", &self.identifier)
            .field("fields", &self.fields)
            .finish()
    }
}

/// A default value: the data escaped and styled `highlight` for the identifier, `primary` else.
fn default_value(value: Option<&Value>, identifier: bool, context: &ViewContext) -> String {
    let escaped = escape(&data_string(value));
    if identifier {
        context.style.highlight().apply(&escaped)
    } else {
        context.style.primary().apply(&escaped)
    }
}

/// One record's entries, from the configured fields or the row's own keys. A `format` callback
/// reads the row's serialized `value`, and a default value its `text` reading.
fn entries<R>(
    config: &RecordsConfig<R>,
    row: &R,
    value: &Value,
    text: &Value,
    context: &ViewContext,
) -> Result<Vec<RecordEntry>, Error> {
    let entry = |key: &str, format: Option<&FormatFn<R>>| -> Result<RecordEntry, Error> {
        let text = match format {
            Some(format) => format(
                field(value, key).as_ref().unwrap_or(&Value::Null),
                row,
                context,
            )?,
            None => default_value(field(text, key).as_ref(), key == config.identifier, context),
        };
        Ok(RecordEntry {
            align: Alignment::Left,
            label: escape(key),
            value: text,
        })
    };
    match &config.fields {
        Some(fields) => fields
            .iter()
            .map(|each| entry(&each.key, each.format.as_ref()))
            .collect(),
        None => own_keys(value).iter().map(|key| entry(key, None)).collect(),
    }
}

/// A row view that renders each row as a record, with one key-value lane per field and a counted
/// closing summary. A row's fields are read from its serialized form. Each row takes its own
/// reading of `columns`. The returned value is a bare pack view and installs nothing.
pub fn records<R: Serialize + 'static>(config: RecordsConfig<R>) -> RowView<R> {
    RowView::new(move |row: &R, index: usize, context: &ViewContext| {
        let value = data_value(row)?;
        let text = text_value(row)?;
        let record = record_block(&entries(&config, row, &value, &text, context)?, context);
        Ok::<_, Error>(if index == 0 {
            record
        } else {
            format!("\n{record}")
        })
    })
    .tail(|count: usize, context: &ViewContext| {
        let noun = if count == 1 { "record" } else { "records" };
        let summary = context.style.dim().apply(&format!("{count} {noun}"));
        let before = if count == 0 { "" } else { "\n" };
        format!("{before}{summary}\n")
    })
}
