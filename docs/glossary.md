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
A standalone typed declaration value with a canonical name, its arguments, its local options, its hidden aliases, its children, and at most one action. A Command is not defined by its place in a path; it carries everything it needs as a value.
_Avoid_: Subcommand (in the model; operator diagnostics may still say "subcommand"), verb, handler

**Root Command**:
The unnamed Command an Application owns. It is the entry point of routing and follows every Command rule except naming and aliasing.
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
The one-letter spelling of an option. It is a spelling of that option and appears in every projection, which distinguishes it from a hidden alias.
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

**Hidden alias**:
Another bare token that routes to a Command and is never advertised. It changes routing alone; it is not a second name and not an option's short alias. Every canonical name and hidden alias under one parent shares one set of names that must not repeat.
_Avoid_: Alternate command, shortcut. Unqualified "alias" is acceptable where the surrounding text already fixes the sense.

**Route** and **Routed path**:
The descent from the root through child names or hidden aliases to the selected Command, and the list of canonical names that records it. The root's path is empty.
_Avoid_: Command chain, breadcrumb

**Candidates**:
The canonical child names a routing failure offers, in authoring order. A hidden alias never appears among them.
_Avoid_: Suggestions, available commands

## Compilation and invocation

**Command graph**:
The validated, frozen tree that core builds from an Application's declarations. Every run and every projection reads this one structure, so their public contracts cannot drift apart.
_Avoid_: Command tree, AST, registry, model (unqualified)

**Graph build**:
The phase that turns the declarations into a Command graph and applies every declaration rule. A rejected declaration is a declaration error, reported before any invocation token is read.
_Avoid_: Compilation, registration, setup

**Inspection**:
Reading the Command graph as plain frozen data through `inspect()`, without reading host facts or running a schema.
_Avoid_: Introspection, reflection, dump

**Invocation**:
One `run()` call: host capture, graph build, global pre-scan, routing, local parsing, validation, the action, and the exit status.
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
The status `run()` resolves and sets on the process. It reports whether the invocation succeeded and, if not, which category of failure ended it.

## Output

**Out**:
The output channel object an action receives. It carries the semantic methods, the neutral render call, and the fatal path.
_Avoid_: Logger, console, writer, printer

**Semantic output**:
A message written through one of the five purpose-named methods: `print`, `info`, `success`, `warn`, and `error`. Each has a fixed default destination and appends one newline.
_Avoid_: Log level, styled output

**Rendered output**:
Text a Renderer produces from one value and `out.render` writes to stdout verbatim. It has no semantic identity and no destination parameter.
_Avoid_: Formatted output, view

**Renderer**:
A pure, synchronous value that turns one typed value into the exact bytes core writes, trailing newline included.
_Avoid_: Formatter, serializer, presenter, view

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
A registration that pairs one failure class with a Renderer for its instances, which produces the diagnostic.
_Avoid_: Error handler, error formatter, catch

**Issue**:
One Standard Schema rejection returned by a schema, with its message and optional path inside the value.
_Avoid_: Validation error, problem (for the schema-level record)

**Problem**:
One entry in an input error: an omitted required input or a rejected value together with its issues.

## Product surface

**Projection**:
A public surface derived from the Command graph, such as help, a manifest, completions, or an agent tool listing. A projection reads the graph and adds nothing the graph does not hold.
_Avoid_: View, export, output format, adapter

**Manifest**:
The projection that describes the accepted built product to a machine consumer: how to construct inputs and what outputs and failures to expect. It excludes authoring provenance, diagnostics, and implementation history.
_Avoid_: Schema (for the whole document), spec, descriptor

**Plugin**:
An explicitly installed extension that may extend typed context, contribute graph data and projections, and hook lifecycle conditions through the same public contract first-party packages use. Core installs none by default.
_Avoid_: Extension, middleware, addon, bundled plugin

**Core**:
The `@loom/core` package: authoring, graph build, invocation, host capture, output, and failures. Core is host-independent and installs no plugins.
_Avoid_: Framework (for the package), runtime, engine
