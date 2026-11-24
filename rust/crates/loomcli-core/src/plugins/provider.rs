//! Providers: typed values built for the Commands that opt in, closed when the action settles.

use std::any::{Any, TypeId};
use std::future::Future;
use std::marker::PhantomData;
use std::sync::Arc;

use crate::diagnostics::{DiagnosticParts, Finding, Literal, rules};
use crate::failures::Error;
use crate::failures::sentences::quoted;
use crate::host::Host;
use crate::inputs::{InputValues, Inputs};
use crate::inspection::CommandGraph;
use crate::invocation::InvokedBy;
use crate::output::{Log, Out};
use crate::signals::{Registration, RunSignal, ShutdownEvent};
use crate::style::ContextualStyle;
use crate::support::{BoxFuture, IntoList};

mod sealed {
    pub trait Sealed {}
}

/// How long a provided value lives: [`Ephemeral`] or [`Persistent`]. The lifetime is part of the
/// provider's type, so a persistent provider's `uses` list takes persistent providers alone, a
/// compile error otherwise: the reference's `provider()` rejection of that `uses`.
pub trait Lifetime: sealed::Sealed + Send + Sync + 'static {
    #[doc(hidden)]
    const PERSISTENT: bool;
}

/// Built at each run's dispatch boundary and closed when that run's action settles. The default.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Ephemeral;

/// Built the first time a run inside the outermost run needs it, shared by every later run inside
/// that run, and closed when the outermost run's action settles.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Persistent;

impl sealed::Sealed for Ephemeral {}
impl sealed::Sealed for Persistent {}

impl Lifetime for Ephemeral {
    const PERSISTENT: bool = false;
}
impl Lifetime for Persistent {
    const PERSISTENT: bool = true;
}

/// A provided value with its type erased, as core holds it between its build and its close.
pub(crate) type ErasedValue = Arc<dyn Any + Send + Sync>;

/// An opener with its value type erased.
pub(crate) type ErasedOpen =
    Arc<dyn Fn(ProviderContext) -> BoxFuture<'static, Result<ErasedValue, Error>> + Send + Sync>;

/// A close function with its value type erased.
pub(crate) type ErasedClose =
    Arc<dyn Fn(ErasedValue) -> BoxFuture<'static, Result<(), Error>> + Send + Sync>;

/// What identifies one provider: its name, its value type, its opener's type, and its lifetime.
/// One factory function's calls share every part, so they name one provider.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProviderKey {
    name: Arc<str>,
    value: TypeId,
    opener: TypeId,
    persistent: bool,
}

/// A provider of a typed value `V` with lifetime `L`, such as a database pool or a session. A
/// Command opts in with `uses`, and its action reads the value with `ctx.provided(&provider)`.
///
/// Declaring a provider opens nothing: core calls the opener only for a run that dispatches an
/// action of a Command that opted in, after the chain reaches the dispatch boundary.
///
/// **Identity.** A provider is identified by its name, its value type, and its opener's type. A
/// factory function, `pub fn acme_pool() -> Provider<Pool, Persistent>`, is the way to share one:
/// each call returns a closure of one type, so `.uses([&acme_pool()])` and
/// `ctx.provided(&acme_pool())` name one provider, and one provider reached twice is built once.
/// An opener reads its settings from the global options on its context and captures none, because
/// captured data is not part of the identity. Two providers with one name and another value type
/// or opener are `provider-name-taken` at the `uses` call that reaches both.
#[must_use]
pub struct Provider<V, L: Lifetime = Ephemeral> {
    pub(crate) erased: crate::__private::ErasedProvider,
    pub(crate) _types: PhantomData<fn() -> (V, L)>,
}

impl<V, L: Lifetime> Clone for Provider<V, L> {
    fn clone(&self) -> Self {
        Self {
            erased: self.erased.clone(),
            _types: PhantomData,
        }
    }
}

