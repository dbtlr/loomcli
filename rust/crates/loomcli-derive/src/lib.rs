//! `#[derive(Inputs)]` and `#[derive(Failure)]` for Loom CLI.
//!
//! Both derives expand to `loomcli-core`'s public API alone, so their expansion is public contract
//! an author can write by hand. Each derive's documentation states its attribute grammar.

mod failure;
mod inputs;
#[cfg(test)]
mod tests;

use proc_macro::TokenStream;

/// Implements `loomcli_core::Inputs` for a struct whose fields are a Command's inputs.
///
/// Each field carries one of `#[option(...)]`, `#[argument(...)]`, `#[stdin(...)]`, or `#[passthrough(...)]`. The field
/// type decides the declaration: `bool` is a Boolean option, an integer under `count` a counted
/// option, `Content` a content input, `Vec<T>` a multiple option or a variadic argument, `Option<T>`
/// an optional input, and any other `T` a required one, typed by its validator's output.
///
/// # Attribute grammar
///
/// Each field carries exactly one role:
///
/// - `#[option(fact, …)]`: an option.
/// - `#[argument(fact, …)]`: an argument, bound in field order.
/// - `#[stdin(description = "…")]`: the standalone stdin, on a `Content` or `Option<Content>` field.
/// - `#[passthrough(description = "…")]` declares passthrough on a `Vec<String>` field.
///   The description is optional.
///
/// The struct may carry `#[inputs(exclusive("a", "b"), one_required(…), required_together(…))]`.
/// Each member is an option's declared name (`dry-run` for a field `dry_run`), not a field
/// identifier; a member that is a field's identifier where the field declares another name is a
/// compile error at the member. A member that names no field is checked at `inputs::<I>()`, because
/// an option declared before that call may be a member.
///
/// | Fact | Form | On |
/// | --- | --- | --- |
/// | `name` | `name = "min-bytes"`; default: the field name with `_` as `-` | both |
/// | `description` | `description = "…"`; default: the doc comment, lines joined by spaces. Use `description = "…"` when the help text holds `<…>` or `[…]`, which rustdoc reads as HTML or a link | both |
/// | `short`, `short_only` | `short = 'f'`, `short_only` | option |
/// | `aliases` | `aliases = ["minimum"]` | option |
/// | `hidden`, `deprecated`, `control` | flags; `deprecated = "Use get instead."` | option |
/// | `count` | flag; the field is an unsigned integer | option |
/// | `polarity` | `polarity = "both"` | Boolean option |
/// | `validate` | `validate = text()`, any `Validator` expression | string input |
/// | `validate_omitted` | flag; `validate` names an `OmissionValidator` | string input |
/// | `default` | `default = "8080"` or `default = ["a", "b"]` | string input |
/// | `arity` | flag taking the count from a fixed-size array field | string option |
/// | `last_wins` | flag keeping the latest occurrence | scalar string option |
/// | `implied` | `implied = "simple"` | string option |
/// | `required` | flag, on a `Vec` field alone: at least one value | both |
/// | `non_interactive` | flag, on an `Option` or `Vec` field: required when the run cannot ask | both |
/// | `env`, `env_delimiter`, `env_allow_empty` | `env = "ACME_LOG"` or `env = ["A", "B"]` | option |
/// | `extensions` | `extensions = [HELP_INPUT.value(…)]` | both |
/// | `stdin`, `min`, `max` | flag; `min = 1` | content input |
/// | `interaction`, `color`, `plain`, `verbose`, `quiet`, `background` | flags | global option |
/// | `builder` | `builder = document_input()`, a shared `ContentOpt` holding every option fact | content option |
///
/// Beside a shared `builder`, a field states only `name` and, on a `Vec`, `required`, `min`, and
/// `max`; its doc comment documents the Rust field alone, and its type still decides presence.
///
/// # Field types
///
/// The field type decides the builder, the presence, and the read. The struct never states a fact
/// twice: a non-`Option` scalar is already required.
///
/// | Field type | Declaration | Presence |
/// | --- | --- | --- |
/// | `bool` | `Opt::boolean()` | never required |
/// | `u8`…`usize` with `count` | `Opt::count()` | never required |
/// | `Content` | `Opt::content()` / `Arg::content()` | required |
/// | `Option<Content>` | content | optional |
/// | `Vec<Content>` | content, multiple or variadic | `required`: at least one |
/// | `String`, no `validate` | `Opt::string()` / `Arg::string()` | required unless `default` |
/// | `T`, with `validate = v` | string, validated by `v`; `T` is `v`'s `Output` | required unless `default` or `validate_omitted` |
/// | `Option<T>` | string | optional; `non_interactive` requires it when the run cannot ask |
/// | `Vec<T>` | string, multiple or variadic | `required`: at least one |
/// | `[T; N]`, `Option<[T; N]>`, or `Vec<[T; N]>` with `arity` | string option taking `N` words per occurrence | required unless defaulted, optional, or multiple, respectively |
///
/// An arity option validates each word as `T`. Its default is a raw array of words, or an array
/// of such arrays for a multiple option. For example, `#[option(arity, default = ["0", "0"])]`
/// fills a field of type `[String; 2]`.
///
/// A `bool` field is never `Option<bool>` or `Vec<bool>`; a `count` field is `u8`, `u16`, `u32`,
/// `u64`, or `usize`; `min` and `max` sit on a `Vec` field alone.
///
/// The derive implements `GlobalInputs` too when the struct has no argument, no stdin, no passthrough, no content
/// option, no presence rule, and no option group, so it can declare global options and a plugin's
/// options.
///
/// ```
/// use loomcli_core::{Command, Content, Context, Inputs};
///
/// /// The inputs of `deploy`.
/// #[derive(Inputs)]
/// #[inputs(exclusive("dry-run", "force"))]
/// struct DeployInputs {
///     /// The environment to deploy to.
///     #[argument]
///     target: String,
///     /// Show what would change.
///     #[option(short = 'n', aliases = ["simulate"])]
///     dry_run: bool,
///     /// Replace what is running.
///     #[option(polarity = "both")]
///     force: bool,
///     /// How much to report.
///     #[option(count, short = 'v')]
///     detail: u8,
///     /// The release channel.
///     #[option(default = "stable", env = "DEPLOY_CHANNEL")]
///     channel: String,
///     /// Labels to attach.
///     #[option(name = "label", env = "DEPLOY_LABELS", env_delimiter = ",")]
///     labels: Vec<String>,
///     /// The manifest, from a path or `-` for stdin.
///     #[option(stdin)]
///     manifest: Option<Content>,
/// }
///
/// let deploy = Command::new("deploy")
///     .inputs::<DeployInputs>()
///     .action(|ctx: Context<DeployInputs>| async move { ctx.out.print(&ctx.inputs.target).await });
/// ```
///
/// # Compile errors
///
/// A fact the field's kind does not take, or a pair of facts the builder would reject at the call,
/// is a compile error at the fact's key:
///
/// ```
/// use loomcli_core::{Command, Content, Context, Inputs};
///
/// #[derive(Inputs)]
/// struct GetInputs {
///     /// The document to read.
///     #[option(short = 'f', stdin)]
///     file: Content,
///     /// Dot path to read.
///     #[argument]
///     path: String,
/// }
///
/// let get = Command::new("get")
///     .inputs::<GetInputs>()
///     .action(|ctx: Context<GetInputs>| async move { ctx.out.print(&ctx.inputs.path).await });
/// ```
///
/// A non-`Option` field is already required:
///
/// ```compile_fail
/// #[derive(loomcli_core::Inputs)]
/// struct GetInputs {
///     #[argument(required)]
///     path: String,
/// }
/// ```
///
/// An input without `validate` reads a `String`, so another field type names its validator:
///
/// ```compile_fail,E0277
/// #[derive(loomcli_core::Inputs)]
/// struct ServeInputs {
///     #[option]
///     port: u16,
/// }
/// ```
///
/// A field reads the validator's `Output`, whatever that is:
///
/// ```compile_fail,E0277
/// use loomcli_core::{Issue, ValidationContext, Validator};
///
/// struct Port;
///
/// impl Validator for Port {
///     type Output = u16;
///
///     fn validate(&self, input: &str, _: &ValidationContext) -> Result<u16, Vec<Issue>> {
///         input.parse().map_err(|_| vec![Issue::new("Expected a port.")])
///     }
/// }
///
/// #[derive(loomcli_core::Inputs)]
/// struct ServeInputs {
///     #[option(validate = Port)]
///     port: String,
/// }
/// ```
///
/// A struct with an argument, stdin, a content option, a presence rule, or an option group does not
/// implement `GlobalInputs`, so it cannot be global options:
///
/// ```compile_fail,E0277
/// use loomcli_core::{Application, Inputs};
///
/// #[derive(Inputs)]
/// struct Globals {
///     /// The profile to use: required, which no global option is.
///     #[option]
///     profile: String,
/// }
///
/// let app = Application::new("app").globals::<Globals>();
/// ```
///
/// A group member names the declared name, never the field:
///
/// ```compile_fail
/// #[derive(loomcli_core::Inputs)]
/// #[inputs(exclusive("dry_run", "force"))]
/// struct DeployInputs {
///     #[option]
///     dry_run: bool,
///     #[option]
///     force: bool,
/// }
/// ```
#[proc_macro_derive(Inputs, attributes(inputs, option, argument, stdin, passthrough))]
pub fn derive_inputs(input: TokenStream) -> TokenStream {
    let input = syn::parse_macro_input!(input as syn::DeriveInput);
    inputs::expand(&input)
        .unwrap_or_else(syn::Error::into_compile_error)
        .into()
}

