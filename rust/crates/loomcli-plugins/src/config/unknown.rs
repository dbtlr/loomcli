//! The unknown-key walk over the surviving configuration values and the published JSON Schema.

use std::fmt::Write as _;

use loomcli_core::escape_control_characters;
use unicode_general_category::{GeneralCategory, get_general_category};

use super::document::{Step, Value};
use super::drop::format_path;
use super::links::{Reached, Shape, is_any, is_array_shape, leaves, step_into};

/// The shapes for one array position. Any array shape that accepts arbitrary items ends the walk
/// at that item.
fn item_shapes<'a>(shapes: &[&'a Shape], index: usize, root: &'a Shape) -> Option<Vec<&'a Shape>> {
    let mut found = Vec::new();
    let mut arrays = shapes
        .iter()
        .filter(|shape| is_array_shape(shape))
        .peekable();
    arrays.peek()?;
    for shape in arrays {
        let item = shape
            .get("prefixItems")
            .and_then(serde_json::Value::as_array)
            .and_then(|items| items.get(index))
            .or_else(|| shape.get("items"))?
            .as_object()?;
        found.extend(leaves(item, root));
    }
    Some(found)
}

fn visit(
    value: &Value,
    shapes: &[&Shape],
    root: &Shape,
    path: &mut Vec<Step>,
    unknown: &mut impl FnMut(&[Step]),
) {
    match value {
        Value::Object(entries) => {
            for (key, value) in entries.iter() {
                let step = step_into(shapes, key, root);
                if matches!(step, Reached::Unchecked) {
                    continue;
                }
                path.push(Step::Key(key.clone()));
                if let Reached::Held(next) = step {
                    visit(value, &next, root, path, unknown);
                } else {
                    unknown(path);
                }
                path.pop();
            }
        }
        Value::Array(array) if !shapes.iter().any(|shape| is_any(shape)) => {
            for item in &array.items {
                if let Some(next) = item_shapes(shapes, item.index, root) {
                    path.push(Step::Index(item.index));
                    visit(&item.value, &next, root, path, unknown);
                    path.pop();
                }
            }
        }
        _ => {}
    }
}

/// Reports the keys the published schema does not describe, depth first in file order.
pub(super) fn walk(file: &Value, root: &Shape, mut unknown: impl FnMut(&[Step])) {
    visit(
        file,
        &leaves(root, root),
        root,
        &mut Vec::new(),
        &mut unknown,
    );
}

/// The whitespace of the reference's ECMAScript regular expression.
fn white_space(character: char) -> bool {
    character == '\u{feff}' || (character != '\u{85}' && character.is_whitespace())
}

fn unseen(character: char, at_edge: bool) -> bool {
    let hidden = character != ' '
        && matches!(
            get_general_category(character),
            GeneralCategory::Format | GeneralCategory::SpaceSeparator
        );
    (hidden || (at_edge && white_space(character)))
        && escape_control_characters(character.encode_utf8(&mut [0; 4]))
            .chars()
            .count()
            == 1
}

fn write_key(text: &mut String, key: &str) {
    let leading = key.len() - key.trim_start_matches(white_space).len();
    let trailing = key.trim_end_matches(white_space).len();
    if !key.is_empty()
        && leading == 0
        && trailing == key.len()
        && !key.chars().any(|character| unseen(character, false))
    {
        text.push_str(key);
        return;
    }

    text.push('"');
    for (offset, character) in key.char_indices() {
        if matches!(character, '"' | '\\') {
            text.push('\\');
            text.push(character);
        } else if unseen(character, offset < leading || offset >= trailing) {
            let _ = write!(text, "U+{:04X}", u32::from(character));
        } else {
            text.push(character);
        }
    }
    text.push('"');
}

/// An unknown key's path, showing invisible characters in each affected segment.
pub(super) fn shown_path(path: &[Step]) -> String {
    format_path(path, write_key)
}
