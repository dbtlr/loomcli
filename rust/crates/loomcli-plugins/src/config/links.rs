//! The graph judgment of the configuration plugin: an option linked to a path the schema cannot
//! hold is a build fault, where the graph publishes the file's shape as its `configuration` fact.
//! The walk reads the shape by the contract's keywords alone, and a schema that publishes no shape,
//! an open object, and a path through an array get no check.

use std::sync::Arc;

use loomcli_core::{
    CommandGraph, CommandNode, DeclarationError, DiagnosticParts, DiagnosticRule, Error, Finding,
    OptionNode, diagnostic_rule, read_extension,
};
use serde_json::{Map, Value};

use super::extension::CONFIG_INPUT;

pub(super) type Shape = Map<String, Value>;

pub(super) fn published_schema(graph: &CommandGraph) -> Option<&Shape> {
    graph.configuration.as_ref()?.schema.as_ref()
}

/// An option linked to a configuration path whose keys the schema does not hold.
pub(crate) const LINK_PATH: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/config/link-path",
    "Option linked to a path the configuration schema does not hold",
    "An option linked with configInput takes the value the configuration file holds at its path, and the configuration schema describes the whole file. A path whose keys the schema does not describe means the shape of the file and the option disagree, and the check catches a typo or a stale link at build time.",
);

/// An option linked to a configuration path that holds a value the option cannot take.
pub(crate) const LINK_TYPE: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/config/link-type",
    "Option linked to a value it cannot take",
    "An option linked with configInput takes a string or a number, a Boolean, a whole number, or an array, by its type. A path whose configuration schema holds no value of that kind can never fill the option, so the link is a mistake that only the assembled application reveals.",
);

/// The keywords that annotate or identify a shape without constraining the value it takes.
const ANNOTATIONS: [&str; 10] = [
    "$comment",
    "$id",
    "$schema",
    "default",
    "deprecated",
    "description",
    "examples",
    "readOnly",
    "title",
    "writeOnly",
];

/// The reference a `$ref` names inside the shape's own `$defs`, or the shape itself for `#`.
fn referenced<'a>(root: &'a Shape, reference: &str) -> Option<&'a Shape> {
    if reference == "#" {
        return Some(root);
    }
    let name = reference.strip_prefix("#/$defs/")?;
    root.get("$defs")?.as_object()?.get(name)?.as_object()
}

/// The shapes a node stands for, once `$ref`s into the shape's `$defs` are followed and `allOf`,
/// `anyOf`, and `oneOf` are flattened into their members. A cycle is entered once.
fn leaves_of<'a>(node: &'a Value, root: &'a Shape, seen: &mut Vec<*const Shape>) -> Vec<&'a Shape> {
    static EMPTY: std::sync::OnceLock<Shape> = std::sync::OnceLock::new();
    match node.as_object() {
        Some(shape) => leaves_of_shape(shape, root, seen),
        // A shape that is not an object constrains nothing.
        None => vec![EMPTY.get_or_init(Shape::new)],
    }
}

fn leaves_of_shape<'a>(
    shape: &'a Shape,
    root: &'a Shape,
    seen: &mut Vec<*const Shape>,
) -> Vec<&'a Shape> {
    let identity: *const Shape = shape;
    if seen.contains(&identity) {
        return Vec::new();
    }
    seen.push(identity);
    if let Some(followed) = shape
        .get("$ref")
        .and_then(Value::as_str)
        .and_then(|reference| referenced(root, reference))
    {
        return leaves_of_shape(followed, root, seen);
    }
    let members: Vec<&Shape> = ["allOf", "anyOf", "oneOf"]
        .iter()
        .filter_map(|keyword| shape.get(*keyword).and_then(Value::as_array))
        .flatten()
        .flat_map(|member| leaves_of(member, root, seen))
        .collect();
    if members.is_empty() {
        vec![shape]
    } else {
        members
    }
}

/// The terminal shapes at one schema node, following local references and compound shapes.
pub(super) fn leaves<'a>(shape: &'a Shape, root: &'a Shape) -> Vec<&'a Shape> {
    leaves_of_shape(shape, root, &mut Vec::new())
}

/// Whether a shape is open: `additionalProperties` or `patternProperties` with a value other than
/// `false`.
fn is_open(shape: &Shape) -> bool {
    ["additionalProperties", "patternProperties"]
        .iter()
        .any(|keyword| {
            shape
                .get(*keyword)
                .is_some_and(|value| *value != Value::Bool(false))
        })
}

/// Whether a shape names no keyword but annotations, so it takes any value.
pub(super) fn is_any(shape: &Shape) -> bool {
    shape
        .keys()
        .all(|keyword| ANNOTATIONS.contains(&keyword.as_str()))
}

/// Whether a shape describes an array.
pub(super) fn is_array_shape(shape: &Shape) -> bool {
    shape.get("type").and_then(Value::as_str) == Some("array")
        || shape.contains_key("items")
        || shape.contains_key("prefixItems")
}