/// Implements `loomcli_core::Failure` for a failure class: a struct with one `#[failure(base)]`
/// field holding its parent class's value.
///
/// `#[failure(code = "path-not-found", exit_code = EX_DATAERR)]` declares the class's failure code
/// and exit code; an omitted one is inherited from the parent. `#[failure(abstract)]` declares a
/// class core never reports bare, so it converts into no `loomcli_core::Error`.
///
/// ```
/// use loomcli_core::{EX_DATAERR, Error, Failure, FatalError};
///
/// #[derive(Debug, Failure)]
/// #[failure(code = "path-not-found", exit_code = EX_DATAERR)]
/// struct PathNotFoundError {
///     #[failure(base)]
///     base: FatalError,
/// }
///
/// let error: Error = PathNotFoundError { base: FatalError::new("Path not found.") }.into();
/// ```
///
/// A failure code outside the grammar is a compile error at its literal, and so is an exit code
/// outside 1 through 125:
///
/// ```compile_fail
/// use loomcli_core::{Failure, FatalError};
///
/// #[derive(Debug, Failure)]
/// #[failure(code = "Path Not Found", exit_code = 126)]
/// struct PathNotFoundError {
///     #[failure(base)]
///     base: FatalError,
/// }
/// ```
///
/// An abstract class converts into no `Error`, so an action cannot return it bare:
///
/// ```compile_fail,E0277
/// use loomcli_core::{Error, Failure, FatalError};
///
/// #[derive(Debug, Failure)]
/// #[failure(abstract)]
/// struct RemoteError {
///     #[failure(base)]
///     base: FatalError,
/// }
///
/// let error: Error = RemoteError { base: FatalError::new("The remote failed.") }.into();
/// ```
#[proc_macro_derive(Failure, attributes(failure))]
pub fn derive_failure(input: TokenStream) -> TokenStream {
    let input = syn::parse_macro_input!(input as syn::DeriveInput);
    failure::expand(&input)
        .unwrap_or_else(syn::Error::into_compile_error)
        .into()
}
