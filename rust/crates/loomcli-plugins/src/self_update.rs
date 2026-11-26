//! The self-update plugin: an installed application replaces its binary with a verified release,
//! and tells an operator at a terminal when a newer release exists.
//!
//! [`self_update()`] contributes one Command and, unless the author turns them off, the update
//! notices' middleware:
//!
//! - **`self-update [<version>] [--channel <name>] [--check]`** replaces the running binary with a
//!   release from the application's GitHub repository, and only when the installer script placed
//!   the binary (`install.json` reads the method `script`), something is still a regular file at
//!   the recorded path, not a symbolic link, and its SHA-256 digest is still the recorded one. It
//!   resolves the newest release on the binary's release channel (`stable` through
//!   `releases/latest`, any other channel through the releases Atom feed), never moves to an older
//!   release unless a version is named, verifies the release asset against the release's
//!   `SHA256SUMS`, writes it to a staging file beside the binary with the binary's permission bits,
//!   flushes it, renames it over the binary, rewrites `install.json` with the new digest, and then
//!   calls the author's [`SelfUpdate::after_replace`]. `--check` reports what an update would do
//!   and downloads no binary.
//! - **Update notices.** After the action of a run at a terminal, the middleware reads
//!   `update.json` in the application's cache directory and prints one `info` line when it names a
//!   newer release on the running binary's channel. A cache older than a day is refreshed by a
//!   detached copy of the application, `[...host.program, "self-update", "--refresh-notice"]`,
//!   which the run never waits for. `NO_UPDATE_NOTIFIER`, the author's [`SelfUpdate::notice_env`]
//!   variable, `CI`, and a stream that is not a terminal each leave the notice and the refresh out.
//!
//! Every request starts at `https://github.com/`, follows each redirect itself, at most 20, only to
//! an `https:` URL, sends no credential, calls no API, and has no time limit; the run's signal
//! cancels it. The requests go through a [`Transport`], [`HttpsTransport`] unless
//! [`SelfUpdate::transport`] names another: `reqwest` over rustls, with the platform's certificate
//! verifier, so the plugin links no OpenSSL.
//!
//! ```
//! use loomcli_core::Application;
//! use loomcli_plugins::self_update::self_update;
//!
//! let application = Application::new("notes")
//!     .description("Keep notes in sync.")
//!     .plugins((self_update()
//!         // An application with a service restarts it once the new binary is in place.
//!         .after_replace(|context| async move {
//!             let _ = (&context.path, &context.previous, &context.current);
//!             Ok(())
//!         })
//!         // Operators may also turn notices off with NOTES_NO_UPDATE_NOTICE.
//!         .notice_env("NOTES_NO_UPDATE_NOTICE")
//!         .plugin(),));
//! # let _ = application;
//! ```
//!
//! An application that installs the skills, completion, or manpage plugin passes their refresh to
//! the hook, so the new binary rewrites what the old one installed:
//!
//! ```ignore
//! self_update().after_replace(|context| async move { refresh_skills(context.refresh()).await })
//! ```
//!
//! A root that declares arguments cannot hold children, so such an application cannot install the
//! plugin.

mod cache;
mod messages;
mod notices;
mod refresh;
mod request;
mod resolve;
mod sums;
mod transport;
mod update;
mod version;

use std::fmt;
use std::future::Future;
use std::path::Path;
use std::sync::Arc;

use loomcli_core::{
    Activation, AnyPlugin, BoxFuture, Command, Context, DeclarationError, DiagnosticParts,
    DiagnosticRule, Error, FailureFacts, FatalError, Finding, Host, InputError, InputIdentity,
    InputKind, InputProblem, Inputs, Issue, Literal, Log, Plugin, RunSignal, diagnostic_rule,
};
use loomcli_validators::create_validator;

use self::request::{Client, RequestError, Stop};
use self::version::{is_channel_name, version_of_argument};
use crate::PACKAGE_NAME;
pub use crate::installation::RefreshContext;

pub use self::transport::{BodyFuture, HttpsTransport, Transport, TransportResponse};

/// What `after_replace` reads once the binary is replaced and the record rewritten.
#[derive(Clone)]
#[non_exhaustive]
pub struct AfterReplaceContext {
    /// The version that was replaced.
    pub previous: String,
    /// The version now at `path`.
    pub current: String,
    /// The recorded path, as `install.json` holds it.
    pub path: String,
    /// The run's host, whose release facts still describe the replaced binary.
    pub host: Arc<Host>,
    /// The run signal. The hook is called even when it was cancelled after the rename.
    pub signal: RunSignal,
    /// The run's log.
    pub log: Log,
}

