//! The manifest plugin: `--manifest` writes the application's machine-readable description.

#[cfg(feature = "manifest-extension")]
pub mod extension;

#[cfg(feature = "manifest")]
mod document;

#[cfg(feature = "manifest")]
mod plugin {
    use loomcli_core::{
        Activation, AnyPlugin, Inputs, MiddlewareContext, Next, Outcome, Plugin, View, ViewContext,
    };
    use serde_json::Value;

    use super::document::{document_text, manifest_document};
    use super::extension::MANIFEST_COMMAND;
    use crate::PACKAGE_NAME;

    /// The manifest plugin's options.
    #[derive(Inputs)]
    pub struct ManifestOptions {
        /// Print this command's manifest as JSON.
        #[option(control)]
        pub manifest: bool,
    }

    /// The manifest plugin's settings builder.
    #[must_use]
    pub struct Manifest {
        plugin: Plugin<ManifestOptions>,
    }

    /// The manifest plugin.
    pub fn manifest() -> Manifest {
        Manifest {
            plugin: Plugin::new(format!("{PACKAGE_NAME}/manifest"))
                .options::<ManifestOptions>()
                .extensions([MANIFEST_COMMAND])
                .middleware(Activation::options(["manifest"]), print_manifest),
        }
    }

    impl Manifest {
        /// Gives `--manifest` a short spelling. A letter that is not one ASCII letter, or that
        /// another option already holds, panics here, at the author's call.
        #[track_caller]
        pub fn short(self, letter: char) -> Self {
            Manifest {
                plugin: self.plugin.short("manifest", letter),
            }
        }

        /// The plugin: `.options::<ManifestOptions>()` with the short spelling the setting chose.
        pub fn plugin(self) -> Plugin<ManifestOptions> {
            self.plugin
        }
    }

    /// Prints the routed Command's manifest and ends the invocation by returning without calling
    /// `next`, so the action never dispatches and a fault core held from parsing or validation is
    /// never raised: a group and a Command missing a required input still print. A failure code
    /// declared with two exit codes or two meanings is the `DeclarationError` this returns as the
    /// document is built.
    async fn print_manifest(context: MiddlewareContext<ManifestOptions>, _next: Next) -> Outcome {
        let document = manifest_document(&context.graph, &context.command)?;
        // A bare view the plugin never declares, so no override reaches it: the document is data.
        let view = View::new(|document: &Value, view: &ViewContext| {
            view.style.escape(&document_text(document))
        });
        context.out.render(&document, &view).await
    }

    impl From<Manifest> for AnyPlugin {
        fn from(settings: Manifest) -> Self {
            settings.plugin().into()
        }
    }
}

#[cfg(feature = "manifest")]
pub use plugin::{Manifest, ManifestOptions, manifest};
