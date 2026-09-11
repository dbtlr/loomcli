---
description: The Loom CLI domain model. Canonical names for the concepts an Application, its Commands, inputs, invocation phases, output, and failures are built from, with the synonyms to avoid.
---

# Loom CLI Glossary

Loom CLI is a framework for defining a typed command application once and serving human operators, agents, and automation from that one definition. This glossary names the concepts the definition is built from. Use these names in code, documentation, diagnostics, and reviews, and challenge language that drifts from them.

## Authoring

**Application**:
The root of one command application: an unnamed root Command plus the application's name, its global options, and its failure renderers. One Application value exists per application, and it alone can run or be inspected.
_Avoid_: Program, CLI object, app root

**Command**:
A standalone typed declaration value with a canonical name, its arguments, its local options, its aliases, its children, and at most one action. A Command is not defined by its place in a path; it carries everything it needs as a value.
_Avoid_: Subcommand (in the model; operator diagnostics may still say "subcommand"), verb, handler

**Root Command**:
The unnamed Command an Application owns. It is the entry point of routing and follows every Command rule except naming, aliasing, and the hidden and deprecated facts, which it never carries.
_Avoid_: Main command, default command

**Child** and **Parent**:
A Command attached under another Command by a `command()` call, and the Command it is attached to. A Command value is a child at one point in one Application's graph.

**Group**:
A Command that has children and registers no action. Routing passes through a group to one of its children and never dispatches the group itself.
_Avoid_: Namespace, container command, folder

**Declaration**:
The immutable value an authoring call returns. Each authoring call returns a new declaration and leaves its receiver unchanged, so the value a call returns is the only one that holds the call's effect.
_Avoid_: Builder, definition object, config

**Authoring call**:
One of the calls that produce a new declaration: `argument()`, `option()`, `alias()`, `command()`, and `action()`. The set a declaration still offers is part of its type, so the calling order is a compile-time rule.
_Avoid_: Builder method, chain step

**Action**:
The handler a Command registers last, which receives the parsed and validated invocation and performs the work. A Command has at most one action, and registering it closes the declaration.
_Avoid_: Handler, run function, executor

**Action context**:
The single object an action receives, carrying its parsed inputs, the passthrough tail, the output channel, and the host.
_Avoid_: Request, invocation object, props

**Global options**:
The one `GlobalOptions` value that every Command in an Application shares. Each global reaches every action with one type.
_Avoid_: Root options, inherited options, common flags

## Inputs

**Argument**:
A positional input a Command binds from bare tokens in declaration order. A scalar argument binds one token; a variadic argument is last and takes the remaining tokens.
_Avoid_: Positional, operand, parameter

**Option**:
A named input introduced by a hyphen spelling. A string option consumes a value; a Boolean option consumes none and reports the value of its spelling.
_Avoid_: Flag, switch, parameter

**Local option**:
An option declared on one Command, visible to that Command's action alone. Local options never inherit along a path, so a group cannot declare one.
_Avoid_: Command option, scoped option

**Declared name**:
The exact string an argument or option is declared under, which is the key its action reads. When a long spelling exists, it is derived from the declared name verbatim.
_Avoid_: Key (when the spelling is meant), label

**Spelling**:
A token form the parser accepts for an option: the long form, the short form, or the generated negative form. Diagnostics about supplied input name the spelling; diagnostics about a declaration name the declared name.
_Avoid_: Flag name, syntax, alias (for the long form)

**Short alias**:
The one-letter spelling of an option. It is a spelling of that option and appears in every projection, which distinguishes it from a Command's alias.
_Avoid_: Short flag, shorthand

**Short group**:
One token that combines several short aliases, such as `-tm words`. Boolean aliases may combine; a value alias must be last.
_Avoid_: Bundled flags, cluster, stacked options

**Polarity**:
The Boolean option setting that selects which long forms exist and what an absent option means: `positive`, `negative`, or `both`.
_Avoid_: Negation mode, inverse flag

**Multiple option**:
A string option that collects every occurrence into one array instead of rejecting the second. Omission is an accurate empty collection rather than `undefined`, and it enters the schema like a supplied value.
_Avoid_: Repeatable flag, array option, list option

