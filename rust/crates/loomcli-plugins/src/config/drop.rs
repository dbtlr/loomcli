//! The drop rule: deserialize the parsed file into the author's type, remove the value at the
//! failure's path, and deserialize again until the file passes. Each round removes at least one
//! value, so the loop ends.
//!
//! The author's type deserializes from the document through [`ValueDeserializer`], whose error
//! records the path it failed at as it returns through each array item and object key. serde stops
//! at its first failure, so each round removes one value. A message is serde's expectation in the
//! reference schema library's words and never repeats the file's value.

use std::fmt;

use serde::de::{self, DeserializeOwned, DeserializeSeed, IntoDeserializer, Visitor};

use super::document::{Item, Step, Value};

/// A deserialization failure: its message, and the path it failed at, outermost step first.
#[derive(Debug)]
pub(crate) struct DropError {
    pub(crate) message: String,
    /// The steps, innermost first while the error returns, reversed by [`DropError::path`].
    steps: Vec<Step>,
}

impl DropError {
    fn new(message: String) -> Self {
        Self {
            message,
            steps: Vec::new(),
        }
    }

    /// The error with one more step outward.
    fn within(mut self, step: Step) -> Self {
        self.steps.push(step);
        self
    }

    /// The path, outermost step first.
    pub(crate) fn path(&self) -> Vec<Step> {
        self.steps.iter().rev().cloned().collect()
    }
}

impl fmt::Display for DropError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for DropError {}

/// The noun for what serde expected, as the reference's schema library names a type.
fn expected_noun(expected: &dyn de::Expected) -> String {
    let text = expected.to_string();
    let noun = match text.as_str() {
        "a string" | "a borrowed string" | "a character" | "a char" | "string" => "string",
        "a boolean" => "boolean",
        "u8" | "u16" | "u32" | "u64" | "u128" | "usize" | "i8" | "i16" | "i32" | "i64" | "i128"
        | "isize" => "int",
        "f32" | "f64" => "number",
        "a sequence" | "a set" => "array",
        "a map" => "object",
        "unit" => "null",
        _ if text.starts_with("struct ") || text.starts_with("a map") => "object",
        _ if text.starts_with("a sequence") || text.starts_with("a tuple") => "array",
        _ => return text,
    };
    noun.to_owned()
}

/// The noun for what the file held, never its value.
fn received_noun(unexpected: &de::Unexpected<'_>) -> &'static str {
    match unexpected {
        de::Unexpected::Bool(_) => "boolean",
        de::Unexpected::Unsigned(_) | de::Unexpected::Signed(_) | de::Unexpected::Float(_) => {
            "number"
        }
        de::Unexpected::Char(_) | de::Unexpected::Str(_) => "string",
        de::Unexpected::Bytes(_) => "bytes",
        de::Unexpected::Unit | de::Unexpected::Option => "null",
        de::Unexpected::Seq => "array",
        de::Unexpected::Map => "object",
        _ => "value",
    }
}

impl de::Error for DropError {
    fn custom<T: fmt::Display>(message: T) -> Self {
        Self::new(message.to_string())
    }

    fn invalid_type(unexpected: de::Unexpected<'_>, expected: &dyn de::Expected) -> Self {
        Self::new(format!(
            "Invalid input: expected {}, received {}",
            expected_noun(expected),
            received_noun(&unexpected)
        ))
    }

    fn invalid_value(_unexpected: de::Unexpected<'_>, expected: &dyn de::Expected) -> Self {
        Self::new(format!(
            "Invalid value: expected {}",
            expected_noun(expected)
        ))
    }

    fn invalid_length(_length: usize, expected: &dyn de::Expected) -> Self {
        Self::new(format!("Invalid length: expected {expected}"))
    }

    fn unknown_variant(_variant: &str, expected: &'static [&'static str]) -> Self {
        let listed: Vec<String> = expected.iter().map(|name| format!("\"{name}\"")).collect();
        Self::new(format!(
            "Invalid option: expected one of {}",
            listed.join("|")
        ))
    }

    fn unknown_field(field: &str, _expected: &'static [&'static str]) -> Self {
        Self::new(format!("Unrecognized key: \"{field}\""))
    }

    fn missing_field(field: &'static str) -> Self {
        Self::new(format!("Missing key: \"{field}\""))
    }

    fn duplicate_field(field: &'static str) -> Self {
        Self::new(format!("Duplicate key: \"{field}\""))
    }
}