impl<V: Send + Sync + 'static, L: Lifetime> Provider<V, L> {
    /// A provider named `name` whose opener builds the value, with the lifetime `L`.
    fn declared<H, Fut>(name: &str, opener: H) -> Self
    where
        H: Fn(ProviderContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<V, Error>> + Send + 'static,
    {
        Self {
            erased: crate::__private::ErasedProvider {
                name: Arc::from(name),
                value_type: TypeId::of::<V>(),
                opener_type: TypeId::of::<H>(),
                persistent: L::PERSISTENT,
                uses: Vec::new(),
                open: erase_opener(opener),
                close: None,
            },
            _types: PhantomData,
        }
    }

    /// The `uses` list grown by `added`, after the call's rules: two different providers with one
    /// name among those the whole list reaches are `provider-name-taken`.
    #[track_caller]
    fn listing(mut self, added: Vec<AnyProvider>) -> Self {
        let owner = UsesOwner::Provider(Arc::clone(&self.erased.name));
        crate::commands::declaration::raise(check_listed(&owner, &self.erased.uses, &added));
        self.erased.uses.extend(added);
        self
    }
}

/// The opener of a provider, with its value type erased.
fn erase_opener<V, H, Fut>(opener: H) -> ErasedOpen
where
    V: Send + Sync + 'static,
    H: Fn(ProviderContext) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<V, Error>> + Send + 'static,
{
    Arc::new(move |context| {
        let opening = opener(context);
        Box::pin(async move { opening.await.map(|value| Arc::new(value) as ErasedValue) })
    })
}

impl<V: Send + Sync + 'static> Provider<V, Ephemeral> {
    /// An ephemeral provider named `name` whose opener builds the value.
    pub fn new<H, Fut>(name: &str, opener: H) -> Self
    where
        H: Fn(ProviderContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<V, Error>> + Send + 'static,
    {
        Self::declared(name, opener)
    }

    /// Lists the providers whose values the opener reads, of either lifetime. Two different
    /// providers with one name among those the list reaches are a fault at this call.
    #[track_caller]
    pub fn uses(self, providers: impl IntoList<AnyProvider>) -> Self {
        self.listing(providers.into_list())
    }
}

impl<V: Send + Sync + 'static> Provider<V, Persistent> {
    /// A persistent provider named `name` whose opener builds the value.
    pub fn persistent<H, Fut>(name: &str, opener: H) -> Self
    where
        H: Fn(ProviderContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<V, Error>> + Send + 'static,
    {
        Self::declared(name, opener)
    }

    /// Lists the providers whose values the opener reads: persistent ones alone, because a value
    /// that outlives one run cannot hold a value of one run. Two different providers with one name
    /// among those the list reaches are a fault at this call.
    #[track_caller]
    pub fn uses(self, providers: impl IntoList<PersistentProvider>) -> Self {
        let added = providers
            .into_list()
            .into_iter()
            .map(|provider| provider.inner)
            .collect();
        self.listing(added)
    }
}

impl<V: Send + Sync + 'static, L: Lifetime> Provider<V, L> {
    /// Sets the function that closes the value when its lifetime ends. Every value still closes
    /// when one close fails. On a run that had otherwise succeeded, the first `Err` fails the run
    /// through the ordinary failure path and resolves the `next.run()` that reached the boundary
    /// with it; a later one, or one on a run that already failed or was cancelled, is an `error` log
    /// event, `A provider's close failed.`, with `error` and `provider` fields.
    pub fn close<H, Fut>(mut self, close: H) -> Self
    where
        H: Fn(Arc<V>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<(), Error>> + Send + 'static,
    {
        self.erased.close = Some(Arc::new(move |value: ErasedValue| {
            match value.downcast::<V>() {
                Ok(value) => Box::pin(close(value)),
                // The value core built for this provider is a `V`, so this arm never runs.
                Err(_) => Box::pin(async { Ok(()) }),
            }
        }));
        self
    }

    /// The name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.erased.name
    }

    /// The same provider, keyed by its own identity, whose value `opener` builds: what
    /// `RunOptions::substitute` hands a run in place of the provider's own opener.
    pub(crate) fn substituted<H, Fut>(&self, opener: H) -> AnyProvider
    where
        H: Fn(ProviderContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<V, Error>> + Send + 'static,
    {
        let mut erased = self.erased.clone();
        erased.open = erase_opener(opener);
        AnyProvider {
            inner: Arc::new(erased),
        }
    }
}

/// A provider with its value type and lifetime erased, as a `uses` list holds it. It keeps
/// everything core needs to build and close the value: the opener, the close function, the
/// providers it uses, its lifetime, and its identity.
#[derive(Clone)]
pub struct AnyProvider {
    pub(crate) inner: Arc<crate::__private::ErasedProvider>,
}

