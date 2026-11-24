//! The plugin contract: plugins, middleware, lifecycle hooks, extensions, providers, the
//! configuration source, and environment preparation.
//!
//! Core installs no plugin. A plugin is a value any crate builds with [`Plugin::new`] and exports
//! from a factory function; an Application installs plugins through one ordered list, and the order
//! is the precedence every contribution composes in.

pub(crate) mod extension;
pub(crate) mod hooks;
pub(crate) mod middleware;
pub(crate) mod plugin;
pub(crate) mod provided;
pub(crate) mod provider;
pub(crate) mod source;

pub(crate) use extension::values_literal as extension_values_literal;
pub use extension::{
    AnyExtension, ArgumentTarget, Collect, Collecting, CommandTarget, Extension, ExtensionCarrier,
    ExtensionTarget, ExtensionValue, OptionTarget, Single, read_extension,
};
pub use hooks::{
    AttachedCommand, AttachedViews, EnvironmentAdditions, EnvironmentContext, FailureHookContext,
    Hints, IntoHints,
};
pub use middleware::{ChainOutcome, MiddlewareContext, Next, OwnOptions, Request, Spellings};
pub use plugin::{Activation, AnyPlugin, NoOptions, Plugin};
pub(crate) use provider::check_uses;
pub use provider::{
    AnyProvider, Ephemeral, Lifetime, Persistent, PersistentProvider, Provider, ProviderContext,
};
pub use source::{ConfigurationSource, SourceAnswer, SourceContext, SourceValue};