/// The largest magnitude a float holds every whole number up to, so one beyond it reads as a float.
const WHOLE_LIMIT: f64 = 9_223_372_036_854_775_808.0;

/// A serde deserializer over one document value.
pub(crate) struct ValueDeserializer<'a>(pub(crate) &'a Value);

struct Items<'a> {
    items: std::slice::Iter<'a, Item>,
}

impl<'de, 'a> de::SeqAccess<'de> for Items<'a> {
    type Error = DropError;

    fn next_element_seed<S: DeserializeSeed<'de>>(
        &mut self,
        seed: S,
    ) -> Result<Option<S::Value>, DropError> {
        let Some(item) = self.items.next() else {
            return Ok(None);
        };
        seed.deserialize(ValueDeserializer(&item.value))
            .map(Some)
            .map_err(|error| error.within(Step::Index(item.index)))
    }

    fn size_hint(&self) -> Option<usize> {
        Some(self.items.len())
    }
}

struct Entries<'a> {
    entries: std::slice::Iter<'a, (String, Value)>,
    value: Option<&'a (String, Value)>,
}

impl<'de, 'a> de::MapAccess<'de> for Entries<'a> {
    type Error = DropError;

    fn next_key_seed<K: DeserializeSeed<'de>>(
        &mut self,
        seed: K,
    ) -> Result<Option<K::Value>, DropError> {
        let Some(entry) = self.entries.next() else {
            return Ok(None);
        };
        self.value = Some(entry);
        let key: de::value::StrDeserializer<'_, DropError> = entry.0.as_str().into_deserializer();
        seed.deserialize(key)
            .map(Some)
            .map_err(|error| error.within(Step::Key(entry.0.clone())))
    }

    fn next_value_seed<V: DeserializeSeed<'de>>(&mut self, seed: V) -> Result<V::Value, DropError> {
        let Some((key, value)) = self.value.take() else {
            return Err(DropError::new(
                "A value was read before its key.".to_owned(),
            ));
        };
        seed.deserialize(ValueDeserializer(value))
            .map_err(|error| error.within(Step::Key(key.clone())))
    }

    fn size_hint(&self) -> Option<usize> {
        Some(self.entries.len())
    }
}

/// An enum written as an object of one key: the variant and its content.
struct Variant<'a> {
    name: &'a str,
    content: &'a Value,
}

impl<'de, 'a> de::EnumAccess<'de> for Variant<'a> {
    type Error = DropError;
    type Variant = Content<'a>;

    fn variant_seed<V: DeserializeSeed<'de>>(
        self,
        seed: V,
    ) -> Result<(V::Value, Content<'a>), DropError> {
        let name: de::value::StrDeserializer<'_, DropError> = self.name.into_deserializer();
        let variant = seed.deserialize(name)?;
        Ok((
            variant,
            Content {
                name: self.name,
                value: self.content,
            },
        ))
    }
}

struct Content<'a> {
    name: &'a str,
    value: &'a Value,
}

impl<'de, 'a> de::VariantAccess<'de> for Content<'a> {
    type Error = DropError;

    fn unit_variant(self) -> Result<(), DropError> {
        de::Deserialize::deserialize(ValueDeserializer(self.value))
            .map_err(|error: DropError| error.within(Step::Key(self.name.to_owned())))
    }

    fn newtype_variant_seed<T: DeserializeSeed<'de>>(self, seed: T) -> Result<T::Value, DropError> {
        seed.deserialize(ValueDeserializer(self.value))
            .map_err(|error| error.within(Step::Key(self.name.to_owned())))
    }

    fn tuple_variant<V: Visitor<'de>>(
        self,
        _len: usize,
        visitor: V,
    ) -> Result<V::Value, DropError> {
        de::Deserializer::deserialize_seq(ValueDeserializer(self.value), visitor)
            .map_err(|error| error.within(Step::Key(self.name.to_owned())))
    }

    fn struct_variant<V: Visitor<'de>>(
        self,
        _fields: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, DropError> {
        de::Deserializer::deserialize_map(ValueDeserializer(self.value), visitor)
            .map_err(|error| error.within(Step::Key(self.name.to_owned())))
    }
}

