//! The view registry: every contributor's overrides in resolution order, and the identity rule that
//! keeps one declared view per identity.
//!
//! Resolution is one walk over one list of contributors: the application's overrides first, then
//! each installed plugin's in installation order, then the default function of the declared view.
//! Inside one contributor, the first override for a key wins, as it does across contributors. A
//! declared-view key matches by its identity and the type of the view it declares; a bare view is
//! never overridden.

use std::any::{Any, TypeId};
use std::collections::BTreeMap;
use std::sync::Arc;

use crate::diagnostics::{DiagnosticParts, Finding, Literal, rules};
use crate::failures::messages::quoted;
use crate::failures::{DeclarationError, Failure};

use super::view::{ErasedFailureView, OverrideIdentity, core_views};
use super::{RowView, View, ViewContribution, ViewOverride};

/// The contributors one run resolves a declared view through, in resolution order.
#[derive(Clone, Default)]
pub(crate) struct ViewRegistry {
    contributors: Vec<Vec<ViewOverride>>,
}

impl ViewRegistry {
    /// A registry over the application's overrides alone, which a build fault reports through.
    pub(crate) fn new(application: &[ViewOverride]) -> Self {
        Self {
            contributors: vec![application.to_vec()],
        }
    }

    /// A registry over the application's overrides, then each installed plugin's in installation
    /// order, which a run reads once its graph has built.
    pub(crate) fn with_plugins(
        application: &[ViewOverride],
        plugins: &[Arc<crate::__private::PluginState>],
    ) -> Self {
        let mut contributors = vec![application.to_vec()];
        contributors.extend(plugins.iter().map(|plugin| {
            plugin
                .views
                .iter()
                .filter_map(|entry| match entry {
                    ViewContribution::Override(entry) => Some(entry.clone()),
                    ViewContribution::Declared(_) => None,
                })
                .collect()
        }));
        Self { contributors }
    }

    /// The view that answers `failure`: at each contributor in resolution order, the first override
    /// of the failure's class, then of each class it extends, most derived first. `None` leaves the
    /// failure to core's default text.
    pub(crate) fn failure_view(&self, failure: &dyn Failure) -> Option<ErasedFailureView> {
        self.contributors.iter().find_map(|contributor| {
            let mut class = Some(failure.class());
            while let Some(current) = class {
                let found = contributor.iter().find_map(|entry| match &entry.key {
                    OverrideIdentity::Failure { class: key, render }
                        if std::ptr::eq(*key, current) =>
                    {
                        Some(Arc::clone(render))
                    }
                    _ => None,
                });
                if found.is_some() {
                    return found;
                }
                class = current.parent();
            }
            None
        })
    }

    /// The first replacement any contributor holds for the declared view `identity` of type `data`.
    fn replacement(&self, identity: &str, data: TypeId) -> Option<&Arc<dyn Any + Send + Sync>> {
        self.contributors
            .iter()
            .flatten()
            .find_map(|entry| match &entry.key {
                OverrideIdentity::View {
                    identity: key,
                    data: key_data,
                } if **key == *identity && *key_data == data => Some(&entry.replacement),
                _ => None,
            })
    }

    /// The whole view `view` resolves to: the first contributor's replacement of the declared view
    /// `identity`, else its own function. A bare view, with no identity, is never replaced.
    pub(crate) fn whole<D: ?Sized + 'static>(
        &self,
        identity: Option<&str>,
        view: &View<D>,
    ) -> View<D> {
        identity
            .and_then(|identity| self.replacement(identity, TypeId::of::<View<D>>()))
            .and_then(|replacement| replacement.downcast_ref::<View<D>>())
            .map_or_else(|| view.clone(), View::clone)
    }

    /// The row view `view` resolves to, by the same walk. A replacement supplies the whole shape,
    /// so one that omits `head` drops the default's `head` with it.
    pub(crate) fn rows<R: 'static>(&self, identity: Option<&str>, view: &RowView<R>) -> RowView<R> {
        identity
            .and_then(|identity| self.replacement(identity, TypeId::of::<RowView<R>>()))
            .and_then(|replacement| replacement.downcast_ref::<RowView<R>>())
            .map_or_else(|| view.clone(), RowView::clone)
    }
}

/// The correction a second copy of one view identity gives.
const COPIES_CORRECTION: &str = "Install one copy of the package that declares it.";

/// The identity and view type one contribution puts on the graph: a declared view, or the key of
/// an override of a declared view. A failure-class override carries no identity.
fn identity_of(entry: &ViewContribution) -> Option<(&Arc<str>, TypeId)> {
    match entry {
        ViewContribution::Declared(declared) => Some((&declared.identity, declared.data)),
        ViewContribution::Override(ViewOverride {
            key: OverrideIdentity::View { identity, data },
            ..
        }) => Some((identity, *data)),
        ViewContribution::Override(_) => None,
    }
}

/// The identities core's own views hold, and those each contribution in `known` puts on the graph.
fn known_identities<'a>(
    known: impl IntoIterator<Item = &'a ViewContribution>,
) -> BTreeMap<Arc<str>, TypeId> {
    let mut identities: BTreeMap<Arc<str>, TypeId> = BTreeMap::new();
    for declared in core_views() {
        identities.insert(declared.identity, declared.data);
    }
    for entry in known {
        if let Some((identity, data)) = identity_of(entry) {
            identities.entry(Arc::clone(identity)).or_insert(data);
        }
    }
    identities
}

/// Checks the contributions one list adds against the views core declares and the contributions
/// `known` holds: one identity names one declared view, so a declared view or an override key under
/// a known identity with another view type is `two-package-copies`, marking the entry `place` names.
pub(crate) fn check_contributions(
    known: &[ViewContribution],
    added: &[ViewContribution],
    place: impl Fn(usize) -> Finding,
) -> Result<(), DeclarationError> {
    let mut identities = known_identities(known);
    for (index, entry) in added.iter().enumerate() {
        let Some((identity, data)) = identity_of(entry) else {
            continue;
        };
        match identities.get(identity) {
            None => {
                identities.insert(Arc::clone(identity), data);
            }
            Some(known) if *known == data => {}
            Some(_) => {
                let named = quoted(identity);
                return Err(DeclarationError::new(
                    rules::TWO_PACKAGE_COPIES,
                    DiagnosticParts::new(format!(
                        "View {named} is declared by two distinct objects."
                    ))
                    .finding(place(index).note(format!("another {named}")))
                    .correction(COPIES_CORRECTION),
                ));
            }
        }
    }
    Ok(())
}

/// Checks the overrides one `overrides()` call adds against the views core declares, the overrides
/// the application listed before, and every installed plugin's contributions, marking the entry.
pub(crate) fn check_overrides(
    known: &[ViewContribution],
    added: &[ViewOverride],
) -> Result<(), DeclarationError> {
    let added: Vec<ViewContribution> = added
        .iter()
        .cloned()
        .map(ViewContribution::Override)
        .collect();
    let count = added.len();
    check_contributions(known, &added, |index| {
        let entries = vec![Literal::builder("override_view(…, …)"); count];
        Finding::new("overrides", vec![Literal::List(entries)])
            .path(Vec::new())
            .mark(format!("0.{index}"))
    })
}
