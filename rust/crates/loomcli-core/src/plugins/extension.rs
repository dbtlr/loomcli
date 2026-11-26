//! Extensions: typed facts a plugin defines and attaches to Commands, options, and arguments.

use std::any::TypeId;
use std::marker::PhantomData;
use std::sync::Arc;

use serde::Serialize;
use serde::de::DeserializeOwned;

use std::collections::BTreeMap;

use crate::__private::ExtensionOwners;
use crate::diagnostics::{DiagnosticParts, rules};
use crate::diagnostics::{Finding, Literal};
use crate::failures::DeclarationError;
use crate::failures::messages::as_sentence;
use crate::failures::messages::quoted;
use crate::inputs::Issue;
use crate::inspection::{ArgumentNode, CommandNode, OptionNode};
use crate::support::escape_control_characters;

use super::AttachedCommand;

/// What an extension attaches to.
pub trait ExtensionTarget: Send + Sync + 'static {
    /// `command`, `option`, or `argument`.
    const NAME: &'static str;
}

/// An extension on a Command.
pub struct CommandTarget;
/// An extension on an option.
pub struct OptionTarget;
/// An extension on an argument.
pub struct ArgumentTarget;

impl ExtensionTarget for CommandTarget {
    const NAME: &'static str = "command";
}
impl ExtensionTarget for OptionTarget {
    const NAME: &'static str = "option";
}
impl ExtensionTarget for ArgumentTarget {
    const NAME: &'static str = "argument";
}

/// Whether an extension holds one value per declaration or collects values from every layer.
pub trait Collect: Send + Sync + 'static {
    /// What a read returns for a value type `V`.
    type Read<V>;
    #[doc(hidden)]
    const COLLECTS: bool;
    #[doc(hidden)]
    fn read<V: DeserializeOwned>(
        identity: &str,
        stored: Option<&serde_json::Value>,
    ) -> Result<Self::Read<V>, crate::Error>;
}

/// One value per declaration; a later value replaces an earlier one whole. A read returns `Option<V>`.
pub struct Single;
/// Values from the author and from other plugins' hooks, author first. A read returns `Vec<V>`.
pub struct Collecting;

impl Collect for Single {
    type Read<V> = Option<V>;
    const COLLECTS: bool = false;
    fn read<V: DeserializeOwned>(
        identity: &str,
        stored: Option<&serde_json::Value>,
    ) -> Result<Option<V>, crate::Error> {
        stored.map(|value| typed(identity, value)).transpose()
    }
}
impl Collect for Collecting {
    type Read<V> = Vec<V>;
    const COLLECTS: bool = true;
    fn read<V: DeserializeOwned>(
        identity: &str,
        stored: Option<&serde_json::Value>,
    ) -> Result<Vec<V>, crate::Error> {
        match stored {
            None => Ok(Vec::new()),
            Some(serde_json::Value::Array(values)) => {
                values.iter().map(|value| typed(identity, value)).collect()
            }
            Some(value) => typed::<Vec<V>>(identity, value),
        }
    }
}

/// One stored value read as `V`. A descriptor reads back what it stored, so a value `V` does not
/// deserialize was stored by another type under the same identity.
fn typed<V: DeserializeOwned>(
    identity: &str,
    value: &serde_json::Value,
) -> Result<V, crate::Error> {
    V::deserialize(value).map_err(|_| unread_value(identity).into())
}

/// The fault of a read through a descriptor that did not store the value.
fn unread_value(identity: &str) -> DeclarationError {
    DeclarationError::new(
        rules::TWO_PACKAGE_COPIES,
        DiagnosticParts::new(format!(
            "Extension {} was read through a descriptor that did not define the stored value.",
            quoted(identity)
        ))
        .correction(COPIES_CORRECTION),
    )
}

const COPIES_CORRECTION: &str = "Install one copy of the package that defines it.";

/// An extension descriptor: an identity, a target, and the value type `V`, which serializes to the
/// plain data the graph carries. Declare one as a constant in a declarations-only module.
pub struct Extension<T, V, C = Single> {
    identity: &'static str,
    check: Option<CheckFn<V>>,
    _types: crate::__private::Types<T, V, C>,
}

/// The value rules of an extension a type cannot state.
pub type CheckFn<V> = fn(&V) -> Result<(), Vec<Issue>>;

impl<T, V: Serialize + DeserializeOwned + 'static> Extension<T, V, Single> {
    /// A descriptor that holds one value per declaration.
    #[must_use]
    pub const fn new(identity: &'static str) -> Self {
        Self {
            identity,
            check: None,
            _types: PhantomData,
        }
    }
}

