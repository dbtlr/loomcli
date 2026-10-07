---
description: The Loom CLI domain model. Canonical names for the concepts an Application, its Commands, inputs, invocation phases, output, and failures are built from, with the synonyms to avoid.
---

# Loom CLI Glossary

Loom CLI is a framework for defining a typed command application once and serving human operators, agents, and automation from that one definition. This glossary names the concepts the definition is built from. Use these names in code, documentation, diagnostics, and reviews, and challenge language that drifts from them.

## Authoring

**Application**:
The root of one command application: an unnamed root Command plus the application's name, its global options, and its view overrides. One Application value exists per application, and it alone can run or be inspected.
_Avoid_: Program, CLI object, app root

**Command**:
A standalone typed declaration value with a canonical name, its arguments, its local options, its aliases, its children, and at most one action. A Command is not defined by its place in a path; it carries everything it needs as a value.
_Avoid_: Subcommand (in the model; operator diagnostics may still say "subcommand"), verb, handler

**Root Command**:
The unnamed Command an Application owns. It is the entry point of routing and follows every Command rule except naming, aliasing, and the hidden and deprecated facts, which it never carries.
_Avoid_: Main command, default command

**Child** and **Parent**:
A Command attached under another Command by a `command()` call, and the Command it is attached to. A Command value is a child at one point in one Application's graph, and a Command path reaches at most two levels below the root.

**Attach**:
The operation that places a finished Command under a parent: `command()` on a Command or on the Application, or a plugin's `commands` list, which the Application constructor attaches to the root. An attached Command is final, so attach checks it as a finished Command and against its new siblings. When a subtree joins an Application, the Application checks it once against its globals, its plugins, and the nodes it already holds.
_Avoid_: Mount, register, add

**Group**:
A Command that has children and registers no action. Routing passes through a group to one of its children and never dispatches the group itself.
_Avoid_: Namespace, container command, folder

**Declaration**:
The immutable value an authoring call returns. Each authoring call returns a new declaration and leaves its receiver unchanged, so the value a call returns is the only one that holds the call's effect.
_Avoid_: Builder, definition object, config

**Authoring call**:
One of the calls that produce a new declaration: `argument()`, `option()`, `globalOption()`, `alias()`, `result()`, `rows()`, `views()`, `command()`, `action()`, and `extend()`. The set a declaration still offers is part of its type, so the calling order is a compile-time rule for an author; a plugin's lifecycle hook makes the same calls with their types erased and the closures `action()` applies do not bind it.
_Avoid_: Builder method, chain step

**Action**:
The handler a Command registers after its inputs, aliases, and children, which receives the parsed and validated invocation and performs the work. An action is lazy by definition: registering it runs nothing, and core calls it only when routing selects its Command and the invocation reaches dispatch. A Command has at most one action, and registering it closes input, alias, child, and action declarations for the author. Command-targeted extension configuration and a result's `views()` remain open, and a plugin's lifecycle hook is exempt from the closure.
_Avoid_: Handler, run function, executor

**Action context**:
The single object an action receives, carrying its validated inputs, the passthrough tail, the output channel, the host, the signal, the style, the graph, the routed Command, and `invoke`, which runs another Command of the same graph by name.
_Avoid_: Invocation object, props, request (which is what a middleware reads)