impl fmt::Debug for AfterReplaceContext {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AfterReplaceContext")
            .field("previous", &self.previous)
            .field("current", &self.current)
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

impl AfterReplaceContext {
    /// The context the skills, completion, and manpage plugins' refresh functions read: the new
    /// binary at `path`, and the run's host, signal, and log.
    #[must_use]
    pub fn refresh(&self) -> RefreshContext<'_> {
        RefreshContext {
            path: Path::new(&self.path),
            host: &self.host,
            signal: &self.signal,
            log: &self.log,
        }
    }
}

/// The author's `after_replace`, stored.
pub(crate) type AfterReplace =
    Arc<dyn Fn(AfterReplaceContext) -> BoxFuture<'static, Result<(), Error>> + Send + Sync>;

/// The self-update plugin's settings builder.
#[must_use]
pub struct SelfUpdate {
    after_replace: Option<AfterReplace>,
    notices: bool,
    notice_env: Option<String>,
    transport: Option<Arc<dyn Transport>>,
}

impl fmt::Debug for SelfUpdate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SelfUpdate")
            .field("after_replace", &self.after_replace.is_some())
            .field("notices", &self.notices)
            .field("notice_env", &self.notice_env)
            .finish_non_exhaustive()
    }
}

/// The self-update plugin, with update notices on and no `after_replace`.
pub fn self_update() -> SelfUpdate {
    SelfUpdate {
        after_replace: None,
        notices: true,
        notice_env: None,
        transport: None,
    }
}

/// `@loomcli/plugins/self-update/settings`.
const SETTINGS_RULE: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/self-update/settings",
    "Invalid self-update setting",
    "The self-update plugin reads the variable that notices.env names from the environment, as an input binds one, and turns update notices off when it is set and not empty, so env is a variable name: letters, digits, and underscores, not starting with a digit.",
);

/// Whether a name follows the environment variable grammar, `[A-Za-z_][A-Za-z0-9_]*`.
fn is_variable_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