impl<'de, 'a> de::Deserializer<'de> for ValueDeserializer<'a> {
    type Error = DropError;

    fn deserialize_any<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, DropError> {
        match self.0 {
            Value::Null => visitor.visit_unit(),
            Value::Bool(flag) => visitor.visit_bool(*flag),
            // A whole number reads as an integer, as the reference's schema library takes `5` for
            // an integer whatever the format wrote.
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            Value::Number(number) if number.fract() == 0.0 && number.abs() < WHOLE_LIMIT => {
                if *number >= 0.0 {
                    visitor.visit_u64(*number as u64)
                } else {
                    visitor.visit_i64(*number as i64)
                }
            }
            Value::Number(number) => visitor.visit_f64(*number),
            Value::Integer(number) => match (i64::try_from(*number), u64::try_from(*number)) {
                (_, Ok(unsigned)) => visitor.visit_u64(unsigned),
                (Ok(signed), _) => visitor.visit_i64(signed),
                _ => visitor.visit_i128(*number),
            },
            Value::Text(text) => visitor.visit_str(text),
            Value::Array(items) => visitor.visit_seq(Items {
                items: items.iter(),
            }),
            Value::Object(entries) => visitor.visit_map(Entries {
                entries: entries.iter(),
                value: None,
            }),
        }
    }

    fn deserialize_option<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, DropError> {
        match self.0 {
            Value::Null => visitor.visit_none(),
            _ => visitor.visit_some(self),
        }
    }

    fn deserialize_newtype_struct<V: Visitor<'de>>(
        self,
        _name: &'static str,
        visitor: V,
    ) -> Result<V::Value, DropError> {
        visitor.visit_newtype_struct(self)
    }

    fn deserialize_enum<V: Visitor<'de>>(
        self,
        _name: &'static str,
        _variants: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, DropError> {
        match self.0 {
            Value::Text(text) => {
                let unit: de::value::StrDeserializer<'_, DropError> =
                    text.as_str().into_deserializer();
                visitor.visit_enum(unit)
            }
            Value::Object(entries) if entries.len() == 1 => {
                let (name, content) = &entries[0];
                visitor.visit_enum(Variant { name, content })
            }
            Value::Object(_) => Err(de::Error::invalid_type(de::Unexpected::Map, &"enum")),
            _ => self.deserialize_any(visitor),
        }
    }

    // A key the type does not read is skipped unread, so a value the file shares through a YAML
    // alias is never walked twice.
    fn deserialize_ignored_any<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, DropError> {
        visitor.visit_unit()
    }

    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 char str string bytes byte_buf
        unit unit_struct seq tuple tuple_struct map struct identifier
    }
}

/// One value the drop removed: its path in the file as the round began, and the message.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Removal {
    pub(crate) path: Vec<Step>,
    pub(crate) message: String,
}

/// The steps a failure's path leads to in the file: a path that enters an array item is cut at the
/// item, so the whole item goes, and one that ends at a value the file does not hold, such as a
/// missing key, stops at the nearest enclosing value it holds.
fn held_steps(file: &Value, path: &[Step]) -> Vec<Step> {
    let mut steps = Vec::new();
    let mut node = file;
    for step in path {
        let Some(next) = node.child(step) else {
            break;
        };
        steps.push(step.clone());
        if matches!(step, Step::Index(_)) {
            break;
        }
        node = next;
    }
    steps
}

/// What a passed file came to: the file after its drops, or the message of the first failure an
/// empty file still raises.
pub(crate) enum Dropped {
    Passed(Value),
    EmptyRejected(String),
}

/// Deserializes `file` as `T` and drops what `T` rejects until it passes, reporting each removal
/// as it is made. A file already empty that still fails is the author's defect.
pub(crate) fn drop_until_passes<T: DeserializeOwned>(
    mut file: Value,
    removed: &mut dyn FnMut(Removal),
) -> Dropped {
    loop {
        let error = match T::deserialize(ValueDeserializer(&file)) {
            Ok(_) => return Dropped::Passed(file),
            Err(error) => error,
        };
        if file.is_empty_object() {
            return Dropped::EmptyRejected(error.message);
        }
        let path = held_steps(&file, &error.path());
        if path.is_empty() {
            file = Value::empty_object();
        } else {
            file.remove(&path);
        }
        removed(Removal {
            path,
            message: error.message,
        });
    }
}

