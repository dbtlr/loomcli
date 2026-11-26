//! The version plugin: `-V` and `--version` print the application's version and optional facts.

#[cfg(feature = "version")]
mod plugin {
    use loomcli_core::{
        Activation, AnyPlugin, Build, CommandGraph, DeclarationError, DiagnosticParts, Finding,
        Host, Inputs, MiddlewareContext, Next, Outcome, Plugin, diagnostic_rule, is_prose_line,
    };
    use serde::Serialize;

    use super::views::{VersionFacts, VersionLine, version_facts, version_line};
    use crate::PACKAGE_NAME;
    use crate::format::views::{json, jsonl};

    /// The version plugin's options.
    #[derive(Inputs)]
    pub struct VersionOptions {
        /// Print the version.
        #[option(short = 'V', control)]
        pub version: bool,
    }

    const POSTFIX_RULE: loomcli_core::DiagnosticRule = diagnostic_rule(
        "@loomcli/plugins/version/postfix",
        "Invalid version postfix",
        "The version plugin prints the postfix after the version on its one line, so the postfix holds a character other than whitespace and no line terminator.",
    );

    /// The version plugin's settings builder.
    #[must_use]
    pub struct Version {
        postfix: Option<String>,
        extended: bool,
    }

    /// The version plugin: `-V` and `--version` print `<name> v<version>` by default, with the
    /// postfix when supplied. [`Version::extended`] adds the running copy's facts.
    pub fn version() -> Version {
        Version {
            postfix: None,
            extended: false,
        }
    }

    impl Version {
        /// Adds one line of prose after the version, such as `(Report schema v1)`. The line prints
        /// after one space, dim and escaped. A postfix that holds only whitespace or a line
        /// terminator panics at this call with the `@loomcli/plugins/version/postfix` diagnostic.
        #[track_caller]
        pub fn postfix(self, postfix: &str) -> Self {
            if !is_prose_line(postfix) {
                let fault = DeclarationError::new(
                    POSTFIX_RULE,
                    DiagnosticParts::new(format!(
                        "Plugin \"{PACKAGE_NAME}/version\" postfix must be a string that holds a character other than whitespace and no line terminator."
                    ))
                    .finding(Finding::new("version().postfix", vec![postfix.into()]).mark("0"))
                    .correction("Supply one line, such as \"(Report schema v1)\", or omit the postfix."),
                );
                panic!("{}", loomcli_core::FailureFacts::message(&fault));
            }
            Version {
                postfix: Some(postfix.to_owned()),
                ..self
            }
        }

        /// Whether to print release, installation, runtime, and platform facts. Defaults to `false`.
        /// With `application/json` or `application/jsonl` selected, the extended output is a
        /// single object containing the name, declared version, and facts.
        pub fn extended(self, extended: bool) -> Self {
            Self { extended, ..self }
        }

        /// The plugin. Its middleware renders the version output and returns without calling the
        /// rest of the chain, so the action does not run.
        pub fn plugin(self) -> Plugin<VersionOptions> {
            let postfix = self.postfix;
            let extended = self.extended;
            Plugin::new(format!("{PACKAGE_NAME}/version"))
                .options::<VersionOptions>()
                .views((version_line(), version_facts()))
                .middleware(
                    Activation::options(["version"]),
                    move |context: MiddlewareContext<VersionOptions>, _next: Next| {
                        let line = VersionLine::new(
                            std::sync::Arc::clone(&context.graph),
                            postfix.clone(),
                        );
                        async move { render(context, line, extended).await }
                    },
                )
        }
    }

    async fn render(
        context: MiddlewareContext<VersionOptions>,
        line: VersionLine,
        extended: bool,
    ) -> Outcome {
        if !extended {
            return context.out.render(&line, &version_line()).await;
        }

        let facts = host_facts(&context.host);
        let document_view = match context.media_type().as_deref() {
            Some("application/json") => Some(json::<VersionDocument>()),
            Some("application/jsonl") => Some(jsonl::<VersionDocument>()),
            _ => None,
        };
        if let Some(view) = document_view {
            let document = VersionDocument::new(&line.graph, facts);
            return context.out.render(&document, &view).await;
        }

        context.out.render(&line, &version_line()).await?;
        context.out.render(&facts, &version_facts()).await
    }

    fn host_facts(host: &Host) -> VersionFacts {
        let release = host.release.release.as_ref();
        VersionFacts {
            channel: release.map(|release| release.channel.clone()),
            build: host.release.build,
            asset: release.and_then(|release| release.asset.clone()),
            installation_method: host
                .release
                .installation
                .as_ref()
                .map(|installation| installation.method.clone()),
            runtime: host.runtime.clone(),
            platform: format!("{}-{}", host.platform, host.arch),
        }
    }

