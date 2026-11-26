//! The configuration plugin: reads one configuration file per run, described by one serde type,
//! hands the result to application code as a provided value, and fills the options linked to its
//! keys.
//!
//! ```ignore
//! use loomcli_plugins::config::{ConfigurationSettings, DirectoryOption, Scope, configuration};
//! use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
//!
//! #[derive(serde::Deserialize, Default)]
//! #[serde(rename_all = "camelCase")]
//! struct Collector {
//!     min_bytes: Option<serde_json::Value>,
//! }
//!
//! let config = configuration::<Collector>(
//!     ConfigurationSettings::new(None)
//!         .file(".collector.{toml,json}")
//!         .short('c')
//!         .env("COLLECTOR_CONFIG")
//!         .directory(DirectoryOption::new("project").short('p'))
//!         .scopes(&[Scope::Project { root: vec![".git".into()] }, Scope::User]),
//! );
//! // Install `config.plugin`, opt in to `config.provider` with `uses`, and link an option with
//! // `Opt::string().extend([CONFIG_INPUT.value(ConfigInputFacts::path("minBytes"))])`.
//! ```
//!
//! The lookup reads at most one file: the one `--config` names, or else the one the settings'
//! variable names, or else the first of the file pattern's candidates in the walk from the start
//! directory to the root marker or to the directory below home, then in the home directory, then
//! in the XDG user folder, each step under the scopes the settings choose. `--no-config` reads
//! none. JSON with comments, TOML (through `toml`), and YAML 1.2 (through `saphyr-parser`) read by
//! the file's extension. A value the type rejects is dropped, with one `-v` line, and the rest of
//! the file stays; a broken discovered file warns once and the run reads no configuration; a
//! broken `--config` file fails the run with exit 2.

#[cfg(feature = "config-extension")]
pub mod extension;

#[cfg(feature = "config")]
mod document;
#[cfg(feature = "config")]
mod drop;
#[cfg(feature = "config")]
mod json;
#[cfg(feature = "config")]
mod links;
#[cfg(feature = "config")]
mod lookup;
#[cfg(feature = "config")]
mod messages;
#[cfg(feature = "config")]
mod number;
#[cfg(feature = "config")]
mod pointer;
#[cfg(feature = "config")]
mod reading;
#[cfg(feature = "config")]
mod settings;
#[cfg(feature = "config")]
mod shared;
#[cfg(feature = "config")]
mod source;
#[cfg(feature = "config")]
mod toml;
#[cfg(feature = "config")]
mod yaml;

/// The configuration plugin's identity, which its sentences name.
#[cfg(feature = "config")]
const IDENTITY: &str = "@loomcli/plugins/config";

#[cfg(feature = "config")]
mod plugin {
    use std::marker::PhantomData;
    use std::sync::Arc;

    use loomcli_core::{
        ConfigurationSource, Declarations, Error, GlobalInputs, InputSchema, InputValues, Inputs,
        Opt, Plugin, Provider, ProviderContext, SourceContext,
    };
    use serde::de::DeserializeOwned;

    use super::extension::CONFIG_INPUT;
    use super::lookup::Reach;
    use super::shared::{Scene, Shared};
    use super::{IDENTITY, drop, links, pointer, settings, source};

    /// The description of `--config`.
    const CONFIG_DESCRIPTION: &str = "Read configuration from this file alone.";
    /// The description of `--no-config`.
    const NO_CONFIG_DESCRIPTION: &str = "Read no configuration file.";
    /// The directory option's description when the settings give none.
    const DIRECTORY_DESCRIPTION: &str = "Look for the configuration file from this directory.";

    /// The configuration plugin's options: `--config` and `--no-config`, each marked `control`,
    /// and the directory option when the settings declare one, which the plugin reads by name.
    #[non_exhaustive]
    pub struct ConfigOptions {
        /// Read configuration from this file alone.
        pub config: Option<String>,
        /// Read no configuration file.
        pub no_config: bool,
        /// Every value of the plugin's own options, the directory option's included.
        values: InputValues,
    }