impl AnyProvider {
    /// What identifies the provider.
    pub(crate) fn key(&self) -> ProviderKey {
        self.inner.key()
    }
}

impl crate::__private::ErasedProvider {
    /// What identifies the provider.
    pub(crate) fn key(&self) -> ProviderKey {
        ProviderKey {
            name: Arc::clone(&self.name),
            value: self.value_type,
            opener: self.opener_type,
            persistent: self.persistent,
        }
    }
}

impl<V: Send + Sync + 'static, L: Lifetime> From<Provider<V, L>> for AnyProvider {
    fn from(provider: Provider<V, L>) -> Self {
        Self {
            inner: Arc::new(provider.erased),
        }
    }
}

impl<V: Send + Sync + 'static, L: Lifetime> From<&Provider<V, L>> for AnyProvider {
    fn from(provider: &Provider<V, L>) -> Self {
        Self::from(provider.clone())
    }
}

/// A persistent provider with its value type erased, as a persistent provider's `uses` list holds
/// it. Only a `Provider<_, Persistent>` converts into it.
#[derive(Clone)]
pub struct PersistentProvider {
    pub(crate) inner: AnyProvider,
}

impl<V: Send + Sync + 'static> From<Provider<V, Persistent>> for PersistentProvider {
    fn from(provider: Provider<V, Persistent>) -> Self {
        Self {
            inner: AnyProvider::from(provider),
        }
    }
}

impl<V: Send + Sync + 'static> From<&Provider<V, Persistent>> for PersistentProvider {
    fn from(provider: &Provider<V, Persistent>) -> Self {
        Self {
            inner: AnyProvider::from(provider),
        }
    }
}

/// What an opener receives.
#[non_exhaustive]
pub struct ProviderContext {
    /// The validated global option values.
    pub options: InputValues,
    /// The host: the same `Arc` the run's configuration source, its other providers, and its
    /// action receive, so `Arc::ptr_eq` keys data one run shares.
    pub host: Arc<Host>,
    /// The output handle.
    pub out: Out,
    /// The style.
    pub style: ContextualStyle,
    /// The built graph.
    pub graph: Arc<CommandGraph>,
    /// The log.
    pub log: Log,
    /// The run signal.
    pub signal: RunSignal,
    /// How the run received its inputs.
    pub invoked_by: InvokedBy,
    pub(crate) run: Arc<crate::__private::RunState>,
    /// The values of the providers this provider lists in its `uses`.
    pub(crate) provided: Arc<ProvidedValues>,
}

impl ProviderContext {
    /// The global options, read as a typed struct by declared name.
    pub fn globals<G: Inputs>(&self) -> Result<G, Error> {
        G::extract(&self.options)
    }

    /// The value of a provider this provider uses. A provider its `uses` does not list is the
    /// `input-read` fault.
    pub fn provided<V: Send + Sync + 'static, L: Lifetime>(
        &self,
        provider: &Provider<V, L>,
    ) -> Result<Arc<V>, Error> {
        self.provided.read(provider)
    }

    /// Registers a synchronous shutdown handler.
    pub fn on_shutdown(
        &self,
        handler: impl FnOnce(ShutdownEvent) + Send + 'static,
    ) -> Registration {
        self.run.on_shutdown(None, handler)
    }
}

/// The values one reader may read under `provided`: each provider its `uses` lists, by identity.
#[derive(Default)]
pub(crate) struct ProvidedValues {
    values: Vec<(ProviderKey, ErasedValue)>,
    /// Who reads, as an `input-read` fault's sentence opens: `The action`, or `Provider "a"`.
    reader: String,
}

impl ProvidedValues {
    /// The values of `listed`, read from what the run built, for `reader`.
    pub(crate) fn of(
        listed: &[AnyProvider],
        built: &[(ProviderKey, ErasedValue)],
        reader: String,
    ) -> Self {
        let values = listed
            .iter()
            .filter_map(|provider| {
                let key = provider.key();
                built
                    .iter()
                    .find(|(known, _)| *known == key)
                    .map(|(_, value)| (key, Arc::clone(value)))
            })
            .collect();
        Self { values, reader }
    }

    /// The values a test states for `reader`, each under its provider's identity.
    pub(crate) fn stated(values: Vec<(ProviderKey, ErasedValue)>, reader: String) -> Self {
        Self { values, reader }
    }

