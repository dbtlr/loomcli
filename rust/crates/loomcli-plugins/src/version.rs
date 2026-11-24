//! The version plugin: `-V` and `--version` print the application's version line.

#[cfg(feature = "version")]
mod plugin {
    use loomcli_core::{
        Activation, AnyPlugin, DeclarationError, DiagnosticParts, Finding, Inputs,
        MiddlewareContext, Next, Outcome, Plugin, diagnostic_rule, is_prose_line,
    };

    use super::views::{VersionLine, version_line};
    use crate::PACKAGE_NAME;

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
    }

    /// The version plugin: `-V` and `--version` print `<name> v<version>`, then the postfix when
    /// the application set one, and end the invocation with exit 0.
    pub fn version() -> Version {
        Version { postfix: None }
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
            }
        }

        /// The plugin. Its middleware renders the version line and returns without calling the
        /// rest of the chain, so nothing after routing runs and the exit code is 0.
        pub fn plugin(self) -> Plugin<VersionOptions> {
            let postfix = self.postfix;
            Plugin::new(format!("{PACKAGE_NAME}/version"))
                .options::<VersionOptions>()
                .views([version_line()])
                .middleware(
                    Activation::options(["version"]),
                    move |context: MiddlewareContext<VersionOptions>, _next: Next| {
                        let line = VersionLine::new(
                            std::sync::Arc::clone(&context.graph),
                            postfix.clone(),
                        );
                        async move { render(context, line).await }
                    },
                )
        }
    }

    /// Renders the line to stdout.
    async fn render(context: MiddlewareContext<VersionOptions>, line: VersionLine) -> Outcome {
        context.out.render(&line, &version_line()).await
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

    use loomcli_core::{CommandGraph, DeclaredView, View, escape, view};

    use crate::PACKAGE_NAME;

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
}