    impl ConfigOptions {
        /// The value of the plugin's option `name`, such as the directory option.
        fn text(&self, name: &str) -> Result<Option<String>, Error> {
            self.values.option(name)
        }
    }

    impl Inputs for ConfigOptions {
        fn declare(declarations: Declarations) -> Declarations {
            declarations
                .option(
                    "config",
                    Opt::string().description(CONFIG_DESCRIPTION).control(),
                )
                .option(
                    "no-config",
                    Opt::boolean().description(NO_CONFIG_DESCRIPTION).control(),
                )
        }

        fn extract(values: &InputValues) -> Result<Self, Error> {
            Ok(Self {
                config: values.option("config")?,
                no_config: values.option("no-config")?,
                values: values.clone(),
            })
        }

        fn into_values(self) -> InputValues {
            self.values
                .with_option("config", self.config)
                .with_option("no-config", self.no_config)
        }
    }

    impl GlobalInputs for ConfigOptions {}

    /// Where a configuration file is looked up. The lookup reads the project scope before the user
    /// scope whatever order the list gives, and a scope listed twice counts once.
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub enum Scope {
        /// The walk from the start directory: the directory itself and each ancestor, up to the
        /// directory below home when the start is inside home, and up to the filesystem root
        /// otherwise. `root` names the entries, such as `package.json` or `.git`, whose presence in
        /// a directory ends the walk after it looks there; an empty list walks to those bounds. Each
        /// name is one path segment: nonempty, with no `/` or `\`, and neither `.` nor `..`, or
        /// [`ConfigurationSettings::scopes`] panics with `@loomcli/plugins/config/root-name`.
        Project {
            /// The root markers.
            root: Vec<String>,
        },
        /// The home file, `file` in the home directory, and then the XDG user file, `config.<ext>`
        /// in `$XDG_CONFIG_HOME/<app>` or in `<home>/.config/<app>`.
        User,
    }

    /// A global option whose value is where the lookup's walk starts.
    #[derive(Clone, Debug)]
    #[must_use]
    pub struct DirectoryOption {
        name: String,
        short: Option<char>,
        description: Option<String>,
    }

    impl DirectoryOption {
        /// The option `--<name>`. A name of `config` or `no-config` claims the plugin's own
        /// spelling, a fault core raises when `configuration()` declares it.
        pub fn new(name: &str) -> Self {
            Self {
                name: name.to_owned(),
                short: None,
                description: None,
            }
        }

        /// Its short spelling, none by default.
        pub fn short(self, letter: char) -> Self {
            Self {
                short: Some(letter),
                ..self
            }
        }

        /// Its description. Defaults to `Look for the configuration file from this directory.`
        pub fn description(self, text: &str) -> Self {
            Self {
                description: Some(text.to_owned()),
                ..self
            }
        }
    }

    /// The configuration plugin's settings: the configuration's type, its published schema, the
    /// file it looks for, and how an operator points the lookup elsewhere.
    ///
    /// `T` deserializes with serde from the file's top-level object, less a top-level `$schema`
    /// key. It accepts an empty file: every key is optional outside an array item or a map's
    /// values, since a command-line application runs before its operator has written any
    /// configuration; a type that rejects an empty file is the `@loomcli/plugins/config/empty-file`
    /// fault on its first read. serde ignores a key it does not know; avoid
    /// `#[serde(deny_unknown_fields)]`, which drops the whole object that holds a key a newer
    /// version of the application added. A value inside `#[serde(flatten)]` or an untagged enum
    /// reaches the type through serde's buffer, so a wrong value there drops the whole value that
    /// holds it.
    #[must_use]
    pub struct ConfigurationSettings<T> {
        schema: InputSchema,
        short: Option<char>,
        scopes: Option<Vec<Scope>>,
        candidates: Option<Vec<String>>,
        env: Option<String>,
        directory: Option<DirectoryOption>,
        notice: bool,
        _value: PhantomData<fn() -> T>,
    }

