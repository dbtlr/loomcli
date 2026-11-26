//! The provided values of one run: building what the routed Command opted in to at the dispatch
//! boundary, one value at a time and dependencies first, and closing each value when its lifetime
//! ends, in reverse build order.
//!
//! This is the reference's `RunValues` and `PersistentValues`. A run builds and closes its own
//! ephemeral values; the persistent values belong to its outermost run, which closes them after its
//! own ephemeral ones.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use crate::__private::RunState;
use crate::failures::Error;
use crate::failures::messages::quoted;
use crate::host::Host;
use crate::inputs::InputValues;
use crate::inspection::CommandGraph;
use crate::invocation::InvokedBy;
use crate::output::emit::Channel;
use crate::output::{Log, LogFields, Out};
use crate::signals::RunSignal;

use super::messages;
use super::provider::{ErasedOpen, ErasedValue, ProvidedValues, ProviderKey};
use super::{AnyProvider, ProviderContext};

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What an opener of one run reads: that run's validated global options, host, graph, signal, and
/// output, and how it received its inputs. A persistent opener reads its outermost run's.
#[derive(Clone)]
pub(crate) struct OpenerScope {
    pub(crate) options: InputValues,
    pub(crate) host: Arc<Host>,
    pub(crate) graph: Arc<CommandGraph>,
    pub(crate) signal: RunSignal,
    pub(crate) invoked_by: InvokedBy,
    pub(crate) run: Arc<RunState>,
}

impl OpenerScope {
    /// The context one opener receives, with the values of the providers its `uses` lists.
    fn context(&self, provided: ProvidedValues) -> ProviderContext {
        ProviderContext {
            options: self.options.clone(),
            host: Arc::clone(&self.host),
            out: Out {
                run: Arc::clone(&self.run),
                channel: Arc::new(Channel::plain()),
                _result: std::marker::PhantomData,
            },
            style: crate::style::style(),
            graph: Arc::clone(&self.graph),
            log: self.log(),
            signal: self.signal.clone(),
            invoked_by: self.invoked_by,
            run: Arc::clone(&self.run),
            provided: Arc::new(provided),
        }
    }

    /// The log that names no plugin.
    fn log(&self) -> Log {
        Log {
            run: Arc::clone(&self.run),
            plugin: None,
        }
    }
}

/// One value core built, with the provider that closes it.
struct Built {
    provider: AnyProvider,
    value: ErasedValue,
}

/// How one run's build ended: the values it built, by identity, or a cancellation that stopped it,
/// with the error an opener returned after the signal was cancelled.
pub(crate) enum BuildOutcome {
    Built(Vec<(ProviderKey, ErasedValue)>),
    Cancelled(Option<Error>),
}

/// The persistent values of one outermost run, which every run inside it shares.
pub(crate) struct PersistentValues {
    /// Held across each build, so two runs that first need one value build it once.
    gate: tokio::sync::Mutex<()>,
    built: Mutex<Vec<Built>>,
    /// The outermost run's opener scope, which every persistent opener reads.
    scope: OpenerScope,
}

impl PersistentValues {
    pub(crate) fn new(scope: OpenerScope) -> Self {
        Self {
            gate: tokio::sync::Mutex::new(()),
            built: Mutex::new(Vec::new()),
            scope,
        }
    }

    /// The value of one persistent provider, built now unless an earlier run built it. A build
    /// that fails leaves nothing behind, so the next run that needs the value builds it again.
    async fn obtain(
        &self,
        needed: &AnyProvider,
        open: ErasedOpen,
        provided: ProvidedValues,
    ) -> Result<ErasedValue, Error> {
        let _building = self.gate.lock().await;
        let key = needed.key();
        if let Some(value) = locked(&self.built)
            .iter()
            .find(|built| built.provider.key() == key)
            .map(|built| Arc::clone(&built.value))
        {
            return Ok(value);
        }
        let value = open(self.scope.context(provided)).await?;
        locked(&self.built).push(Built {
            provider: needed.clone(),
            value: Arc::clone(&value),
        });
        Ok(value)
    }

    /// Closes every persistent value once each build in flight has settled.
    async fn close(&self, log: &Log, fails: bool) -> Option<Error> {
        let _settled = self.gate.lock().await;
        let built = std::mem::take(&mut *locked(&self.built));
        close_values(built, log, fails).await
    }
}

/// The values of one run: the ephemeral values it builds and closes, and the persistent values of
/// its outermost run, which it builds into and closes only when it is the outermost run.
pub(crate) struct RunValues {
    scope: OpenerScope,
    ephemeral: Mutex<Vec<Built>>,
    persistent: Arc<PersistentValues>,
    outermost: bool,
    /// The openers a test substituted, each keyed by the provider it replaces.
    substitutes: Arc<[AnyProvider]>,
}