/// What following a link's keys came to.
pub(super) enum Reached<'a> {
    Held(Vec<&'a Shape>),
    Unchecked,
    Missing,
}

/// The shapes a key leads to, or whether the shape leaves the key unchecked or does not hold it.
pub(super) fn step_into<'a>(leaves: &[&'a Shape], key: &str, root: &'a Shape) -> Reached<'a> {
    let mut next = Vec::new();
    for leaf in leaves {
        if is_array_shape(leaf) || is_any(leaf) {
            return Reached::Unchecked;
        }
        match leaf
            .get("properties")
            .and_then(Value::as_object)
            .and_then(|properties| properties.get(key))
        {
            Some(property) => next.extend(leaves_of(property, root, &mut Vec::new())),
            None if is_open(leaf) => return Reached::Unchecked,
            None => {}
        }
    }
    if next.is_empty() {
        Reached::Missing
    } else {
        Reached::Held(next)
    }
}

/// Follows a link's keys through the shape.
fn reach<'a>(path: &str, root: &'a Shape) -> Reached<'a> {
    let mut leaves = leaves(root, root);
    for key in path.split('.') {
        match step_into(&leaves, key, root) {
            Reached::Held(next) => leaves = next,
            other => return other,
        }
    }
    Reached::Held(leaves)
}

/// An object declaration reached without losing a requirement. The link walk flattens
/// compound shapes, which can hide a requirement that strict must respect.
fn property_declaration<'a>(mut shape: &'a Shape, root: &'a Shape) -> Option<&'a Shape> {
    let mut followed: Vec<&Shape> = Vec::new();
    loop {
        let mut constraints = shape
            .iter()
            .filter(|(key, _)| key.as_str() != "$defs" && !ANNOTATIONS.contains(&key.as_str()));
        if constraints.clone().all(|(key, _)| {
            matches!(
                key.as_str(),
                "type" | "properties" | "required" | "additionalProperties"
            )
        }) {
            return Some(shape);
        }
        let (keyword, value) = constraints.next()?;
        if constraints.next().is_some() || followed.iter().any(|seen| std::ptr::eq(*seen, shape)) {
            return None;
        }
        followed.push(shape);
        shape = match keyword.as_str() {
            "$ref" => referenced(root, value.as_str()?)?,
            "anyOf" | "oneOf" => sole_object_alternative(value.as_array()?)?,
            "allOf" => {
                let [member] = value.as_array()?.as_slice() else {
                    return None;
                };
                member.as_object()?
            }
            _ => return None,
        };
    }
}

/// The sole alternative that can describe the object present in the file.
fn sole_object_alternative(alternatives: &[Value]) -> Option<&Shape> {
    let mut possible = alternatives.iter().filter(|alternative| match alternative {
        Value::Bool(false) => false,
        Value::Object(shape) => {
            types_of(shape).is_none_or(|types| types.iter().any(|kind| kind == "object"))
        }
        _ => true,
    });
    let shape = possible.next()?.as_object()?;
    possible.next().is_none().then_some(shape)
}

/// Whether the published shape declares a property and lets it be absent.
pub(super) fn declares_optional_key(parent: Option<&str>, key: &str, root: &Shape) -> bool {
    let shape = parent
        .into_iter()
        .flat_map(|parent| parent.split('.'))
        .try_fold(root, |shape, name| {
            property_declaration(shape, root)?
                .get("properties")?
                .as_object()?
                .get(name)?
                .as_object()
        });
    let Some(shape) = shape.and_then(|shape| property_declaration(shape, root)) else {
        return false;
    };
    shape
        .get("properties")
        .and_then(Value::as_object)
        .is_some_and(|properties| properties.contains_key(key))
        && shape.get("required").is_none_or(|required| {
            required.as_array().is_some_and(|required| {
                required
                    .iter()
                    .all(|name| name.as_str().is_some_and(|name| name != key))
            })
        })
}

/// The JSON type of a value a `const` or `enum` names.
fn type_of_value(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(number) => {
            if number.is_i64()
                || number.is_u64()
                || number.as_f64().is_some_and(|n| n.fract() == 0.0)
            {
                "integer"
            } else {
                "number"
            }
        }
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// The JSON types a shape names through `const`, `enum`, or `type`, or `None` when it names none.
fn types_of(shape: &Shape) -> Option<Vec<String>> {
    if let Some(value) = shape.get("const") {
        return Some(vec![type_of_value(value).to_owned()]);
    }
    if let Some(values) = shape.get("enum").and_then(Value::as_array) {
        return Some(
            values
                .iter()
                .map(|value| type_of_value(value).to_owned())
                .collect(),
        );
    }
    match shape.get("type") {
        Some(Value::String(kind)) => Some(vec![kind.clone()]),
        Some(Value::Array(kinds)) => Some(
            kinds
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
        ),
        _ => None,
    }
}

/// The JSON types a value the option takes may have, by the option's type.
fn taken_types(option: &OptionNode) -> &'static [&'static str] {
    match option {
        OptionNode::Boolean(_) => &["boolean"],
        OptionNode::Count(_) => &["integer", "number"],
        OptionNode::String(node) if node.multiple || node.arity.is_some() => &["array"],
        OptionNode::Content(node) if node.multiple => &["array"],
        _ => &["integer", "number", "string"],
    }
}