    impl<T: DeserializeOwned + Send + Sync + 'static> ConfigurationSettings<T> {
        /// Settings for a configuration of type `T`, publishing `schema`: the file's input-side
        /// JSON Schema, which the graph's `configuration` fact and the manifest print with a
        /// `$schema` string property listed in its top-level object, or `None` to publish none.
        /// The plugin's build check judges each linked option's path against it.
        pub fn new(schema: InputSchema) -> Self {
            Self {
                schema,
                short: None,
                scopes: None,
                candidates: None,
                env: None,
                directory: None,
                notice: false,
                _value: PhantomData,
            }
        }

        /// Gives `--config` a short spelling, applied as `Plugin::short("config", letter)` on the
        /// typed plugin. With none, `--config` has no short spelling.
        pub fn short(self, letter: char) -> Self {
            Self {
                short: Some(letter),
                ..self
            }
        }

        /// The scopes the lookup reads, both by default. The project scope is read first whatever
        /// the order, and a scope listed twice counts once; the root markers of every project
        /// entry end the walk. An empty list reads neither scope, so only `--config` and the
        /// variable name a file. A root marker that is not one path segment panics at this call
        /// with `@loomcli/plugins/config/root-name`.
        #[track_caller]
        pub fn scopes(self, scopes: &[Scope]) -> Self {
            for scope in scopes {
                if let Scope::Project { root } = scope {
                    settings::judge_markers(root);
                }
            }
            Self {
                scopes: Some(scopes.to_vec()),
                ..self
            }
        }

        /// The configuration file's name or relative path, a file pattern; `.<app>.json` by
        /// default. Glob syntax may appear only as the whole extension of its last segment: `*`
        /// for any format the plugin reads, tried as `toml`, `yaml`, `yml`, `json`, then `jsonc`, or
        /// a brace list such as `{toml,json}`, tried as listed. A file that is not a relative path
        /// panics at this call with `@loomcli/plugins/config/file-path`, and glob syntax elsewhere
        /// or an unreadable listed extension with `@loomcli/plugins/config/file-pattern`.
        #[track_caller]
        pub fn file(self, pattern: &str) -> Self {
            Self {
                candidates: Some(settings::judge_file(pattern)),
                ..self
            }
        }

        /// A variable whose nonempty value names the configuration file, read with no search. A
        /// name that is not `[A-Za-z_][A-Za-z0-9_]*` panics at this call with
        /// `@loomcli/plugins/config/variable-name`.
        #[track_caller]
        pub fn env(self, variable: &str) -> Self {
            Self {
                env: Some(settings::judge_variable(variable)),
                ..self
            }
        }

        /// Declares a global string option whose value replaces `host.cwd` as the walk's start.
        pub fn directory(self, option: DirectoryOption) -> Self {
            Self {
                directory: Some(option),
                ..self
            }
        }

        /// Writes one info line when the lookup finds no file: `Found no configuration file.
        /// Create <file> to configure <app>.` Off by default.
        pub fn notice(self) -> Self {
            Self {
                notice: true,
                ..self
            }
        }