impl<T, V: Serialize + DeserializeOwned + 'static> Extension<T, V, Collecting> {
    /// A descriptor that collects a value from every layer. Its type names `Collecting` as the
    /// third parameter, which a constant states:
    ///
    /// ```
    /// use loomcli_core::{Collecting, CommandTarget, Extension};
    ///
    /// pub const TAGS: Extension<CommandTarget, String, Collecting> =
    ///     Extension::collecting("@acme/tagger/tags");
    /// ```
    #[must_use]
    pub const fn collecting(identity: &'static str) -> Self {
        Self {
            identity,
            check: None,
            _types: PhantomData,
        }
    }
}

impl<T, V, C> Extension<T, V, C> {
    /// Adds the value rules a type cannot state; a value they reject is a fault at the call that
    /// carries it.
    pub const fn check(self, check: CheckFn<V>) -> Self {
        Self {
            identity: self.identity,
            check: Some(check),
            _types: PhantomData,
        }
    }

    /// The identity.
    #[must_use]
    pub const fn identity(&self) -> &'static str {
        self.identity
    }
}

impl<T: ExtensionTarget, V: Serialize + DeserializeOwned + 'static, C: Collect> Extension<T, V, C> {
    /// A value of this extension, for a declaration's `extend()`. Making it serializes the value and
    /// runs the descriptor's value rules, and records their verdict; the call that carries it
    /// reports a rejected value: the author's `extend()` as a fault at that call, a hook's
    /// `AttachedCommand::extend` as its returned `DeclarationError`, both under
    /// `invalid-extension-value`.
    pub fn value(&self, value: V) -> ExtensionValue<T> {
        let verdict = match self.check.map(|check| check(&value)) {
            Some(Err(issues)) => Err(ValueFault::Rejected(issues)),
            _ => serde_json::to_value(&value).map_err(|_| ValueFault::NotPlain),
        };
        ExtensionValue {
            descriptor: self.erased(),
            value: verdict,
            _target: PhantomData,
        }
    }

    /// The descriptor with its value type erased.
    fn erased(&self) -> AnyExtension {
        AnyExtension {
            identity: self.identity,
            target: T::NAME,
            collects: C::COLLECTS,
            value_type: TypeId::of::<V>(),
        }
    }
}

/// A value of one extension, ready to attach to a declaration of target `T`, with the verdict of
/// its descriptor's rules.
pub struct ExtensionValue<T> {
    pub(crate) descriptor: AnyExtension,
    pub(crate) value: Result<serde_json::Value, ValueFault>,
    pub(crate) _target: PhantomData<fn() -> T>,
}

impl<T> Clone for ExtensionValue<T> {
    fn clone(&self) -> Self {
        Self {
            descriptor: self.descriptor.clone(),
            value: self.value.clone(),
            _target: PhantomData,
        }
    }
}

/// Why a descriptor refused a value when it was made.
#[derive(Clone, Debug)]
pub(crate) enum ValueFault {
    /// The descriptor's value rules rejected it, with their issues.
    Rejected(Vec<Issue>),
    /// The value did not serialize as JSON data.
    NotPlain,
}

/// A descriptor with its value type erased, as a plugin's `extensions` list holds it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnyExtension {
    pub(crate) identity: &'static str,
    pub(crate) target: &'static str,
    pub(crate) collects: bool,
    pub(crate) value_type: TypeId,
}

impl AnyExtension {
    /// The identity.
    #[must_use]
    pub fn identity(&self) -> &'static str {
        self.identity
    }

    /// `command`, `option`, or `argument`.
    #[must_use]
    pub fn target(&self) -> &'static str {
        self.target
    }

    /// Whether it collects.
    #[must_use]
    pub fn collects(&self) -> bool {
        self.collects
    }
}

impl<T: ExtensionTarget, V: 'static, C: Collect> From<Extension<T, V, C>> for AnyExtension {
    fn from(descriptor: Extension<T, V, C>) -> Self {
        AnyExtension::from(&descriptor)
    }
}

impl<T: ExtensionTarget, V: 'static, C: Collect> From<&Extension<T, V, C>> for AnyExtension {
    fn from(descriptor: &Extension<T, V, C>) -> Self {
        AnyExtension {
            identity: descriptor.identity,
            target: T::NAME,
            collects: C::COLLECTS,
            value_type: TypeId::of::<V>(),
        }
    }
}

/// A node that carries extension values of target `T`.
pub trait ExtensionCarrier<T> {
    #[doc(hidden)]
    fn extension_values(&self) -> &serde_json::Map<String, serde_json::Value>;
    #[doc(hidden)]
    fn extension_owners(&self) -> &ExtensionOwners;
}

impl ExtensionCarrier<CommandTarget> for CommandNode {
    fn extension_values(&self) -> &serde_json::Map<String, serde_json::Value> {
        &self.extensions
    }
    fn extension_owners(&self) -> &ExtensionOwners {
        &self.owners
    }
}