/// Whether any shape a path leads to holds a value the option takes.
fn is_taken(leaves: &[&Shape], option: &OptionNode) -> bool {
    let accepted = taken_types(option);
    leaves.iter().any(|leaf| {
        types_of(leaf)
            .is_none_or(|types| types.iter().any(|kind| accepted.contains(&kind.as_str())))
    })
}

/// What a path's shapes hold, in words, for the sentence.
fn describe(leaves: &[&Shape]) -> String {
    let mut names: Vec<String> = Vec::new();
    for kind in leaves.iter().filter_map(|leaf| types_of(leaf)).flatten() {
        let name = match kind.as_str() {
            "array" => "an array".to_owned(),
            "boolean" => "a Boolean".to_owned(),
            "integer" | "number" => "a number".to_owned(),
            "null" => "null".to_owned(),
            "object" => "an object".to_owned(),
            "string" => "a string".to_owned(),
            other => other.to_owned(),
        };
        if !names.contains(&name) {
            names.push(name);
        }
    }
    names.join(" or ")
}

/// How the diagnostic names an option, as the graph records it.
fn subject_of(option: &OptionNode, node: Option<&CommandNode>) -> String {
    match node {
        None => format!("Global option \"{}\"", option.name()),
        Some(node) if node.name.is_none() => {
            format!("The root Command option \"{}\"", option.name())
        }
        Some(node) => format!(
            "Command \"{}\" option \"{}\"",
            node.path.join(" "),
            option.name()
        ),
    }
}

/// An option that carries the binding, with where it was declared.
struct Linked<'a> {
    option: &'a OptionNode,
    node: Option<&'a CommandNode>,
    path: String,
}

/// Every option in the graph that carries the binding, the globals first and then each Command's
/// own, root first and depth first.
fn linked_options(graph: &CommandGraph) -> Result<Vec<Linked<'_>>, Error> {
    fn walk<'a>(node: &'a Arc<CommandNode>, linked: &mut Vec<Linked<'a>>) -> Result<(), Error> {
        for option in &node.options {
            if let Some(binding) = read_extension(option, &CONFIG_INPUT)? {
                linked.push(Linked {
                    option,
                    node: Some(node),
                    path: binding.path,
                });
            }
        }
        node.children
            .iter()
            .try_for_each(|child| walk(child, linked))
    }
    let mut linked = Vec::new();
    for option in &graph.globals {
        if let Some(binding) = read_extension(option, &CONFIG_INPUT)? {
            linked.push(Linked {
                option,
                node: None,
                path: binding.path,
            });
        }
    }
    walk(&graph.root, &mut linked)?;
    Ok(linked)
}

/// The fault for one linked option, or `None` when the shape accepts the link or cannot judge it.
fn fault_of(link: &Linked<'_>, shape: &Shape) -> Option<DeclarationError> {
    let leaves = match reach(&link.path, shape) {
        Reached::Unchecked => return None,
        Reached::Missing => {
            return Some(fault(
                LINK_PATH,
                format!(
                    "{} links to {}, which the configuration schema does not hold.",
                    subject_of(link.option, link.node),
                    link.path
                ),
                "Link a path the schema describes, or add the key to the schema.",
                &link.path,
            ));
        }
        Reached::Held(leaves) => leaves,
    };
    if is_taken(&leaves, link.option) {
        return None;
    }
    Some(fault(
        LINK_TYPE,
        format!(
            "{} links to {}, which holds {}.",
            subject_of(link.option, link.node),
            link.path,
            describe(&leaves)
        ),
        "Link a key that holds a value the option takes: a string or a number for a string option, a Boolean for a Boolean option, a whole number for a counted option, or an array for a multiple or arity option.",
        &link.path,
    ))
}

fn fault(rule: DiagnosticRule, sentence: String, correction: &str, path: &str) -> DeclarationError {
    DeclarationError::new(
        rule,
        DiagnosticParts::new(sentence)
            .finding(Finding::new("ConfigInputFacts::path", vec![path.into()]).mark("0"))
            .correction(correction),
    )
}

/// The `on_graph_built` hook: it reads the configuration file's shape the graph publishes, only
/// when an option carries the binding, and returns the first fault it finds.
pub(crate) fn judge_links(graph: &CommandGraph) -> Result<(), Error> {
    let linked = linked_options(graph)?;
    if linked.is_empty() {
        return Ok(());
    }
    let Some(shape) = published_schema(graph) else {
        return Ok(());
    };
    match linked.iter().find_map(|link| fault_of(link, shape)) {
        Some(fault) => Err(fault.into()),
        None => Ok(()),
    }
}
