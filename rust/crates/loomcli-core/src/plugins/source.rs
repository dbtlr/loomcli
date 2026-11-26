//! The configuration source: the single slot a plugin claims to fill options from a configuration.

use std::collections::BTreeMap;
use std::future::Future;
use std::marker::PhantomData;
use std::sync::Arc;

use crate::failures::Error;
use crate::host::Host;
use crate::inputs::Inputs;
use crate::inputs::sources::{Resolve, SourceCall};
use crate::inspection::{CommandGraph, InputSchema, OptionNode};
use crate::invocation::InvokedBy;
use crate::output::emit::Channel;
use crate::output::{Log, Out};
use crate::style::ContextualStyle;
use crate::support::BoxFuture;

use super::{Extension, OptionTarget};

/// A value a source answers for one option.
#[derive(Clone, Debug, PartialEq)]
#[non_exhaustive]
pub enum SourceValue {
    /// A string.
    String(String),
    /// A Boolean.
    Bool(bool),
    /// A number.
    Number(f64),
    /// Strings for a multiple option or one occurrence of a scalar arity option.
    List(Vec<String>),
    /// Groups of words for a multiple arity option.
    Tuples(Vec<Vec<String>>),
}

/// A source's answer for one option: the value, the label a message names its origin by, and the
/// directory a relative path in it resolves against.
#[derive(Clone, Debug, PartialEq)]
#[non_exhaustive]
pub struct SourceAnswer {
    /// The value.
    pub value: SourceValue,
    /// One line of prose naming where the value came from, such as `settings.json`.
    pub label: String,
    /// The directory a relative path resolves against.
    pub directory: Option<std::path::PathBuf>,
}

impl SourceAnswer {
    /// An answer with its value and label.
    pub fn new(value: SourceValue, label: impl Into<String>) -> Self {
        Self {
            value,
            label: label.into(),
            directory: None,
        }
    }

    /// Sets the directory a relative path resolves against.
    #[must_use]
    pub fn directory(self, directory: impl Into<std::path::PathBuf>) -> Self {
        Self {
            directory: Some(directory.into()),
            ..self
        }
    }
}

/// What a source resolver receives. `O` is the claiming plugin's options struct.
#[non_exhaustive]
pub struct SourceContext<O> {
    /// The plugin's own validated options.
    pub options: O,
    /// The options the source is asked to fill: those bound to it that no token or variable filled.
    pub requests: Vec<OptionNode>,
    /// The host: the same `Arc` the run's providers and action receive, so a source and a
    /// provider that share one lookup per run key it with `Arc::ptr_eq`.
    pub host: Arc<Host>,
    /// The output handle.
    pub out: Out,
    /// The style.
    pub style: ContextualStyle,
    /// The built graph.
    pub graph: Arc<CommandGraph>,
    /// The log.
    pub log: Log,
    /// How the run received its inputs.
    pub invoked_by: InvokedBy,
}

type ResolveFn<O> = Arc<
    dyn Fn(SourceContext<O>) -> BoxFuture<'static, Result<BTreeMap<String, SourceAnswer>, Error>>
        + Send
        + Sync,
>;

/// The configuration source a plugin claims: the binding extension that names which options it
/// fills, the resolver, and the configuration's published schema.
#[must_use]
pub struct ConfigurationSource<O> {
    pub(crate) binding: super::AnyExtension,
    pub(crate) schema: InputSchema,
    pub(crate) resolve: ResolveFn<O>,
    pub(crate) _options: PhantomData<fn() -> O>,
}

impl<O: Inputs> ConfigurationSource<O> {
    /// A source bound through `binding`, resolved by `resolve`, which answers by option name.
    pub fn new<B, H, Fut>(binding: &Extension<OptionTarget, B>, resolve: H) -> Self
    where
        B: 'static,
        H: Fn(SourceContext<O>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<BTreeMap<String, SourceAnswer>, Error>> + Send + 'static,
    {
        Self {
            binding: super::AnyExtension::from(binding),
            schema: None,
            resolve: Arc::new(move |context| Box::pin(resolve(context))),
            _options: PhantomData,
        }
    }

    /// Publishes the configuration's JSON Schema on the graph's `configuration` fact. A source
    /// that publishes none reads `{"schema":null}` there.
    pub fn schema(self, schema: InputSchema) -> Self {
        Self { schema, ..self }
    }

    /// The source as the plugin `identity` claims it: its resolver erased into the input-source
    /// stage's form, which extracts the plugin's own validated options as `O` and hands the
    /// resolver its context.
    pub(crate) fn claim(self, identity: &str) -> ClaimedSource {
        let resolve = self.resolve;
        let identity = identity.to_owned();
        ClaimedSource {
            binding: self.binding.identity,
            schema: self.schema,
            resolve: Arc::new(move |call: SourceCall| {
                let resolve = Arc::clone(&resolve);
                let context = O::extract(&call.options).map(|options| SourceContext {
                    options,
                    requests: call.requests,
                    host: call.host,
                    out: Out {
                        run: Arc::clone(&call.run),
                        channel: Arc::new(Channel::plain()),
                        _result: PhantomData,
                    },
                    style: crate::style::style(),
                    graph: call.graph,
                    log: call.run.log.bind(Some(Arc::from(identity.as_str()))),
                    invoked_by: call.invoked_by,
                });
                Box::pin(async move { resolve(context?).await })
            }),
        }
    }
}

/// A configuration source as a plugin holds it once claimed: the identity of its binding, the
/// schema the graph publishes, and its resolver with the plugin's options type erased.
#[derive(Clone)]
pub(crate) struct ClaimedSource {
    pub(crate) binding: &'static str,
    pub(crate) schema: InputSchema,
    pub(crate) resolve: Resolve,
}