        /// What the lookup reads, from the scopes.
        fn reach(&self) -> Reach {
            let Some(scopes) = &self.scopes else {
                return Reach {
                    project: true,
                    user: true,
                    markers: Vec::new(),
                };
            };
            let mut reach = Reach::default();
            for scope in scopes {
                match scope {
                    Scope::Project { root } => {
                        reach.project = true;
                        for marker in root {
                            if !reach.markers.contains(marker) {
                                reach.markers.push(marker.clone());
                            }
                        }
                    }
                    Scope::User => reach.user = true,
                }
            }
            reach
        }
    }

    /// The configuration plugin and the provider of the parsed configuration.
    #[non_exhaustive]
    pub struct Configuration<T> {
        /// The plugin the Application installs, which claims the configuration-source slot.
        pub plugin: Plugin<ConfigOptions>,
        /// The provider of the configuration value, named `config`: the type's value for the file
        /// once every rejected value is dropped, or for an empty file when the run reads none.
        pub provider: Provider<T>,
    }

    /// The configuration plugin, `@loomcli/plugins/config`, and the provider that reads it, built
    /// from one settings value. The plugin declares `--config` and `--no-config`, the directory
    /// option when the settings name one, the configuration source bound through
    /// [`CONFIG_INPUT`], and a build check that judges each linked option's path against the
    /// published schema. The source and the provider share one read per run, keyed by the run's
    /// host, so each warning and each `-v` line is written once.
    #[must_use]
    #[track_caller]
    pub fn configuration<T: DeserializeOwned + Send + Sync + 'static>(
        settings: ConfigurationSettings<T>,
    ) -> Configuration<T> {
        let directory_name = settings
            .directory
            .as_ref()
            .map(|option| option.name.clone());
        let shared = Arc::new(Shared::<T>::new(
            settings.candidates.clone(),
            settings.env.clone(),
            settings.notice,
            settings.reach(),
        ));
        let mut plugin = Plugin::new(IDENTITY).options::<ConfigOptions>();
        if let Some(letter) = settings.short {
            plugin = plugin.short("config", letter);
        }
        if let Some(option) = &settings.directory {
            let declared = Opt::string().description(
                option
                    .description
                    .as_deref()
                    .unwrap_or(DIRECTORY_DESCRIPTION),
            );
            let declared = match option.short {
                Some(letter) => declared.short(letter),
                None => declared,
            };
            plugin = plugin.option(&option.name, declared);
        }
        let resolving = Arc::clone(&shared);
        let directory = directory_name.clone();
        let source = ConfigurationSource::new(
            &CONFIG_INPUT,
            move |context: SourceContext<ConfigOptions>| {
                let shared = Arc::clone(&resolving);
                let directory = directory.clone();
                async move {
                    let directory = match &directory {
                        Some(name) => context.options.text(name)?,
                        None => None,
                    };
                    let scene = Scene {
                        graph: &context.graph,
                        host: &context.host,
                        invoked_by: context.invoked_by,
                        out: &context.out,
                        log: &context.log,
                        style: &context.style,
                        config: context.options.config.as_deref(),
                        no_config: context.options.no_config,
                        directory: directory.as_deref(),
                    };
                    let loaded = shared.load_once(&scene).await?;
                    match &loaded.usable {
                        Some(usable) => source::answer_all(
                            &context.requests,
                            usable,
                            context.invoked_by,
                            &context.log,
                        ),
                        None => Ok(std::collections::BTreeMap::new()),
                    }
                }
            },
        )
        .schema(pointer::with_pointer(settings.schema));
        let plugin = plugin
            .extensions([CONFIG_INPUT])
            .on_graph_built(links::judge_links)
            .source(source);
        let provider = Provider::new("config", move |context: ProviderContext| {
            let shared = Arc::clone(&shared);
            let directory = directory_name.clone();
            async move {
                let config: Option<String> = context.options.option("config")?;
                let no_config: bool = context.options.option("no-config")?;
                let directory: Option<String> = match &directory {
                    Some(name) => context.options.option(name)?,
                    None => None,
                };
                let scene = Scene {
                    graph: &context.graph,
                    host: &context.host,
                    invoked_by: context.invoked_by,
                    out: &context.out,
                    log: &context.log,
                    style: &context.style,
                    config: config.as_deref(),
                    no_config,
                    directory: directory.as_deref(),
                };
                let loaded = shared.load_once(&scene).await?;
                drop::deserialize_passed::<T>(&loaded.document()).map_err(Error::from)
            }
        });
        Configuration { plugin, provider }
    }
}

#[cfg(feature = "config")]
pub use plugin::{
    ConfigOptions, Configuration, ConfigurationSettings, DirectoryOption, Scope, configuration,
};