    // The document's field order is part of its JSON contract. Absent values serialize as null.
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct VersionDocument {
        name: String,
        version: String,
        channel: Option<String>,
        build: Build,
        asset: Option<String>,
        installation_method: Option<String>,
        runtime: Option<String>,
        platform: String,
    }

    impl VersionDocument {
        fn new(graph: &CommandGraph, facts: VersionFacts) -> Self {
            Self {
                name: graph.name.clone(),
                version: graph.version.clone(),
                channel: facts.channel,
                build: facts.build,
                asset: facts.asset,
                installation_method: facts.installation_method,
                runtime: facts.runtime,
                platform: facts.platform,
            }
        }
    }

    impl From<Version> for AnyPlugin {
        fn from(settings: Version) -> Self {
            settings.plugin().into()
        }
    }
}

#[cfg(feature = "version")]
pub use plugin::{Version, VersionOptions, version};

/// The version plugin's declared views.
#[cfg(feature = "version-views")]
pub mod views {
    use std::sync::Arc;

    use loomcli_core::{Alignment, Build, CommandGraph, DeclaredView, View, escape, view};

    use crate::PACKAGE_NAME;
    use crate::layout::block::{RecordEntry, record_block};

    /// The data the version line renders: the application's graph and the postfix the
    /// `version()` call took. An override of the line reads both.
    #[derive(Clone, Debug)]
    #[non_exhaustive]
    pub struct VersionLine {
        /// The application's command graph.
        pub graph: Arc<CommandGraph>,
        /// The postfix line.
        pub postfix: Option<String>,
    }

    impl VersionLine {
        /// The line for an application's graph, with an optional postfix.
        #[must_use]
        pub fn new(graph: Arc<CommandGraph>, postfix: Option<String>) -> Self {
            Self { graph, postfix }
        }
    }

    /// The version line, `@loomcli/plugins/version/line`. A declared version that already starts
    /// with a lowercase `v` carries that `v` once; every other first character is printed after
    /// the added one. The rule is rendering alone. A postfix follows after one unstyled space,
    /// escaped and dim.
    pub fn version_line() -> DeclaredView<VersionLine> {
        view(
            &format!("{PACKAGE_NAME}/version/line"),
            View::new(|data: &VersionLine, context| {
                let style = &context.style;
                let declared = &data.graph.version;
                let version = if declared.starts_with('v') {
                    declared.clone()
                } else {
                    format!("v{declared}")
                };
                let line = format!(
                    "{} {}",
                    style.highlight().bold().apply(&escape(&data.graph.name)),
                    style.primary().apply(&escape(&version)),
                );
                match &data.postfix {
                    None => format!("{line}\n"),
                    Some(postfix) => {
                        format!("{line} {}\n", style.dim().apply(&escape(postfix)))
                    }
                }
            }),
        )
    }

    /// The release, installation, runtime, and platform facts from the run's host.
    #[derive(Clone, Debug)]
    #[non_exhaustive]
    pub struct VersionFacts {
        /// The release channel, such as `stable` or `next`, when there is a release.
        pub channel: Option<String>,
        /// How the running copy was built.
        pub build: Build,
        /// The release asset name, when the release has one.
        pub asset: Option<String>,
        /// The installation method, such as `script`, when the host has installation facts.
        pub installation_method: Option<String>,
        /// The Cargo target triple, when the process handle reports one.
        pub runtime: Option<String>,
        /// The operating system and architecture joined by a hyphen, such as `linux-x64`.
        pub platform: String,
    }

    /// The extended facts, `@loomcli/plugins/version/facts`. The records layout renders six rows
    /// with dim labels and escaped primary values. An absent fact has an empty value.
    pub fn version_facts() -> DeclaredView<VersionFacts> {
        view(
            &format!("{PACKAGE_NAME}/version/facts"),
            View::new(|facts: &VersionFacts, context| {
                let build = match facts.build {
                    Build::Source => "source",
                    Build::Development => "development",
                    Build::Distributed => "distributed",
                };
                let rows = [
                    ("channel", facts.channel.as_deref()),
                    ("build", Some(build)),
                    ("asset", facts.asset.as_deref()),
                    ("installation method", facts.installation_method.as_deref()),
                    ("runtime", facts.runtime.as_deref()),
                    ("platform", Some(facts.platform.as_str())),
                ];
                let entries = rows.map(|(label, value)| RecordEntry {
                    align: Alignment::Left,
                    label: label.to_owned(),
                    value: context.style.primary().apply(&escape(value.unwrap_or(""))),
                });
                record_block(&entries, context)
            }),
        )
    }
}