/// A removed value's path as the `-v` line shows it: keys joined by dots, an array item as its
/// index in brackets.
pub(crate) fn shown_path(path: &[Step]) -> String {
    let mut text = String::new();
    for step in path {
        match step {
            Step::Index(index) => text.push_str(&format!("[{index}]")),
            Step::Key(key) if text.is_empty() => text.push_str(key),
            Step::Key(key) => {
                text.push('.');
                text.push_str(key);
            }
        }
    }
    text
}

/// The value the passed file deserializes to. The drop already passed it, so a failure here is a
/// type whose deserialization changes between two reads of one document.
pub(crate) fn deserialize_passed<T: DeserializeOwned>(file: &Value) -> Result<T, DropError> {
    T::deserialize(ValueDeserializer(file))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde::Deserialize;

    use super::*;
    use crate::config::document::ObjectBuilder;

    fn object(entries: Vec<(&str, Value)>) -> Value {
        let mut builder = ObjectBuilder::default();
        for (key, value) in entries {
            builder.insert(key.to_owned(), value);
        }
        builder.build()
    }

    fn text(value: &str) -> Value {
        Value::Text(value.to_owned())
    }

    fn drops<T: DeserializeOwned>(file: Value) -> (Value, Vec<(String, String)>) {
        let mut removed = Vec::new();
        let mut count = 0;
        let passed = drop_until_passes::<T>(file, &mut |removal| {
            count += 1;
            assert!(
                count <= 10,
                "the drop announced a removal more than ten times"
            );
            removed.push((shown_path(&removal.path), removal.message));
        });
        match passed {
            Dropped::Passed(file) => (file, removed),
            Dropped::EmptyRejected(message) => panic!("an empty file was rejected: {message}"),
        }
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Named {
        name: Option<String>,
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Numbered {
        name: Option<f64>,
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Aliased {
        first: Option<Named>,
        second: Option<Numbered>,
    }

    // config.test.ts: "a value an alias reaches is removed at the second path alone, once".
    #[test]
    fn a_value_an_alias_reaches_is_removed_at_the_second_path_alone_once() {
        let shared = object(vec![("name", text("hello"))]);
        let (file, removed) =
            drops::<Aliased>(object(vec![("first", shared.clone()), ("second", shared)]));
        assert_eq!(
            removed,
            [(
                "second.name".to_owned(),
                "Invalid input: expected number, received string".to_owned()
            )]
        );
        assert_eq!(
            file,
            object(vec![
                ("first", object(vec![("name", text("hello"))])),
                ("second", object(vec![])),
            ])
        );
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Flipped {
        first: Option<Numbered>,
        second: Option<Named>,
    }

    // config.test.ts: "a value an alias reaches is removed at the first path alone, and the second
    // keeps it".
    #[test]
    fn a_value_an_alias_reaches_is_removed_at_the_first_path_alone() {
        let shared = object(vec![("name", text("hello"))]);
        let (file, removed) =
            drops::<Flipped>(object(vec![("first", shared.clone()), ("second", shared)]));
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].0, "first.name");
        assert_eq!(
            file,
            object(vec![
                ("first", object(vec![])),
                ("second", object(vec![("name", text("hello"))])),
            ])
        );
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Port {
        port: Option<f64>,
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Template {
        defaults: Option<serde_json::Value>,
        server: Option<Port>,
    }

    // config.test.ts: "a template anchor the schema does not check keeps its value when its alias
    // loses it".
    #[test]
    fn a_template_anchor_keeps_its_value_when_its_alias_loses_it() {
        let base = object(vec![("port", text("wrong"))]);
        let (file, removed) =
            drops::<Template>(object(vec![("defaults", base.clone()), ("server", base)]));
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].0, "server.port");
        assert_eq!(
            file,
            object(vec![
                ("defaults", object(vec![("port", text("wrong"))])),
                ("server", object(vec![])),
            ])
        );
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Source {
        dir: Option<String>,
        harness: String,
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Sessions {
        sources: Option<Vec<Source>>,
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Typed {
        sessions: Option<Sessions>,
        owners: Option<BTreeMap<String, Owner>>,
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Owner {
        id: String,
    }

    #[test]
    fn an_array_item_is_removed_whole_and_named_by_its_index_in_the_file() {
        let sources = Value::array(vec![
            object(vec![("dir", Value::Number(1.0))]),
            object(vec![("harness", text("b"))]),
            object(vec![("harness", Value::Number(2.0))]),
            object(vec![("harness", text("d"))]),
        ]);
        let (_, removed) = drops::<Typed>(object(vec![(
            "sessions",
            object(vec![("sources", sources)]),
        )]));
        assert_eq!(
            removed,
            [
                (
                    "sessions.sources[0]".to_owned(),
                    "Invalid input: expected string, received number".to_owned()
                ),
                (
                    "sessions.sources[2]".to_owned(),
                    "Invalid input: expected string, received number".to_owned()
                ),
            ]
        );
    }

    #[test]
    fn a_missing_key_removes_the_value_that_lacks_it() {
        let owners = object(vec![
            ("alpha", object(vec![("id", Value::Number(1.0))])),
            ("beta", object(vec![("extra", Value::Number(1.0))])),
            ("gamma", object(vec![("id", text("ok"))])),
        ]);
        let (file, removed) = drops::<Typed>(object(vec![("owners", owners)]));
        assert_eq!(
            removed,
            [
                (
                    "owners.alpha.id".to_owned(),
                    "Invalid input: expected string, received number".to_owned()
                ),
                ("owners.alpha".to_owned(), "Missing key: \"id\"".to_owned()),
                ("owners.beta".to_owned(), "Missing key: \"id\"".to_owned()),
            ]
        );
        assert_eq!(
            file,
            object(vec![(
                "owners",
                object(vec![("gamma", object(vec![("id", text("ok"))]))])
            )])
        );
    }

    #[derive(Deserialize, Debug)]
    #[allow(dead_code)]
    enum Mode {
        #[serde(rename = "fast")]
        Fast,
        #[serde(rename = "slow")]
        Slow,
    }

    #[derive(Deserialize, Debug)]
    #[allow(dead_code)]
    struct Moded {
        mode: Option<Mode>,
        count: Option<u32>,
    }

    #[test]
    fn an_unknown_variant_lists_the_variants_and_a_negative_count_names_no_value() {
        let (_, removed) = drops::<Moded>(object(vec![
            ("mode", text("medium")),
            ("count", Value::Number(-1.0)),
        ]));
        assert_eq!(
            removed,
            [
                (
                    "mode".to_owned(),
                    "Invalid option: expected one of \"fast\"|\"slow\"".to_owned()
                ),
                ("count".to_owned(), "Invalid value: expected int".to_owned()),
            ]
        );
    }

    #[derive(Deserialize, Debug)]
    #[serde(try_from = "serde_json::Value")]
    struct Refined;

    impl TryFrom<serde_json::Value> for Refined {
        type Error = String;

        fn try_from(value: serde_json::Value) -> Result<Self, String> {
            if value.get("mode") == Some(&serde_json::json!("bad")) {
                Err("Pick another mode.".to_owned())
            } else {
                Ok(Refined)
            }
        }
    }

    // config.test.ts: "an issue with no path removes every key".
    #[test]
    fn a_failure_with_no_path_removes_every_key() {
        let (file, removed) = drops::<Refined>(object(vec![
            ("mode", text("bad")),
            ("other", Value::Number(1.0)),
        ]));
        assert_eq!(removed, [(String::new(), "Pick another mode.".to_owned())]);
        assert!(file.is_empty_object());
    }

    #[test]
    fn a_type_that_rejects_an_empty_file_reports_its_message() {
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct Requires {
            present: bool,
        }
        assert!(matches!(
            drop_until_passes::<Requires>(Value::empty_object(), &mut |_| {}),
            Dropped::EmptyRejected(message) if message == "Missing key: \"present\""
        ));
    }
}