**Default**:
The value a declaration supplies for an omitted optional input. A default is stated in the schema's input type and passes through the schema like a supplied value.

**Schema**:
A Standard Schema object attached to a value input through `validate`. It receives the supplied string or string array, decides acceptance, and determines the action's value type.
_Avoid_: Validator (for the object), parser, type guard

**Validation context**:
The facts core attaches to every schema call it makes: the phase, the input's identity, the routed path, the passthrough tail, the raw supplied tokens, and the host. A schema reads it to decide rules that depend on the invocation.
_Avoid_: Schema options, environment

**Passthrough**:
The tokens after the first bare `--`, delivered to the action unchanged and never parsed, validated, or transformed by core.
_Avoid_: Rest arguments, trailing arguments, raw args

## Names and routing

**Canonical name**:
The one name a Command is declared with. Every routed path, diagnostic, candidate list, and inspection report uses it, whichever token the operator typed.
_Avoid_: Primary name, display name, real name

**Alias**:
An unadvertised synonym that routes to a Command: another bare token for a common mistype or inference, so a guessed spelling succeeds. It changes routing alone; it is not a second name, not an option's short alias, and not a hidden Command. Every canonical name and alias under one parent shares one set of names that must not repeat.
_Avoid_: Hidden alias, alternate command, shortcut

**Hidden Command**:
A full Command kept off every listing. It routes, runs, and has its own help page; only the listings omit it. A hidden option follows the same rule: it parses as any other option and no listing shows it.
_Avoid_: Secret command, unlisted command, alias (for this concept)

**Deprecated member**:
A Command or option the application still accepts but no longer advertises as the way to do its job. It carries a one-line migration message that every page that includes it shows beside it; a member that is also hidden appears in none. A candidate list names it without the message, because it holds names alone.
_Avoid_: Legacy, obsolete, retired

**Route** and **Routed path**:
The descent from the root through child names or aliases to the selected Command, and the list of canonical names that records it. The root's path is empty.
_Avoid_: Command chain, breadcrumb

**Candidates**:
The canonical child names a routing failure offers, in authoring order. An alias or a hidden Command never appears among them, and a deprecated Command appears by name alone.
_Avoid_: Suggestions, available commands

## Compilation and invocation

**Command graph**:
The validated, frozen tree that core builds from an Application's declarations. Every run and every projection reads this one structure, so their public contracts cannot drift apart.
_Avoid_: Command tree, AST, registry, model (unqualified)

**Graph build**:
The phase that turns the declarations into a Command graph and applies every declaration rule. A rejected declaration is a declaration error, reported before any invocation token is read.
_Avoid_: Compilation, registration, setup

**Inspection**:
Reading the Command graph as plain frozen data through `inspect()`, without reading host facts or running an input schema.
_Avoid_: Introspection, reflection, dump

**Invocation**:
One `run()` call: host capture, graph build, global pre-scan, routing, the middleware chain, local parsing, validation, the action, and the exit status.
_Avoid_: Execution, call, request

**Pre-scan**:
The invocation phase that consumes global options from the tokens before routing, stopping at the passthrough delimiter.
_Avoid_: Global pass, first pass

**Routing**:
The invocation phase that reads bare tokens from the root downward and selects the Command that will parse the remaining tokens.
_Avoid_: Dispatch (for selection), resolution, matching

**Dispatch**:
Handing the validated invocation to the selected Command's action.
_Avoid_: Routing (for the handoff), execution

**Host**:
The captured facts of the process an invocation runs in: argument tokens, working directory, environment, the standard streams, and terminal facts. Core copies the facts, retains the streams, and lets a caller override fields.
_Avoid_: Environment (for the whole object), process, platform, context

**Exit code**:
The status `run()` resolves and sets on the process. It reports whether the invocation succeeded and, if not, which category of failure or which signal ended it.

**Run signal**:
The one cancellation signal a run creates and hands to every middleware and the action. A caller-supplied signal or the signals owner aborts it, with a `CancellationReason` naming the cause.
_Avoid_: Abort controller (for the concept), cancellation token, interrupt

