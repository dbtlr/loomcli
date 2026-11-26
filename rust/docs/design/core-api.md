---
description: The core API design of Loom CLI for Rust. How each reference concept takes its Rust form, the rules each one enforces and where, the run lifecycle, the host, the crate layout, and the feature map. The crates' code is the source of truth for signatures.
---

# Core API design

This page is the authoring contract of `loomcli-core` and its companion crates. The crates' code under `crates/` is the source of truth for every signature; this page explains the model, maps each reference concept to its Rust form, and states the rules. It rests on the five [decision records](../decisions/README.md). What an operator or a machine reads follows the TypeScript reference byte for byte; [deviations](../deviations.md) lists every difference.

Conventions that hold everywhere below:

- **Builders consume and return.** Every authoring call takes `self` and returns the next value. Builder types carry `#[must_use]`, so a dropped result is a compiler warning (the reference's `discarded-declaration` lint).
- **Output types are `#[non_exhaustive]`.** A type Loom builds and the author reads has public fields and cannot be constructed outside Loom. A type the author builds is a builder.
- **Handlers are `Send + Sync + 'static` and return `Send` futures.** An action is `Fn(Context<I, R>) -> impl Future<Output = Outcome> + Send`, so `async fn` items and closures that capture nothing, `async |ctx| { ... }`, fit. A handler that captures state clones it into the future it returns: `move |ctx| { let shared = shared.clone(); async move { ... } }`. Stable Rust gives an `async move` closure that captures state no `Fn` impl whose future is `Send`, so that form does not compile.
- **A declaration fault at the author's call or attach panics** with `#[track_caller]`, at the author's line, with the whole Developer Diagnostic (80 columns) as the message: the Rust form of the reference's throw while a module evaluates, which never reaches `run()`. Every public method that can raise one carries `#[track_caller]`. A fault at build is returned: `inspect()` returns `Err(DeclarationError)`, `check()` collects every one, and `run()` renders it by build. A lifecycle hook's own calls never panic: each returns its `DeclarationError`, which the hook propagates as a build fault or handles ([section 8](#8-the-plugin-contract)).
- **Author code returns its failures.** A view, a failure view, an encoder, and the `on_failure` and `on_log` hooks return `Result` or a value that converts into one (`IntoRendered`, `IntoHints`, `IntoOutcome`), so the reference's fallback paths for a broken view, encoder, or hook have a source. A plain `String`, `()`, or hint value converts as `Ok`.
- **Names** keep the glossary's vocabulary in Rust casing. Where Rust forbids or a name is taken, the [naming table](#naming-differences) gives the substitute.

## 1. Authoring

### The model

`Application<I, R, S>` and `Command<I, R, S>` are one dynamic builder each (ADR-0004). `I` is the inputs struct the action reads (`NoInputs` until `inputs::<I>()`), `R` the declared result (`NoResult`, `ValueResult<V>`, `RowsResult<Row>`), and `S` the authoring state. Defaults make a finished declaration short to name: `Command<GetInputs>` is `Command<GetInputs, NoResult, Done>`.

| State | Reached by | Calls it offers |
| --- | --- | --- |
| `Configuring` | `Application::new` | `plugins()`, and every call `Fresh` offers |
| `Fresh` | `Command::new`; any call on `Configuring` | arguments, children, options, globals, results, action |
| `Group` | `command()` | arguments, children, options, results, action |
| `Done` | `action()` | `extend()`; `views()` when a result is declared |

`Open` and `TakesGlobals` are sealed marker traits over the states, each with a `#[diagnostic::on_unimplemented]` message that names the rule. Arguments and children are available in every open state. `Group` records that an explicit child was attached. The finished declaration determines whether the Command is a group. Both `argument()` and `inputs::<J>()` return a builder in `<S as State>::Declared`, preserving `Group` after a child is attached.

### Application

| Reference | Rust | Available in |
| --- | --- | --- |
| `new Application(name)` | `Application::new(name)` | |
| `options.plugins` | `.plugins(list)` | `Configuring` only, so once and first |
| `options.description` | `.description(text)` | open states |
| `options.version` | `.version(text)` | open states |
| `options.extensions`, `extend()` | `.extend(list)` | every state |
| `options.views` | `.overrides(list)` | open states |
| `options.translators` | `.translators(list)` | open states |
| `options.uses` | `.uses(list)` | open states |
| `options.shutdown.timeout` | `.shutdown_timeout(ms: u32)` | open states |
| `options.rendering` | `.rendering(RenderingPolicy)` | open states |
| `argument(name, config)` | `.argument(name, Arg::…)` | open states |
| `option(name, config)` | `.option(name, Opt::…)` | open states |
| `globalOption(name, config)` | `.global_option(name, Opt::…)` | `TakesGlobals` |
| (types of globals) | `.globals::<G: GlobalInputs>()` | `TakesGlobals` |
| (inferred inputs) | `.inputs::<I>()` | `I = NoInputs`, open states |
| `exclusive`, `oneRequired`, `requiredTogether` | `.exclusive(&[..])`, `.one_required(&[..])`, `.required_together(&[..])` | open states |
| `stdin(config)` | `.stdin(Stdin::new()…)` | open states |
| `passthrough(config?)` | `.passthrough(Passthrough::new()…)` | open states |
| `needsTerminal()` | `.needs_terminal()` | open states |
| `command(child)` | `.command(child)` | open states |
| `result({views})`, `rows({views})` | `.result(ResultViews)`, `.rows(RowViews)`; `ValueResult<V>` carries views when `V: Serialize + 'static` | `R = NoResult`, open states |
| `views(replacements, {default})` | `.views(ResultViews or RowViews)`, default inside the record | `R: CarriesResult`, every state |
| `action(handler)` | `.action(handler)` | open states |
| `name`, `inspect()`, `check()`, `run()`, `invoke()` | `.name()`, `.inspect()`, `.check()`, `.run(RunOptions) -> BoxFuture<'static, ExitCode>` (the run takes its place in its signal lane at the call, as the reference's `run()` does before its first await), `.invoke(path, values, options, process)` | every state |
| (no runtime of its own) | `.main()` builds a current-thread runtime, runs on the real process, then calls the real process's exit listeners with the code; on a thread that already drives a tokio runtime it panics with the `@loomcli/core/entry-point` diagnostic | every state |
| (a runtime of its own) | `.main_async()`, awaited inside the author's runtime (`#[tokio::main] async fn main() -> ExitCode { app().main_async().await }`): `run` on the real process, then the exit listeners, as `.main()` does. Awaiting `run` alone calls no exit listener, so a process-scoped `on_shutdown` handler would not run at a normal end | every state |

A `list` is `impl IntoList<T>`: an array or `Vec` of one type, or a tuple of up to 32 mixed types, each element `Into<T>`. A tuple is how `plugins((help().command(true), version(), …))` holds settings builders of different types; a longer mixed list is a `Vec` of converted values, `vec![help().into(), version().into(), …]`.

Each state bound sits in the method's `where` clause rather than the impl header, so a call the state removes, such as `.command(x).global_option(..)` or `.action(h).option(..)`, reports the bound's `#[diagnostic::on_unimplemented]` message (E0277) instead of a bare "method exists but its trait bounds were not satisfied" (E0599). A return type names no projection through a bounded trait: the state after a call that removes nothing is `<S as State>::Declared`, which every state defines (`Done`'s is `Done`), so the projection resolves before the `Open` bound is judged. The result calls are bounded the same way: `result()` and `rows()` by `R: NoResultYet`, `views()` by `R: CarriesResult`, each with its own message, and `compile_fail` doctests on the three traits keep the messages reachable. A function that returns a group Command with no action names it `GroupCommand<I, R>`, an alias for `Command<I, R, Group>`, and a group Application `GroupApplication<I, R>`, an alias for `Application<I, R, Group>`.

### Command

| Reference | Rust |
| --- | --- |
| `new Command(name)` | `Command::new(name)` |
| `options.description` | `.description(text)` |
| `options.hidden` | `.hidden()` |
| `options.deprecated` | `.deprecated(message)` |
| `options.extensions`, `extend()` | `.extend(list)` |
| `options.uses` | `.uses(list)` |
| `alias(...names)` | `.alias(name)`, once per alias |
| every other call | as on Application, minus `global_option`, `globals`, `plugins`, and the Application-only facts |

A Command with an action may declare arguments and attach children in either order. The root may also declare arguments beside a plugin's Commands. A group has children and no action. Its declaration may carry local options, and any argument, stdin, passthrough mode, or terminal need is a `command-without-action` fault. Attach checks a child, and graph build checks the root and hook contributions.

### Passthrough and terminal need

`Passthrough::new()` declares the mode. `.description(text)` on that builder supplies the optional description for help, man pages, and the manifest. `passthrough(Passthrough::new().description(text))` sets that declaration on the Command or the root. Each setting applies only to the declaration that sets it. Both setters require an open declaration and fault on a second call. A typed input may declare passthrough through `#[passthrough]`. The terminal need is declared through `needs_terminal()`.

The first bare `--` ends routing and option parsing. With passthrough enabled, every later word reaches the action in `Context::passthrough` in order, including any empty word or later `--`. With the mode off, the parser reads those words as positional arguments. A word that has no argument slot raises `UnexpectedArgumentError` with exit 2. When the routed Command has arguments and the mode is off, `UnknownOptionError` suggests passing the word as an argument after `--`.

`needs_terminal()` requires terminal stdin and stderr outside CI. A redirected stdout or the operator's choice to turn questions off has no effect on that requirement. A Command that needs a terminal always fails with `TerminalUnavailableError` on an invocation by name, even when the calling action runs at a terminal. Help and the man page include the requirement, and opting the Command in as an MCP tool raises `@loomcli/plugins/mcp/tool-needs-terminal` during graph build.

### Options

`Opt::string()`, `Opt::boolean()`, `Opt::count()`, and `Opt::content()` return `StringOpt`, `BooleanOpt`, `CountOpt`, and `ContentOpt`. Each has only the setters its kind takes, so `type`-dependent key exclusions are type errors.

| Reference key | Rust setter | Kinds |
| --- | --- | --- |
| `type` | the constructor | all |
| `description` | `.description(text)` | all |
| `hidden` | `.hidden()` | all |
| `deprecated` | `.deprecated(message)` | all |
| `control` | `.control()` | all |
| `short` | `.short(letter)` | all |
| `shortOnly` | `.short_only()` | all |
| `aliases` | `.aliases(names)` | all |
| `extensions` | `.extend(list)` | all |
| `env` | `.env(names)` | all |
| `envDelimiter` | `.env_delimiter(text)` | string, content |
| `envAllowEmpty` | `.env_allow_empty()` | string |
| `required: true` | `.required()` | string, content |
| `required: 'non-interactive'` | `.required_when_non_interactive()` | string |
| `multiple` | `.multiple()` | string, content |
| `default` | `.default(DefaultValue)` (from `&str`, `String`, `[&str; N]`, `Vec<String>`) | string |
| `implied` | `.implied(text)` | string |
| `validate` | `.validate(validator)` | string |
| `validateOmitted` with `validate` | `.validate_omitted(validator: impl OmissionValidator)` | string |
| `polarity` | `.polarity(Polarity::…)` | Boolean |
| `interaction` | `.interaction()` | Boolean |
| `color` | `.color()` | Boolean |
| `verbose` | `.verbose()` | count |
| `quiet` | `.quiet()` | count |
| `background` | `.background()` | string |
| `stdin` | `.stdin()` | content |
| `min`, `max` | `.min(n)`, `.max(n)` | content |

`option()` takes `impl Into<OptionDecl>` (all four builders). `global_option()` and a plugin's `option()` take `impl Into<GlobalOptionDecl>`, which `ContentOpt` does not implement.

### Arguments and stdin

`Arg::string()` and `Arg::content()` return `StringArg` and `ContentArg`.

| Reference key | Rust setter | Kinds |
| --- | --- | --- |
| `description` | `.description(text)` | both |
| `variadic` | `.variadic()` | both |
| `required: true` | `.required()` | both |
| `required: 'non-interactive'` | `.required_when_non_interactive()` | string |
| `default` | `.default(DefaultValue)` | string |
| `validate` | `.validate(validator)` | string |
| `validateOmitted` | `.validate_omitted(validator)` | string |
| `extensions` | `.extend(list)` | both |
| `stdin`, `min`, `max` | `.stdin()`, `.min(n)`, `.max(n)` | content |

An argument builder has no `hidden`, `deprecated`, `control`, `env`, or spelling setter, so the reference's `ArgumentKeyConstraint` is a type error. A standalone `stdin()` takes `Stdin::new().description(text).required()`.

Without a variadic, words fill arguments from the start in declaration order. After a variadic, only unconditionally required scalar string arguments are allowed. Core fills those arguments from the end first, then fills the arguments before the variadic from the start. The variadic receives the words between. The required-before-optional rule applies through the variadic, so an optional variadic can precede a required scalar argument.

### Input sources

Precedence is the reference's: a token, then the environment, then the configuration source, then the declared default. An environment binding is the `env` setters above, read under the reference's rules: the first name holding a non-empty value (or, under `env_allow_empty`, the first defined name), a string as it is, a multiple option's value split at its delimiter, a Boolean through the `true`/`false`/`yes`/`no`/`y`/`n`/`on`/`off`/`1`/`0` grammar, and a count as ASCII digits; a value outside its grammar is the option's `invalid` problem, naming the variable. The configuration source is the single slot a plugin claims with `Plugin::source(ConfigurationSource::new(&BINDING, resolver).schema(schema))`; the binding is an option-target extension descriptor and the resolver answers `BTreeMap<String, SourceAnswer>` (`SourceAnswer::new(value, label).directory(dir)`) by option name. Core reaches the slot through `inputs::sources::SourceSlot`, the erased form a `ConfigurationSource` takes once `Plugin::source` claims it: the resolver receives a `SourceContext<O>` whose `options` are the claiming plugin's own validated options extracted as `O`, and whose `out` and `log` are the run's, the log tagged with the plugin. A resolver's foreign error is offered to the translators before it becomes the plugin's `foreign-throw` fault. The hidden `__private::install_source(app, plugin, &BINDING, own, resolver)` installs a source with untyped options for a test. Option groups withdraw lower-tier members before validation.

### Where each authoring rule is enforced

"Type" means the program does not compile. "Call", "attach", and "build" are the reference's moments; the identity is the reference rule a fault reports under, or a [Rust-only rule](#rust-only-rules).

| Reference rule | Rust enforcement | Identity |
| --- | --- | --- |
| `command()` and `action()` remove `globalOption()` | Type: `TakesGlobals` | (types) |
| `result()`/`rows()` once, `views()` only with a result | Type: `NoResultYet`, `CarriesResult` | (types) |
| `action()` closes every call but `extend()`/`views()` | Type: `Open` | (types) |
| The root has no `alias()`, `hidden`, `deprecated` | Type: Application has no such setters | (types) |
| `alias()` takes at least one name | Type: `alias(name)` takes one | (types) |
| One statically known name per declaration | Type: a `&str` names one input | (types) |
| An argument has no `hidden`, `deprecated`, `control`, `env`, spelling | Type: argument builders lack the setters | (types) |
| A content option is local | Type: no `From<ContentOpt> for GlobalOptionDecl` | (types) |
| `validateOmitted` needs a validator that takes the omission | Type: `validate_omitted(impl OmissionValidator)` | (types) |
| A validator of several values judges one string | Type: `Validator::validate(&str, …)` | (types) |
| A default and an implied value are in the validator's input type | Type: `DefaultValue` and `implied` are raw strings | (types) |
| Plugins install before the application's own declarations | Type: `plugins()` exists on `Configuring` only | (types) |
| Shutdown handlers are synchronous | Type: handlers return `()` | (types) |
| Application, Command, alias names are portable | Call | `portable-name` |
| Argument, option, alias names are declared names | Call | `declared-name` |
| A global option declares no presence rule | Call (`option-config`); derive: `GlobalInputs` is not implemented, a compile error at `globals::<G>()` or `options::<O>()` under `cargo check` | `option-config` |
| Run-wide marks only on global options | Call | `option-config` |
| `required` excludes `default`; `shortOnly` excludes `aliases`; `polarity: 'both'` excludes `shortOnly`; a color mark excludes a short spelling and `env`; a verbose or quiet mark excludes `env`; a multiple option's `env` needs `envDelimiter`; `validateOmitted` excludes `required`, `default`, `multiple` | Call; derive: compile error | `option-config` |
| An empty `envDelimiter` | Call | `env-delimiter` |
| One mark of each kind per Application | Call | `interaction-mark`, `color-mark`, `verbose-mark`, `quiet-mark`, `background-mark` |
| A key, spelling, or variable used twice in one scope | Call | `option-declared-twice`, `spelling-taken`, `variable-bound-twice` |
| A local option that collides with a global, the plugins' included | Call (`option`), attach (`command`) | same three |
| Only required scalar string arguments follow a variadic. Required arguments precede optional ones up through the variadic. | Call | `argument-after-variadic`, `optional-argument-last` |
| An argument declared twice | Call | `argument-declared-twice` |
| Passthrough declared twice | Call | `passthrough-declared-twice` |
| Terminal need declared twice | Call | `terminal-need-declared-twice` |
| An option group of fewer than two, repeated, or undeclared members | Call | `option-group` |
| Siblings share a name or alias | Attach | `sibling-name-taken` |
| One Command value at two places | Type: `command()` moves the child, and `Command` is not `Clone`, so one value cannot attach twice; `command-attached-twice` is unreachable | (types) |
| A Command with neither children nor an action, or arguments, stdin, passthrough, or terminal need on a group | Attach; build for the root and hook contributions | `command-without-action` |
| Two providers with one name in a `uses` closure | Call (`uses`) | `provider-name-taken` |
| A persistent provider uses an ephemeral one | Type: `Provider<V, Persistent>::uses` takes `PersistentProvider` alone | (types) |
| At most one stdin target per Command | Call: `stdin()`, or `option()`/`argument()` of a content input with `.stdin()`, when another already claims stdin | `stdin-claimed-twice` |
| A missing input names a local option or an argument of the routed Command | Run: `missing_input_error` returns the `DeclarationError` in place of the `InputError` | `missing-input-name` |
| A plugin installed twice; a slot claimed twice; two encoders for one media type | Call (`plugins()`, `failure_encoders()`) | `plugin-installed-twice`, `slot-taken`, `failure-encoder-taken` |
| Two descriptors or declared views under one identity with different types | Call | `two-package-copies` |
| An extension value its rules reject | Call: the `extend()` that carries it; in a hook, `AttachedCommand::extend` returns the fault | `invalid-extension-value` |
| An activation, `short`, or `env` setting names an option the plugin has not declared | Call (`middleware()`, `Plugin::short`, `Plugin::env`) | `plugin-option-name` |
| A plugin registers its middleware or one hook twice | Call: the second setter | `handler-registered-twice` |
| A shutdown budget out of range | Call | `invalid-shutdown-timeout` |
| A hook's call breaks a declaration rule | Build: the call returns its `DeclarationError`; the hook propagates it with `?`, and it reports as itself, or handles it and continues without the declaration | the call's rule (`declared-name`, `option-config`, `invalid-extension-value`, …) |
| A hook's contribution collides | Build, naming the hook's plugin and the Command | the collision rules, `name-shared-across-kinds` |
| A hook returns an error that is not a `DeclarationError` | Build | `broken-attach-hook`, `broken-graph-hook` |
| A default or implied value its validator rejects | Run, after environment preparation and before any token; not `check()` | `invalid-default`, `invalid-implied` |
| A Command's global requirements (`Register`, `AttachmentConstraint`) | Read: `ctx.globals::<G>()` returns the fault | `input-read` |
| A Command's provider requirements (`uses` types `provided`) | Read: `ctx.provided(&p)` returns the fault | `input-read` |

## 2. Typed inputs

`#[derive(Inputs)]` implements `Inputs` for a struct whose fields are inputs, and `GlobalInputs` as well when every field may be a global option. One struct per declaration: `Command::inputs::<I>()` for a Command's arguments and local options, `Application::globals::<G: GlobalInputs>()` for global options, `Plugin::options::<O: GlobalInputs>()` for a plugin's options. The same trait reads globals back: `ctx.globals::<G>()`. `Inputs::into_values` is the inverse of `extract`, so a test's context builder turns a typed struct into the by-name values a context reads.

### Attribute grammar

Each field carries exactly one of:

- `#[option(fact, …)]`: an option.
- `#[argument(fact, …)]`: an argument, bound in field order.
- `#[stdin(description = "…")]`: the standalone stdin, on a `Content` or `Option<Content>` field.
- `#[passthrough(description = "…")]` declares the passthrough mode on a `Vec<String>` field. The description is optional and defaults to the field’s doc comment.

The struct may carry `#[inputs(exclusive("a", "b"), one_required(…), required_together(…))]`. Each member is an option's declared name (`dry-run` for a field `dry_run`), not a field identifier: a member that is a field's identifier where that field declares another name is a compile error at the member (`` `dry_run` is the field; a group names the declared name "dry-run" ``). A member that names no field stays a call fault at `inputs::<I>()`, because an option declared before that call may be a member.

| Fact | Form | On |
| --- | --- | --- |
| `name` | `name = "min-bytes"`; default: the field name with `_` as `-` | both |
| `description` | `description = "…"`; default: the doc comment, lines joined by spaces. Use `description = "…"` when the help text holds `<…>` or `[…]`, which rustdoc reads as HTML or a link | both |
| `short`, `short_only` | `short = 'f'`, `short_only` | option |
| `aliases` | `aliases = ["minimum"]` | option |
| `hidden`, `deprecated`, `control` | flags; `deprecated = "Use get instead."` | option |
| `count` | flag; the field is an unsigned integer | option |
| `polarity` | `polarity = "both"` | Boolean option |
| `validate` | `validate = text()` | string input |
| `validate_omitted` | flag; `validate` names an `OmissionValidator` | string input |
| `default` | `default = "8080"` or `default = ["a", "b"]` | string input |
| `implied` | `implied = "simple"` | string option |
| `required` | flag, on a `Vec` field alone: at least one value | both |
| `non_interactive` | flag, on an `Option` or `Vec` field: required when the run cannot ask | both |
| `env`, `env_delimiter`, `env_allow_empty` | `env = "ACME_LOG"` or `env = ["A", "B"]` | option |
| `extensions` | `extensions = [HELP_INPUT.value(…)]` | both |
| `stdin`, `min`, `max` | flag; `min = 1` | content input |
| `interaction`, `color`, `verbose`, `quiet`, `background` | flags | global option |
| `builder` | `builder = document_input()`: a shared `ContentOpt` that holds every option fact, its description included; beside it the field states only `name` and, on a `Vec`, `required`, `min`, and `max`, and its doc comment documents the Rust field alone; the field type still decides presence | content option |

### Field types

The field type decides the builder, the presence, and the extraction. The struct never states a fact twice: a non-`Option` scalar is required, so `required` on it is a compile error.

| Field type | Declaration | Presence | Extraction |
| --- | --- | --- | --- |
| `bool` | `Opt::boolean()` | never required | `values.option::<bool>(name)` |
| `u8`…`usize` with `count` | `Opt::count()` | never required | `values.option::<T>(name)` |
| `Content` | `Opt::content()` / `Arg::content()` | `.required()` | `values.required_option::<Content>(name)` |
| `Option<Content>` | content | optional | `values.option::<Option<Content>>(name)` |
| `Vec<Content>` | content, `.multiple()` / `.variadic()` | `required` adds `.required()` | `values.option::<Vec<Content>>(name)` |
| `String`, no `validate` | `Opt::string()` / `Arg::string()` | `.required()` unless `default` | `values.required_option::<String>(name)` |
| `T`, with `validate = v` | string, `.validate(v)`; `T` must be `v`'s `Output` | `.required()` unless `default` or `validate_omitted` | `values.required_option::<T>(name)` |
| `Option<T>` | string | optional; `non_interactive` adds `.required_when_non_interactive()` | `values.option::<Option<T>>(name)` |
| `Vec<T>` | string, `.multiple()` / `.variadic()` | `required` adds `.required()` | `values.option::<Vec<T>>(name)` |

A `bool` field is a Boolean option and is never `Option<bool>` or `Vec<bool>`; a `count` field is `u8`, `u16`, `u32`, `u64`, or `usize`; a `#[stdin]` field is `Content` or `Option<Content>`; `min` and `max` sit on a `Vec` field alone.

`T` must equal the validator's `Output`, and an unvalidated string field must be `String`; the derive proves both at compile time with `assert_validator_output::<T, _>(&validator)` and `assert_string_input::<T>()`, emitted at the field type's span. Both rest on `IsType<T>`, whose `#[diagnostic::on_unimplemented]` says that an input without `validate` reads a `String` and one with `validate` reads the validator's `Output`. All three are public, documented items; a hand-written impl may omit the two assertions.

### Compile errors

The derive rejects at compile time what the builder would reject at the call for one field, each error spanned at the fact's key, the type, or the attribute at fault, and every field's error at once:

- **A fact of another kind**, such as `polarity` on a string option or `short` on an argument: `` `polarity` is not a fact of a string option: it is a fact of a Boolean option``.
- **Presence stated twice**: `required` on a non-`Option` scalar, `required` or `default` on an `Option`, `non_interactive` on a scalar, `validate_omitted` on an `Option` or a `Vec`.
- **The `option-config` rules of one field**: a `short` character literal that is not an ASCII letter, `short_only` with no `short` or beside `aliases`, polarity `"both"` beside `short_only`, a color option's `short` or `env`, a verbose or quiet option's `env`, `verbose` beside `quiet`, a background option's `short`, `env`, `default`, or `implied`, or a `Vec` background option, a multiple option's `env` with no `env_delimiter`, `env_delimiter` with no `env` or off a `Vec`, `env_allow_empty` with no `env` or on a `Vec`, `validate_omitted` with no `validate` or beside `default`, `required` beside `non_interactive` or `default`, `non_interactive` beside `default`, and a list `default` (an array literal) off a `Vec`.
- **A fact beside a shared `builder`** other than `name`, `required`, `min`, and `max`: `` `short` is a fact of the shared builder: set it in the builder or drop `builder` ``.
- **A name outside the `declared-name` grammar**: a `name` literal, a literal in an `aliases` array, or a field name that becomes one, such as `_private` (`-private`).
- **A type no kind reads**: `Option<bool>`, a `bool` argument, a `count` field that is no unsigned integer, a `#[stdin]` field that is not `Content` or `Option<Content>`.
- **The grammar**: an unknown fact (the message lists the facts), a fact named twice, a flag given a value, a valued fact given none, two roles on one field, a field with no role, and a tuple struct or an enum.

The rules that read more than one declaration, a name or a spelling taken twice, a run-wide mark on a local option, and a presence rule on a struct used as global options, stay the call's faults, as does a rule on a value the derive cannot read as a literal, such as `short = SHORT` or `aliases = ALIASES`. A type the field and its input disagree on is E0277 at the field type through `IsType`; a struct that is not eligible as global options is E0277 at `globals::<G>()` or `options::<O>()` through `GlobalInputs`. The derive implements `GlobalInputs` only for a struct with no argument, no stdin, no passthrough, no content option, no presence rule, and no option group.

### Expansion contract

The expansion is public contract (ADR-0004), written against public items alone:

```rust
// Emitted only when every field may be a global option; SelectInputs has a content option.
// impl loomcli_core::GlobalInputs for SelectInputs {}

impl loomcli_core::Inputs for SelectInputs {
    fn declare(declarations: Declarations) -> Declarations {
        let declarations = declarations.option("file", (document_input()).required());
        let declarations = {
            let validator = text();
            loomcli_core::assert_validator_output::<String, _>(&validator);
            declarations.option(
                "field",
                Opt::string().description("A field to keep. Repeat it for several.")
                    .short('F').validate(validator).multiple().required(),
            )
        };
        declarations
    }

    fn extract(values: &InputValues) -> Result<Self, Error> {
        Ok(SelectInputs {
            file: values.required_option::<Content>("file")?,
            field: values.option::<Vec<String>>("field")?,
        })
    }

    fn into_values(self) -> InputValues {
        let values = InputValues::new();
        let values = values.with_option("file", loomcli_core::Required(self.file));
        let values = values.with_option("field", self.field);
        values
    }
}
```

`IntoInputValue` is the inverse of `FromInputValue`: `Option<T>`, `Vec<T>`, `bool`, an unsigned count, and `Required<T>` for a value validation guarantees. Every read returns `Result`: a name the table does not hold, a `T` the declaration does not produce, and a required read of an absent value are the `input-read` fault. `T` is `String` for an input with no validator, the validator's `Output` with one, and `Content` for a content input; a count beyond the integer type's range reads as its largest value.

`Command::inputs::<I>()` applies `I::declare` through the Command's own `argument()`, `option()`, `stdin()`, `passthrough()`, and group calls, in the order `declare` made them, so every call-time rule applies. `Application::globals::<G>()` applies each option through `global_option()`; a hand-written `GlobalInputs` impl that lists an argument, stdin, passthrough, a group, or a content option faults there under `option-config`. `I::extract` runs at dispatch over the validated values.

### Globals, plugin options, and dynamic reads

- **Declare.** `Application::global_option(name, opt)` or `.globals::<G>()`; `Plugin::option(name, opt)` or `.options::<O>()`. `globals` and `options` bound `G: GlobalInputs`, so an ineligible struct is an E0277 at the call under `cargo check`, clippy, and rust-analyzer alike.
- **Read typed.** `ctx.globals::<G>()` extracts any struct whose fields name global options, the plugins' included; a middleware reads its own as `ctx.options: Option<O>`. A field that names no global, or a type that does not match the declaration, returns the `input-read` fault.
- **Read by name.** Plugins and hooks read inputs they did not declare: `ctx.option::<T>(name)`, `ctx.argument::<T>(name)`, `middleware.option::<T>(name)`, `own_options.option::<T>(name)`, `request.values.option::<T>(name)`. Every one returns `Result<T, Error>`: absence reads through `T = Option<V>`, and a name the scope does not declare, or a `T` the declaration does not produce, is `input-read`. `T: FromInputValue` is `Option<V>` for one value, `Vec<V>` for several, `bool` for a Boolean option, and an unsigned integer for a counted option. A Boolean or counted option also reads as `Option<bool>` or `Option<u32>` (any unsigned integer), so a record that holds an option only once it validated, such as `own_options`, reads its absence as `None`. While a middleware's `options` is `None`, `middleware.option::<T>(name)` reads every global option as absent, so a middleware that runs on an invocation whose global value did not validate reads a Boolean as `Option<bool>` and a count as `Option<u32>`: a read of an absent value as a type that always holds one (`bool`, `u32`, `String`) is `input-read` with its own sentence, `The inputs read option "peek" as a type that always holds a value, and the run holds none for it.`, whose correction names the `Option` reads.
- **Stdin.** A derived `#[stdin]` field is the typed form of `ctx.stdin`: when an inputs struct claims stdin, `ctx.stdin` is `None`, so one stdin is read one way.
- **Passthrough.** The derive declares the mode with `Declarations::passthrough`, extracts the tail with `InputValues::passthrough()`, and restores it with `InputValues::with_passthrough`. The same words are available through `ctx.passthrough`.

## 3. Validation

```rust
pub trait Validator: Send + Sync + 'static {
    type Output: Clone + Send + Sync + 'static;
    fn validate(&self, input: &str, context: &ValidationContext) -> Result<Self::Output, Vec<Issue>>;
    fn input_schema(&self) -> InputSchema { None }
}
pub trait OmissionValidator: Validator {
    fn validate_omission(&self, context: &ValidationContext) -> Result<Self::Output, Vec<Issue>>;
}
```

- **Synchronous.** A validator judges one string and returns. It holds no state between calls; on a multiple option or a variadic argument it judges each value. `path` probes the file system synchronously.
- **Issues.** `Issue { message, path: Vec<PathSegment>, code, params }`, built with `Issue::new(message).at(segment).code(code, params)`. A rejection with no issue reads as core's "rejected without an explanation" issue. `issue_path(&issue)` returns the dotted path. `loomcli-validators` declares typed codes with `issue_code::<P>(code, message)`.
- **Context.** `ValidationContext { phase, host, input, command, passthrough, supplied }`. Phases: `Default` (a declared default or implied value, once per run before any token), `Invocation` (a supplied or filled value), `Question` (a prompt's answer). Outside a run, `validation_context(handle: Arc<dyn ProcessHandle>, ValidationFacts) -> Result<ValidationContext, Error>` builds one, the reference's `validationOptions`: it captures a host of its own from the handle, with the background its terminal states, and returns the `WorkingDirectoryError` a run would report for a working directory the handle cannot read. `ValidationFacts::default_phase(input)` or `::invocation(input)`, then `.command(path)`, `.passthrough(words)`, `.supplied(record)`, which the default phase ignores. The context is a parameter, so the reference's `validationContext(options)` and `validationContextKey` have no counterpart.
- **Absence.** An omitted input with no default calls no validator unless it declares `validate_omitted`. An empty variadic or multiple input is an empty list and calls no validator.
- **Input schema.** `input_schema()` returns `Option<serde_json::Map>`: the published JSON Schema of the token, sound and never stricter than the validator. A content input publishes `{"minLength":1,"type":"string"}`. `with_schema_dialect(schema)` puts the `$schema` member naming `JSON_SCHEMA_DIALECT` (draft 2020-12) ahead of a schema's own members, as the reference's `createValidator` publishes it; every first-party validator publishes through it, and core's own content schema carries no `$schema`. A converter cannot fail by type, so `schema-converter-failed` is unreachable.
- **Identity.** `InputIdentity::new(global, kind, name)` builds the identity a test hands `ValidationFacts`.
- **Problems.** `InputProblem::{Group, Missing, Invalid}` aggregate in authoring order, globals first, the standalone stdin's in its declaration position and the groups' last, into `InputError`, whose message is every problem's lines in core's sentences. `reported_spelling(&option)` names an option as core does.
- **Content.** A content input's sources are prepared before dispatch: counted, probed for existence and readability with no read, and each a lazy `Content` handle. `ContentKind::File { path }` holds the absolute path (the operand joined to the run's `cwd` without normalizing) and `name` the operand; `text()` and `bytes()` read the rest of the source, a file opened afresh on each read and stdin read on from where it stands; `stream()` hands the stream itself.
- **Linked and missing inputs.** `ValueLink::option(name, message)` or `ValueLink::argument(name, message)` names the input a question links. `validate_linked_value::<T>(ctx, &link, value) -> Result<Result<T, Vec<Issue>>, Error>`, `question_validation_context(ctx, link, message)`, and `missing_input_error(ctx, &link) -> Error` serve the prompts. `validate_linked_value` runs the linked input's declared validator on one value in the question phase: the inner result is the validator's verdict, an input with no validator answers the value as a `String`, and the outer `Err` is the `input-read` fault of a `T` the validator does not produce. `missing_input_error` returns the error to return: core's `InputError`, or, for a link that names no local option or argument of the routed Command, the `missing-input-name` `DeclarationError`.

## 4. The action context

`Context<I, R>` is `#[non_exhaustive]` with public fields and methods.

| Reference field | Rust form |
| --- | --- |
| `args`, `options` | `ctx.inputs: I` (arguments and local options); globals through `ctx.globals::<G>()`; by name through `ctx.argument::<T>()`, `ctx.option::<T>()` |
| `supplied` | `ctx.supplied: SuppliedInputs` (`args`, `options` maps of `SuppliedValue`) |
| `interactive` | `ctx.interactive: bool` |
| `passthrough` | `ctx.passthrough: Vec<String>`, empty when the Command leaves the mode off or the invocation supplies no tail |
| `graph` | `ctx.graph: Arc<CommandGraph>` |
| `command` | `ctx.command: Arc<CommandNode>` |
| `out` | `ctx.out: Out<R>` |
| `host` | `ctx.host: Arc<Host>` |
| `signal` | `ctx.signal: RunSignal` (`is_cancelled()`, `cancelled().await`, `reason()`, `token()`) |
| `cancel` | `ctx.cancel()`: the run signal's `Action` cause; under an invocation by name it cancels the call alone |
| `onShutdown` | `ctx.on_shutdown(FnOnce(ShutdownEvent)) -> Registration`, scoped to the run; a panic is the `error` event `A shutdown handler failed.` with the panic message under `error` |
| `onSuspend`, `onResume` | `ctx.on_suspend(Fn())`, `ctx.on_resume(Fn())`, scoped to the run, a panic logged as `A suspend handler failed.` or `A resume handler failed.` |
| `style` | `ctx.style: ContextualStyle` |
| `invoke` | `ctx.invoke(path, InvocationValues, InvokeOptions<M>).await -> InvocationOutcome<M>`; values are JSON (below); `InvokeOptions::new().view(name).failure(\|failure: &dyn Failure, context: &InvokeFailure\| …).signal(token).on_progress(\|event\| …).exclude(names)`; `InvocationOutcome::{Completed { output, messages }, Failed { failure, form, exit_code, output, messages }, Cancelled { exit_code }}`, `failure` being the mapper's value or, with none, the failure as an `Error`. An observer or mapper that panics makes the call panic once its run settles |
| `log` | `ctx.log: Log` |
| `provided` | `ctx.provided(&provider) -> Result<Arc<V>, Error>` |
| `stdin` | `ctx.stdin: Option<Content>`, `None` when a derived `#[stdin]` field claims it |

An action returns `Outcome = Result<(), Error>`. A handler that captures state clones it into its future:

```rust
let banner: Arc<str> = Arc::from("jsonkit");
Command::new("hello").action(move |ctx: Context| {
    let banner = Arc::clone(&banner);
    async move { ctx.out.print(&banner).await }
})
```

**Reading inputs.** `ctx.inputs` is the routed Command's inputs struct, extracted from the validated values; `ctx.option::<T>(name)` reads a local option, else a global one, `ctx.argument::<T>(name)` an argument, and `ctx.globals::<G>()` extracts a struct of global options, each under the rules of section 2. `ctx.supplied` holds the raw value of every declared input any tier supplied: `One` or `Many` for a string or content input (`Many(vec![])` for an omitted collected one), `Flag` for a Boolean, `Count` for a counted option, and no key for an omitted scalar or an input left to its default; a member an exclusive group withdrew is left out.

**Invocation values.** `InvocationValues::new().arg(name, v).option(name, v)` takes any `impl Into<serde_json::Value>` for `v`, such as `"text"`, `5`, `true`, `vec!["a", "b"]`, or the JSON value an agent sent. The MCP plugin passes a tool call's `arguments` through as received. Core applies the reference's lowering table. A finite number lowers to the token JavaScript's `String(number)` writes, such as `5` or `0.5`. An unlowerable value supplies nothing and becomes an `invalid` problem in authoring order. Examples include `null`, an object, a nested array, an array on a scalar input, a non-finite number, and a Boolean on an argument. An absent key is the reference's `undefined`.

`InvocationValues::passthrough(words)` takes `impl IntoIterator<Item = impl Into<String>>`. A Command with the mode receives the words in order. A Command with the mode off accepts an empty list and rejects a nonempty list with `UnexpectedArgumentError`, whose `extra()` holds those words and whose `accepted()` holds the Command’s argument count. A crate-private constructor sets the sentence to `Command "get" declares no passthrough. Remove passthrough from the values.` The message module escapes the Command name. Core holds this structural fault behind unknown option keys, excluded names, and argument keys. This applies to both `Application::invoke` and `Context::invoke`.

## 5. Output

`Out<R>` writes through the view registry under the destination's rendering policy.

| Method | Destination | Rules |
| --- | --- | --- |
| `print(message)` | stdout | `print` lane by default |
| `info`, `success` | stderr | hidden at verbosity -1 |
| `warn`, `error` | stderr | every verbosity |
| `debug` | stderr | from verbosity 1 |
| `trace` | stderr | from verbosity 2 |
| `render(data, &view)` | stdout | one operation over `Render<Data>`: `&D` with `View<D>`/`DeclaredView<D>`, or `impl Into<RowSource<Row>>` with `RowView<Row>`/`DeclaredRowView<Row>` |
| `draw(&data, &view) -> usize` | stderr | whole views (`WholeView<D>`, `D: 'static`); no newline; returns the terminal rows taken at stderr's real width |
| `text(&data, &view) -> String` | none | the text `render` would write now, for `render`'s destination (`D: 'static`) |
| `region(RegionOptions) -> Region` | stderr | live region; `RegionOptions::new().input()` for a question |
| `lend_terminal(work) -> impl Future<Output = T>` | none | holds live regions while `work` runs; the lend counts from the call |
| `results(value)` | stdout | exists only on `Out<ValueResult<V>>` (takes `V`) and `Out<RowsResult<Row>>` (takes `impl Into<RowSource<Row>>`); once |
| `fatal(message) -> Error` | failure path | the `FatalError` to return: `return Err(out.fatal(…))` |

Every write method is `async` and returns `Result<_, Error>`; a closed stdout pipe returns the cancellation echo, and the run exits 141. A call writes when it is awaited: a Rust future runs only when polled, so a call the action never awaits writes nothing and raises nothing.

**Message level and view.** `print`, `info`, `success`, `warn`, and `error` each take `impl Into<Message<'a>>`. `Message<'a>` is a borrowed builder exported by `loomcli-core`. A borrowed `AsRef<str>` value, such as `&str` or `&String`, converts to a message drawn through the method's lane view. `Message::new(text).view(&view)` borrows the text as `&str` and the view as a `WholeView<str>`, either bare or declared. `EnvironmentContext::warn` takes the same argument.

`debug` and `trace` take `&str` until the core logging port (LM-621) removes them.
The streamed message port (LM-645) uses a separate constructor or type without `.view`.

A method sets the message's level, which fixes its destination and verbosity. The run skips rendering when the level is hidden. A message with its own view uses that view for its whole layout, including any glyph, gutter, wrapping, or indentation. The view receives the destination's context. A declared view resolves through the registry, including when the message names a different lane's view. A rendering error is returned by the awaited call.

**Message line breaks.** Core appends `\n` when the view's drawn text lacks a final line break. The test ignores control sequences, so an LF inside a style frame and a CRLF both count. Core preserves every line break the view supplied. Empty view text writes one `\n`. The same rule applies to the default lanes, lane overrides, and views a message passes.

**Lane views.** The default `print` view returns the message as given. `info`, `success`, `warn`, and `error` open with their glyph and one space, styled with the matching token. `debug` opens with `Glyph::PointerSmall` and `trace` with two spaces and `Glyph::LineVerticalDashed0`. Both style the glyph and message in `dim`, with `faint` added for `trace`. These six lane views indent continuation lines by the measured gutter and, on a terminal, expand tabs and wrap at the context's `columns` less the gutter.

**Step view.** The `step` Cargo feature of `loomcli-plugins` enables `loomcli_plugins::step::step`. Its factory `step<D: AsRef<str> + ?Sized + 'static>() -> View<D>` returns a bare view. The input is `str` for a message or a text render call, and can be `String` for a value result. The view draws `Glyph::Pointer` styled `primary`, one space, and the text styled `bold`, preserving the author's styling. On a terminal the view expands tabs and wraps the text at `columns` less the measured gutter, with a minimum of one column. The gutter uses the destination's glyph form. Off a terminal the view keeps the authored lines. Continuation lines align under the text and blank lines stay empty. The view ends a drawn step with `\n` and returns empty text for input that resolves to no characters.

```rust
use loomcli_core::{Error, Message, Out};
use loomcli_plugins::step::step;

async fn show(out: &Out) -> Result<(), Error> {
	out.info(Message::new("Building 3 packages").view(&step())).await?;
	out.success("Built 3 packages").await
}
```

**Destinations and order.** `print`, `render`, and `text` follow the caller's channel: the action of a Command that declares a result writes them to stderr, with stderr's view context, so stdout carries the result alone; every other caller keeps stdout. Each destination has one turn, so writes to it keep the order their calls were made in. A sequence, under `render` with a row view or under `results`, holds its destination's turn from its first piece to its last, requests no row until the previous piece is written, and resolves each piece's `columns` just before its view function runs. A sequence that stops early, at a source's, view's, or write's `Err` or at the run's cancellation, writes no closing piece and holds one line of `incomplete_result()` (`@loomcli/core/results/incomplete`), which the run writes on stderr ahead of its failure report, or at its end; a closed stdout drops it. A stdout write that fails with `BrokenPipe` or `NotConnected` cancels the run with `ClosedPipe`, and that write and every later one to stdout return the cancellation echo, which the run reports nothing for. Any other failed write, and every failed stderr write, is a broken destination: the run reports `broken-destination` through the plain fallback path and exits 1.

**Process end.** At a shutdown's end or a host exit event, core drains writes that have reached the queue. It sends only the parts that have yet to reach their streams, in queue order. On a shared terminal a stdout write's erase and redraw go to stderr as usual. Core restores the terminal cursor before calling shutdown handlers. The drain polls each stream write once and skips a destination that already failed. A future that has yet to be polled has no queued write.

**Views.** `View<D: ?Sized>` (`View::new(|data, ctx| …).media_type(…)`), `RowView<R>` (`RowView::new(|row, index, ctx| …).head(…).tail(…)`), and `view(identity, definition)` declares either through `Declare`, returning `DeclaredView<D>` or `DeclaredRowView<R>`. A render function returns `impl IntoRendered`: a `String`, or a `Result<String, E>` whose `Err` is the view's failure, which takes the ordinary failure path from the write site (`out.render` and `out.text` return it). `View<[T]>` and `DeclaredView<[T]>` render a `&Vec<T>` as well as a `&[T]`. `ViewContext { background, columns, style }` with `expand_tabs`, `plain`, `width`, `wrap`, each measuring under the destination's capabilities; `wrap` with `None` or zero columns leaves the text unwrapped. The lanes are declared views: `lanes::print()` … `lanes::trace()`, `@loomcli/core/lanes/<name>`. `Render::prepare` is hidden: it takes the call's `RenderSite` and answers the write that remains.

**Results.** `.result(ResultViews::new().view("table", v).default_view("table"))` and `.rows(RowViews::new().view("records", records(…)))`; a rows view is `RowViewEntry::Whole(View<[R]>)` or `Row(RowView<R>)`. A result type is `Serialize`, so a hook can add a machine view to any result: `AttachedCommand::views` takes an `AttachedViews` record of erased `ResultView`s (`View<serde_json::Value>` or `RowView<serde_json::Value>`, each `Into<ResultView>`) with the default inside, the same shape as `ResultViews`. `RowSource<R>` is any iterator of rows (`out.results(rows)` converts one through `From`, a `Vec` included), an iterator of `Result<R, Error>` rows through `RowSource::try_iter`, or a `Stream` of `Result<R, Error>` rows through `RowSource::stream`, where `loomcli_core::Stream` re-exports `futures_core::Stream`; an `Err` item stops the sequence; `incomplete_result()` is the declared view of the line a stopped sequence writes.

**Result transforms.** `ResultTransform::new` takes a synchronous `FnMut(T) -> Result<T, Error> + Send + 'static` for a result value or a row of type `T`. It keeps that Rust type. For a hook-added view, a typed transform runs before core serializes the result. `ResultTransform::json` takes the same form over `serde_json::Value`. It serves hook-added views and results whose value or row type is `serde_json::Value`. For a hook-added view, core serializes the value or row before the JSON transform runs. The transform may return any JSON shape. Core reports an incompatible transform when the result is emitted. The `@loomcli/core/result-transform` defect names the plugin and the Command, exits 1, and uses the generic message in a distributed build. For state that belongs to one invocation, the middleware constructs the transform inside its handler.

Core applies the transform once to a value and once to each row. A row view receives each transformed row before core requests the next one. For a whole view over rows, core collects every row before it starts transforming them. An `Err` from a transform follows the same path as an `Err` from a view, with its failure class and exit code. A stopped sequence leaves any written rows in place and omits its tail. A whole view writes only after every row transforms successfully. Without an assignment, the result reaches the view unchanged. The transform applies only to `out.results` on a Command that declares a result.

**Row cancellation.** Both a row view and a whole view check cancellation before asking for a row and again before rendering or collecting it. The process signal listener cancels the run on its own thread, so the row loop can see SIGINT at the next check even while the runtime is busy. Each delivered row also consumes Tokio cooperative budget so other runtime tasks can make progress. A row delivered during cancellation counts as yielded and stays unwritten. Core checks again once the source poll returns.

<a name="formatter-views"></a>

**Formatter views.** The `format-views` feature exports `jsonl_rows::<R>()` and `jsonl_rows_mapped::<R, M>(map)` beside the whole `jsonl()` and `jsonl_mapped(map)` views. A row view takes a mapping function over `&R` and writes one compact JSON line per row, including when a mapped row is an array. It declares `application/jsonl`, has no head or tail, and writes nothing for an empty source. The formatter appends a missing `jsonl` as a row view on a rows result and as a whole view on a value result. An author can declare their own `jsonl` to choose how it renders.

**Registry and overrides.** `override_view(key, replacement)` is one operation over `OverrideKey`: a `DeclaredView<D>` takes `View<D>`, a `DeclaredRowView<R>` takes `RowView<R>`, and `failure::<F>()` takes `FailureView<F>`. Resolution is first in wins: the application's `overrides`, then each plugin's `views` in installation order, then the declaring contributor's default; inside one contributor the first override of a key wins. A declared view is its identity and the type of the view it declares (`View<D>` or `RowView<R>`), so an override keyed by a declared view matches every declaration of that identity and type, and a bare view is never overridden. `Application::overrides` checks each key against core's own views and the overrides listed before: one identity with another view type is `two-package-copies` at the call. A result's views are reached by name and carry no identity, so no override reaches them. A plugin's `views` list holds `ViewContribution`s: its declared views and its overrides.

**Live regions.** `out.region(options) -> Region`, a `Clone` handle with `live()`, `signal() -> CancellationToken`, `closed_by() -> Option<RegionCloser>`, `on_close(FnOnce(&Region))`, `draw(&data, &view)`, `end(EndState, Option<&str>)` with `EndState::{Ended, Failed}`, and `report(ProgressReport)`. `end` resolves once the close is written and rejects with stderr's failure when stderr refused a write before it or refuses the close; a region that is not live, or already closed, resolves at once. Every open region sits at the bottom of stderr in open order; core erases the stack before every other stderr write, lane, `print` on a result Command, `out.draw`, failure report, incomplete-result line, or an `on_log` hook's record, and draws it again after, and while stdout is a second terminal stream a stdout write issued with a region open joins stderr's order and does the same, unless a sequence holds stdout's order. A region is live when stderr is a terminal and it takes input, or the run's verbosity is 0 or more and the terminal redraws in place (`TERM` is not `dumb` and `CI` is unset, empty, or `false`); a region that is not live calls no view and writes nothing. `draw` renders its view at the call with stderr's context and returns a `'static` future that writes the frame, so a frame drawn inside an `on_close` handler, which runs synchronously as the region closes, after `closed_by` is set and before the signal is cancelled, is the region's last frame without being awaited. `RegionCloser::{End, Completion, Failure, Cancellation}`: `end()`; the opener finished with the region open (the action's regions as it returns, every other once the chain has unwound); a failure about to be reported; the run's cancellation, which closes every region at once, waiting ones included, and any region opened or closed after it. An input region holds every other region's frame until it closes, and a second waits to open. `lend_terminal(work)` ends the row the last write left, holds every frame while `work` runs, then writes a line break and draws the stack below what the work wrote; a failure report and the incomplete-result line wait for every lend. Writes a caller cannot await, a region's close and a hook's record, take their place in stderr's order at their call, behind every write already waiting for stderr's turn and ahead of every later one; the next caller to take stderr's turn from a later place sends them, or a task core spawns does. The screen model is `output::screen::Screen`, the registry `output::region::Regions`.

**Progress events.** A region's reports build `ProgressEvent { id, state, label, completed, total }`: `Started` for its first report, `Updated` for each later one, and its end event as it closes (`Ended` after `end` or completion, `Failed` after `end(EndState::Failed, …)` or a failure, `Cancelled` after cancellation). `ProgressReport::new().completed(n).total(n).label(text)`; a value left unset keeps the last reported one, the label reads as plain text, and an end label replaces it on the end event alone. Each event is delivered inside the call that built it to `InvokeOptions::on_progress`; under `run()` nothing observes them, except a test's observer through the hidden `__private::observe_progress(options, observer)`.

**Logging.** `ctx.log.info(message, fields)`, with `LogFields::new().field(name, value)` (the value copied as serde's JSON at that call) or `()`. With no hook installed a call creates no event. Each event reaches every `on_log` hook, in installation order, as one `LogEvent { time, level, message, fields, application, run, path, plugin, failure, defect }` with a `LogDestination { env, home, platform, stderr }` whose `stderr` joins the run's stderr order at each write and acknowledges it at once; core writes no log record. `run` is one 32-hex-character id per run, `path` the route routing has published. Core logs one event for each failure it reports once graph build has finished, the broken-destination defect included: `fatal` with `defect` (`defect_detail`) for a declaration fault or a defect, `error` otherwise, `message` the form's. A hook's first `Err` is reported once, after every other report, as `foreign-throw`, and forces 1. The run's log is `output::RunLog`; `Plugin::on_log` installs each plugin's hook in installation order, and the hidden `__private::install_log_hook(app, hook)` installs one after them for a test. Environment preparation's additions reach every later event's `destination.env`.

## 6. Failures

**The trait.** `Failure: Debug + Send + Sync + 'static` with `class()`, `failure_class()` (`where Self: Sized`), `base()`, and `as_any()`: what identifies the class and its chain. The facts a reader reads, `message()`, `cause()`, `code()`, and `exit_code()`, are methods of `FailureFacts`, implemented once for every `F: Failure + ?Sized`, so no impl can override them: core reads both codes from `class()` alone, and one class never exits with two codes. The message and cause live on the root `LoomError` value. A failure is not a `std::error::Error`. `dyn Failure::downcast_ref::<F>()` and `is::<F>()` walk the bases, as `instanceof` walks the prototype chain.

**Classes.** A class's facts live once in a `static FailureClass` (`name`, declared `code`, declared `exit_code`, `parent`); `code()` and `exit_code()` walk to the nearest ancestor that declares one, `declared_code()` and `declared_exit_code()` read the class's own, and `extends(&class)` compares classes by address up the chain. `FailureExitCode::new(n)` and `FailureClass::new` assert their grammar in `const`, so a bad exit code or failure code is a compile error.

| Class | Parent | Failure code | Exit |
| --- | --- | --- | --- |
| `LoomError` (abstract) | none | `failure` | 1 |
| `UsageError` (abstract) | `LoomError` | `usage` | 2 |
| `InputError` | `UsageError` | `invalid-input` | 2 |
| `UnknownCommandError` | `UsageError` | `unknown-command` | 2 |
| `NonCallableCommandError` | `UsageError` | `missing-subcommand` | 2 |
| `UnexpectedArgumentError` | `UsageError` | `unexpected-argument` | 2 |
| `UnknownOptionError` | `UsageError` | `unknown-option` | 2 |
| `MissingValueError` | `UsageError` | `missing-value` | 2 |
| `UnexpectedValueError` | `UsageError` | `unexpected-value` | 2 |
| `RepeatedOptionError` | `UsageError` | `repeated-option` | 2 |
| `MisplacedOptionError` | `UsageError` | `misplaced-option` | 2 |
| `FatalError` | `LoomError` | `fatal` | 1 |
| `TerminalUnavailableError` | `FatalError` | `terminal-unavailable` | 1 |
| `WorkingDirectoryError` | `LoomError` | `working-directory-unreadable` | 1 |
| `DeclarationError` | `LoomError` | `internal` | 1 |
| `InternalError` | `LoomError` | `internal` | 1 |
| `ResultError` | `InternalError` | `internal` (inherited) | 1 |

The fifteen `sysexits.h` constants (`EX_USAGE` … `EX_CONFIG`) are `FailureExitCode` constants. `ExitCode` is what a run resolves: 0, a failure's code, or 129, 130, 131, 141, 143.

`TerminalUnavailableError::new(application, command)` takes the application name and routed path. `command()` returns that path, empty for the root. `NonCallableCommandError::new(command, candidates)` takes the same two arguments and `.argument(word)` adds the escapable spelling. `argument_word()` returns `Option<&str>`, with `None` on invocations by name. It carries the spelling used to route to a group from a parent with arguments and passthrough off on an argv run. The failure suggests placing `--` before that spelling to pass it as an argument.

**`#[derive(Failure)]`.** One `#[failure(base)]` field holds the parent class's value; `#[failure(code = "…", exit_code = …, abstract)]` on the struct. It writes the `Failure` impl with its `static` class and, unless abstract, `From<T> for loomcli_core::Error`. Generic structs are rejected. A `code` outside the failure-code grammar and an integer-literal `exit_code` outside 1 through 125 are compile errors at the literal; an `exit_code` constant such as `EX_DATAERR` is checked by `FailureExitCode::new` in `const`.

```rust
#[derive(Debug, Failure)]
#[failure(code = "path-not-found", exit_code = EX_DATAERR)]
pub struct PathNotFoundError {
    #[failure(base)]
    base: FatalError,
}
```

**`Error`.** What author code returns: a failure, or a foreign `std::error::Error` that `?` converts. A boxed `dyn Error` and an error type that is not a `std::error::Error` (`anyhow::Error`, `eyre::Report`) convert through `Error::from_foreign(e.into())`; the blanket `From` impl leaves no room for a `From<Box<dyn Error>>` impl. Accessors: `failure()`, `foreign()`, `downcast_failure::<F>()`, and `backtrace()`. A foreign error converted by `?` or `From` keeps its type's name, and every foreign error keeps the `std::backtrace::Backtrace` captured at its conversion when `RUST_BACKTRACE` or `RUST_LIB_BACKTRACE` enables capture; a development build's defect diagnostic prints both.

**Translators.** `translate(|error: serde_json::Error| Ok(InvalidJsonError::new(error)))` pairs a foreign error type with a function that takes the error by value and returns the failure or hands the error back. A translation matches a foreign error of exactly that type. Resolution: the application's list, then each plugin's in installation order; the first failure wins. Translators are synchronous. A translator answers `Ok(failure)` or hands the error back as `Err(error)`, so it cannot fail itself.

**Failure views and encoders.** `FailureView<F>::new(|failure, ctx| …)`, whose render returns `impl IntoRendered`, with `FailureViewContext { view_context, application, path, hints, invoked_by, view, media_type }`. `encode_failure(media_type, |form| …)`, also returning `impl IntoRendered`, registers a `FailureEncoding`, which a plugin lists under `failure_encoders` and whose `media_type()` reads back; it writes the form in place of the view when the selected result view declares that media type. `FailureForm { code, exit_code, message, hints }` serializes as `{"code","exitCode","message","hints"}`.

**Declaration faults and diagnostics.** `DeclarationError::new(rule, DiagnosticParts::new(sentence).finding(…).correction(…))` or `::sentence_only(sentence)`, and `.with_cause(error)` to keep the error a fault replaced. Its `message()` holds the whole Developer Diagnostic at 80 columns, `sentence()` the sentence alone, and `diagnostic(columns)` renders it at another width. `diagnostic_rule(identity, headline, explanation).docs(url)` is a `const fn`, so a rule is a constant and a bad identity a compile error. One `correction` call prints its sentence; two or more print one per line under `- `. `Finding::new(call, arguments).path(…).mark(…).note(…)` rebuilds the call in Rust builder syntax, read back through `call_name()`, `arguments()`, `command_path()`, `marked()`, and `noted()`. `Literal` holds the arguments: `"text".into()`, `'c'.into()`, numbers, `bool`, a `Vec` as a list, `Literal::Opaque` as `…`, and `Literal::builder("Opt::string()").call("short", vec!['F'.into()])` for a builder chain; a builder with no calls, `Literal::builder("Command::new(\"get\")")`, stands for a value. A mark is a dotted path: `1` an argument, `1.0` a list member inside it, `1.short` a setter of the chain there, `1.short.0` that setter's argument. `Literal` displays as the code a finding prints. Core's own rules are constants in `diagnostics::rules`, generated from the diagnostics reference with each headline and explanation, beside the corrections several sites share.

**Defects.** `InternalError::new(rule, parts, cause)`, `::without_cause(rule, parts)` for a contract core found broken itself, or `::message_only(message, cause)`; its `message()` is its sentence. It carries a rule: `foreign-throw` (an `on_failure` or `on_log` hook's `Err`, among others), `broken-failure-view` and `broken-failure-encoder` (a failure view's or encoder's `Err`, after core wrote the failure's default text through the plain fallback path), `next-misuse`, `result-contract`, `view-selection`, `source-answers`, `broken-destination`. `foreign-graph` is unreachable (section 7). A development build renders the Developer Diagnostic ahead of every override; a distributed build renders `<app>: Something went wrong.` at most once per run. A panic in author code is Rust's own report of a broken invariant: core does not catch it.

**Failure identity.** Core boxes each reported failure once and moves it no more until its report is written, so every `on_failure` hook and then the failure's view receive one `&dyn Failure` at one address. A plugin that correlates the two, as suggestions does, keys on that address within one report.

**Received input.** Core keeps the raw value outside `InputError` and `InputProblem`, including
their debug output, and out of its failure text. Core keys the raw value by the invalid problem's
address in the reported `InputError`'s problems vector, which stays stable from construction
through the report. The only public reader of that association is
`FailureHookContext::received(&self, problem: &InputProblem) -> Option<SuppliedValue>`.
It returns the value core held before validation or content preparation, from argv, an invocation
by name, the environment, or a configuration fill that validation keeps. `SuppliedValue::One`
holds a string and `SuppliedValue::Many` holds the whole collection. An issue's path identifies
its rejected element.
The reader returns `None` for missing or group problems, copies of problems, problems from another
failure, and problems with no recorded value. An author's own problem, a rejected omission, an
environment value outside its option's grammar, and an invocation by name whose input could not
lower to tokens have no recorded value.

### Rust-only rules

These rules cover declaration checks, typed reads, runtime startup, and type-erased transforms.
The deviations register records the reason for each rule.

| Identity | Raised | Replaces |
| --- | --- | --- |
| `@loomcli/core/passthrough-declared-twice` | At the second declaration | The builder type closing `passthrough()` |
| `@loomcli/core/terminal-need-declared-twice` | At the second declaration | The builder type closing `needsTerminal()` |
| `@loomcli/core/option-config` | At the declaring call | The option-config unions (`Presence`, `OptionSpelling`, marks, `GlobalOmissionConstraint`, `ListBinding`) |
| `@loomcli/core/plugin-option-name` | At the `middleware`, `short`, or `env` call | `activate: readonly (keyof Options)[]`, and the settings' typed option names |
| `@loomcli/core/input-read` | At the typed read | `Register`/`AttachmentConstraint` globals and `uses`-typed `provided` |
| `@loomcli/core/handler-registered-twice` | At a plugin's second `middleware`, `on_command_attach`, `on_graph_built`, `on_failure`, `on_log`, or `on_environment` call | The definition object's one key per hook, where a repeated key does not compile |
| `@loomcli/core/entry-point` | When `Application::main` is called inside a Tokio runtime | Rust-specific runtime startup. `Application::main` builds its own Tokio runtime. |
| `@loomcli/core/result-transform` | When emitting a result with an incompatible transform | The typed-transform deviation. Core checks the type-erased assignment against the declared value or row type. |

## 7. The command graph

An `Application` keeps up to two successful graph builds in memory. Source and development builds
share one slot, and distributed builds use the other. The two slots match when the reference runs
`on_command_attach` hooks. `run()` and `Application::invoke()` select a
slot from their captured host's release facts. `inspect()` selects its slot from the baked release
facts. Overlapping calls in the same slot share one successful build. A fault leaves the slot empty,
so the next call retries the build and calls its hooks again.

Cloning an `Application` shares its declarations and graph slots. An authoring call that changes
the declaration gives the resulting Application fresh slots. The graph owns its built declaration
and parser tables. The slots belong to the Application so the graph can outlive it through a reader's
`Arc`. Each outer run still captures and prepares its host and validates declared defaults and
implied values for that host. An action's `ctx.invoke` uses its run's graph and validated defaults.
`check()` builds and judges a fresh graph on each call, independent of the slots.

`inspect()` returns `Arc<CommandGraph>`. It shares the same allocation as the graph a run or a
named invocation uses in that slot, so readers can compare them with `Arc::ptr_eq`. Serialization
equals `JSON.stringify(app.inspect())`. A reference field that holds `undefined` is `Option`
with `skip_serializing_if`. A field that holds `null` is `Option` serialized as `null`. Keys follow
the reference's object-literal order.

| Node | Keys in order |
| --- | --- |
| `CommandGraph` | `configuration`, `description`?, `globals`, `name`, `root`, `version` |
| `CommandNode` | `optionGroups`, `passthrough`, `stdin`?, `aliases`, `arguments`, `children`, `deprecated`?, `description`?, `extensions`, `hasAction`, `hidden`, `name`, `needsTerminal`, `options`, `path`, `result` |
| `ArgumentNode` | `max`?, `min`?, `stdin`?, `type`? (content alone), `default`?, `description`?, `extensions`, `name`, `required`, `requiredWhen`, `schema`, `validateOmitted`, `validated`, `variadic` |
| `StringOptionNode` | `aliases`, `control`, `deprecated`?, `description`?, `env`, `extensions`, `hidden`, `long`, `name`, `short`, `default`?, `envDelimiter`, `implied`, `multiple`, `required`, `requiredWhen`, `schema`, `validateOmitted`, `validated`, `background`, `envAllowEmpty`, `type` |
| `ContentOptionNode` | the string node's keys through `validated`, then `max`?, `min`?, `stdin`, `type` |
| `BooleanOptionNode` | shared keys through `short`, then `color`, `interaction`, `negative`, `polarity`, `schema`, `type` |
| `CountOptionNode` | shared keys through `short`, then `quiet`, `schema`, `type`, `verbose` |
| `ResultNode` | `default`, `kind`, `mediaTypes`, `views` |
| `OptionGroup` | `kind`, `options` |
| `PassthroughNode` | `description`? |
| `StdinNode` | `description`?, `required` |
| `ConfigurationNode` | `schema` |

`?` marks a key absent when the value is absent. `OptionNode` is an untagged enum of the four option nodes, with the shared accessors `name()`, `long()`, `short()`, `hidden()`, `deprecated()`, and `extensions()`. Children, arguments, options, and globals are `Arc`s, so a context holds the routed node without copying the tree, and every node a reader receives, from a context or from `locate`, is the graph's own: a reader compares by `Arc::ptr_eq`. `extensions` and `mediaTypes` are `serde_json::Map` (insertion order, `preserve_order`). `locate(&graph, words) -> WordPosition` reads a partial invocation with the run's grammar and never fails: the words before the last go through the parser's own walk (`invocation::parse`, with routing left open where they run out at a Command with children), and an empty list reads as one empty word. Core constructs `CommandGraph` (`#[non_exhaustive]`). A clone shares the parser's tables, so `foreign-graph` is unreachable. `WordPosition::Option`'s `counts` and `booleans` are `Vec<(String, _)>` in the order the earlier words first gave each, the reference's insertion-ordered maps. `graph.command(&["cache", "clear"])` finds a node by canonical path.

`CommandNode::passthrough` is `Option<PassthroughNode>`, serialized as `null` when the mode is off. When the mode is on but the description is absent, the graph serializes an empty object and the manifest serializes an object with `description: null`. `CommandNode::needs_terminal` is `bool`. `WordPosition::Command` includes `argument: Option<Arc<ArgumentNode>>`, the graph's first argument for a word that matches no child. With passthrough off, `locate` returns an argument position for a word after `--` when a slot is available.

## 8. The plugin contract

`Plugin::new(identity)` returns `Plugin<NoOptions>`; `.options::<O>()` types it `Plugin<O>`. A plugin converts into `AnyPlugin`, which `Application::plugins` takes. A first-party factory with settings returns a settings builder (`Help`, `Format`, `Version`, …) that converts into `AnyPlugin`, so `help().command(true)` sits in the same list as `suggestions()`.

| Capability | Method | Notes |
| --- | --- | --- |
| Global options | `.options::<O: GlobalInputs>()`, `.option(name, opt)` | global options in every respect |
| Plugin settings | `.short(name, letter)`, `.env(name, variables)` | apply the application's settings to an option the plugin declared, typed or by name |
| Middleware | `.middleware(Activation, handler)` | `Activation::Always` or `Activation::options(["explain"])` |
| Commands | `.commands(list)` | attach to the root first, in installation order |
| `onCommandAttach` | `.on_command_attach(Fn(&mut AttachedCommand) -> Result<(), Error>)` | build; root first, depth first |
| `onGraphBuilt` | `.on_graph_built(Fn(&CommandGraph) -> Result<(), Error>)` | build; a `DeclarationError` rejects the graph, any other `Err` is `broken-graph-hook` |
| `onFailure` | `.on_failure(Fn(&dyn Failure, &FailureHookContext) -> impl IntoHints)` | once per rendered failure |
| `onLog` | `.on_log(Fn(&LogEvent, &LogDestination) -> impl IntoOutcome)` | once per event |
| `onEnvironment` | `.on_environment(Fn(EnvironmentContext) -> Future<Result<EnvironmentAdditions, Error>>)` | once per outer run, before validation |
| Extensions | `.extensions(list of AnyExtension)` | descriptors it defines |
| Views and overrides | `.views(list of ViewContribution)` | |
| Translators | `.translators(list)` | |
| Failure encoders | `.failure_encoders(list)` | one per media type |
| Configuration source | `.source(ConfigurationSource<O>)` | single slot |
| Theme | `.theme(ThemeMapping)` | single slot |

**Plugin settings.** A factory that lets the application choose a spelling or a binding applies it with `Plugin::short(name, letter)` or `Plugin::env(name, variables)` after the declaration, so a plugin typed by a derived options struct keeps its typed options: `Plugin::new(id).options::<ManifestOptions>().short("manifest", 'M')`. The adjusted declaration meets every rule the declaring call meets; a hook-declared option takes its setting inside the hook. A name the plugin has not declared is `plugin-option-name` at the call.

**Middleware.** `Fn(MiddlewareContext<O>, Next) -> impl Future<Output = Outcome> + Send`. `Next::run(self)` consumes the rest of the chain and resolves `ChainOutcome::{Dispatched, TakenOver, Cancelled}` or the failure the rest raised; dropping `Next` takes the invocation over. A second call does not compile. `Next::run` is live while the middleware's own future runs: a `Next` first polled after that future settled, such as one a spawned task or a shared slot kept, continues nothing and returns the `next-misuse` defect (`Plugin "…" called next() after its middleware returned.`). A `Next` a spawned task polled before the middleware returned holds the chain open until it settles, as an awaited one does. The rest of the chain runs on its own task, so dropping a `Next` future mid-flight (a timeout, a `select!` branch) never cancels the action: it runs to its end, its regions and provided values close, and the entry, once its middleware returns, reports what the rest settled with, its failure included, because no caller received it. `MiddlewareContext { options: Option<O>, own_options, spellings, graph, command, request: Option<Request>, host, out, signal, log }` with `view()`, `select_view(name)`, `option::<T>(name)`, `on_shutdown`, `on_suspend`, `on_resume`; `own_options.option::<T>(name)` reads as every by-name read does, over the plugin's own global options and the local options its `on_command_attach` hook declared on the routed Command, each absent unless a pass of the run validated it and none of its occurrences faulted; `own_options.validated(name)` says whether the record holds the option, which separates one that validated as omitted (reading its default or `None`) from one that is absent. `Spellings::get(name)` and `Spellings::iter()` read the spellings in name order. `Request { values, passthrough, stdin }` holds the routed Command's arguments and local options by name. Activation decides whether the middleware joins the chain; there is nothing to load. A `Next` a test's `middleware_context` builds resolves with the outcome the test stated instead of continuing a chain.

The chain is `invocation::chain`. A plugin's middleware joins it when its activation is `Always`, or when any option it lists is supplied after the input-source stage (a token in any spelling, a variable, or a configuration fill; a declared default never activates, nor does a configuration fill validation dropped). Entries run in installation order; the boundary past the last one raises the held fault, else resolves the view selection (`view-selection`: a name the result does not hold, or any name on a Command with no result, naming the plugin that selected it), builds the routed Command's providers, and dispatches the action. An entry reports `TakenOver` when its middleware returned without continuing, `Cancelled` in its place on a cancelled run, and, when its middleware handled the failure of `next` and returned, `Dispatched` if the action ran and `TakenOver` otherwise. Under any held fault core runs one more validation pass, for `own_options` alone, over the plugins' options whose tokens parsed, none of whose occurrences faulted, and that no earlier pass reached, including a hook's option on a group. The held fault stays the one raised. The run's view selection is `plugins::middleware::ViewSelection`, which the failure path reads for its view and media type.

**Run media type.** `MiddlewareContext::media_type() -> Option<String>` follows the selected result view's declared media type, including when a middleware changes the selected name. On a Command with no result it reads the most recent `set_media_type(&str)` assignment, or `None`. Core treats the string as opaque. A takeover can read it to choose its encoding, and the failure path reads it to choose an encoder. The dispatch boundary rejects an assignment on a Command that declares a result as `view-selection`. A held fault takes precedence, followed by an invalid view assignment, then an invalid media type assignment. A takeover can return before the boundary. An assignment after the boundary has no effect.

**Transform selection.** `MiddlewareContext::set_transform(ResultTransform)` assigns the run's transform. `transform() -> Option<ResultTransform>` returns a clone of the assigned handle, or `None`. The last assignment before the dispatch boundary wins, and an assignment after the boundary has no effect. `MiddlewareContext::invoked_by` is `InvokedBy::Argv` or `InvokedBy::Name`, so a middleware can name inputs as the operator supplied them.

**Options on groups.** A group can declare local options. Routing reads them from the same table as global options. The spelling binds at the Command where routing ends. Under the held missing-subcommand fault, a group option that a hook declared validates for that plugin's `own_options`. A group has no action or request.

<a name="formatter-options"></a>

**Formatter options.** The formatter adds the control options `--format` and `--fields` to every Command that declares a result, and adds both as hidden options on groups. A group's `--format` accepts `json` and `jsonl`, with `ndjson` as an alias of `jsonl`, and sets the run's media type. Its `--fields` is parsed and validated for the formatter's own options. The group has no result to transform.

On a result Command the formatter records the views it appended in the `@loomcli/plugins/format/provided-views` Command extension. For a valid request, `--fields` sets a JSON transform when one of those views is selected. The formatter raises a refusal as an `InputError` with exit 2 before it calls `next.run()`. A help middleware installed after the formatter therefore has no chance to take over the refusal. The refusal names the available formatter views and options. When the author declared both JSON views, the refusal says the formatter provides none. With a held fault, the formatter leaves the fault to the boundary. A refusal for an invocation by name uses `fields` and `format` in place of their CLI spellings.

`--fields` is repeatable and each occurrence takes a comma list of literal top-level keys. An empty key is invalid. The transform keeps the named keys in request order, using the first occurrence of a repeated name and omitting keys absent from an individual object. It checks keys against the whole object, the union of keys in an array of objects, or the first row of a rows result. An empty collection stays empty. An unknown key or a value that should be an object but is another kind fails with an input error when the result is emitted. A sequence that stops after writing JSON Lines keeps those lines on stdout. When the failure encoder handles the error, its line replaces the incomplete-result line on stderr.

**Hooks.** `AttachedCommand` exposes the facts (`name`, `path`, `has_action`, `arguments`, `options`, `result`, and `extensions()`, the record `inspect()` would publish at that hook, which `read_extension(&*command, &DESCRIPTOR)` reads typed) and the reference's seven dynamic calls, `argument`, `option`, `exclusive`, `one_required`, `required_together` (each `&[&str]` of declared names), `views(AttachedViews)`, and `extend`, each `&mut self -> Result<&mut Self, DeclarationError>`. A group call meets `option-group` at the call against the local options the Command declares at that point, the author's and every hook's so far, and its group joins the Command's groups, which `inspect()` publishes and validation judges. A call meets every declaration rule at the call; one that faults returns its `DeclarationError` and changes nothing, so `?` chains the calls, and a hook that handles the error continues without that declaration, the reference's catch-and-continue. The hook returns `Result<(), Error>`: a `DeclarationError` reports as itself, any other `Err` is `broken-attach-hook` naming the plugin and the Command, both build faults with exit 1 and the generic message in a distributed build. Calls are exempt from the author's authoring order. A hook edits the Command in place, so what a call added stays whether or not the hook later fails, and a descriptor a call admits joins the build's one registry at the call: a second descriptor under one identity is `two-package-copies` at the `extend` that carries it. Once every hook has run over a Command, core judges what the hooks declared, root first and depth first, before the Command's own table compiles: each hook-declared input against an earlier hook's input, a local option, a global or plugin option, then an argument (`option-declared-twice`, `argument-declared-twice`, `name-shared-across-kinds`), each spelling against every spelling the scope holds (`spelling-taken`), then one stdin target, the argument order, arguments beside children, and each variable once (`inspection::attach`). `on_graph_built` hooks receive the graph a run's action reads, at one address; the first fault ends `inspect()` and a run, and `check()` collects every hook's. `FailureHookContext { application, path, invoked_by, view, media_type, style, graph, command, log }`. A failure hook returns `impl IntoHints`: `()`, `Option<String>`, `String`, `Vec<String>`, `Hints`, or a `Result` of one; an `Err` ends the hooks for that failure and reports as `foreign-throw` after core writes the failure's default text. `EnvironmentContext { cwd, env, log }` with `warn()`. The hooks run in installation order after graph build and verbosity, before the declared values validate, with the cancellation checked before each hook and after its answer; a variable the environment defines, an empty one included, wins, the first hook that fills a missing one wins, and on an argv run each accepted addition passes to the handle's `publish_env` before the next hook runs; an invocation by name publishes nothing. Output and the log read the merged environment from each merge on, and the run's later steps read a host with it. A hook's failure class keeps its class; any other error is `foreign-throw`, which no translator is offered.

**Extensions.** A descriptor is a constant: `pub const EXPLAIN_COMMAND: Extension<CommandTarget, ExplainFacts> = Extension::new("@loom/explain/command");`, or `Extension::collecting(id)` for one that collects from every layer, whose type names `Collecting` as its third parameter (`pub const TAGS: Extension<CommandTarget, String, Collecting> = Extension::collecting("@acme/tagger/tags");`; the parameter defaults to `Single`), with `.check(fn)` for value rules. `new` and `collecting` bound `V: Serialize + DeserializeOwned`, the schema, so a value is plain data by type and a descriptor that cannot be read back does not compile. `DESCRIPTOR.value(v)` makes an `ExtensionValue<T>` and records the rules' verdict; the `extend()` that carries it reports a rejection, the author's as a call fault and a hook's as its returned error. `read_extension(&node, &DESCRIPTOR)` (with `V: DeserializeOwned + 'static`, whose `TypeId` identifies the descriptor) returns `Result<Option<V>, Error>`, or `Result<Vec<V>, Error>` author first for a collecting one; a value another descriptor under the same identity stored, or one `V` does not deserialize, is a `DeclarationError` on the ordinary failure path (exit 1, the generic message in a distributed build). Targets are `CommandTarget` (`CommandNode`, `Arc<CommandNode>`, `AttachedCommand`), `OptionTarget` (`OptionNode`, `Arc<OptionNode>`), and `ArgumentTarget` (`ArgumentNode`, `Arc<ArgumentNode>`). A descriptor is its identity, its target, whether it collects, and its value type: two descriptors that share an identity and differ in any of the rest are `two-package-copies` where both first reach one declaration or one Application, and a read through one of a value the other stored returns that fault.

**Providers.** `Provider::new(name, opener)` is ephemeral and `Provider::persistent(name, opener)` persistent: the lifetime is the type parameter `L` of `Provider<V, L = Ephemeral>`. `.uses(list)` on a persistent provider takes `PersistentProvider`s alone, so the reference's "a persistent provider may not use an ephemeral one" is a compile error. `.close(close)` takes `Fn(Arc<V>) -> Future<Result<(), Error>>`. The opener is `Fn(ProviderContext) -> Future<Result<V, Error>>`. A Command opts in with `.uses([&provider])`; the action reads `ctx.provided(&provider)`. `AnyProvider` carries the erased provider whole (opener, close, uses, lifetime), so core builds from the opt-in list alone.

- **Identity.** A provider is identified by its name, `TypeId` of `V`, and `TypeId` of its opener. The way to share one is a factory function, `pub fn acme_pool() -> Provider<Pool, Persistent>`: every call returns an opener of one closure type, so `.uses([&acme_pool()])` and `ctx.provided(&acme_pool())` name one provider, built once however often it is reached. An opener reads its settings from the global options on its context and captures none, because captured data is not part of the identity. Two providers with one name and another value type or opener are `provider-name-taken` at the `uses` call.
- **Lifetimes and closing.** Core builds opted-in values at the dispatch boundary, ephemeral per run and persistent per outermost run. When the action settles it closes the action's open regions, then the run's ephemeral values, then, on the outermost run, the persistent ones, each lifetime in reverse build order, before the chain unwinds. Every value still closes when one close fails. On a run that had otherwise succeeded, the first `Err` fails the run through the ordinary failure path and resolves the `next.run()` that reached the boundary with it; a later one, or one on a run that already failed or was cancelled, is an `error` log event, `A provider's close failed.`, with `error` and `provider` fields.
- **Reading.** `ctx.provided(&p)` reads a provider the routed Command's `uses` lists, and `ProviderContext::provided(&p)` one the provider's own `uses` lists; any other is `input-read` (`The action read provider "pool", which its uses does not list.`). A value whose provider declares no `close` is dropped when the run lets go of it. The persistent values of one outermost run build one at a time, so two runs that first need one value build it once.
- **The close log event.** Its `error` field is `{ "message", "name" }`: the failure's message and class name, or a foreign error's text and type name (`Error` for one boxed through `Error::from_foreign`).
- **Testing.** The reference substitutes an opener through module mocking, which Rust has no counterpart for. `RunOptions::substitute(&provider, opener)` builds that provider's value with a test's opener for every run inside the one it starts; `loomcli_testing::ActionValues::provide` supplies a value to an extracted handler, as `actionContext` does.
- **Context.** `ProviderContext { options, host, out, style, graph, log, signal, invoked_by }` with `globals::<G>()`, `provided(&p)`, `on_shutdown`.

**Run identity.** Core holds one `Arc<Host>` per run and hands that same `Arc` to the run's configuration source, providers, middleware, and action, so a source and a provider that share one lookup per run, as the configuration plugin's do, key it with `Arc::ptr_eq`.

**Composition.** Installation order is precedence for every contribution: options, middleware, hooks, views, translators, encoders. Each plugin call judges its own contribution and panics at the author's line; `Application::plugins` judges the installed list: an identity installed twice, a second theme or source claim, two descriptors under one identity, two encoders for one media type, two view types under one identity, then each plugin's options joining the global table after the application's (`option-declared-twice`, `spelling-taken`, one option per mark, `variable-bound-twice`, each sentence naming the plugin first), then each plugin's Commands attaching to the root ahead of the application's. A later `global_option` and `command` meet the plugins' options as they meet the application's. A plugin's option finding prints `Plugin::new("@acme/log").option(…)`. The faults are in [section 1](#where-each-authoring-rule-is-enforced).

**The theme slot.** `Plugin::theme(mapping)` builds the theme at the claim and panics with the style error for a chain that names a token. A run resolves the installed theme's palette on the settled background, before graph build, so a build fault's report reads it, and an adaptive entry turns background detection on.

## 9. The run lifecycle

The order is the reference's (`invocation.md`, steps 1 to 9; `providers.md`, Closing).

1. **Host capture.** `run` reads the process handle (`RunOptions::process`, else `process_handle(ProcessFields::new())`): argv, program, cwd and ceiling (a read failure becomes `WorkingDirectoryError`), env, home, tmpdir, platform, arch, libc, uid, time zone, release facts, terminal facts. Malformed release facts are a build failure in Rust, so none reach here.
2. **Color settles** from `host.argv` in an Application that declares the color mark, which sets the run's color policy before anything else prints.
3. **Background settles** from `host.argv` in an Application that declares the background mark, else from the bounded terminal query (one second, raw mode through the handle's stdin) when no skip applies. The query is `host::ask_terminal(&host, QueryRun { cancel, on_shutdown, signal })`, crate-private: it ends at the DA1 reply, an interrupt key, the deadline, the run's cancellation, or the end of stdin, restores the raw mode it found, pushes every byte that is not a reply back with `InputStream::unshift`, and raises each interrupt key through `raise_interrupt_keys`.
4. **Signals.** Core subscribes to ending signals and suspend/resume on the handle's `SignalSource`, and composes the caller's token into the run signal.
5. **Graph build or reuse.** Core uses the graph kept for the run's build. If the Application has yet to keep one, core builds tables, runs every `on_command_attach` (root first, depth first), applies the hook-collision rules, and runs every `on_graph_built`. A build fault renders by build, under the settled color, and exits 1.
6. **Verbosity settles** from `host.argv`, read with the parser's own word reader against the built graph, before anything that can write a lane.
7. **Environment preparation.** Each `on_environment` hook, in installation order, for an outer run alone; additions merge into `host.env` and, on an argv run, pass to `publish_env`.
8. **Defaults.** Core validates every declared default and implied value against the prepared environment (`invalid-default`, `invalid-implied`), so an `on_environment` failure outranks an invalid default.
9. **Routing.** Before `--`, a word that is a value for an option being read fills that option. An exact child name or alias descends to that child. A plain word matching no child becomes the first positional word when the Command declares arguments. For a Command with children and no arguments, an unmatched plain word raises the unknown-command failure. The first positional word and the first bare `--` each end routing.
10. **Parsing.** The routed Command's words against its one table; every other fault is held.
11. **Input sources.** Environment, then the configuration source's resolver, then defaults; option groups withdraw lower tiers.
12. **Interaction settles** from the terminal facts, `CI`, and the marked option's value.
13. **Validation.** Globals then locals, in authoring order. Plugins' own options validate under any held fault for `own_options`. When a Command needs a terminal and the run has none, core holds `TerminalUnavailableError` for the dispatch boundary so middleware takeovers still answer. It outranks collected input problems. Structural faults, configuration-source failures, and validator defects outrank it.
14. **Activation** of each plugin's middleware from which tier supplied its options.
15. **The chain.** Each activated middleware, in installation order.
16. **The dispatch boundary.** Core fixes the run's view, media type, and result transform. It raises any held fault, then checks the view and media type assignments (`view-selection`), builds the opted-in providers, extracts `I`, and calls the action.
17. **The action settles.** Core closes every live region the action left open (`completion`, or `failure` when it failed), then the run's ephemeral provided values, then, on the outermost run, the persistent ones, each lifetime in reverse build order. A close's `Err` follows the rule in [section 8](#8-the-plugin-contract).
18. **Unwind.** `next.run().await` resolves in each middleware, so its code after the call runs in reverse order, after every value of the run has closed. Then core closes every region still open (one a middleware or a source opened), removes the run's `on_shutdown` handlers while no shutdown is under way, and finishes pending core output.
19. **The failure path.** Every open region closes with `failure`, and the report waits for every lend of the terminal. A foreign error, unless it is the cancellation echo, is offered to the translators, the application's and then each plugin's; each `on_failure` hook adds hints once graph build has finished, and a hook's `Err` ends the hooks; the failure logs its event to `on_log` with those hints; then the encoder of the media type the run's selection declares writes the form, else a development build writes an author fault's Developer Diagnostic with the hints, else the view registry resolves the failure: at each contributor, the application's overrides and then each plugin's, an override of the failure's class and then of each class it extends, most derived first, else core's default text with the hints under it. Until graph build succeeds the registry holds the application's overrides alone, so a build fault never reaches a plugin's. The failure path reads the routed Command's selected result view and its media type, or the assigned media type alone on a Command with no result. A broken view, encoder, or hook leaves core's default text for the failure, without hints, and the broken contract's report (its Developer Diagnostic after a blank line, or the generic message at most once per run) to the plain fallback path, and forces 1. A hook's first `Err` is reported last, and every region still open closes before the run returns.
20. **Exit code.** Cancellation outranks a failure's code; a broken view, hook, encoder, or destination forces 1. Core ends its listening, calls `set_exit_code` on the handle, and returns the `ExitCode`. After a shutdown, core re-raises the ending signal on the handle's `SignalSource` so the default disposition ends the process with the shell's status, as the reference does; a mock records it as `ended_by`. Core never calls `std::process::exit`.

`run` follows these steps in `invocation::run`, one function per step: host capture, the color choice and the background (`marks::color_choice`, `marks::background_choice`, and `settle_background`, which asks the terminal only when the Application declares the background mark), the run's `output::emit::Output` over both destinations, graph build, the verbosity (`marks::verbosity`, read with `invocation::parse::read_words` in its partial mode), the declared values (`inputs::declared`, every default and implied value through its validator in the default phase, globals first and then each Command depth first), routing and parsing (`invocation::parse`, which raises only an unknown Command and holds the first other structural fault in word order), the dispatch preparation (`invocation::prepare`: the input-source stage of `inputs::sources`, the interaction decision, and the validation pass of `inputs::pass`, which ranks the held fault, then a group's missing subcommand, then a source's fault, then the `InputError`), the chain (`invocation::chain`: activation, each middleware in installation order, and the dispatch boundary, which raises the held fault, resolves the view selection, builds the providers through `plugins::provided`, calls the action with its context, calls no action on a run already cancelled, fails with `ResultError` of kind `Missing` when the action of a Command that declares a result returns without emitting it, then closes the action's regions and its provided values), and the failure path (`settle`: every open region closed with `Failure`, the held incomplete-result lines once every lend has settled, the failure's report and its log event unless a destination failed or the failure is the echo of a cancelled run, a hook's first `Err` reported last with exit 1, a broken destination's report through the plain fallback path with exit 1 and its log event, every region still open closed, and the signal's code over every other on a cancelled run whose graph build, with its declared values, finished; a cancelled run that fails before then resolves that failure's own code and reports it). While the run's work runs, `closing_on_cancellation` closes every open region with `Cancellation` as the run's signal is cancelled. The caller's `RunOptions::signal` is the parent of the run's token, so its cancellation reads as `Caller`, and the first cause fixes the reason. An invocation by name reads its values through `InvocationValues`' lowering (`invocation::lower`) into the parser's result, with each unlowerable value an `invalid` problem. A step a later stage owns sits between them where this list places it. The parser reads each Command's one table: the global options' spellings beside its own, built with the graph and shared by every clone of it, so a context's `command` and `locate`'s nodes are the graph's own `Arc`s. `ctx.supplied` holds the raw value every tier supplied, by declared name, taken after the input-source stage, so it keeps a configuration fill its validator later drops and leaves out the members an exclusive group withdrew (section 4).

Entry points: `run(RunOptions) -> BoxFuture<'static, ExitCode>`, which enters its handle's signal lane at the call; `main() -> std::process::ExitCode` (a current-thread runtime over `run`, then the real process's exit listeners with the code; inside a runtime, the `entry-point` panic); `main_async()` (the same inside the caller's runtime, entering the lane at the call); `invoke(path, values, options, process) -> InvocationOutcome<M>` (the same order with named values in place of steps 9–10, output captured as plain text, no signals claimed, no exit code written); `inspect() -> Result<Arc<CommandGraph>, DeclarationError>` (step 5, with baked release facts); `check() -> Vec<DeclarationError>` (a fresh build that returns its first build fault or collects all `on_graph_built` faults if the build succeeds). `ctx.invoke` reuses the run's graph, host, and preparation. `run()` and `invoke()` share one run body (`invocation::run::execute`) behind a door that states what differs: the host (the handle's capture, or capture sinks with no argv, an empty stdin, and no terminal), the policy (the declared one with the operator's choice, or its plain form), the read (argv parsing, or `invocation::lower` with `marks::named_verbosity`), whether a failure passes the encoding stage (`run()` alone), the log destination (the run's, an action's run's, or one with no stderr), and the bound graph an action's call reuses (`CallScope`: graph, declared values, host, lane, signal, destination, and the outermost run's persistent values). A call's signal is `RunSignal::nested(run_signal, caller)`, cancelled with its run and reading its reason, and cancelled with `Caller` by its own `InvokeOptions::signal`, which every read of the call's signal consults for the whole call, its failure path included, so a caller's cancellation that lands while core reports a failure still decides the code, as a parent token's does for `app.invoke` and `run()`. The run's `RunEnd` is `Cancelled(code)`, `Completed`, or `Failed { exit_code, failure, form, path }`: the failure that set the code, with the form its report built.

## 10. The host

`ProcessHandle` is a dyn-compatible trait: everything a run reads from or writes to the process, injectable for tests.

| Method | Reference member |
| --- | --- |
| `argv()`, `program()`, `env()` | `argv`, `program`, `env` |
| `cwd() -> io::Result<PathBuf>` | `cwd()` |
| `ceiling() -> io::Result<Option<PathBuf>>` | `ceiling` |
| `home()`, `tmpdir()`, `platform()`, `arch()`, `libc()`, `uid()`, `time_zone()` | same |
| `release_for(application, &DirectoryFacts) -> ReleaseFacts` | the capture's `handleRelease`: `release()` with the installation the record holds, which only the real handle given no `release` reads |
| `release() -> ReleaseFacts` | `release` |
| `read_source(path, cwd)` | `readSource` |
| `stdin() -> Arc<dyn InputStream>`, `stdout()`, `stderr() -> Arc<dyn OutputStream>` | `stdin`, `stdout`, `stderr`; `InputStream::set_raw_mode(on)` and `is_raw()` are `setRawMode` and `isRaw`; `InputStream::in_background_job()` is the background query's foreground check, which only the real terminal stdin answers `true`; `InputStream::unshift(bytes)` is `unshift`, which the query uses to push keys typed during its wait back onto stdin, and which a stream with no raw mode may leave as the default that drops them |
| `terminal() -> Arc<dyn ProcessTerminal>` | `terminal` (widths read live) |
| `signals() -> Arc<dyn SignalSource>` | `signals` |
| `spawn(SpawnRequest) -> Child` | `spawn`; the handle wraps its own `ChildProcess` in `Child::new` |
| `set_exit_code(ExitCode)` | `exitCode`, the one member core writes; the real handle's writes nothing, and `main` returns the `ExitCode` `run` resolves |
| `publish_env(name, value)` | `publishEnv` |

`process_handle(ProcessFields::new().argv(…).stdout(…))` is the real process with fields replaced, and the one place core reads `std::env`, the real streams, real signals, and termios. `ProcessFields` replaces every member the reference's `ProcessFields` does: argv, program, env, cwd (`cwd(path)`, or `cwd_with(read)` for the reference's `cwd` function), ceiling, home, tmpdir, platform, arch, libc, uid, time zone, `read_source`, the three streams, the terminal facts, and release. Each fact not given reads the process when asked: `program` is the running executable, `libc` is the C library the binary was compiled against, the time zone is the IANA zone `TZ` names in the time zone database (an empty or unknown `TZ` reads `UTC`) else the system's, and the user database home is the one `/etc/passwd` lists. A handle implementor builds the facts it reports with `InputTerminal::new`, `OutputTerminal::new`, and `ChildOutput::new`, reads a request through `SpawnRequest`'s fields and `SpawnOptions`' accessors (`stdout_stream`, `stderr_stream`, `cancellation`, `stdin_input`, `inherits_stdin`), and answers `spawn` with a type of its own that implements `ChildProcess { exited(), kill(signal), abandon() }`, or `Child::unstarted(error)`. `SpawnRequest::attached` and `SpawnRequest::detached` build a request, as a test that calls a handle's `spawn` directly does.

**Raw mode.** Every raw-mode switch, in core's background query, in a question of `loomcli-prompts`, and in the resume after Ctrl-Z, goes through `InputStream::set_raw_mode` on the run's stdin or the signal source's terminal. A stream with no raw mode answers `Unsupported`, which skips the background query and fails a question. The real handle switches termios through `rustix` to libuv's raw mode, the one Node's terminal stream sets (output translation kept), and restores the settings it found; the mock keyboard hands over its next `keys` entry at the first read after each switch. The real stdin is read by one thread that reads descriptor 0 only when a read asks, so a child that inherits stdin sees every key no reader asked for.

**Ceiling.** `ProcessHandle::ceiling()` defaults to `Ok(None)`, including on the real handle without
a `ProcessFields::ceiling(path)` override. After reading the working directory successfully, core
reads the ceiling once and copies it into `Host::ceiling: Option<PathBuf>`. Either read can fail
the capture with `WorkingDirectoryError`. An action's invocation by name inherits the captured
ceiling. `MockFields::ceiling(path)` supplies a ceiling explicitly. Otherwise the mock uses its
working directory, calling the `cwd_with` function again if present.

The configuration plugin compares directories lexically. Rust deliberately resolves a relative
ceiling against the captured working directory so the walk depends on the process handle's facts.
When the start is at or inside home, the walk excludes the home directory even if it is also the
ceiling. A project walk starting at or inside the ceiling can otherwise look in the ceiling itself.
The walk stops at the ceiling, the filesystem root, or after looking in a directory with a root
marker, whichever comes first. A start above the ceiling skips the project walk. A start elsewhere
outside the ceiling is the only directory the walk checks, subject to the home rule. The user
scope and files named explicitly by `--config` or the configuration variable follow their own
lookup rules.

`loomcli-testing::mock_process(MockFields)` is the mock: the reference's fixed facts (cwd `/loom-test`, home `/loom-test/home`, tmpdir `/loom-test/tmp`, uid 1000, and the rest of its table), recording streams with an ordered `transcript()`, `stdout_text()`, `stderr_text()`, `end_output()` for a stream's end, `exit_code()`, `ended_by()` for the ending signal raised while nothing listened, `listeners(SignalEvent)` for how many listeners its signal source holds (the reference's tests count them with a spy), `is_raw()`, `resize(columns, rows)`, and `calls()`. `MockFields::terminal(MockTerminal::new(columns, rows).streams([StreamName::Stderr]).background(…).keys([…]))` puts streams on a terminal and stdin on its keyboard, whose `KeyEntry` is one read or `KeyEntry::reads([…])`; `MockFields::script(command, |call| async { Ok(ProgramAnswer::new()…) })` is a `programs` entry, run behind the mock's own `ChildProcess`, and `program([…])` sets the program words. The file system stays outside the handle, as the reference leaves it, so the mock serves no files: a test writes them under a temporary directory and points `cwd` there.

`Host` is what a run captured: `argv`, `program`, `cwd`, `ceiling`, `env`, `home`, `tmpdir`, `platform`, `arch`, `libc`, `uid`, `time_zone`, `release`, `terminal: HostTerminal` (`background`, live `stdout()`/`stderr()` facts), with `spawn(command, args, SpawnOptions)`, `spawn_detached(…)`, `raise(InterruptSignal)`, `read_source`, and the run's streams `stdin()`, `stdout()`, `stderr()`. Under `invoke` the output streams are the capture sinks. A protocol server, such as the MCP plugin's `mcp` action, writes its messages to `host.stdout()`, past the lane views; a write the closed pipe refuses follows the closed-pipe rule below. `ChildStream::Inherit` is the run's own `host.stdout()` or `host.stderr()`. `SpawnOptions` sets `cwd`, `env`, `stdout`/`stderr` (`ChildStream::{Capture, Ignore, Inherit, Stream}`), `signal`, `input` or `inherit_stdin`; `.detached()`, or `DetachedSpawnOptions::new()`, gives `DetachedSpawnOptions`, which takes only `cwd` and `env`. `DirectoryFacts::from(&host)` is the run's `env`, `home`, and `platform` for `application_directory`. `Child::exited().await` returns a `ChildExit` of kind `Exited`, `Unstarted`, or `Abandoned`. `Child::kill(KillSignal)` forwards a signal to the child. `raise_interrupt_keys(&host, cancel, text)` serves raw-mode readers.

**Abandoning a child.** `Child::abandon(&self)` tells the process handle that the caller has stopped
waiting. It gives every current and later `exited()` waiter the same settled answer without waiting
for the process or its streams. `ChildExit::Abandoned { stdout, stderr }` holds the output captured
so far, with empty output for non-captured streams. If the process has already reported its status
and its pipes are still open, the answer is `ChildExit::Exited` with that status and the output
captured so far. Once settled, the answer is final. Repeated calls preserve it, including on a
child that never started. A custom `ChildProcess` must implement `abandon(&self)` and settle every
current and later `exited()` waiter exactly once. The first answer wins.

Abandoning stops forwarding output and closes any stdin pipe Loom opened, leaving the source
stream open. The runtime drains and discards remaining piped output while it runs, including
output from descendants that still hold the pipes. Directly inherited descriptors stay with the
child. A mock discards a script's answer after abandonment, so its abandoned exit has empty
output. `kill` and the spawn's cancellation signal can still signal a live child after abandonment.
Abandonment itself sends no signal. Dropping a `Child` or an `exited()` future lets the child and
its stream tasks finish normally while the runtime is active.

**Signals and shutdown.** The first cause fixes `CancellationReason { source, cause }`: `Signal(EndingSignal)`, `Caller`, `Action`, `ClosedPipe`. An ending signal starts a shutdown bounded by the budget (500 ms unless set); `on_shutdown` handlers are synchronous and run at its end even when the budget runs out, and then core re-raises the signal so the process dies by it. The handlers and listeners live in one lane per signal source (`signals::lane`, the reference's `signal-lane.ts`), found by the source's address: `lane_of(source)`. The lane holds its source, so a run's listeners go and its re-raise reaches the source even when `ProcessHandle::signals` answered a new `Arc` the handle keeps no hold of; such a handle gives each run a lane of its own. A run enters its lane with a `LaneRun { cancel, flush, listens, timeout }` and holds a `Place`, through which its contexts' handlers register (`RunState::on_shutdown`, `on_suspend`, `on_resume`, each logging a panic naming its plugin) and which it leaves as it resolves, its status written first. The lane listens for the ending signals and the exit event while a run that listens is live or a handler that listens is registered, and for `SIGTSTP` and `SIGCONT` while a suspend or resume handler is; it never holds its lock while it calls out. A shutdown cancels every live run, fixes its budget as the longest timeout among them (none for `SIGQUIT`), and ends at the first of the last run leaving, a timer thread at the budget, or a second ending signal: each run's `flush` writes its queued region frames and shows the cursor (`Output::flush_terminal`), the pending handlers run newest first, the listeners go, and the signal is raised on the source. A run's abort runs its `RunSignal::on_abort` listeners synchronously, which close its regions with `Cancellation`, so a region's close handler draws the cancelled line as the shutdown begins. While a live region is open the run's output holds a suspend handler that writes the queued frames, the erase, and the cursor straight to the terminal (`Output::flush_composed`, through `support::poll_once`), and a resume handler that queues the redraw. `Registration` holds its remover; `remove()` unregisters, and dropping it keeps the handler. The real handle's signal source registers a signal's handler with `signal-hook` the first time a listener listens for it and keeps it registered, because `signal-hook` cannot give a signal back its default disposition; the handler wakes a thread of the signal's own, which calls the listeners outside the handler. A signal that arrives while nothing listens for it, from the terminal, another process, or the source's own `raise`, takes its default action there through `signal_hook::low_level::emulate_default_handler`: `SIGINT`, `SIGTERM`, or `SIGHUP` kills the process, and `SIGTSTP` stops it, which `tokio::signal`'s handlers, with no default fallback, would prevent. A Rust process has no exit event, so core's `main` and `main_async` call the real source's `exit` listeners as the run returns; a program that awaits `run` itself calls none. `on_shutdown`, `on_suspend`, `on_resume` are also free functions for a library without a context. **Closed pipe:** a stdout write that fails with `BrokenPipe` cancels the run with `ClosedPipe`, writes no report, and exits 141. **Exit codes:** 0, 1–125 from the failure's class, 129/130/131/143 for the signal, 141 for a closed pipe.

## 11. Release facts and build kinds

`ReleaseFacts { build: Build, release: Option<Release>, installation: Option<Installation> }`; `Build::{Source, Development, Distributed}`; `is_development()` is `Source` or `Development`.

- `cargo loom build`, whose toolchain is not in this tree, runs `cargo build` with `LOOM_RELEASE` set to one line of JSON, the reference's shape for a compiled target: `{"build":"distributed","compiled":true}`, and with `--release` `{"build":"distributed","compiled":true,"release":{"asset":…,"repository":…,"version":…}}`. `--development` bakes `{"build":"development","compiled":true}`. Core accepts a Boolean `compiled` and otherwise ignores it, derives the channel from the version and ignores a baked one, as it ignores every member it does not know.
- `loomcli-core`'s `build.rs` declares `rerun-if-env-changed=LOOM_RELEASE`, validates the value with the reader in `shipping/baked.rs`, and bakes its known members as `LOOM_RELEASE_BUILD`, `LOOM_RELEASE_VERSION`, `LOOM_RELEASE_REPOSITORY`, and `LOOM_RELEASE_ASSET` (hexadecimal UTF-8); malformed facts fail the build with the sentence that names the member at fault, such as `The release facts baked into LOOM_RELEASE hold build "staging".` An application needs no build script.
- A build without the variable, `cargo build` and `cargo run` included, is a `source` build.
- `ReleaseFacts::baked()` reads the baked value; the real handle reports it; a test supplies facts through `MockFields::release`.
- `installation` is read from the installation record at `application_directory(ApplicationDirectory::Installation, name, &DirectoryFacts)`, through `ProcessHandle::release_for` during host capture, only by the real handle given no `release` and only for a release with an asset, and kept only when the recorded path and the running executable resolve to one path.
- `Release` and `Installation` serialize their members in the order the reference's frozen facts hold them (`asset`, `repository`, `channel`, `version`; `digest`, `method`, `path`), so an action that prints `host.release` as JSON writes the reference's bytes.

## 12. Crates, modules, features, dependencies

| Crate | Modules |
| --- | --- |
| `loomcli-core` | `application`, `commands` (`state`), `inputs` (`options`, `arguments`, `content`, `typed`, `validation`, `interaction`), `marks`, `invocation`, `inspection`, `plugins` (`plugin`, `middleware`, `hooks`, `extension`, `provider`, `source`), `failures` (`class`, `error`, `builtin`, `form`, `translators`), `diagnostics` (`rules`), `output` (`out`, `view`, `results`, `region`, `screen`, `progress`, `log`), `style` (the `loomcli-style` re-export), `host`, `signals`, `shipping`, `support`, `__private` (derive and testing support, hidden). The crate root re-exports every public name, as the reference's one barrel does. |
| `loomcli-derive` | `inputs`, `failure` |
| `loomcli-validators` | one module per factory family (`text`, `numbers`, `strings`, `temporal`, `sizes`, `network`, `path`), the grammars they share (`calendar`, `layout`, `span`, `address`, `uri`), `codes` (the catalog's issue codes and their parameter records), `custom` (`create_validator`), `issues` (`issue_code`), `pipe` |
| `loomcli-plugins` | one module per plugin; see the feature map |
| `loomcli-prompts` | `questions` (`text`, `secret`, `editor`, `confirm`, `select`, `select_as`, `multiselect`, `multiselect_as`; each begins at its call and returns its future), `progress` (`progress` over an action's or a middleware's context, `progress_style(ProgressStyleSettings)`), `views`, and `reader`, `link`, `list`, `editor` behind them |
| `loomcli-testing` | `assert_assembles`, `assert_described`, `mock` (`mock_process`, `MockFields`, `MockTerminal`, `KeyEntry`, `StreamName`, `MockProcess`, `ProgramCall`, `ProgramAnswer`, `Program`, `Write`), `contexts` (`action_context`, `middleware_context`, `failure_hook_context`, `provider_context`, `environment_context`, `view_context`), `log_event`, `log_destination`, `progress_event`, `key` |
| `loomcli-style` | the style module: marked strings, rendering, color depth, glyphs, width, wrap, pad, and themes; see its crate rustdoc |
| `loomcli-mcp` | the MCP server over stdio: framing, protocol revisions, and tool dispatch through a `ToolSource`; see its crate rustdoc |
| `examples/*` | `jsonkit` and `textstat`, applications, and `explain` and `doctor`, plugin crates, each ported declaration for declaration from the reference's examples |

**The style re-export.** `loomcli_core::style` re-exports `loomcli-style` whole, and the crate root re-exports `style`, `width`, `pad`, `nowrap`, `escape`, `adaptive`, `Glyph`, `Style`, `Switch`, `RenderingPolicy`, `BackgroundPolicy`, `TerminalControls`, `ColorChoice`, and the theme types. `ContextualStyle` is `Style`, the chain a context hands out (`ctx.style.escape(text)`, `ctx.style.token(name).apply(text)`); the reference types its token names, which Rust cannot, and a name no theme declares stays literal when it resolves, as the reference's does at run time. `marks::Background` is `loomcli-style`'s `Background`, and `escape_control_characters` and `split_lines` in `support` are its functions.

**The testing crate.** `loomcli-testing` holds what an author's tests call. `assert_assembles(&app)` panics with `The application does not assemble: N faults.` and each `check()` fault's Developer Diagnostic after a blank line. `assert_described(&app)` panics naming each declaration of the built graph with no description, the Application, each global option, and each Command with its options, arguments, and stdin, depth first, as `Option "force" of Command "remote add" has no description.`, above one correction sentence. `mock_process(fields)` is the sealed process handle of section 10.

The context builders return the core type one author function receives. They use the hidden
`__private::unit` seam and need no Application or run.

| Builder | Values | Notes |
| --- | --- | --- |
| `action_context::<I, R: UnitResult>(ActionValues::new(inputs))` | `.globals(g)`, `.passthrough(words)`, `.interactive()`, `.process(handle)`, `.graph(graph)`, `.command(path)`, `.provide(&provider, value)`, `.on_log(hook)` | `ctx.inputs` is the inputs read back through `extract(&into_values())`, which `ctx.argument` and `ctx.option` read. The typed inputs supply the tail, with an empty vector by default. The fixture’s `.passthrough(words)` overrides the tail for both the typed field and `ctx.passthrough`. `out.results` writes a value as one JSON line and rows as one JSON line each. |
| `middleware_context(MiddlewareValues::new(Some(options)))` returns `(MiddlewareContext<O>, Next)` | `.outcome(ChainOutcome)`, `.own_options(values)`, `.request(values)`, `.invoked_by(InvokedBy)`, `.spelling(name, spelling)`, `.view(name)`, `.media_type(type)`, `.transform(ResultTransform)`, `.plugin(identity)`, `.process`, `.graph`, `.command`, `.on_log` | The invocation defaults to `InvokedBy::Argv`. The media type and transform default to `None` and keep the last assignment, independent of the view. An unstated outcome makes `next.run()` fail with `middleware_context has no outcome for this middleware's next to resolve. Add one to its values, such as .outcome(ChainOutcome::Dispatched).` |
| `failure_hook_context(FailureHookValues::new(app, path))` | `.invoked_by(…)`, `.view(name, media_type)`, `.graph(graph)`, `.on_log`, `.received(reader)` | `command` is the graph's node at the path, or its root. `received` returns `None` unless the test supplies a reader. |
| `provider_context(ProviderValues::new(globals))` | `.process`, `.graph`, `.provide(&provider, value)`, `.on_log` | `options` holds the globals' values |
| `environment_context(EnvironmentValues::new())` | `.process(handle)`, `.on_log(hook)` | `cwd` and `env` come from the process handle. `warn` writes to its stderr. The test calls the hook with the context and receives its additions directly. |
| `view_context(ViewValues::new())` | `.columns(n)`, `.background(b)`, `.color()` | core's own measures; the test calls `View::render(&data, &ctx)` (or `DeclaredView::render`), or `render_head`, `render_row(&row, index, &ctx)`, and `render_tail(count, &ctx)` on a `RowView` or `DeclaredRowView`, each the view's own function with no registry read |

A built context writes through core's output onto its process handle, by default a fresh mock no test reads, so a test that reads what the function wrote states a mock and reads its streams. Its host is captured from that handle, its log reaches the hooks `.on_log(hook)` attaches, in order, each event naming the graph's application (a failure hook context's stated one) at version `0.0.0` and the routed path, with no stderr in its destination and a hook's `Err` dropped, a handler registered on it is never called, its signal is cancelled only by `ctx.cancel()`, and `ctx.invoke` resolves cancelled with 130. An unstated graph is an Application named `app` whose root runs an action. `piped_content(bytes)` and `file_content(cwd, path)` build the `Content` a test gives a content input.

`FailureHookValues::received(reader)` takes
`impl Fn(&InputProblem) -> Option<SuppliedValue> + Send + Sync + 'static`. The unit context passes
each problem directly to that reader, so the test can choose which problems receive a value.

An environment context's default mock has working directory `/loom-test` and an empty environment.
Its warning uses the normal warning lane, and its log events use application `app` and an empty
path. A test can set `MockFields::cwd` and `MockFields::env` independently and read the mock's
stderr to observe warnings.

The value builders return owned core values with deterministic defaults. Each setter replaces
the corresponding member. A stated destination stream is shared through its `Arc`.

| Builder | Returns | Defaults |
| --- | --- | --- |
| `log_event(LogEventValues::new())` | `LogEvent` | Time `2026-01-01T00:00:00.000Z`, level `LogLevel::Info`, empty message and fields, application `app` at version `0.0.0`, run id of 32 zeroes, empty path, and no plugin, failure, or defect. |
| `log_destination(LogDestinationValues::new())` | `LogDestination` | Empty environment, home `/loom-test/home`, platform `linux`, and no stderr. |
| `progress_event(ProgressEventValues::new())` | `ProgressEvent` | Id `1`, empty label, state `ProgressState::Updated`, and no completed or total count. |

**`loomcli-plugins` features.** No default features. One feature per plugin; a plugin's extension descriptors and declared views sit behind their own features, which the plugin's feature enables.

| Feature | Module | Also enables |
| --- | --- | --- |
| `background`, `color`, `completion`, `dotenv`, `interaction`, `logging`, `manpage`, `self-update`, `service`, `skills`, `suggestions`, `theme`, `verbose` | the plugin | |
| `config` | `config` | `config-extension` |
| `format` | `format` | `format-views` |
| `help` | `help` | `help-extension`, `help-views` |
| `manifest` | `manifest` | `manifest-extension` |
| `mcp` | `mcp` | `mcp-extension` |
| `version` | `version` | `version-views` |
| `config-extension`, `help-extension`, `manifest-extension`, `mcp-extension` | `<plugin>::extension` | |
| `format-views`, `help-views`, `version-views` | `<plugin>::views` | |
| `box`, `heading`, `list`, `prose`, `records`, `rule`, `step`, `table` | the pack view (`box` is module `boxed`) | |

**Dependencies.**

| Dependency | Crates | Why |
| --- | --- | --- |
| `tokio` | core | Child programs, timers, and the runtime `main` builds (ADR-0003). |
| `signal-hook` | core (Unix) | Signal registration through a pipe a thread reads, and the default-action emulation that ends or stops the process when a signal arrives that nothing listens for; `tokio::signal` offers no default fallback. |
| `rustix` | core, validators, plugins (Unix) | Safe termios (raw mode), terminal size (`TIOCGWINSZ`), the foreground process group, the user id, and process signals, with `unsafe` forbidden in the workspace. |
| `tokio-util` | core | `CancellationToken`, the run signal's standard form. |
| `futures-core` | core | `Stream`, the standard trait a row source is. |
| `serde` | core, validators, plugins, examples | The graph's and extension values' plain-data form. |
| `serde_json` (`preserve_order`) | core, validators, plugins, examples | JSON in declaration order for the graph, the manifest, the failure form, and log events. |
| `syn`, `quote`, `proc-macro2` | derive | The standard procedural-macro toolkit. |
| `url` | validators, plugins (`self-update`) | WHATWG URL parsing, the reference `url()`'s semantics; its output type. |
| `jiff` (`tzdb-zoneinfo` in core) | core, validators, plugins (`self-update`) | IANA time zones: the real handle's time zone, and civil times for `date_time()` and `time()` with their output types. |
| `loomcli-style`, `serde_json` | core's build script | The baked release facts' reader is the crate's own, and quotes a value as core's messages do. |
| `regex` | validators, prompts, plugins (`help`, `manpage`) | `text().pattern(…)`, whose syntax differs from a JavaScript `u`-flag `RegExp` (no lookaround, no backreferences), a recorded deviation; the Unicode word classes of the prompts' line editor and of the Markdown subset. |
| `toml`, `saphyr-parser` | plugins (`config`) | TOML and YAML 1.2 configuration files. |
| `sha2` | plugins (the installation record) | SHA-256 digests of installed files. |
| `reqwest` (rustls) | plugins (`self-update`) | HTTPS requests to GitHub with the platform's certificate verifier and no OpenSSL. |
| `unicode-normalization` | plugins (`suggestions`) | Comparing names under the normalization the reference's suggestions apply. |

`signal-hook`, `rustix`, and `regex` are declared in `[workspace.dependencies]`; core names `signal-hook` and `rustix` for Unix targets, and the validators, the prompts, and the plugins' Markdown subset name `regex`. `loomcli-testing` names `tokio` and `tokio-util` for its scripted children and keyboard.

### Skills

`skills(listed).select_commands(skill, paths)` selects Command paths for a named skill, whether the
skill comes from the list or the skills folder. Each path is a sequence of canonical Command names.
An empty path selects the root. An empty list selects no Commands. A later call for the same skill
replaces its selection. The final graph checks every path and reports a declaration fault if two
visible Commands selected by one skill give the same reference name. Hidden Commands and their
descendants give no reference.

`skills::extension::SKILL_COMMAND` attaches `SkillCommandFacts::new(guidance)` to a Command. The
guidance is nonblank Markdown and a later value replaces the earlier one. A generated command
reference carries the guidance along with the Command's manifest details, examples, and failures.

`skills::command_references(graph, paths, guidance)` returns the same generated Markdown from a
built graph. Each `CommandReference` has a file name and its text. The index comes first, followed
by the selected Commands in graph order. The Boolean selects whether to include skill guidance.

## 13. Lint rules and TypeScript-only type rules

| Reference | Rust |
| --- | --- |
| `undescribed` (ESLint) | A test the author installs, as the lint plugin is installed: `loomcli_testing::assert_described(&app)` panics naming each Command, option, argument, and stdin declaration with no description. The derive takes a field's doc comment as its description, so a documented inputs struct passes. |
| `discarded-declaration` (ESLint) | `#[must_use]` on every builder type, `Registration`, and `Next`. |
| `name-shape` (ESLint) | A declaration fault at the call (`portable-name`, `declared-name`), with `is_portable_name` (a `const fn`) and `is_declared_name` exported. |
| `host-bypass` (ESLint) | A documented `clippy.toml` `disallowed-methods`/`disallowed-types` list for application crates: `std::env::var`, `std::env::vars`, `std::env::args`, `std::env::current_dir`, `std::env::home_dir`, `std::env::temp_dir`, `std::process::exit`, `std::process::Command`, `std::io::stdin`, `std::io::stdout`, `std::io::stderr`, `tokio::process::Command`, `tokio::signal::*`, each with the host member to use instead. `cargo loom init` writes it; that toolchain is not in this tree. |
| `strict-configuration-schema` (ESLint) | serde ignores an unknown key by default, the forgiving form the rule asks for; `#[serde(deny_unknown_fields)]` is the strict form, and the configuration plugin's rustdoc warns against it. No check: a library cannot see a derive attribute. |
| `unrooted-configuration` (ESLint, off by default) | `config::Scope::Project { root }` names the root markers in the type, so the choice is visible at the call; an empty list is allowed, as the reference allows no marker. |
| One literal name per declaration (`NameConstraint`) | A `&str` names one input. |
| Default and implied value types (`DefaultConstraint`, `ImpliedConstraint`) | Raw strings by type; validated at run (`invalid-default`, `invalid-implied`). |
| Per-value validator input (`PerValueConstraint`) | `Validator::validate(&str)`. |
| `ValidateOmittedConstraint` | `validate_omitted(impl OmissionValidator)`; the rest `option-config`. |
| `GlobalNameConstraint`, `AttachmentConstraint`, `Register`, `EnvironmentOf` | Call and attach faults for collisions; `input-read` at the typed read for requirements. |
| `GlobalOmissionConstraint`, `Unmarked`, option-config unions | Builder types per kind, then `option-config` at the call; derive compile errors. |
| `ArgumentKeyConstraint` | Argument builders lack the setters. |
| `OptIn` shared provider names | `provider-name-taken` at the call; identity is name, value type, and opener type. |
| A persistent provider's `uses` (`readonly PersistentProvider[]`) | `Provider<V, Persistent>::uses` takes `PersistentProvider`: a compile error. |
| `MetByRegistration`, `RootRequirement` (provider globals) | `input-read` at the read. |
| `ThemeConstraint` (reserved theme names) | Checked by `loomcli-style`'s theme builder at the call. |
| `Synchronous<Returned>` | Handlers return `()`. |
| `FailureExitCode` range, `exitCode` read-only | `FailureExitCode::new` const assertion; class facts live on the `static` class and `FailureFacts` reads them, so no impl overrides them per instance. |
| Failure code type and grammar | `FailureClass::new` const assertion: a compile error. |
| `activate: (keyof Options)[]`, a setting's option | `plugin-option-name` at the call. |
| One `middleware` and one key per hook in a plugin's definition object | `handler-registered-twice` at the second setter call. |
| `views({ default })` keyof | The default lives inside the record (`ResultViews`, `RowViews`, and a hook's `AttachedViews`); a missing name fails where the result renders, as in the reference. |
| `Command` state parameter, `ActionHandler<typeof cmd>` | The state parameter `S`, bounded in each method's `where` clause so the `on_unimplemented` message shows; a handler names `Context<I, R>`; a group's builder returns `GroupCommand<I, R>`. |
| Another installed copy of core (`foreign-value`) | Two semver-incompatible copies of `loomcli-core` are distinct types: a compile error. |

## Naming differences

| Reference | Rust | Why |
| --- | --- | --- |
| `override(key, view)` | `override_view(key, view)` | `override` is a reserved keyword. |
| `ApplicationOptions.views` | `Application::overrides` | `views()` is the result-view call on the same type. |
| `MiddlewareContext.view` setter | `select_view(name)` | Rust has no property setter. |
| `box()` pack view | `boxed()` in module `boxed` | `box` is a reserved keyword. |
| `new DeclarationError(sentence)` | `DeclarationError::sentence_only(sentence)` | One constructor per arity. |
| `new InternalError(message, cause)` | `InternalError::message_only(message, cause)` | One constructor per arity. |
| `failure` class key | `failure::<F>()` | A class is a type, so its key is a value made from the type. |
| `globalOption`, `oneRequired`, … | `global_option`, `one_required`, … | Rust casing. |

## Reference page map

| `docs/core` page | Placed in |
| --- | --- |
| `README.md` | this page |
| `application.md` | §1 Application, §9 |
| `commands.md` | §1, §2 globals, §9 routing |
| `options.md` | §1 Options, Arguments, rules |
| `input-sources.md` | §1 Input sources, §8 source slot, §9 step 11 |
| `validation.md` | §3 |
| `declaration-faults.md` | §1 rules table, §6 declaration faults and defects |
| `diagnostics.md` | §6, `diagnostics::rules` |
| `invocation.md` | §4, §9 entry points |
| `graph-inspection.md` | §7 |
| `host.md` | §10 |
| `interaction.md` | §1 (`required_when_non_interactive`), §3 linked inputs, §4 `interactive`, §9 step 12 |
| `color.md` | §1 marks, §9 step 2, style re-export |
| `verbosity.md` | §1 marks, §5 lanes, §9 step 6 |
| `background.md` | §1 marks, §9 step 3, §10 `HostTerminal`, raw mode |
| `signals.md` | §10 signals and shutdown |
| `output.md` | §5 |
| `views.md` | §5 views and registry |
| `results.md` | §5 results |
| `styles.md` | §12 style re-export (owned by `loomcli-style`) |
| `logging.md` | §5 logging, §8 `on_log` |
| `failures.md` | §6 |
| `failure-views.md` | §6 failure views and encoders |
| `plugin-contract.md` | §8 |
| `middleware.md` | §8 middleware |
| `providers.md` | §8 providers |
| `lifecycle-hooks.md` | §8 hooks |
| `extensions.md` | §8 extensions |
| `release-facts.md` | §11 |
| `installation-record.md` | §11 (`installation`, `application_directory`); the record's writer is `cargo-loom`'s installer script, which is not in this tree |
| `public-exports.md` | Conventions (input and output types), §12 crate root |