**Global options**:
The options accepted on every Command: those the Application declares through `globalOption()` and those a plugin declares under its definition's `options`, one kind with one configuration whoever declares them. Their validated values reach every action and every middleware; Application registration supplies their types, a plugin's included, to independently authored Commands. A global option declares no presence rule, neither `required` nor `validateOmitted`, so its omission is always plain absence; a Command that needs the value checks for it.
_Avoid_: Root options, inherited options, common flags, plugin option (for a plugin's global option)

**Application environment**:
The shallow type information extracted before Command composition: global output types and the installed plugin tuple. It excludes the Command graph and root-local inputs.
_Avoid_: Runtime context, global singleton

**Application registration**:
The Application-owned `Register.environment` module augmentation that supplies its environment to one TypeScript compilation context.
_Avoid_: Command wiring, plugin installation

## Inputs

**Argument**:
A positional input a Command binds from plain words in declaration order. A scalar argument binds one token; a variadic argument is last and takes the remaining tokens.
_Avoid_: Positional, operand, parameter

**Option**:
A named input introduced by a hyphen spelling, of one of three kinds. A string option consumes a value; a Boolean option consumes none and reports the value of its spelling; a counted option consumes none and reports how many times it was supplied.
_Avoid_: Flag, switch, parameter

**Local option**:
An option declared on one Command, by its author or by a plugin's lifecycle hook, whose value reaches that Command's action and the request a middleware reads. An author's option is in the action's types; a hook's is present in the value at run time and absent from those types, and a middleware reads either untyped. Local options never inherit along a path, so a group cannot declare one.
_Avoid_: Command option, scoped option

**Declared name**:
The exact string an argument or option is declared under, which is the key its action reads. An option's own long spelling, when it has one, is the declared name verbatim; each of its aliases adds another long spelling.
_Avoid_: Key (when the spelling is meant), label

**Spelling**:
A token form the parser accepts for an option: the long form, the short form, an alias's long form, or a generated negative form. Diagnostics about supplied input name the spelling; diagnostics about a declaration name the declared name.
_Avoid_: Flag name, syntax, alias (for the long form the declared name derives)

**Reported spelling**:
The one spelling every validation diagnostic and reported problem names an option by, whichever spelling the operator typed: its long form, else the negative form a negative-only Boolean option publishes, and otherwise its short form, which a short-only option alone publishes. An alias is never the reported spelling. A parser fault names the spelling typed instead. An invocation by name types no spelling, so there every problem names the option by its declared name.
_Avoid_: Display name, canonical spelling

**Short alias**:
The one-letter spelling of an option. It is a spelling of that option and appears in every projection, which distinguishes it from an alias, a Command's or an option's, which no projection shows.
_Avoid_: Short flag, shorthand

**Short group**:
One option word that combines short aliases after a single hyphen, such as `-tm words`, read under the POSIX `getopt` rule: a Boolean letter is set and the walk continues, a counted letter adds one and the walk continues, and a value letter ends the group and takes the rest of the word, after one leading `=`, as its value; when nothing remains it takes the next word, or supplies its implied value when it declares one. Its letters may belong to any option the routed Command's table holds, global or local.
_Avoid_: Bundled flags, cluster, stacked options

**Option word** and **Plain word**:
An option word is a word the parser reads as options: `--` followed by at least one character, or `-` followed by an ASCII letter. Every other word is a plain word, which names a Command or is a value or an argument, so `-`, `-5`, and `-.5` are plain words. A separate word is the value of a string option that declares no implied value, unless it is an option word or the bare `--`.
_Avoid_: Flag token, hyphen token (for the class), negative number (as a grammar rule)

**Value class**:
The way an option reads words, of which there are four: a Boolean option, a counted option, a string option with an implied value, and a string option that takes a separate value. A parent's own option typed before a child's name binds to the child's option of that spelling only when both have one value class.
_Avoid_: Arity, option shape, value kind

**Command table**:
The one spelling table graph build gives each Command after the lifecycle hooks have run: its local options and every global option, each entry referencing its one declaration. The routed Command's words are read against it.
_Avoid_: Globals table, merged options, copied globals

**Polarity**:
The Boolean option setting that selects which long forms exist and what an absent option means: `positive`, `negative`, or `both`.
_Avoid_: Negation mode, inverse flag

**Multiple option**:
A string option that collects every occurrence into one array instead of rejecting the second. Omission is an accurate empty array rather than `undefined`. The same validator checks each value, so no occurrence makes no validator call.
_Avoid_: Repeatable flag, array option, list option

**Counted option**:
An option that takes no value and reads, as a number, how many times it was supplied across every spelling, so `-vvv` reads 3 and an option nothing supplied reads 0. Repeating it is never a fault.
_Avoid_: Verbosity flag, counter, incrementing flag

**Control option**:
An option that controls the invocation rather than feeding the Command's work, such as `--help`, `--version`, `--manifest`, or `--format`. The declarer marks it with `control`, core never reads the mark, and a projection that lists what a Command needs, such as the MCP tool listing, leaves it out.
_Avoid_: Meta option, system option, framework option, takeover option (for the mark)

**Default**:
The value a declaration supplies for an omitted optional input: one no token supplied and, for an option, no input source filled. A default is stated in the validator's input type, an array of such values for a multiple option or a variadic argument, and passes through the validator like a supplied value. Core snapshots it once, at the call that declares it: arrays and plain objects are copied and frozen, and other values are kept as they are. No path through a default holds more than 10 arrays and plain objects, and a default that holds itself nests without end, so every reader of a default stays far inside the call stack on every runtime. That copy is the value the graph publishes and the validator receives.

**Implied value**:
The value a string option takes when its spelling is supplied bare, with nothing attached. An explicit value is attached to the spelling, because a bare spelling never takes the next word; a default, by contrast, fills an option nothing supplied. Like a default, it passes through the option's validator before any token is read.
_Avoid_: Optional argument, flag value, const value

**Input-source stage**:
The invocation phase between local parsing and validation that fills each unfilled option from the environment and then the configuration source, under the fixed precedence argv, environment, configuration, default. A filled value is supplied in every sense, and nothing downstream can tell which tier supplied it; only core's failure messages name the source.
_Avoid_: Config merge, fallback chain, value resolution

**Environment binding**:
The variable an option names with `env` on its declaration, from which the input-source stage fills the option when argv does not supply it. Binding is explicit only, an argument and a multiple option never bind, and within one invocation's scope a variable binds one option. Host conventions such as `NO_COLOR` are rendering policy and not bindings.
_Avoid_: Env var option, env fallback, auto env

**Validator**:
The Standard Schema object a value input declares through `validate`: a catalog validator, one built with `createValidator`, or a schema library's value such as a Zod schema, which core cannot tell apart. It receives one value of its input type, a supplied string, a default, or `undefined` under `validateOmitted`, and on a multiple option or a variadic argument each value in turn; it decides acceptance, and determines the action's value type. "Validate" names the action and "validator" the object; "schema" names a description of validation, such as an input schema.
_Avoid_: Schema (for the object), parser, type guard

**Validator catalog**:
The validators `@loomcli/validators` ships as factories, each built with `createValidator`, so an author covers a common input shape without a schema library. A factory earns its slot by covering a shape a command-line author would otherwise need a schema library for.
_Avoid_: Built-in validators, core validators

**Validation context**:
The facts core attaches to every validator call it makes: the phase, the input's identity, the routed path, the passthrough tail, the raw supplied values, tokens and the values input sources filled alike, and the host. A validator reads it to decide rules that depend on the invocation.
_Avoid_: Schema options, environment

**Passthrough**:
The tokens after the first bare `--`, delivered to the action unchanged and never parsed, validated, or transformed by core.
_Avoid_: Rest arguments, trailing arguments, raw args

## Names and routing

**Canonical name**:
The one name a Command is declared with. Every routed path, diagnostic, candidate list, and inspection report uses it, whichever token the operator typed.
_Avoid_: Primary name, display name, real name

**Portable name**:
The one rule for every name an operator types as a command at a shell prompt: the application name, every Command name, and every Command alias. It holds characters from the POSIX portable filename set, `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`, and starts with neither `-`, which reads as an option, nor `.`, which a shell hides. An argument or option name, and an option's alias, follows the declared-name rule instead: nonempty, not starting with `-`, and without whitespace or `=`. A view name follows that rule and is not integer-like.
_Avoid_: Safe name, shell-safe name, identifier

**Alias**:
An unadvertised synonym for a Command or an option: another name for a common mistype, an inference, or a former name, so a guessed or retired spelling still succeeds. A Command's alias routes to that Command, and every canonical name and alias under one parent shares one set of names that must not repeat. An option's alias is one more long spelling of that option, in the table its other spellings share. An alias is not a second advertised name, not an option's short alias, and not a hidden member.
_Avoid_: Hidden alias, alternate command, shortcut

**Hidden Command**:
A full Command kept off every listing. It routes, runs, and has its own help page; only the listings omit it. A hidden option follows the same rule: it parses as any other option and no listing shows it.
_Avoid_: Secret command, unlisted command, alias (for this concept)

**Deprecated member**:
A Command or option the application still accepts but no longer advertises as the way to do its job. It carries a one-line migration message that every page that includes it shows beside it; a member that is also hidden appears in none. A candidate list leaves it out, as the [Candidates](#names-and-routing) entry states.
_Avoid_: Legacy, obsolete, retired

**Route** and **Routed path**:
The descent from the root through child names or aliases to the selected Command, and the list of canonical names that records it. The root's path is empty.
_Avoid_: Command chain, breadcrumb

**Candidates**:
The canonical child names a routing failure offers, in authoring order. An alias, a hidden Command, or a deprecated Command never appears among them.
_Avoid_: Suggestions, available commands

## Compilation and invocation

**Command graph**:
The validated, frozen tree that core builds from an Application's declarations. Every run and every projection reads this one structure, so their public contracts cannot drift apart.
_Avoid_: Command tree, AST, registry, model (unqualified)

**Graph build**:
The phase of `run()` and `inspect()` that turns the declarations into a Command graph. It applies only the declaration rules no earlier moment can judge: the root's finished-Command checks, the lifecycle hooks, and what the hooks contribute. A rejected declaration is a declaration error, reported before any invocation token is read.
_Avoid_: Compilation, registration, setup

**Inspection**:
Reading the Command graph as plain frozen data through `inspect()`, without reading host facts or running a validator.
_Avoid_: Introspection, reflection, dump

**Invocation**:
One `run()` or `invoke()` call: host capture, graph build, routing, parsing the routed Command's words, the input-source stage, validation, the middleware chain, the action, and the exit status. An action's `invoke()` captures no host and builds no graph: it takes its host fields and its graph from its own run.
_Avoid_: Execution, call, request

**Invocation by name**:
An invocation that names its Command by path and its inputs by declared name instead of by argv, captures what the run writes, and resolves a structured outcome: completed, failed, or cancelled. It behaves as the argv that spells the same values, reports its inputs by name, and touches no process. An action starts one through `invoke` on its context, and an embedding host through `app.invoke`.
_Avoid_: Programmatic run, child run, sub-invocation, tool call (for the invocation)

**Request**:
The read-only snapshot of the routed Command's validated argument, local option, and passthrough values that middleware reads through `request`. Global options are separate, and the request is `null` while core holds a fault or the routed Command is a group.
_Avoid_: Parsed invocation, parsed input, raw input (which is the pre-validation form)

**Dispatch boundary**:
The point the middleware chain reaches when it continues past its last middleware: core raises the fault it held, or reads the selected view and dispatches the action. A takeover never reaches it.
_Avoid_: Terminal step, end of chain, action phase

**Routing**:
The invocation phase that reads words from the root downward and selects the Command whose table reads the remaining words. A plain word that names a child descends; an option word is read against the global options and, at a Command with an action and children, that Command's own options, which bind to the Command routing finally reaches, and one none of those declares stops routing at the Command reached. Core once read the global options in a separate pre-scan before routing; the term is retired.
_Avoid_: Dispatch (for selection), resolution, matching, pre-scan

**Misplaced option**:
An option word the routed Command's table does not hold, while a visible Command below it declares it, such as a Command's own option typed before the Command's name, or a parent's own option that the routed Command declares with another value class. It is held as `MisplacedOptionError`, whose sentence names those Commands, or the routed Command.
_Avoid_: Early option, out-of-scope option

**Word position**:
Where the last word of an unfinished invocation sits under core's token grammar: a Command name, an option spelling, the value of one option, one argument, the passthrough tail, or nowhere. Core reads it with the parser's own grammar, so completion and parsing never disagree.
_Avoid_: Slot (a single-owner contribution), cursor context, completion state

**Dispatch**:
Handing the validated invocation to the selected Command's action.
_Avoid_: Routing (for the handoff), execution

**Host**:
The captured facts of the process an invocation runs in: argument tokens, working directory, environment, the standard streams, terminal facts, and the release facts the build baked in. Core copies the facts, retains the streams, and lets a caller override fields. Core captures them once per run, and a working directory that cannot be read fails the run with a `WorkingDirectoryError`.
_Avoid_: Environment (for the whole object), process, platform, context

**Release facts**:
The facts that say how the running application was built, released, and installed: its build, which is `source`, `development`, or `distributed`, an optional release group with its version, lane, repository, and asset, and an installation group. The build bakes them into the artifact, and core holds them on the host as `release`. An artifact built with none reads `source`.
_Avoid_: Packet, build info, environment, mode, `NODE_ENV`

**Lane**:
The release line a version belongs to, which core derives from the version: its first prerelease identifier, such as `next` for `1.1.0-next.3`, or `stable` when it has none. It is an open set of names.
_Avoid_: Channel, track, dist-tag

**Development build**:
An application whose release facts read `source` or `development`: the source run while the author works, an artifact built with no facts, or an artifact built for development. A defect or declaration fault shows the author its Developer Diagnostic, and checks that only development runs report author mistakes a distributed build tolerates.
_Avoid_: Debug mode, dev mode, source mode

**Distributed build**:
An application whose release facts read `distributed`: what an operator installs. A defect or declaration fault that `run()` reports shows the generic defect message. Operator failures print the same bytes in both builds.
_Avoid_: Production, release mode, shipped mode

**Exit code**:
The status `run()` resolves and sets on the process. It reports whether the invocation succeeded and, if not, which category of failure, which failure class, or which signal ended it. 0 is success, 1 and 2 are core's failure categories, 3 through 125 appear only as declared exit codes, which may also be 1 or 2, and 130 and 143 are signals.

**Declared exit code**:
The exit code a failure class states as its static `exitCode`, read from the nearest ancestor that declares one and captured at the class's first construction, so every failure of one class exits with one code. It is a whole number from 1 through 125; 0 and 126 and above are reserved.
_Avoid_: Custom exit code, error code, status override

**Run signal**:
The one cancellation signal a run creates and hands to every middleware and the action. A caller-supplied signal or the signals owner aborts it, with a `CancellationReason` naming the cause.
_Avoid_: Abort controller (for the concept), cancellation token, interrupt

**Signals owner**:
The one installed plugin that claims the signals slot, on whose behalf core installs and removes the process listeners for one run.
_Avoid_: Signal handler plugin, interrupt plugin

## Output

View, Token, Glyph, and Theme follow the [style contract](core.md#styles-and-rendering-policy) and the [view registry contract](core.md#views). The registry is implemented under accepted ADR-0021, so the package spells a view `View` and its context `ViewContext`. Result, Row view, View name, and `ResultError` follow the [results contract](core.md#results), which is implemented under accepted ADR-0023. Column, Field, and Identifier follow the [table](core.md#table) and [records](core.md#records) contracts.

**Out**:
The output channel object an action or a middleware receives, carrying the semantic methods, the neutral render call, the result call, and the fatal path. On a Command that declares a result, the action's `print`, `info`, `success`, `warn`, `error`, and `render` write to stderr, `results` owns stdout, and `fatal` still throws without writing; a middleware's `out` keeps the default destinations and its `results` accepts no value, typed `never`, and no method is ever removed.
_Avoid_: Logger, console, writer, printer

**Semantic output**:
A message written through one of the five purpose-named methods: `print`, `info`, `success`, `warn`, and `error`. Each has a fixed default destination and appends one newline.
_Avoid_: Log level, styled output

**Rendered output**:
Text a view produces from one value and `out.render` writes, after core resolves its markup for the destination stream. It has no semantic identity and no destination parameter, and from an action it goes to stderr on a Command that declares a result.
_Avoid_: Formatted output, verbatim output

**View**:
A pure, synchronous value whose view functions turn typed data and the supplied view context into the marked text core resolves and writes, in one of two shapes: a whole view renders one value through `render`, and a row view renders a sequence one row at a time through `row`. The write site decides whether the view owns its trailing newline. A bare view is chosen at the call site or named in a result's views. A declared view also carries an identity, is named by reference, and is the unit an override replaces.
_Avoid_: Renderer, template, widget, presenter, formatter (for a view), serializer

**Declared view**:
The value `view(identity, definition)` returns: a view that carries an identity, holds its default view function, and is invariant in the data it presents, so it names one data type alone. It is the unit an override keys on, and an application or a plugin names it by reference, the way it names an extension descriptor, never by spelling its identity.
_Avoid_: Named renderer, registered view, view id

**View function**:
The `render` function of a whole view, or the `row`, `head`, and `tail` functions of a row view: data and context in, marked text out. A default view supplies them, and a replacement view of the same shape supersedes them.
_Avoid_: Renderer, render callback

**Pack view**:
A view the plugin pack ships as a configured factory, such as `table({ columns })` or `records({ identifier })`. The factory's return is a bare view typed from the row type of the data it is written against. Its configuration is plain data the returned view holds and never publishes, and a pack view is replaced by name alone, through a result's `views()` and never through an override.
_Avoid_: Built-in view, formatter (for a pack view), widget

**Column**:
One entry of a table view's `columns` list: a key of the row, an optional header, an optional alignment, and an optional `format` that renders that cell. The list order is the column order, a key may appear twice, and an omitted list makes every key that appears in the rows a column in first-seen order.
_Avoid_: Field (for a column), table column definition

**Field**:
One entry of a records view's `fields` list: a key of the row and an optional `format`. A field carries no header and no alignment, because the key is the label the line prints and the value column is one lane. An omitted list makes every key that appears in the record a field in first-seen order.
_Avoid_: Column (for a field), property, attribute, row key

**Identifier**:
The required key of a records view's configuration, naming the field whose value identifies each record. The view styles that value apart from the rest so a reader scanning a list finds the record it names. It is a presentation choice alone, and it is neither a uniqueness claim nor a fact any other reader consumes.
_Avoid_: Key, id, primary key, unique key, name (for the identifier)

**Row view**:
The second structural shape of a view, which renders a sequence one row at a time: a `row` function over one row, its index, and the context, with optional `head` and `tail` functions that open and close the sequence, where `head` takes the context alone and `tail` takes the number of rows rendered and then the context. Every function is pure and synchronous. Core tells a row view from a whole view by the function present, and feeds a row view as the source yields while it buffers a sequence for a whole view.
_Avoid_: Item view, stream view, incremental renderer

**Whole view**:
A view with a `render` function, named in contrast to a row view when both are in play. Under a rows result core buffers the whole sequence before calling it.
_Avoid_: Document view, buffered view

**View override**:
The pairing of a key, a declared view or a failure class, with a replacement view whose view function supersedes the default, listed under `views` on an Application or a plugin. Resolution runs the application's overrides, then each plugin's in installation order, then the declaring contributor's default, walking a failure-class key's prototype chain in full at each contributor.
_Avoid_: Failure renderer, registration, hook

**Lane view**:
The declared view behind one of the five semantic methods, exported by core under `lanes`, each over the message string. An override of a lane view owns its glyph gutter, and the newline the method appends is outside the view. The bare word lane also names an output area of core, as in the results lane.
_Avoid_: Channel, log level, stream (for the lane view)

**Token**:
A semantic name for a theme-defined appearance, carried as markup until core resolves it for the destination. Core supplies seven names, and theme configuration introduces custom names in one Application vocabulary.
_Avoid_: Color, style name, class

**Glyph**:
A named, unstyled mark from core's inventory with main and compatibility forms. Glyph identity is independent of theme appearance.
_Avoid_: Icon, symbol, emoji, bullet

**Media type**:
The type a view declares for the text it writes, such as `application/json` or `application/jsonl`, which a result publishes by view name. Core stores the string and never checks it, and a reader parses a view's output by its media type rather than by its view name. A failed run reads its selected view's media type to find a failure encoder.
_Avoid_: Encoding (for the fact), format, content type, encoding name

**Result**:
What a Command declares it produces and its action emits once through `out.results`: one value under `result<Value>()`, or a sequence of rows under `rows<Row>()`, emitted as any iterable or async iterable. The author states the type, the declaration carries a record of views keyed by view name with the first as the default, replaced by name through `views()` and never by identity, and a declared result owns stdout on that Command. No schema and no cardinality are part of it.
_Avoid_: Return value, payload, output value, document, stream (for the declaration)

**View name**:
A key in a result's `views` record: the bare-token name by which `--format` selects that view and by which `views()` replaces it. Names are unique by construction and belong to the Command, not to the view.
_Avoid_: Presentation, presentation name, format name, view identity, encoding name

**Selected view**:
The view a result renders through on one run: the view name a middleware assigned to `view` on its context before the dispatch boundary, or the declaration's default when none did.
_Avoid_: Active view, current format, output mode

## Failures

**Failure**:
Any outcome `run()` reports as unsuccessful. Every failure is an instance of a public class that carries the facts its sentence interpolates, so a view reads facts instead of parsing prose.
_Avoid_: Exception (as the model term), error object

**Usage error**:
A failure that means the invocation is wrong: unknown command, missing subcommand, unknown or misplaced option, missing value, unexpected value, repeated option, unexpected argument, or rejected input. It exits 2.
_Avoid_: User error, CLI error, validation error (as the class name)

**Structure error**:
A parse-time fault in the invocation's words, such as an unknown or misplaced option or a missing value. It is held, the first in word order, and ranks after an unknown command and ahead of a group's missing subcommand and every validator issue.
_Avoid_: Syntax error, parse error

**Input error**:
The usage error that carries the whole validation phase: every omitted required input and every value a validator rejected, in authoring order.
_Avoid_: Validation error, schema error

**Declaration error**:
A failure caused by the author's declarations. A declaration fault throws at the earliest moment that holds the data proving it: the authoring call or constructor, the attach, or graph build. A declared default or implied value its validator rejects and a validator that throws or returns a malformed result are declaration errors found during a run. It names the declaration, or, for a validator factory's argument, the factory, and carries its Developer Diagnostic. One that `run()` meets reports with exit 1, as a defect in a distributed build; one thrown at a call or an attach is an uncaught exception whose message holds the diagnostic.
_Avoid_: Config error, definition error, developer error (in the class name)

**Fatal error**:
The failure `out.fatal()` throws to end an action with a message. It exits 1 and carries no category prefix. An application subclasses it for its own failures, and a subclass may declare its own exit code.
_Avoid_: Abort, panic, crash

**Internal error**:
A failure core wraps around an unexpected exception no translator answered, a broken view, a broken `onFailure` hook, a broken translator, or a broken destination whose write failure no translator answered, or raises when an action breaks the result contract: a promised result not emitted, emitted twice, emitted where none is declared, or emitted from a middleware. It exits 1.
_Avoid_: Unhandled error, bug (in output)

**Defect**:
A failure only the author can fix: an unexpected exception no translator answered, a broken view, hook, translator, or result contract, or an author fault that reached a run. It is the application's equivalent of an HTTP 500. In a distributed build the operator sees one generic message, `<application>: Something went wrong.`, with no reason, class name, or code detail; in a development build the author sees its Developer Diagnostic.
_Avoid_: Bug, crash, internal error (for the concept rather than the class)

**Diagnostic**:
The text core writes to stderr for one failure: the prefix the view chooses, which is the application name on every problem line of a usage failure and on a `WorkingDirectoryError`'s line, and nothing for a `FatalError`, whose authored sentence stands alone, then the sentence, its correction, and the hints the view prints. A defect or declaration fault writes the generic defect message or a Developer Diagnostic instead, by build.
_Avoid_: Error message (when the class is meant), log line

**Developer Diagnostic**:
The author-facing report of a declaration fault or a defect: a banner with the rule's headline and identity, the sentence, the findings, an explanation of why the rule exists, the correction, and an optional docs link. It is not a view, and in a development build core renders it before consulting any override. Findings rebuild the declaration from graph facts, and a defect's findings show the author's own source lines.
_Avoid_: Stack trace, error page, debug output, verbose error

**Diagnostic rule**:
One reason a declaration can be wrong, or one kind of defect, declared once with `diagnosticRule` and shared by every site that raises it. Its identity is the declaring package's name and any kebab-case subpath segments that name the part of the package that owns it, which together form an identity, then a kebab-case rule name, joined by `/`, such as `@loomcli/core/spelling-taken` or `@loomcli/plugins/manifest/failure-code-conflict`, and it carries the headline, the explanation, and an optional docs link.
_Avoid_: Error code (for a rule), lint rule, check

**Operator message**:
Any message that runs after the application is built and shipped, read by the operator who ran it and cannot change its code. Every operator message Loom ships says what went wrong and what to do instead.
_Avoid_: User message, runtime error, end-user error

**Author message**:
A message that runs while the author develops the application, such as a declaration fault's Developer Diagnostic, addressed to the author who can change the code. A distributed build shows the generic defect message in its place.
_Avoid_: Developer error (for the message), debug message

**Failure view**:
The view core declares for one failure class, keyed by the class, whose function receives the failure instance and the failure view context: the stderr view context, the application name, the path routing walked, the hints plugins added, whether the run received argv or names, and the view the result would render through when the run failed, a middleware's assignment, else the view an invocation by name started with, else the Command's default view, with that view's media type. An application or plugin replaces it with a view override keyed by the class, and resolution follows the thrown failure's prototype chain, most derived first. A failure carries what went wrong, and the context carries where the run was.
_Avoid_: Failure renderer, error handler, error formatter, catch

**Failure code**:
The kebab-case name a failure class declares as its static `code`, such as `unknown-option` or `path-not-found`, read from the nearest ancestor that declares one and captured at the class's first construction, so a machine reader tells failures apart where many share an exit code. Every defect and declaration fault reads `internal`, in both builds.
_Avoid_: Error code, failure name, exit name, rule identity (for a failure)

**Failure form**:
One failure as plain data, `{ code, exitCode, message, hints }`: its failure code, its declared exit code, its sentence as plain text without the application-name prefix, by build for a defect, and the hint lines. Core builds it for every reported failure, and an invocation by name's outcome, a failure encoder, and the MCP tool error read it.
_Avoid_: Error object, error payload, error JSON, failure document

**Failure encoder**:
A function a plugin registers for one media type that turns a failure form into text. When a failed `run()`'s selected view declares that media type, core writes the encoder's text to stderr in place of the failure view, and that line is the run's only failure text there, with no incomplete-result line. A run whose failure no encoder writes, such as a cancelled stream or a broken encoder, keeps that line. One media type has one encoder, and core encodes nothing itself.
_Avoid_: Error formatter, JSON failure view, error serializer, failure override

**Hint**:
A line a plugin adds under a failure message through its `onFailure` lifecycle hook. Hints from every installed plugin accumulate in installation order and reach the failure view, which decides whether to print them; core's default text prints each on its own line under the sentence. A hint adds to a diagnostic and never replaces a view.
_Avoid_: Suggestion (a hint is a line under the sentence, not the near match inside it), tip, help text, note

**Suggestion**:
The near match a plugin's failure view offers as the fix inside the sentence for a mistyped Command or option, such as `Did you mean "get"?`. It is never an alias, a hidden member, or a deprecated member, and core's own sentence never offers one.
_Avoid_: Did-you-mean (as the term), correction, autocorrect, hint (for the match)

**Translator**:
A function registered by the application or a plugin, keyed by a foreign error class, that turns a throw from an action, a row source or destination write the action set going, a middleware before its `next()` has settled, or an input source into one of the author's failure classes, or passes. Translators resolve in the order view overrides do, and the first failure returned wins.
_Avoid_: Error mapper, catch, handler, adapter

**Issue**:
One Standard Schema rejection returned by a validator, with its message and optional path inside the value. Core reads only the message and the path, and it keeps every other field the validator attached, so an issue code and its parameters reach a failure view.
_Avoid_: Validation error, problem (for the schema-level record)

**Issue code**:
The namespaced name of one sentence a validator package prints, such as `@loomcli/validators/integer-range`, carried on an issue with that sentence's parameters, the rule's settings. An author reads it through the package's typed descriptor to reword the sentence.
_Avoid_: Error code, message key, validation code

**Problem**:
One entry in an input error: an omitted required input or a rejected value together with its issues.

## Product surface

**Projection**:
A public surface derived from the Command graph, such as help, a manifest, completions, or the MCP tool listing. A projection reads the graph and adds nothing the graph does not hold.
_Avoid_: Export, output format, adapter

**Help page**:
The projection of one routed Command that the help plugin prints: its masthead, usage, visible members with the values each input accepts, and examples, with meaning independent of styling. It has two variants, compact help and extended help, and the spelling the operator typed selects one.
_Avoid_: Usage text, man page, help screen

**Help section**:
A named set of Command rows or option rows on a help page, under one heading or an outer and an inner heading. A section groups rows for the reader and does not define a routing Group.
_Avoid_: Group (for help grouping), category, plane

**Compact help**:
The help page `-h` prints, for a reader who needs the syntax: the extended page without the details and the examples, ending with a pointer to `--help` when the extended page holds more.
_Avoid_: Short help, summary, brief help

**Extended help**:
The help page `--help` prints, for a reader who is learning the Command: the whole page, with the details and the examples. Help prints it whenever the help option was not typed as `-h`.
_Avoid_: Long help, full help, man page

**Completion**:
The projection a shell reads while the operator types: a printed script that calls back into the application on each Tab and inserts the offered words, the canonical Command names, option spellings, and closed-set values that fit the word under the cursor. It never offers an alias, a hidden member, or a deprecated member, and it never evaluates what was typed.
_Avoid_: Autocomplete, suggestions, candidates (for the offered words), tab completion plugin

**MCP tool**:
One opted-in Command as the MCP plugin serves it to a Model Context Protocol client: a name that is the Command's path joined with `_`, or the application name for the root, with each `-` written as `_`, a description for an agent, the Command's inputs as one object keyed by declared name, and the effect hints its author set. A Command is a tool only when it carries an `mcpCommand` value, and an alias never is. A call of the tool is an invocation by name of its Command.
_Avoid_: Endpoint, function, MCP command, tool (for a Command that has not opted in)

**Formatter**:
The first-party plugin, `@loomcli/plugins/format`, that puts `--format` on every Command that declares a result, so a run selects a view by name, and that ships `json()` and `jsonl()` as whole views whose map reshapes the value under `result()` and the collected rows under `rows()`, and failure encoders for their two media types. A result has no encoding outside the view model: a machine view is a view like a table is.
_Avoid_: Format plugin, encoder (for the plugin), serializer, format (for the view), output mode

**Theme**:
The optional plugin that maps semantic tokens to concrete colors, modifiers, resets, or their combinations. A theme owns no glyphs, layout, or terminal policy, and an absent mapping inherits its surroundings.
_Avoid_: Color scheme, skin, style sheet, palette (for the plugin)

**Plugin pack**:
The one first-party package that ships every first-party plugin as its own separately installable subpath export.
_Avoid_: Bundle, standard library, batteries, default set

**Manifest**:
The projection that describes the accepted built product to a machine consumer: how to construct inputs and what outputs and failures to expect. The first-party manifest plugin prints it for the routed Command as a self-contained slice. It lists no alias or hidden member, though a hidden Command routed to directly prints its own slice, and it excludes authoring provenance, diagnostics, and implementation history, and nothing depends on it: no projection or plugin reads a fact from it, because a fact a consumer needs enters the Command graph and reaches the manifest from there. A plugin that wants its own facts in the manifest supplies them through the manifest's collecting extension.
_Avoid_: Schema (for the whole document), spec, descriptor, tool listing

**Input schema**:
The JSON Schema a validated input's validator publishes through the Standard JSON Schema channel, carried on the Command graph as a core fact so every projection reads what the input accepts. It describes the value one string token must satisfy, exactly as the validator states it, and a multiple option or a variadic argument publishes that same schema for each of its values. It is unknown, not unconstrained, where the validator publishes none. A published input schema is sound: every token the validator accepts satisfies it, so it may be looser than the validator and never stricter.
_Avoid_: Constraint facts, choices, enum fact, shape (for the graph fact)

**Plugin**:
A frozen, explicitly installed value with a fixed identity that contributes options, one middleware, lifecycle hooks, extensions, views and view overrides, a configuration source, Commands attached to the root, or a slot claim through the same public contract first-party packages use. Its code runs where core calls it, at a hook or inside an invocation. Core installs none by default.
_Avoid_: Extension (for the whole plugin), addon, bundled plugin

**Identity**:
The string that names a plugin, an extension, or a declared view, fixed at the `plugin()`, `extension()`, or `view()` call that declares it and checked there against one grammar: an npm package name, scoped or unscoped and at most 214 characters, then zero or more kebab-case subpath segments joined by `/`, such as `help`, `@acme/config`, or `@loomcli/plugins/help/page`. It keys contributions and prefixes the declaring package's diagnostic rule identities, which add a rule name.
_Avoid_: Name (when the key is meant), id (in prose)

**Plugin identity**:
A plugin's identity. By convention it is the package name, or the package name with a kebab-case subpath when one package ships several plugins, and the plugin's extensions and views take it as their prefix.
_Avoid_: Plugin name (when the key is meant), id (in prose)

**Contribution**:
One thing a plugin adds to an Application: an option, a middleware, a lifecycle hook, an extension, a declared view, a view override, a configuration source, a Command attached to the root, or a slot claim. Contributions compose in installation order.
_Avoid_: Registration, feature

**Lifecycle hook**:
A function on a plugin definition that core calls at one named point of an Application's life, named `on` followed by the event, with the event's subject where it carries meaning. `onCommandAttach` is the first: it receives each Command's declaration at graph build, unlocked with its types erased, and returns the declaration to build. `onFailure` is the second: it receives each failure a run renders after graph build, an invocation by name's included, and returns hints. `onGraphBuilt` is the third: it receives the frozen graph once per build and may reject it, and it never contributes to it. A hook runs in sequence at its point, and middleware is not one.
_Avoid_: Event handler, listener, callback, plugin API

**Slot**:
A core-declared position that exactly one plugin may claim. A second claim is a declaration error. The signals slot is the first, and the configuration source follows the same rule.
_Avoid_: Singleton, capability (for the position)

**Configuration source**:
The one optional `source` a plugin definition declares, which answers for configuration-bound options: those carrying a value of the plugin's own binding extension. Core loads it lazily only when such an option is still unfilled after argv and the environment and holds no environment fault, calls it once, and fills each option it answers, with a label core prints in failure messages. Core holds no store, file format, or path grammar; the plugin owns what the binding means.
_Avoid_: Config loader, config provider, settings store

**Configuration file**:
The one JSON, TOML, or YAML file the first-party configuration plugin answers from in a run, never merged with another: the file `--config` names, or else the first found of the author's `file` in the working directory and then the operator's home directory. `.toml` reads as TOML, `.yaml` and `.yml` as YAML, and every other name as JSON. A discovered file never breaks a run, while the named file and a wrong value in the file are usage failures.
_Avoid_: Config, settings file, rc file, dotfile

**File pattern**:
The configuration plugin's `file` setting: a file name or relative path whose last segment's extension alone may be `*` or a brace list such as `{toml,yaml}`, naming candidates in order. In each directory the plugin looks in, the first present candidate is the file it finds, and it warns about every other present one. A literal extension locks the file's format.
_Avoid_: Glob (for the whole setting), wildcard path, file mask

**Middleware**:
A plugin's participation in an invocation, wrapping the request after routing, parsing, and validation. It receives every global option's value, which reads `null` while a global option has a structural fault or was rejected, the spellings of its own plugin's options, and in `ownOptions` the validated values of its plugin's own options, local ones included, which hold even while core holds a fault on another input, a structural or input-source one included, the routed node, the request, and the selected view, and it either takes over by returning or continues the chain by calling `next()`; the fault core held is raised at the dispatch boundary, which a takeover never reaches.
_Avoid_: Hook, interceptor, terminal option, handler (for the chain entry)

**Activation**:
A middleware's declared condition for running and loading: a list of its plugin's own option names, any of which being present activates it, or always. Present means supplied as a token or filled by the input-source stage, never by a default.
_Avoid_: Trigger, gate, filter

**Extension**:
A typed fact a plugin defines for one target, Command, option, or argument, and a declaration carries as a branded value keyed by the extension's identity. Command-targeted values can be replaced after action registration through immutable `extend()` calls, except a collecting extension's, which accumulate.
_Avoid_: Metadata, annotation, field, decorator

**Collecting extension**:
An extension whose values accumulate on a declaration in order, from the author and then from lifecycle hooks, instead of replacing each other. The plugin that declares one reads what an open set of suppliers gave it, and no value records its supplier.
_Avoid_: Contribution queue, queue, channel, contribution (for one value)

**Supplier**:
The author or a plugin whose lifecycle hook gives a value to a collecting extension.
_Avoid_: Contributor, producer, publisher

**Core fact**:
A declaration fact core owns and every projection reads without any plugin installed: description, version, hidden, deprecated, control, the input schema, and a result's media types.
_Avoid_: Built-in metadata, reserved field

**Plugin Command**:
A Command a plugin lists under its definition's `commands`, which core attaches to the root ahead of the application's own Commands. It is an ordinary Command in every other way: every Command rule applies to it, every projection reads it without a special case, and the graph does not record which plugin attached it. The application cannot rename or remove it.
_Avoid_: Plugin subcommand, built-in command, contributed command

**Core**:
The `@loomcli/core` package: authoring, graph build, invocation, host capture, output, failures, and the plugin contract. Core is host-independent and installs no plugins.
_Avoid_: Framework (for the package), runtime, engine

## Releases

**Participating library**:
A publishable first-party package under `packages/`, a library or the `@loomcli/loom` toolchain, included in the synchronized release version and package set.
_Avoid_: Release target, public workspace

**Change fragment**:
A pending record of one pull request's consumer-visible changes and any required migration, kept in a package's `.changes/` until a cut consumes it. Its kind is breaking, feature, or fix.
_Avoid_: Changeset, release note draft

**Breaking fragment**:
A change fragment, named `breaking.<slug>.md`, for a change that forces a consumer to change its code or requirements. It carries a migration section, and it advances the major version from `1.0.0` and the minor below it.
_Avoid_: Major fragment, breaking changeset

**Feature fragment**:
A change fragment, named `feature.<slug>.md`, for a compatible addition. It advances the minor version from `1.0.0` and the patch below it.
_Avoid_: Minor fragment, enhancement

**Fix fragment**:
A change fragment, named `<slug>.md` with no kind prefix, for a compatible correction. It advances the patch version.
_Avoid_: Patch fragment, ordinary fragment, bugfix

**Release cut**:
The reviewed commit that consumes pending change fragments and sets the synchronized version and changelog for one release. It may also mark accepted the proposed decisions the release ships, and change nothing else.
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

## Toolchain

**Package directory**:
The directory of the nearest `package.json` at or above where a `loom` command runs. Every command acts on that one package, never on a repository as a set of packages.
_Avoid_: Project root, workspace, repository root

**Scaffold file**:
A file or `package.json` key `loom init` writes once, when it is missing, and never overwrites or tracks, because it is the author's code from the moment it is written, such as `src/application.ts`.
_Avoid_: Template, generated file, boilerplate

**Managed file**:
A file `loom init` keeps current, such as the fragment guide, marked by a header that holds a checksum of its content. Init re-renders it while the checksum matches and warns once it drifts; deleting the header makes it the author's file.
_Avoid_: Generated file, owned file, vendored file