**Signals owner**:
The one installed plugin that claims the signals slot, on whose behalf core installs and removes the process listeners for one run.
_Avoid_: Signal handler plugin, interrupt plugin

## Output

**Out**:
The output channel object an action receives, carrying the semantic methods, the neutral render call, the result call, and the fatal path. On a Command that declares a result, every method other than the result call writes to stderr, and none is ever removed.
_Avoid_: Logger, console, writer, printer

**Semantic output**:
A message written through one of the five purpose-named methods: `print`, `info`, `success`, `warn`, and `error`. Each has a fixed default destination and appends one newline.
_Avoid_: Log level, styled output

**Rendered output**:
Text a Renderer produces from one value and `out.render` writes, after core resolves its markup for the destination stream. It has no semantic identity and no destination parameter, and it goes to stderr on a Command that declares a result.
_Avoid_: Formatted output, verbatim output

**Renderer**:
A pure, synchronous value that turns one typed value into the marked text core resolves and writes, trailing newline included.
_Avoid_: Formatter, serializer, presenter

**View**:
A registered presentation unit with an identity, the data shape it presents, a cardinality of document or item, and its default renderer. Core, a plugin, or an application defines one, and an application replaces the renderer of any view through the registry.
_Avoid_: Template, widget, presenter, renderer (for the registration)

**Token**:
A semantic color name a renderer applies to text, carried as markup until core resolves it against the installed theme and the host. Core owns seven, and a plugin or an application mints more.
_Avoid_: Color, style name, class

**Glyph**:
A named mark from core's inventory, each with a fixed ASCII fallback and a fixed paired token, that a renderer writes by name rather than as a literal character.
_Avoid_: Icon, symbol, emoji, bullet

**Result**:
The typed value a Command declares and its action emits once, as one document or one stream of items. Its declaration carries the shape, the views in preference order, and the cardinality, and a declared result owns stdout on that Command.
_Avoid_: Return value, payload, output value

## Failures

**Failure**:
Any outcome `run()` reports as unsuccessful. Every failure is an instance of a public class that carries the facts its sentence interpolates, so a renderer reads facts instead of parsing prose.
_Avoid_: Exception (as the model term), error object

**Usage error**:
A failure that means the invocation is wrong: unknown command, missing subcommand, unknown option, missing value, unexpected value, repeated option, unexpected argument, short group misuse, or rejected input. It exits 2.
_Avoid_: User error, CLI error, validation error (as the class name)

**Structure error**:
A parse-time fault in the token stream, such as an unknown option or a missing value. It ranks after routing errors and before schema issues.
_Avoid_: Syntax error, parse error

**Input error**:
The usage error that carries the whole validation phase: every omitted required input and every schema-rejected value, in authoring order.
_Avoid_: Validation error, schema error

**Declaration error**:
A failure caused by the author's declarations, found at graph build, by a rejected default, or by a validator that throws or returns a malformed result. It names the declaration and exits 1.
_Avoid_: Config error, definition error, developer error (in the class name)

**Fatal error**:
The failure `out.fatal()` throws to end an action with a message. It exits 1 and carries no category prefix.
_Avoid_: Abort, panic, crash

**Internal error**:
A failure core wraps around an unexpected exception, a broken renderer, or a broken destination. It exits 1.
_Avoid_: Unhandled error, bug (in output)

**Diagnostic**:
The text core writes to stderr for one failure: the sentence, its correction, and the category prefix the renderer chooses.
_Avoid_: Error message (when the class is meant), log line

**Failure renderer**:
A view override keyed by a failure class rather than by a view identity, which produces the diagnostic for that class and its subclasses. It resolves through the same registry every other view resolves through, along the thrown failure's prototype chain.
_Avoid_: Error handler, error formatter, catch

**Issue**:
One Standard Schema rejection returned by a schema, with its message and optional path inside the value.
_Avoid_: Validation error, problem (for the schema-level record)

**Problem**:
One entry in an input error: an omitted required input or a rejected value together with its issues.

## Product surface

**Projection**:
A public surface derived from the Command graph, such as help, a manifest, completions, or an agent tool listing. A projection reads the graph and adds nothing the graph does not hold.
_Avoid_: Export, output format, adapter