impl ExtensionCarrier<CommandTarget> for Arc<CommandNode> {
    fn extension_values(&self) -> &serde_json::Map<String, serde_json::Value> {
        &self.extensions
    }
    fn extension_owners(&self) -> &ExtensionOwners {
        &self.owners
    }
}

// A hook reads the record `inspect()` would publish for the Command at that hook.
impl ExtensionCarrier<CommandTarget> for AttachedCommand {
    fn extension_values(&self) -> &serde_json::Map<String, serde_json::Value> {
        &self.inner.record
    }
    fn extension_owners(&self) -> &ExtensionOwners {
        &self.inner.owners
    }
}

impl ExtensionCarrier<OptionTarget> for OptionNode {
    fn extension_values(&self) -> &serde_json::Map<String, serde_json::Value> {
        self.extensions()
    }
    fn extension_owners(&self) -> &ExtensionOwners {
        self.owners()
    }
}

impl ExtensionCarrier<OptionTarget> for Arc<OptionNode> {
    fn extension_values(&self) -> &serde_json::Map<String, serde_json::Value> {
        self.extensions()
    }
    fn extension_owners(&self) -> &ExtensionOwners {
        self.owners()
    }
}

impl ExtensionCarrier<ArgumentTarget> for ArgumentNode {
    fn extension_values(&self) -> &serde_json::Map<String, serde_json::Value> {
        &self.extensions
    }
    fn extension_owners(&self) -> &ExtensionOwners {
        &self.owners
    }
}

impl ExtensionCarrier<ArgumentTarget> for Arc<ArgumentNode> {
    fn extension_values(&self) -> &serde_json::Map<String, serde_json::Value> {
        &self.extensions
    }
    fn extension_owners(&self) -> &ExtensionOwners {
        &self.owners
    }
}

/// Reads `descriptor`'s value from `node`, typed: `Option<V>` for a single extension, `Vec<V>`, author
/// first, for a collecting one. A stored value that another descriptor under the same identity
/// produced, or one `V` does not deserialize, returns a `DeclarationError`, which takes the ordinary
/// failure path inside a run: exit 1, and the generic message in a distributed build.
pub fn read_extension<T, V, C, N>(
    node: &N,
    descriptor: &Extension<T, V, C>,
) -> Result<C::Read<V>, crate::Error>
where
    T: ExtensionTarget,
    V: DeserializeOwned + 'static,
    C: Collect,
    N: ExtensionCarrier<T> + ?Sized,
{
    let identity = descriptor.identity;
    let read = AnyExtension::from(descriptor);
    let stored = match node.extension_owners().owner(identity) {
        None => None,
        Some(owner) if *owner == read => node.extension_values().get(identity),
        Some(_) => return Err(unread_value(identity).into()),
    };
    C::read(identity, stored)
}

/// The descriptors one declaration or Application has admitted, by identity: one identity names
/// one descriptor.
pub(crate) type DescriptorRegistry = BTreeMap<&'static str, AnyExtension>;

/// How a fault about one layer's values names the declaration that carries them: the sentence that
/// opens it, and the phrase that places it after a verb.
#[derive(Clone, Debug)]
pub(crate) struct ExtensionSubject {
    pub(crate) phrase: String,
    pub(crate) sentence: String,
}

/// Where a layer's values sit in the author's code: the call that carries them, and the mark path of
/// the list inside its arguments, so entry `i` marks `{at}.{i}`.
#[derive(Clone, Debug)]
pub(crate) struct ExtensionSite {
    pub(crate) call: Finding,
    pub(crate) at: String,
}

impl ExtensionSite {
    /// The finding that marks entry `index` of the list.
    fn entry(&self, index: usize, note: Option<String>) -> Finding {
        let mark = if self.at.is_empty() {
            index.to_string()
        } else {
            format!("{}.{index}", self.at)
        };
        let finding = self.call.clone().mark(mark);
        match note {
            Some(note) => finding.note(note),
            None => finding,
        }
    }
}

/// The list literal a finding prints for `count` extension values.
pub(crate) fn values_literal(count: usize) -> Literal {
    Literal::List(vec![Literal::Opaque; count])
}

/// Admits `descriptor` into `registry`, or reports the descriptor already there under its identity.
pub(crate) fn admit_descriptor(
    registry: &mut DescriptorRegistry,
    descriptor: &AnyExtension,
    place: Option<Finding>,
) -> Result<(), DeclarationError> {
    match registry.get(descriptor.identity) {
        None => {
            registry.insert(descriptor.identity, descriptor.clone());
            Ok(())
        }
        Some(known) if known == descriptor => Ok(()),
        Some(_) => {
            let identity = quoted(descriptor.identity);
            let mut parts = DiagnosticParts::new(format!("Extension {identity} is defined twice."))
                .correction(COPIES_CORRECTION);
            if let Some(place) = place {
                parts = parts.finding(place.note(format!("another {identity}")));
            }
            Err(DeclarationError::new(rules::TWO_PACKAGE_COPIES, parts))
        }
    }
}

