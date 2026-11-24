//! The document a configuration file holds, as every format reads into it.
//!
//! A collection holds its children behind an `Arc`, so a YAML alias shares the value its anchor
//! names at the cost of one pointer, and a removal copies only the path it changes: a value two
//! aliases share loses a value only at the path a drop names.

use std::sync::Arc;

/// One value of a configuration file.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Value {
    /// JSON `null`, or a YAML null.
    Null,
    /// A Boolean.
    Bool(bool),
    /// A JSON or YAML number, read as the reference's runtime reads it: a 64-bit float, which an
    /// overflowing literal turns into an infinity.
    Number(f64),
    /// A TOML integer, exact.
    Integer(i128),
    /// A string, and a TOML date or time as the text the file wrote.
    Text(String),
    /// An array, each item with the index it held in the file.
    Array(Arc<Vec<Item>>),
    /// An object, its keys unique, in the order the file wrote them.
    Object(Arc<Vec<(String, Value)>>),
}

/// One array item, with the index it held in the file, which a removal never shifts.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Item {
    pub(crate) index: usize,
    pub(crate) value: Value,
}

/// One step of a path into a document: an object key, or an array item's index in the file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Step {
    Key(String),
    Index(usize),
}

impl Value {
    /// An empty object.
    pub(crate) fn empty_object() -> Self {
        Value::Object(Arc::new(Vec::new()))
    }

    /// An array of these values, each at its own position.
    pub(crate) fn array(values: Vec<Value>) -> Self {
        Value::Array(Arc::new(
            values
                .into_iter()
                .enumerate()
                .map(|(index, value)| Item { index, value })
                .collect(),
        ))
    }

    /// The entries of an object, or `None` for any other value.
    pub(crate) fn entries(&self) -> Option<&[(String, Value)]> {
        match self {
            Value::Object(entries) => Some(entries),
            _ => None,
        }
    }

    /// The value an object holds under `key`, as an own key.
    pub(crate) fn get(&self, key: &str) -> Option<&Value> {
        self.entries()?
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value)
    }

    /// The value one step leads to, when the document holds it.
    pub(crate) fn child(&self, step: &Step) -> Option<&Value> {
        match (self, step) {
            (Value::Object(_), Step::Key(key)) => self.get(key),
            (Value::Array(items), Step::Index(index)) => items
                .iter()
                .find(|item| item.index == *index)
                .map(|item| &item.value),
            _ => None,
        }
    }

    /// Whether this is an object with no key.
    pub(crate) fn is_empty_object(&self) -> bool {
        self.entries().is_some_and(<[_]>::is_empty)
    }

    /// The object without a top-level key, or the value itself when it holds none.
    pub(crate) fn without_key(&self, key: &str) -> Value {
        match self {
            Value::Object(entries) if entries.iter().any(|(name, _)| name == key) => {
                Value::Object(Arc::new(
                    entries
                        .iter()
                        .filter(|(name, _)| name != key)
                        .cloned()
                        .collect(),
                ))
            }
            other => other.clone(),
        }
    }

    /// Removes the value a nonempty path leads to, copying each collection on the way, so a value
    /// another path shares keeps its own copy. A path the document does not hold removes nothing.
    pub(crate) fn remove(&mut self, path: &[Step]) {
        let Some((last, ancestors)) = path.split_last() else {
            return;
        };
        let mut node = self;
        for step in ancestors {
            let Some(next) = node.child_mut(step) else {
                return;
            };
            node = next;
        }
        match (node, last) {
            (Value::Object(entries), Step::Key(key)) => {
                Arc::make_mut(entries).retain(|(name, _)| name != key);
            }
            (Value::Array(items), Step::Index(index)) => {
                Arc::make_mut(items).retain(|item| item.index != *index);
            }
            _ => {}
        }
    }

    /// The value one step leads to, made unique so it can change.
    fn child_mut(&mut self, step: &Step) -> Option<&mut Value> {
        match (self, step) {
            (Value::Object(entries), Step::Key(key)) => Arc::make_mut(entries)
                .iter_mut()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value),
            (Value::Array(items), Step::Index(index)) => Arc::make_mut(items)
                .iter_mut()
                .find(|item| item.index == *index)
                .map(|item| &mut item.value),
            _ => None,
        }
    }
}

/// Builds an object's entries the way `JSON.parse` does: a repeated key keeps its first position
/// and takes the later value.
#[derive(Default)]
pub(crate) struct ObjectBuilder {
    entries: Vec<(String, Value)>,
}

impl ObjectBuilder {
    /// Adds one entry.
    pub(crate) fn insert(&mut self, key: String, value: Value) {
        match self.entries.iter_mut().find(|(name, _)| *name == key) {
            Some(entry) => entry.1 = value,
            None => self.entries.push((key, value)),
        }
    }

    /// The object.
    pub(crate) fn build(self) -> Value {
        Value::Object(Arc::new(self.entries))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(entries: Vec<(&str, Value)>) -> Value {
        let mut builder = ObjectBuilder::default();
        for (key, value) in entries {
            builder.insert(key.to_owned(), value);
        }
        builder.build()
    }

    #[test]
    fn a_removal_copies_its_path_so_a_shared_value_keeps_its_copy_elsewhere() {
        let shared = object(vec![("name", Value::Text("hello".to_owned()))]);
        let mut file = object(vec![("first", shared.clone()), ("second", shared)]);
        file.remove(&[Step::Key("second".to_owned()), Step::Key("name".to_owned())]);
        assert_eq!(
            file,
            object(vec![
                (
                    "first",
                    object(vec![("name", Value::Text("hello".to_owned()))])
                ),
                ("second", object(vec![])),
            ])
        );
    }

    #[test]
    fn an_array_item_keeps_its_file_index_after_an_earlier_item_goes() {
        let mut file = object(vec![(
            "list",
            Value::array(vec![Value::Bool(true), Value::Null, Value::Bool(false)]),
        )]);
        file.remove(&[Step::Key("list".to_owned()), Step::Index(0)]);
        let list = file.get("list").unwrap_or(&Value::Null);
        assert_eq!(list.child(&Step::Index(2)), Some(&Value::Bool(false)));
        assert_eq!(list.child(&Step::Index(0)), None);
    }

    #[test]
    fn a_repeated_key_keeps_its_first_position_and_takes_the_later_value() {
        let file = object(vec![
            ("a", Value::Number(1.0)),
            ("b", Value::Number(2.0)),
            ("a", Value::Number(3.0)),
        ]);
        assert_eq!(
            file.entries().map(<[_]>::to_vec),
            Some(vec![
                ("a".to_owned(), Value::Number(3.0)),
                ("b".to_owned(), Value::Number(2.0))
            ])
        );
    }
}