impl RunValues {
    pub(crate) fn new(
        scope: OpenerScope,
        persistent: Arc<PersistentValues>,
        outermost: bool,
        substitutes: Arc<[AnyProvider]>,
    ) -> Self {
        Self {
            scope,
            ephemeral: Mutex::new(Vec::new()),
            persistent,
            outermost,
            substitutes,
        }
    }

    /// Builds what `uses` reaches, one value at a time, dependencies first, reusing each persistent
    /// value the outermost run already holds. When the run's signal is cancelled, the opener in
    /// flight settles and nothing further is built. An opener's `Err` on a live run is returned;
    /// the caller closes what was built.
    pub(crate) async fn build(&self, uses: &[AnyProvider]) -> Result<BuildOutcome, Error> {
        let signal = &self.scope.signal;
        let mut values: Vec<(ProviderKey, ErasedValue)> = Vec::new();
        for needed in build_order(uses) {
            if signal.is_cancelled() {
                return Ok(BuildOutcome::Cancelled(None));
            }
            match self.open(&needed, &values).await {
                Ok(value) => values.push((needed.key(), value)),
                Err(error) if signal.is_cancelled() => {
                    return Ok(BuildOutcome::Cancelled(Some(error)));
                }
                Err(error) => return Err(error),
            }
        }
        if signal.is_cancelled() {
            return Ok(BuildOutcome::Cancelled(None));
        }
        Ok(BuildOutcome::Built(values))
    }

    /// Closes the run's ephemeral values, then, on the outermost run, its persistent ones, each in
    /// reverse build order. `fails` holds when the run had otherwise succeeded, so the first close
    /// that fails is the run's failure; every other is an `error` log event.
    pub(crate) async fn close(&self, fails: bool) -> Option<Error> {
        let log = self.scope.log();
        let ephemeral = std::mem::take(&mut *locked(&self.ephemeral));
        let first = close_values(ephemeral, &log, fails).await;
        if !self.outermost {
            return first;
        }
        let persistent = self.persistent.close(&log, fails && first.is_none()).await;
        first.or(persistent)
    }

    /// Builds one value with the opener a test substituted for it, else its own.
    async fn open(
        &self,
        needed: &AnyProvider,
        built: &[(ProviderKey, ErasedValue)],
    ) -> Result<ErasedValue, Error> {
        let key = needed.key();
        let open = self
            .substitutes
            .iter()
            .find(|substitute| substitute.key() == key)
            .map_or_else(
                || Arc::clone(&needed.inner.open),
                |substitute| Arc::clone(&substitute.inner.open),
            );
        let provided = ProvidedValues::of(
            &needed.inner.uses,
            built,
            format!("Provider {}", quoted(&needed.inner.name)),
        );
        if needed.inner.persistent {
            return self.persistent.obtain(needed, open, provided).await;
        }
        let value = open(self.scope.context(provided)).await?;
        locked(&self.ephemeral).push(Built {
            provider: needed.clone(),
            value: Arc::clone(&value),
        });
        Ok(value)
    }
}

/// Every provider `uses` reaches, each after the providers it uses, in the order each list names
/// them; one provider reached twice appears once.
fn build_order(uses: &[AnyProvider]) -> Vec<AnyProvider> {
    fn visit(reached: &AnyProvider, order: &mut Vec<AnyProvider>, seen: &mut Vec<ProviderKey>) {
        let key = reached.key();
        if seen.contains(&key) {
            return;
        }
        seen.push(key);
        for used in &reached.inner.uses {
            visit(used, order, seen);
        }
        order.push(reached.clone());
    }
    let mut order = Vec::new();
    let mut seen = Vec::new();
    for listed in uses {
        visit(listed, &mut order, &mut seen);
    }
    order
}

/// Closes `built` latest first, awaiting each close before the next. When `fails` holds, the first
/// close that fails is returned; every other failing close is an `error` log event naming its
/// provider.
async fn close_values(built: Vec<Built>, log: &Log, fails: bool) -> Option<Error> {
    let mut first: Option<Error> = None;
    for entry in built.into_iter().rev() {
        let Some(close) = &entry.provider.inner.close else {
            continue;
        };
        let Err(error) = close(entry.value).await else {
            continue;
        };
        if fails && first.is_none() {
            first = Some(error);
        } else {
            log.error(
                messages::PROVIDER_CLOSE_FAILED,
                LogFields::new()
                    .field("error", error_fields(&error))
                    .field("provider", &*entry.provider.inner.name),
            );
        }
    }
    first
}

/// What a close's error logs as: its name, the failure class or the foreign error's type, and its
/// message.
fn error_fields(error: &Error) -> serde_json::Value {
    let (name, message) = match error.failure() {
        Some(failure) => (
            failure.class().name().to_owned(),
            crate::failures::FailureFacts::message(failure).to_owned(),
        ),
        None => (
            error.foreign_type_name().unwrap_or("Error").to_owned(),
            error.foreign().map(ToString::to_string).unwrap_or_default(),
        ),
    };
    serde_json::json!({ "message": message, "name": name })
}