/// The first issue's message, escaped, or core's sentence for a rejection with no issue.
fn issue_text(issues: &[Issue]) -> String {
    issues.first().map_or_else(
        || "The schema rejected this value without an explanation".to_owned(),
        |issue| escape_control_characters(&issue.message),
    )
}

/// Validates one layer of values, one `extend()` call or one input's values, in order: each
/// descriptor against those `registry` already holds, then each value's verdict. A later value of
/// one descriptor in the layer replaces the earlier one in its place. On success the layer's
/// descriptors join `registry`; on a fault nothing does.
pub(crate) fn validate_layer<T>(
    values: &[ExtensionValue<T>],
    registry: &mut DescriptorRegistry,
    site: &ExtensionSite,
    subject: &ExtensionSubject,
) -> Result<Vec<(AnyExtension, serde_json::Value)>, DeclarationError> {
    let mut staged = registry.clone();
    let mut layer: Vec<(AnyExtension, serde_json::Value)> = Vec::new();
    for (index, value) in values.iter().enumerate() {
        let descriptor = &value.descriptor;
        admit_descriptor(&mut staged, descriptor, Some(site.entry(index, None)))?;
        let identity = quoted(descriptor.identity);
        let place = site.entry(index, Some(format!("extension {identity}")));
        let output = match &value.value {
            Ok(output) => output.clone(),
            Err(ValueFault::Rejected(issues)) => {
                return Err(DeclarationError::new(
                    rules::INVALID_EXTENSION_VALUE,
                    DiagnosticParts::new(format!(
                        "{} holds an invalid {identity} value: {}",
                        subject.sentence,
                        as_sentence(&issue_text(issues))
                    ))
                    .finding(place)
                    .correction("Correct the value."),
                ));
            }
            Err(ValueFault::NotPlain) => {
                return Err(DeclarationError::new(
                    rules::EXTENSION_OUTPUT,
                    DiagnosticParts::new(format!(
                        "Extension {identity} produced a value that is not plain data {}.",
                        subject.phrase
                    ))
                    .finding(place)
                    .correction(
                        "Return strings, numbers, booleans, null, arrays, and plain objects.",
                    ),
                ));
            }
        };
        match layer
            .iter_mut()
            .find(|(known, _)| known.identity == descriptor.identity)
        {
            Some(entry) => entry.1 = output,
            None => layer.push((descriptor.clone(), output)),
        }
    }
    *registry = staged;
    Ok(layer)
}

/// The values one declaration carries, per identity in the order each first arrived: one output
/// for an ordinary extension, every output in collection order for a collecting one.
#[derive(Clone, Debug, Default)]
pub(crate) struct ExtensionStore {
    entries: Vec<(AnyExtension, Vec<serde_json::Value>)>,
}

impl ExtensionStore {
    /// Adds a validated layer: a later value replaces an ordinary extension's output whole, and a
    /// collecting extension keeps every output.
    pub(crate) fn extend(&mut self, layer: Vec<(AnyExtension, serde_json::Value)>) {
        for (descriptor, output) in layer {
            match self
                .entries
                .iter_mut()
                .find(|(known, _)| known.identity == descriptor.identity)
            {
                Some((known, outputs)) => {
                    if descriptor.collects {
                        outputs.push(output);
                    } else {
                        *outputs = vec![output];
                    }
                    *known = descriptor;
                }
                None => self.entries.push((descriptor, vec![output])),
            }
        }
    }

    /// The record a node publishes, with the descriptor that stored each identity.
    pub(crate) fn publish(&self) -> (serde_json::Map<String, serde_json::Value>, ExtensionOwners) {
        let mut record = serde_json::Map::new();
        let mut owners = Vec::new();
        for (descriptor, outputs) in &self.entries {
            let stored = if descriptor.collects {
                serde_json::Value::Array(outputs.clone())
            } else {
                outputs.first().cloned().unwrap_or(serde_json::Value::Null)
            };
            record.insert(descriptor.identity.to_owned(), stored);
            owners.push(descriptor.clone());
        }
        (record, ExtensionOwners(Arc::new(owners)))
    }

    /// Every descriptor the store holds.
    pub(crate) fn descriptors(&self) -> impl Iterator<Item = &AnyExtension> {
        self.entries.iter().map(|(descriptor, _)| descriptor)
    }
}
