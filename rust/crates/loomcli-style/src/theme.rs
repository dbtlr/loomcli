//! Themes: the mapping a theme plugin supplies, the theme core builds from it, and the palette a
//! theme resolves to on one background.

use std::collections::BTreeMap;
use std::sync::Arc;

use crate::background::Background;
use crate::style::{AdaptiveStyle, Operation, Style, StyleError};

/// One value of a theme mapping: a concrete chain, the same on both backgrounds, or an adaptive
/// style with a side for each.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ThemeValue {
    /// A concrete chain, such as `style().yellow().bold()`.
    Plain(Style),
    /// One concrete chain for each background.
    Adaptive(AdaptiveStyle),
}

impl From<Style> for ThemeValue {
    fn from(style: Style) -> ThemeValue {
        ThemeValue::Plain(style)
    }
}

impl From<&Style> for ThemeValue {
    fn from(style: &Style) -> ThemeValue {
        ThemeValue::Plain(style.clone())
    }
}

impl From<AdaptiveStyle> for ThemeValue {
    fn from(adaptive: AdaptiveStyle) -> ThemeValue {
        ThemeValue::Adaptive(adaptive)
    }
}

/// The mapping a theme plugin supplies: semantic names, core or custom, each with a value or
/// declared with none. Its names form the Application's one flat token vocabulary. Build it with
/// [`ThemeMapping::new`]; setting a name again replaces its value in place.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct ThemeMapping {
    entries: Vec<(String, Option<ThemeValue>)>,
}

impl ThemeMapping {
    /// A mapping with no entry.
    #[must_use]
    pub const fn new() -> ThemeMapping {
        ThemeMapping {
            entries: Vec::new(),
        }
    }

    /// The mapping with `name` mapped to a concrete chain or an adaptive style.
    #[must_use]
    pub fn entry(self, name: &str, value: impl Into<ThemeValue>) -> ThemeMapping {
        self.set(name, Some(value.into()))
    }

    /// The mapping with `name` declared and given no style: the name joins the vocabulary, and the
    /// token inherits its surroundings.
    #[must_use]
    pub fn declare(self, name: &str) -> ThemeMapping {
        self.set(name, None)
    }

    fn set(mut self, name: &str, value: Option<ThemeValue>) -> ThemeMapping {
        if let Some(entry) = self.entries.iter_mut().find(|(key, _)| key == name) {
            entry.1 = value;
        } else {
            self.entries.push((name.to_owned(), value));
        }
        self
    }

    /// The mapping's entries, in the order their names were first set.
    #[must_use]
    pub fn entries(&self) -> &[(String, Option<ThemeValue>)] {
        &self.entries
    }
}

/// One built theme entry: one operation list, or one for each background.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum ThemeEntry {
    Plain(Vec<Operation>),
    Adaptive {
        dark: Vec<Operation>,
        light: Vec<Operation>,
    },
}

/// A theme as core resolves semantic styles through it, built and checked from a mapping.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct Theme {
    entries: Vec<(String, ThemeEntry)>,
}

impl Theme {
    /// The theme a mapping describes. A declared name with no value maps to no operation.
    ///
    /// # Errors
    ///
    /// [`StyleError::ThemeEntry`] when a value is a chain that holds a semantic token, since a
    /// mapping cannot reference a token.
    pub fn build(mapping: &ThemeMapping) -> Result<Theme, StyleError> {
        let entries = mapping
            .entries
            .iter()
            .map(|(name, value)| {
                let entry = match value {
                    None => ThemeEntry::Plain(Vec::new()),
                    Some(ThemeValue::Plain(style)) if style.is_concrete() => {
                        ThemeEntry::Plain(style.operations().to_vec())
                    }
                    Some(ThemeValue::Plain(_)) => return Err(StyleError::ThemeEntry(name.clone())),
                    Some(ThemeValue::Adaptive(adaptive)) => ThemeEntry::Adaptive {
                        dark: adaptive.dark().to_vec(),
                        light: adaptive.light().to_vec(),
                    },
                };
                Ok((name.clone(), entry))
            })
            .collect::<Result<_, _>>()?;
        Ok(Theme { entries })
    }

    /// Whether any entry adapts to the background, which makes the run detect its background.
    #[must_use]
    pub fn adapts(&self) -> bool {
        self.entries
            .iter()
            .any(|(_, entry)| matches!(entry, ThemeEntry::Adaptive { .. }))
    }

    /// The names the theme declares, in mapping order.
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|(name, _)| name.as_str())
    }

    /// The palette the theme resolves to on one background: a plain entry's own operations, and an
    /// adaptive entry's light side on a light background and its dark side otherwise.
    #[must_use]
    pub fn palette(&self, background: Option<Background>) -> Palette {
        let mut entries = BTreeMap::new();
        for (name, entry) in &self.entries {
            let operations = match entry {
                ThemeEntry::Plain(operations) => operations,
                ThemeEntry::Adaptive { light, .. } if background == Some(Background::Light) => {
                    light
                }
                ThemeEntry::Adaptive { dark, .. } => dark,
            };
            entries.insert(name.clone(), operations.clone());
        }
        Palette {
            entries: (!entries.is_empty()).then(|| Arc::new(entries)),
        }
    }
}

/// The concrete operations each declared token name resolves to on one destination. A token a
/// style header names is recognized when it is a core token or a name the palette holds.
///
/// A palette is shared, not copied, when it is cloned, so a renderer built for each render call
/// costs no copy of it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct Palette {
    /// The entries, or `None` for a palette with none, so that every empty palette is equal.
    entries: Option<Arc<BTreeMap<String, Vec<Operation>>>>,
}

impl Palette {
    /// A palette with no name, as without a theme: core tokens inherit their surroundings.
    #[must_use]
    pub const fn new() -> Palette {
        Palette { entries: None }
    }

    /// The operations a name maps to, or `None` when the palette holds no such name.
    #[must_use]
    pub fn get(&self, name: &str) -> Option<&[Operation]> {
        self.entries.as_ref()?.get(name).map(Vec::as_slice)
    }

    /// Whether the palette declares a name.
    #[must_use]
    pub fn contains(&self, name: &str) -> bool {
        self.entries
            .as_ref()
            .is_some_and(|entries| entries.contains_key(name))
    }

    /// The names the palette declares.
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.entries
            .iter()
            .flat_map(|entries| entries.keys())
            .map(String::as_str)
    }
}