impl SelfUpdate {
    /// Calls `hook` once after the binary is replaced, the record rewritten, and the update line
    /// printed, and awaits it. It runs in the process that replaced the binary, so it runs the old
    /// version's code; anything that needs the new version runs `path`. It is never called for
    /// `--check`, for a release that is not newer, or for a refusal. A hook that fails takes the
    /// ordinary failure path, and the new binary and record stay.
    pub fn after_replace<F, Fut>(self, hook: F) -> Self
    where
        F: Fn(AfterReplaceContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<(), Error>> + Send + 'static,
    {
        let hook: AfterReplace = Arc::new(move |context| Box::pin(hook(context)));
        Self {
            after_replace: Some(hook),
            ..self
        }
    }

    /// Turns update notices on or off; they are on unless this says `false`. Off, the plugin
    /// declares no middleware.
    pub fn notices(self, on: bool) -> Self {
        Self {
            notices: on,
            ..self
        }
    }

    /// Names a variable of the application's own that turns update notices off when it is set and
    /// not empty, beside `NO_UPDATE_NOTIFIER`.
    ///
    /// # Panics
    ///
    /// With the `@loomcli/plugins/self-update/settings` diagnostic when `variable` is not an
    /// environment variable name: letters, digits, and underscores, not starting with a digit.
    #[track_caller]
    pub fn notice_env(self, variable: &str) -> Self {
        if !is_variable_name(variable) {
            let fault = DeclarationError::new(
                SETTINGS_RULE,
                DiagnosticParts::new(format!(
                    "Plugin \"{PACKAGE_NAME}/self-update\" setting \"notices.env\" is not an environment variable name."
                ))
                .finding(
                    Finding::new(
                        "SelfUpdate::notice_env",
                        vec![Literal::String(variable.to_owned())],
                    )
                    .mark("0"),
                )
                .correction("Name it with letters, digits, and underscores, not starting with a digit."),
            );
            panic!("{}", FailureFacts::message(&fault));
        }
        Self {
            notice_env: Some(variable.to_owned()),
            ..self
        }
    }

    /// Sends the plugin's requests through `transport` in place of [`HttpsTransport`], such as a
    /// test's scripted GitHub.
    pub fn transport(self, transport: impl Transport) -> Self {
        Self {
            transport: Some(Arc::new(transport)),
            ..self
        }
    }

    /// The plugin: the `self-update` Command and, unless notices are off, the update notices'
    /// middleware with `Always` activation.
    pub fn plugin(self) -> Plugin {
        let transport = self
            .transport
            .unwrap_or_else(|| Arc::new(HttpsTransport::new()));
        let plugin = Plugin::new(format!("{PACKAGE_NAME}/self-update"))
            .commands([command(self.after_replace, transport)]);
        if !self.notices {
            return plugin;
        }
        plugin.middleware(
            Activation::Always,
            notices::notice_middleware(self.notice_env),
        )
    }
}

impl From<SelfUpdate> for AnyPlugin {
    fn from(settings: SelfUpdate) -> Self {
        settings.plugin().into()
    }
}

/// A string input that `accepts` or reports the one-sentence `message`, published as a plain
/// string.
fn string_input(
    accepts: fn(&str) -> bool,
    message: &'static str,
) -> impl loomcli_core::Validator<Output = String> {
    let mut schema = serde_json::Map::new();
    schema.insert("type".to_owned(), serde_json::Value::from("string"));
    create_validator(move |raw: &str, _| {
        if accepts(raw) {
            Ok(raw.to_owned())
        } else {
            Err(vec![Issue::new(message)])
        }
    })
    .input_schema(schema)
}

/// The `version` argument's validator.
fn version_input() -> impl loomcli_core::Validator<Output = String> {
    string_input(
        |text| version_of_argument(text).is_some(),
        "Supply a semantic version, such as 1.4.0.",
    )
}

/// The `--channel` option's validator.
fn channel_input() -> impl loomcli_core::Validator<Output = String> {
    string_input(
        is_channel_name,
        "Supply stable or a prerelease identifier, such as next.",
    )
}

/// The inputs of `self-update`.
#[derive(Inputs)]
struct SelfUpdateInputs {
    /// A release version to install, newer or older, such as 1.4.0.
    #[argument(validate = version_input())]
    version: Option<String>,
    /// The release channel to follow, such as stable or next.
    #[option(validate = channel_input())]
    channel: Option<String>,
    /// Report what an update would do and replace nothing.
    #[option]
    check: bool,
    /// Refresh the update notices' cache.
    #[option(hidden)]
    refresh_notice: bool,
}

/// The usage error for an option given beside an input it cannot be given with.
fn conflict(option: &str, sentence: &str, correction: &str) -> Error {
    InputError::new(
        format!("{sentence} {correction}"),
        vec![InputProblem::Invalid {
            input: InputIdentity::new(false, InputKind::Option, option),
            spelling: format!("--{option}"),
            issues: vec![Issue::new(correction)],
        }],
    )
    .into()
}

/// The usage error for inputs given together that cannot be: `--refresh-notice` beside any other
/// input, then `--channel` beside a version.
fn refuse_conflicts(inputs: &SelfUpdateInputs) -> Result<(), Error> {
    if inputs.refresh_notice
        && (inputs.version.is_some() || inputs.channel.is_some() || inputs.check)
    {
        return Err(conflict(
            "refresh-notice",
            "Option \"--refresh-notice\" cannot be given with other inputs.",
            "Leave out the other inputs.",
        ));
    }
    if inputs.channel.is_some() && inputs.version.is_some() {
        return Err(conflict(
            "channel",
            "Option \"--channel\" cannot be given with a version.",
            "Leave out --channel, or the version.",
        ));
    }
    Ok(())
}

/// The `self-update` Command, its action calling `after_replace`.
fn command(
    after_replace: Option<AfterReplace>,
    transport: Arc<dyn Transport>,
) -> Command<SelfUpdateInputs> {
    Command::new("self-update")
        .description("Replace this application with another release.")
        .inputs::<SelfUpdateInputs>()
        .action(move |context: Context<SelfUpdateInputs>| {
            let after_replace = after_replace.clone();
            let transport = Arc::clone(&transport);
            async move { run(context, after_replace, transport).await }
        })
}

/// The Command's action, once its inputs are read.
async fn run(
    context: Context<SelfUpdateInputs>,
    after_replace: Option<AfterReplace>,
    transport: Arc<dyn Transport>,
) -> Result<(), Error> {
    let inputs = &context.inputs;
    refuse_conflicts(inputs)?;
    let name = context.graph.name.clone();
    let client = Client {
        transport,
        signal: context.signal.clone(),
    };
    // A version that passed its validator always reads.
    let named = inputs.version.as_deref().and_then(version_of_argument);
    let outcome = if inputs.refresh_notice {
        refresh::refresh_notice(&name, &context.host, &client).await
    } else {
        let request = update::Request {
            name: name.clone(),
            host: Arc::clone(&context.host),
            signal: context.signal.clone(),
            log: context.log.clone(),
            out: context.out.clone(),
            client,
            named: named.clone(),
            channel: inputs.channel.clone(),
            check_only: inputs.check,
        };
        update::update(&request, after_replace.as_ref()).await
    };
    match outcome {
        Ok(()) => Ok(()),
        Err(Stop::Failed(error)) => Err(error),
        Err(Stop::Request(_)) if context.signal.is_cancelled() => {
            context.signal.throw_if_cancelled()
        }
        Err(Stop::Request(failure)) => {
            let named = named.as_ref().map(|version| version.text.as_str());
            let sentence = messages::request_failed(&name, &failure, named);
            Err(match failure {
                RequestError::NoResponse { cause, .. } => FatalError::with_cause(sentence, cause),
                _ => FatalError::new(sentence),
            }
            .into())
        }
    }
}