**Help page**:
The projection of one routed Command that the help plugin prints: its masthead, usage, visible members, and examples, as plain text.
_Avoid_: Usage text, man page, help screen

**Formatter**:
A machine encoding of a result value, contributed by a plugin and selected for one run by name. `json` and `jsonl` are formatters, and a formatter never sees a view.
_Avoid_: Renderer (for an encoding), serializer, view (for a format)

**Theme**:
The plugin that maps every token to a color, where a color is a named terminal color or a custom value core degrades to the host's capabilities. It carries nothing else, and with none installed output is plain text with glyphs.
_Avoid_: Color scheme, skin, style sheet, palette (for the plugin)

**Plugin pack**:
The one first-party package that ships every first-party plugin as its own separately installable subpath export.
_Avoid_: Bundle, standard library, batteries, default set

**Manifest**:
The projection that describes the accepted built product to a machine consumer: how to construct inputs and what outputs and failures to expect. It excludes authoring provenance, diagnostics, and implementation history.
_Avoid_: Schema (for the whole document), spec, descriptor

**Plugin**:
A frozen, explicitly installed value with a fixed identity that contributes options, one middleware, extensions, failure renderers, or a slot claim through the same public contract first-party packages use. Core installs none by default.
_Avoid_: Extension (for the whole plugin), addon, bundled plugin

**Plugin identity**:
The nonempty string that names a plugin, fixed where the plugin is defined. By convention it is the package name, or the package name with a suffix when one package ships several plugins.
_Avoid_: Plugin name (when the key is meant), id (in prose)

**Contribution**:
One thing a plugin adds to an Application: an option, a middleware, an extension, a failure renderer, or a slot claim. Contributions compose in installation order.
_Avoid_: Hook, registration, feature

**Slot**:
A core-declared position that exactly one plugin may claim. A second claim is a declaration error. The signals slot is the first.
_Avoid_: Singleton, capability (for the position)

**Middleware**:
A plugin's participation in an invocation, run between routing and local parsing. It receives its own options and the routed node, and it either takes over by returning or continues the chain by calling `next()`.
_Avoid_: Hook, interceptor, terminal option, handler (for the chain entry)

**Activation**:
A middleware's declared condition for running and loading: a list of its plugin's own option names, any of which being present activates it, or always.
_Avoid_: Trigger, gate, filter

**Extension**:
A typed fact a plugin defines for one target, Command, option, or argument, and a declaration carries as a branded value keyed by the extension's identity.
_Avoid_: Metadata, annotation, field, decorator

**Core fact**:
A declaration fact core owns and every projection reads without any plugin installed: description, version, hidden, and deprecated.
_Avoid_: Built-in metadata, reserved field

**Plugin option**:
An option a plugin contributes. It shares the globals table and the pre-scan with global options, but it carries no schema and reaches its own plugin's middleware alone, never an action.
_Avoid_: Global option (for a plugin's option), flag

**Core**:
The `@loomcli/core` package: authoring, graph build, invocation, host capture, output, failures, and the plugin contract. Core is host-independent and installs no plugins.
_Avoid_: Framework (for the package), runtime, engine

## Releases

**Participating library**:
A publishable first-party library included in the synchronized release version and package set.
_Avoid_: Release target, public workspace

**Change fragment**:
A pending record of one pull request's consumer-visible changes and any required migration.
_Avoid_: Changeset, release note draft

**Release cut**:
The reviewed commit that consumes pending change fragments and sets the synchronized version and changelog for one release.
_Avoid_: Version bump, release build

**Cut commit**:
The first-parent commit on `main` that set the current synchronized version. It is the material-change baseline for the next cut, and the release workflow publishes only while the participating tree is unchanged since it.
_Avoid_: Release tag, version tag, tagged commit

**Material change**:
A change to a library, a library dependency, or a shared build input that can affect the library's published contents.
_Avoid_: Direct change, visible change

**Replacement cut**:
The ordinary release cut that follows an abandoned unpublished version or a defective published one. It takes the next version and never rewrites, republishes, or retags the version it supersedes.
_Avoid_: Retry, rebuild, republish, repair