    /// The value of `provider`, or the `input-read` fault of a provider the reader does not list.
    pub(crate) fn read<V: Send + Sync + 'static, L: Lifetime>(
        &self,
        provider: &Provider<V, L>,
    ) -> Result<Arc<V>, Error> {
        let reader = self.reader.as_str();
        let key = provider.erased.key();
        let value = self
            .values
            .iter()
            .find(|(known, _)| *known == key)
            .map(|(_, value)| Arc::clone(value))
            .ok_or_else(|| unlisted(reader, provider.name()))?;
        // A key names the value type, so the value is a `V`.
        value
            .downcast::<V>()
            .map_err(|_| unlisted(reader, provider.name()))
    }
}

/// The `input-read` fault of a read of a provider the reader's `uses` does not list.
fn unlisted(reader: &str, name: &str) -> Error {
    crate::failures::DeclarationError::new(
        rules::INPUT_READ,
        DiagnosticParts::new(format!(
            "{reader} read provider {}, which its uses does not list.",
            quoted(name)
        ))
        .correction("List the provider in the uses of the Command or provider that reads it."),
    )
    .into()
}

/// Who lists providers: a Command, the Application for the root's own action, or a provider.
pub(crate) enum UsesOwner {
    Command(Option<String>),
    Provider(Arc<str>),
}

impl UsesOwner {
    /// How a sentence opens when it names the owner.
    fn sentence(&self) -> String {
        match self {
            UsesOwner::Command(None) => "The Application".to_owned(),
            UsesOwner::Command(Some(name)) => format!("Command {}", quoted(name)),
            UsesOwner::Provider(name) => format!("Provider {}", quoted(name)),
        }
    }

    /// The finding of the `uses` call that lists `count` providers, marking entry `index`.
    fn finding(&self, count: usize, index: usize) -> Finding {
        let list = Literal::List(vec![Literal::Opaque; count]);
        let finding = match self {
            UsesOwner::Command(name) => {
                Finding::new("uses", vec![list]).path(name.iter().cloned().collect())
            }
            UsesOwner::Provider(name) => Finding::new(
                format!("Provider::new({}, …).uses", Literal::from(&**name)),
                vec![list],
            ),
        };
        finding.mark(format!("0.{index}"))
    }
}

/// Applies the `uses` rules at the call that lists providers: two different providers with one name
/// among those the list reaches, with the ones the declaration already lists, are
/// `provider-name-taken`. `owner` names the Command, `None` for the root.
pub(crate) fn check_uses(
    owner: Option<&str>,
    listed: &[AnyProvider],
    added: &[AnyProvider],
) -> Result<(), crate::DeclarationError> {
    check_listed(&UsesOwner::Command(owner.map(str::to_owned)), listed, added)
}

/// The `uses` rules for any owner.
fn check_listed(
    owner: &UsesOwner,
    listed: &[AnyProvider],
    added: &[AnyProvider],
) -> Result<(), crate::DeclarationError> {
    let mut seen: Vec<ProviderKey> = Vec::new();
    for (index, entry) in listed.iter().chain(added).enumerate() {
        let Some(name) = clash_in(entry, &mut seen) else {
            continue;
        };
        // The list before this call reached no clash, so the entry is one this call added.
        let at = index.saturating_sub(listed.len());
        return Err(crate::DeclarationError::new(
            rules::PROVIDER_NAME_TAKEN,
            DiagnosticParts::new(format!(
                "{} reaches two different providers named {}.",
                owner.sentence(),
                quoted(&name)
            ))
            .finding(owner.finding(added.len(), at))
            .correction("Give each provider its own name. A package that exports a provider prefixes its name with its own, such as \"acmeToken\", so it never meets another package's."),
        ));
    }
    Ok(())
}

/// The name two different providers share, walking `reached` and the providers it uses depth first.
/// One provider reached twice is one provider.
fn clash_in(reached: &AnyProvider, seen: &mut Vec<ProviderKey>) -> Option<String> {
    let key = reached.key();
    if seen.contains(&key) {
        return None;
    }
    if seen.iter().any(|known| known.name == key.name) {
        return Some(key.name.to_string());
    }
    seen.push(key);
    reached
        .inner
        .uses
        .iter()
        .find_map(|used| clash_in(used, seen))
}
