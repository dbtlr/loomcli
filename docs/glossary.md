---
description: The Loom CLI domain model. Canonical names for the concepts an Application, its Commands, inputs, invocation phases, output, and failures are built from, with the synonyms to avoid.
---

# Loom CLI Glossary

Loom CLI is a framework for defining a typed command application once and serving human operators, agents, and automation from that one definition. This glossary names the concepts the definition is built from. Use these names in code, documentation, diagnostics, and reviews, and challenge language that drifts from them.

## People

**Author**:
The developer who builds and ships an application with Loom. The author owns the application's code and every value that code creates, and Loom trusts it.
_Avoid_: User, developer (for the role)

**Operator**:
The person or agent who runs a built application and cannot change its code. Every operator message Loom ships is addressed to the operator.
_Avoid_: User, end user

**Reach**:
Who can supply a value or set off a behavior: an operator through what Loom ships, only the author's own code, or only a construction built to break the code. Reach sets how deeply Loom specifies, tests, and reviews the behavior.
_Avoid_: Attack surface, threat model, exposure

## Authoring

**Application**:
The root of one command application: an unnamed root Command plus the application's name, its global options, and its view overrides. One Application value exists per application, and it alone can run or be inspected.
_Avoid_: Program, CLI object, app root

**Command**:
A standalone typed declaration value with a canonical name, its arguments, its local options, its aliases, its children, at most one stdin target, and at most one action. A Command is not defined by its place in a path; it carries everything it needs as a value.
_Avoid_: Subcommand (in the model; operator diagnostics may still say "subcommand"), verb, handler

**Root Command**:
The unnamed Command an Application owns. It is the entry point of routing and follows every Command rule except naming, aliasing, and the hidden and deprecated facts, which it never carries.
_Avoid_: Main command, default command

**Child** and **Parent**:
A Command attached under another Command by a `command()` call, and the Command it is attached to. A Command value is a child at one point in one Application's graph, and a Command path may reach any depth below the root.

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
One of the calls that produce a new declaration: `argument()`, `option()`, `globalOption()`, `exclusive()`, `oneRequired()`, `requiredTogether()`, `stdin()`, `alias()`, `result()`, `rows()`, `views()`, `command()`, `action()`, and `extend()`. The set a declaration still offers is part of its type, so the calling order is a compile-time rule for an author; a plugin's lifecycle hook makes the same calls with their types erased and the closures `action()` applies do not bind it.
_Avoid_: Builder method, chain step

**Action**:
The handler a Command registers after its inputs, aliases, and children, which receives the parsed and validated invocation and performs the work. An action is lazy by definition: registering it runs nothing, and core calls it only when routing selects its Command and the invocation reaches dispatch. A Command has at most one action, and registering it closes input, alias, child, and action declarations for the author. Command-targeted extension configuration and a result's `views()` remain open, and a plugin's lifecycle hook is exempt from the closure.
_Avoid_: Handler, run function, executor

**Action context**:
The single object an action receives, carrying its validated inputs, the supplied record as `supplied`, the interaction decision as `interactive`, any stdin-only input as `stdin`, the passthrough tail, the output channel, the host, the signal, `cancel`, which aborts the signal, the style, the graph, the routed Command, `invoke`, which runs another Command of the same graph by name, `log`, which records log events, and `provided`, which holds the provided values of the providers its Command opts in to.
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
A named input introduced by a hyphen spelling: a string, content, Boolean, or counted option. String options consume values, content options consume paths, Boolean options report their spelling's value, and counted options report how often they were supplied.
_Avoid_: Flag, switch, parameter

**Content input**:
A native argument or local option whose supplied values name file sources and whose action values are lazy content handles. A content input may be scalar or a collection, and may be its Command's stdin target.
_Avoid_: File validator, file-or-stdin validator, content validator, document option

**Content**:
A lazy handle for one readable file source or stdin, with its kind, name, file path when present, and text and stream reads. File reads open afresh, while stdin handles share one stream at its current position.
_Avoid_: File contents, payload, input stream (for the handle), buffered document

**Stdin target**:
The one input on a Command that claims available nonterminal stdin: a content input carrying `stdin: true`, or a stdin-only input. It places stdin among a content collection's sources, fills an absent scalar content input, or exposes stdin separately.
_Avoid_: Stdin owner, stdin binding, pipe input

**Stdin-only input**:
A Command input declared through `stdin()` that consumes no command-line word and exposes its content handle separately as `stdin`. It is the Command's stdin target and may require a source or permit absence.
_Avoid_: Stdin argument, stdin option, stream parameter

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
The way an option reads words, of which there are four: a Boolean option, a counted option, a string option with an implied value, and a string option that takes a separate value. A native content option shares the last class, and a parent's own option typed before a child's name binds to the child's option of that spelling only when both share one value class.
_Avoid_: Arity, option shape, value kind

**Command table**:
The one spelling table graph build gives each Command after the lifecycle hooks have run: its local options and every global option, each entry referencing its one declaration. The routed Command's words are read against it.
_Avoid_: Globals table, merged options, copied globals

**Polarity**:
The Boolean option setting that selects which long forms exist and what an absent option means: `positive`, `negative`, or `both`.
_Avoid_: Negation mode, inverse flag

**Option group**:
A declared relationship among a Command's local options: at most one supplied, at least one supplied, or all supplied together. It is distinct from a routing Group and a help Section.
_Avoid_: Flag group, validation group, constraint

**Multiple option**:
A string or content option that collects every occurrence into one array instead of rejecting the second. An omitted string option with no default receives `[]` and calls no per-value validator, while a content option holds assembled sources, including stdin when claimed.
_Avoid_: Repeatable flag, array option, list option

**Counted option**:
An option that takes no value and reads, as a number, how many times it was supplied across every spelling, so `-vvv` reads 3 and an option nothing supplied reads 0. Repeating it is never a fault.
_Avoid_: Verbosity flag, counter, incrementing flag

**Control option**:
An option that controls the invocation rather than feeding the Command's work, such as `--help`, `--version`, `--manifest`, or `--format`. The declarer marks it with `control`, core never reads the mark, and a projection that lists what a Command needs, such as the MCP tool listing, leaves it out.
_Avoid_: Meta option, system option, framework option, takeover option (for the mark)

**Default**:
The value a declaration supplies for an omitted optional input: one no token supplied and, for an option, no input source filled. A default is stated in the validator's input type, an array of such values for a multiple option or a variadic argument, and passes through the validator like a supplied value. The value the author declared is the value the graph publishes and the validator receives, nested as deep as the author writes it, and each invocation receives its own copy of an array default.

**Implied value**:
The value a string option takes when its spelling is supplied bare, with nothing attached. An explicit value is attached to the spelling, because a bare spelling never takes the next word; a default, by contrast, fills an option nothing supplied. Like a default, it passes through the option's validator before any token is read.
_Avoid_: Optional argument, flag value, const value

**Input-source stage**:
The invocation phase between local parsing and validation that fills each unfilled option from the prepared environment and then the configuration source, under the fixed precedence argv, environment, configuration, default. A filled value is supplied in every sense, and nothing downstream can tell which tier supplied it; only core's failure messages name the source. The supplied record tells an action whether a value was supplied, never by which tier.
_Avoid_: Config merge, fallback chain, value resolution

**Environment preparation**:
The phase after graph build and before declared values or inputs validate, in which installed environment hooks contribute missing variables. It preserves existing values and applies the process boundary independently of input-source precedence.
_Avoid_: Input-source tier (for preparation), dotenv stage

**Prepared environment**:
The run's captured environment after installed environment hooks add missing variables, shared by downstream validation, sources, middleware, actions, logging, and failure reports.
_Avoid_: Dotenv environment, merged config

**Environment binding**:
The variable, or the ordered list of variables, an option names with `env` on its declaration, from which the input-source stage fills the option when argv does not supply it. With a list, the first name holding a non-empty value supplies it. Binding is explicit only, an argument and a multiple option never bind, and within one invocation's scope a variable binds one option. Host conventions such as `NO_COLOR` are rendering policy and not bindings.
_Avoid_: Env var option, env fallback, auto env

**Validator**:
The Standard Schema object an ordinary value input declares through `validate`: a catalog validator, one built with `createValidator`, or a schema library's value such as a Zod schema, which core cannot tell apart. It receives one value of its input type, a supplied string, a default, or `undefined` under `validateOmitted`, and on a multiple option or a variadic argument each value in turn; it decides acceptance, and determines the action's value type. Native content inputs declare no validator. "Validate" names the action and "validator" the object; "schema" names a description of validation, such as an input schema.
_Avoid_: Schema (for the object), parser, type guard

**Validator catalog**:
The validators `@loomcli/validators` ships as factories, each built with `createValidator`, so an author covers a common input shape without a schema library. A factory earns its slot by covering a shape a command-line author would otherwise need a schema library for.
_Avoid_: Built-in validators, core validators

**Validation context**:
The facts core attaches to every validator call it makes: the phase, the input's identity, the routed path, the passthrough tail, the raw supplied values, tokens and the values input sources filled alike, and the host. A validator reads it to decide rules that depend on the invocation.
_Avoid_: Schema options, environment

**Supplied record**:
The raw value of every input some tier supplied in one invocation, keyed by declared name. An input that was omitted or left to its declared default reads `undefined`, or `[]` for a multiple option or a variadic argument. Validators read it in the validation context and the action reads it as `supplied`; it says whether a value was supplied, never which tier supplied it.
_Avoid_: Provenance, raw options, source map

**Conditional requiredness**:
The presence rule `required: 'non-interactive'` on a local string option that takes one value: the option is required when the run's interaction decision is off and optional when it is on, so the action can ask for it.
_Avoid_: Soft required, required unless prompted

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

**Interaction decision**:
The one verdict per run, computed before validation, on whether the run may ask the operator questions: on only when stdin and stderr are terminals, the run is not under CI, and the interaction mark does not turn it off. Conditional requiredness and every question read the same verdict.
_Avoid_: TTY check, interactive mode, host.interactive

**Interaction mark**:
The `interaction: true` fact on the one Boolean global option whose value states the application's intent to ask questions. It can turn the interaction decision off and never on.
_Avoid_: No-input flag (for the mark), interactive option

**Color choice**:
The operator's color setting for one run: the last spelling of the color-marked option among argv's words before the first bare `--`, read right after host capture so everything the run prints after capture follows it. A positive spelling turns color on and a negative one turns it off, over `NO_COLOR`, `FORCE_COLOR`, and the declared rendering policy, and modifiers and hyperlinks keep their own policy.
_Avoid_: Color lane, color mode, color flag (for the choice)

**Color mark**:
The `color: true` fact on the one Boolean global option whose spellings carry the operator's color choice. The marked option binds no variable and no configuration key, because the environment speaks for color only through `NO_COLOR` and `FORCE_COLOR`.
_Avoid_: No-color flag (for the mark), color option

**Verbosity**:
The run's one setting of which lanes write, settled right after graph build from argv with the parser's own word reader: the verbose-marked option's occurrences, read as 2 above 2, less the quiet-marked option's, read as 1 above 1. At 0, the default, `info`, `success`, `warn`, and `error` write; 1 adds `debug`, 2 adds `trace`, and -1 hides `info` and `success`. `print`, rendered output, `draw`, results, warnings, errors, failures, and the incomplete-result line write at every verbosity. An invocation by name settles its own from the values it lowers.
_Avoid_: Log level (a log level belongs to a log event), detail level, verbose mode, quiet mode

**Verbose mark**:
The `verbose: true` fact on the one counted global option whose occurrences raise the verbosity. The marked option binds no variable and no configuration key, because the verbosity settles before the environment and configuration are read.
_Avoid_: Verbosity flag (for the mark), verbose option

**Quiet mark**:
The `quiet: true` fact on the one counted global option whose occurrence lowers the verbosity by one step, which hides `info` and `success`; a further occurrence adds nothing. It binds no variable and no configuration key, as the verbose mark does.
_Avoid_: Silent flag, quiet option (for the mark)

**Background**:
The run's terminal background, `dark`, `light`, or `undefined` when no source knows it, which core settles once per run, right after the color choice and before environment preparation, from the first source that answers: the operator's background choice, the author's `rendering.background`, a background the run's process handle states, and then, only when a theme entry is adaptive or an option carries the background mark, `undefined` when stdin, stdout, or stderr is not a terminal or the run's color is off, dark when `TERM` is `linux`, a query to the terminal, `COLORFGBG`, and otherwise `undefined`. An adaptive style resolves against it, taking its dark side when it is `undefined`, and the host and every view context read it. An invocation by name reads `undefined`.
_Avoid_: Theme mode, color scheme, appearance, dark mode (for the fact)

**Background choice**:
The operator's background for one run: the last occurrence of the background-marked option among argv's words before the first bare `--` whose value is `dark` or `light`, read right after host capture beside the color choice. It comes before every other source of the background.
_Avoid_: Background flag, theme switch

**Background mark**:
The `background: true` fact on the one string global option whose value carries the operator's background choice. The marked option takes argv as its one source, so it binds no variable or configuration key and declares no default, implied value, or short alias.
_Avoid_: Background option (for the mark), theme option

**Invocation**:
One `run()` or `invoke()` call: host capture, graph build, routing, parsing the routed Command's words, the input-source stage, validation, the middleware chain, the action, and the exit status. An action's `invoke()` captures no host and builds no graph: it takes its host fields and its graph from its own run.
_Avoid_: Execution, call, request

**Invocation by name**:
An invocation that names its Command by path and its inputs by declared name instead of by argv, captures what the run writes, and resolves a structured outcome: completed, failed, or cancelled. It reports inputs by name and makes no process effect, following argv behavior except that no stdin is available for content and the call may exclude options. An action starts one through `invoke` on its context, and an embedding host through `app.invoke`.
_Avoid_: Programmatic run, child run, sub-invocation, tool call (for the invocation)

**Excluded option**:
An option an invocation by name leaves out of its run through `invoke`'s `exclude`. No tier supplies it, so a variable or a configuration key bound to it is a value no input reads, and it takes its declared default. The exclusion lasts for the one call, so help, the manifest, completion, and a command line still read the option. The MCP plugin excludes an option whose `mcpInput` value is `{ exclude: true }` from every tool and every tool call.
_Avoid_: Omitted option (every excluded option is omitted, but an omitted one need not be excluded), hidden option (hidden keeps it off the listings), ignored option

**Request**:
The read-only snapshot of the routed Command's validated argument, local option, stdin-only input, and passthrough values that middleware reads through `request`. Global options are separate, and the request is `null` while core holds a fault or the routed Command is a group.
_Avoid_: Parsed invocation, parsed input, raw input (which is the pre-validation form)

**Dispatch boundary**:
The point the middleware chain reaches when it continues past its last middleware: core raises the fault it held, or reads the selected view, builds the providers the routed Command opted in to, and dispatches the action. A takeover never reaches it.
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

**Child program**:
A program a run starts through `host.spawn`, with no shell, in the run's working directory and environment unless the call names others. The real process's handle starts it for real, and a mock answers it from the script the test gives for its command.
_Avoid_: Child process (for what a run starts), subprocess

**Host**:
The facts of the process an invocation runs in, copied from the run's process handle: argument tokens, working directory, home folder, temporary folder, environment, platform, architecture, C library, user ID, the standard streams, terminal facts, and the release facts, with `spawn`, the run's one way to start a child program. Core copies the facts once per run, except that it reads terminal width and height live and settles the terminal's background rather than copying it, and retains the streams; installed environment hooks may then add variables before inputs are read. A working directory that cannot be read fails the run with a `WorkingDirectoryError`.
_Avoid_: Environment (for the whole object), process, platform, context

**Process handle**:
The one object a run reads every process fact from and sends every process effect to, such as its exit status, the signals core listens for and re-raises, and the child programs the run starts, bound when the run enters and never replaced during it. It owns no clock, timer, randomness, network, or file system. `processHandle()` builds the real process's handle, and `@loomcli/testing`'s `mockProcess()` builds a sealed one that reads nothing from the process a test runs in and scripts each child program instead of running it.
_Avoid_: Host (for the handle), process object, host overrides

**Mock keyboard**:
The stdin a mock process handle has in place of piped text when a test gives its terminal scripted keys: a terminal of the mock's own signal source, which hands one scripted entry each time a reader switches it to raw mode, so a question reads what the operator would type once it appears.
_Avoid_: Fake stdin, input script, typeahead

**Signal source**:
The part of a process handle that delivers process signals and the process's own end. Every handle over the real process shares its one signal source, a mock has its own, and a signal reaches only the runs whose handle shares the source it was raised on.
_Avoid_: Process lane (for the source), signal bus

**Release facts**:
The facts that say how the running application was built, released, and installed: its build, which is `source`, `development`, or `distributed`, an optional release group with its version, release channel, repository, and asset, and an optional installation group. The build bakes the build and release group into the artifact, core reads the installation group from the installation record, and core holds them on the host as `release`. An artifact built with none reads `source`.
_Avoid_: Packet, build info, environment, mode, `NODE_ENV`

**Release channel**:
The release line a version belongs to, which core derives from the version: its first prerelease identifier, such as `next` for `1.1.0-next.3`, or `stable` when it has none. It is an open set of names, the release facts name the field `channel`, and self-update follows the running binary's channel unless the operator names another.
_Avoid_: Lane (a lane is an output area), channel (alone, which names `out`), track, dist-tag

**Installation record**:
The directory, one per application and per user in the platform's state directory, that says how the application was installed and which files its installers wrote. Its `install.json` holds the installation, which an installer script and self-update write and core reads into the release facts when its path is the running executable; each first-party plugin that installs files keeps what it installed, files with their digests, whole folders, or startup lines, in files of its own there. A file the application writes there under a name no first-party writer uses is the application's own.
_Avoid_: Receipt, installation receipt, journal, ledger, manifest

**Startup line**:
The one line an installer adds to a shell's startup file, such as `.zshrc` or the PowerShell profile, that loads a completion script it installed and names the Command that added it. The installer writes the line into a file it may change, and prints it for the operator to add to one it may not. The installation record holds the text of a line the installer wrote, rather than the file's digest, because the startup file is the operator's, and it never holds a line the operator added by hand.
_Avoid_: Shell hook, rc line, profile snippet, init block

**Development build**:
An application whose release facts read `source` or `development`: the source run while the author works, an artifact built with no facts, or an artifact built for development. A defect or declaration fault shows the author its Developer Diagnostic, and checks that only development runs report author mistakes a distributed build tolerates.
_Avoid_: Debug mode, dev mode, source mode

**Distributed build**:
An application whose release facts read `distributed`: what an operator installs. A defect or declaration fault that `run()` reports shows the generic defect message. Operator failures print the same bytes in both builds.
_Avoid_: Production, release mode, shipped mode

**Exit code**:
The status `run()` resolves and writes to its process handle. It reports whether the invocation succeeded and, if not, which category of failure, which failure class, or which cancellation ended it. 0 is success, 1 and 2 are core's failure categories, 3 through 125 appear only as declared exit codes, which may also be 1 or 2, 129 is a cancellation by `SIGHUP`, 130 a cancellation by `SIGINT`, by the caller, or by the action's `cancel()`, 131 a cancellation by `SIGQUIT`, 141 a closed pipe, and 143 a cancellation by `SIGTERM`.

**Declared exit code**:
The exit code a failure class states as its static `exitCode`, read from the nearest ancestor that declares one, so every failure of one class exits with one code. Its type is a whole number from 1 through 125; 0 and 126 and above are reserved.
_Avoid_: Custom exit code, error code, status override

**Run signal**:
The one cancellation signal a run creates and hands to every middleware and the action. A caller-supplied signal, a shutdown, the action's `cancel()`, or a closed pipe aborts it, with a `CancellationReason` naming the cause.
_Avoid_: Abort controller (for the concept), cancellation token, interrupt

**Closed pipe**:
The reader of a run's stdout closing the pipe, as `head -1` does once it has its line, so the run's next stdout write fails with `EPIPE`, or with `ENOTCONN` on a macOS socket. It ends the run as a cause of the run signal and exits 141, following the `SIGPIPE` convention; it is not a broken destination, which every other failed write is.
_Avoid_: Broken pipe (for the run's end), SIGPIPE (core receives no signal)

**Shutdown**:
What an ending signal, `SIGINT`, `SIGTERM`, or `SIGHUP`, starts while core listens: core aborts the signal of every live run whose process handle shares the signal source, gives the runs the shutdown budget to unwind, then calls every pending `onShutdown` handler synchronously, newest first, and re-raises the signal, so the process dies by it. It ends at the first of every run resolving, the budget running out, or a second ending signal. `SIGQUIT` ends the process the same way with no budget.
_Avoid_: Cooperative claim, immediate path, force path, graceful shutdown (for core's), exit backstop

**Shutdown budget**:
How long a shutdown waits for the runs to unwind before it ends the process: `shutdown.timeout` on the Application, 500 ms unless the Application sets another, the longest among the live runs' Applications. A small budget keeps Ctrl-C instant.
_Avoid_: Grace period, deadline (for the setting), timeout (alone, for the concept)

**Shutdown handler**:
A synchronous function registered through `onShutdown`, on the action or middleware context for a run or exported from `@loomcli/core` for the process, that restores what must not outlive the process, such as raw mode or the cursor. It runs once, at the shutdown's end or at the process's own `exit` event, newest first. A run's handler is removed when the run ends outside a shutdown.
_Avoid_: Cleanup, defer, disposer, finalizer, exit handler, process event

**Signal lane**:
What one signal source's listeners, live runs, and shutdown, suspend, and resume handlers are kept in. Core listens and re-raises through the lane of each run's signal source, so a shutdown aborts every run that shares it. The real process's lane lives under `globalThis[Symbol.for('loomcli.processLane')]`, shared by every copy of `@loomcli/core`, and holds a map from every other source, such as a mock's, to its lane, so one source has one lane however many copies of core ask. Its shape is a contract across versions of core that only grows.
_Avoid_: Process lane (for the lane of any other source), process events, signal registry

**Suspend**:
What `SIGTSTP` does while core listens for it, from Ctrl-Z at a cooked terminal or a reader that raises it for a raw Ctrl-Z byte: core calls each `onSuspend` handler, newest first, which restores cooked mode and shows the cursor, then removes its listener and re-raises `SIGTSTP`, so the default action stops the process. It cancels no run.
_Avoid_: Pause, background (for the event)

**Resume**:
What follows a suspend once the process runs again, after the `SIGCONT` that `fg` sends or at once where nothing stops the process, as in an orphaned process group or on a mock: core calls each `onResume` handler in registration order, which enters raw mode again and redraws.
_Avoid_: Continue, foreground (for the event)

**Interrupt key**:
Ctrl-C, Ctrl-\, or Ctrl-Z, which a cooked terminal turns into `SIGINT`, `SIGQUIT`, or `SIGTSTP` and raw mode delivers as the byte 0x03, 0x1c, or 0x1a. A reader that reads keys in raw mode passes what it read to `raiseInterruptKeys`, which raises each key's signal through `host.raise`, or, where the stdin is not its signal source's own terminal, cancels the run for Ctrl-C and Ctrl-\ and drops Ctrl-Z, and drops the unread keys once a signal is raised, as a cooked terminal does.
_Avoid_: Control key, signal key, break key

## Output

View, Token, Glyph, and Theme follow the [style contract](core/styles.md) and the [view registry contract](core/views.md). The registry is implemented under accepted ADR-0021, so the package spells a view `View` and its context `ViewContext`. Result, Row view, View name, and `ResultError` follow the [results contract](core/results.md), which is implemented under accepted ADR-0023. Column, Field, and Identifier follow the [table](plugins/pack-views.md#table) and [records](plugins/pack-views.md#records) contracts.

**Out**:
The output channel object an action or a middleware receives, carrying the semantic methods, the neutral render call, the region call that opens a live region on stderr, the draw call that draws one frame there, the text call that returns what the render call would write without writing it, the result call, and the fatal path. On a Command that declares a result, the action's `print` and `render` move to stderr beside `info`, `success`, `warn`, `error`, `debug`, and `trace`, `results` owns stdout, and `fatal` still throws without writing; a middleware's `out` keeps the default destinations and its `results` accepts no value, typed `never`, and no method is ever removed.
_Avoid_: Logger, console, writer, printer

**Semantic output**:
A message written through one of the seven purpose-named methods: `print`, `info`, `success`, `warn`, `error`, `debug`, and `trace`. Each has a fixed default destination and appends one newline. The run's verbosity decides whether `info`, `success`, `debug`, and `trace` write.
_Avoid_: Log level (a log level belongs to a log event), styled output

**Rendered output**:
Text a view produces from one value and `out.render` writes, after core resolves its markup for the destination stream. It has no semantic identity and no destination parameter, and from an action it goes to stderr on a Command that declares a result.
_Avoid_: Formatted output, verbatim output

**Live region**:
An area at the bottom of stderr that core redraws in place while it is open, which `out.region()` opens and whose handle draws frames into it. Open regions stack in the order they opened, below every other write, which core writes above them, and a closing region's last frame stays in scrollback. Core draws one only when stderr is a terminal and, unless it is an input region, the run is not quiet, and core closes one left open when what opened it finishes: the action's return for the action's regions, and the middleware chain's unwinding for a middleware's or a configuration source's. `out.draw` is a region of one frame that core writes above the open regions, as it writes every other write, at every verbosity.
_Avoid_: Status area, live area, spinner area, region broker, sticky footer

**Frame**:
The text one draw of a live region renders through a view. Core keeps a region's latest frame, redraws it after every other write, and recounts its rows at the current width before it erases it.
_Avoid_: Screen, snapshot, render (for the text)

**Input region**:
A live region opened with `input: true`, which reads the operator's keys, as a question does. While it is open, core draws no frame of any other region and draws each latest frame once when it closes, and one input region is open at a time. It draws at every verbosity.
_Avoid_: Prompt region, modal, focus

**Progress event**:
The typed value a live region's report builds, `{ id, label, state, completed?, total? }`, whose state is `started`, `updated`, `ended`, `failed`, or `cancelled`. An invocation by name delivers each one to its `onProgress` observer, and the MCP plugin sends each one as `notifications/progress`. It is not a log event.
_Avoid_: Progress notification (for the event; the MCP message is one), log event, progress log

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
A view the plugin pack ships as a configured factory, such as `table({ columns })`, `records({ identifier })`, `list({ ordered })`, or `heading({ level })`. The factory's return is a bare view typed from the data it is written against: the row type for the table, the records list, and the list, a string for the heading, the rule, prose, and a text box, and the framed view's data for a box with content. Its configuration is plain data the returned view holds and never publishes, and a pack view is replaced by name alone, through a result's `views()` and never through an override.
_Avoid_: Built-in view, formatter (for a pack view), widget

**Column**:
One entry of a table view's `columns` list: a key of the row, an optional header, an optional alignment, and an optional `format` that renders that cell. The list order is the column order, a key may appear twice, and an omitted list makes every key that appears in the rows a column in first-seen order. A column is as wide as its widest header or cell when the table fits the destination's columns, and otherwise the widest columns shrink by levelling, down to a floor, the widest unit `wrap` keeps whole, such as a word or a `nowrap` frame, and their text wraps inside them.
_Avoid_: Field (for a column), table column definition, Columns (the destination's width, a separate term)

**Field**:
One entry of a records view's `fields` list: a key of the row and an optional `format`. A field carries no header and no alignment, because the key is the label the line prints and the value column is one lane. An omitted list makes every key that appears in the record a field in first-seen order. On a terminal its value wraps at the width left after the key column, and a table whose columns cannot fit renders its rows in this layout.
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
The declared view behind one of the seven semantic methods, exported by core under `lanes`, each over the message string. An override of a lane view owns its glyph gutter and its wrapping, and the newline the method appends is outside the view. The bare word lane also names an output area of core, as in the results lane.
_Avoid_: Channel, log level (a log level belongs to a log event), stream (for the lane view)

**Columns**:
The effective width of the destination a view's text reaches, read live at render time: just before each render call core takes the destination's real width and passes it to the view as the context's `columns` member. It is `undefined` when that destination is not a terminal, such as a pipe, a file, an invocation by name, or an MCP tool call. `COLUMNS` only narrows it, under [the rule in the core reference](core/styles.md#width-padding-and-multiline-lanes): it never widens a layout past the width a terminal reports. The same context offers `wrap(text, columns)`, which breaks lines at spaces when the view runs and never splits a word, and `expandTabs(text)`, which turns each tab into the spaces that reach its stop, so text placed at an offset shows as it measures, and core's `nowrap(text)` marks a path or a URL that `wrap` and a table's floor keep whole, and `context.wrap(text, context.columns)` leaves the text alone when `columns` is `undefined`. `host.terminal` reports the real, live width and never reflects `COLUMNS`. A Column, one entry of a table view's `columns` list, is a separate term.
_Avoid_: Terminal width (for the view context member), screen width, line length, Column (a table view's entry)

**Token**:
A semantic name for a theme-defined appearance, carried as markup until core resolves it for the destination. Core supplies seven names, and theme configuration introduces custom names in one Application vocabulary.
_Avoid_: Color, style name, class

**Adaptive style**:
A theme entry, built by `style.adaptive({ dark, light })`, that holds one concrete style for each background, so core resolves its token to the side that matches the run's background each time it emits it. A plain entry looks the same on both backgrounds. An adaptive style styles no text itself.
_Avoid_: Light palette (for the entry), dual style, theme variant

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
The usage error that carries the whole validation phase: every omitted required input, every value a validator rejected, and every native content preparation problem, in authoring order, followed by broken option groups in their declaration order.
_Avoid_: Validation error, schema error

**Declaration error**:
A failure caused by the author's declarations. A declaration fault throws at the earliest moment that holds the data proving it: the authoring call or constructor, the attach, or graph build. A declared default or implied value its validator rejects and a validator that throws or returns a malformed result are declaration errors found during a run. It names the declaration, or, for a validator factory's argument, the factory, and carries its Developer Diagnostic. One that `run()` meets reports with exit 1, as a defect in a distributed build; one thrown at a call or an attach is an uncaught exception whose message holds the diagnostic.
_Avoid_: Config error, definition error, developer error (in the class name)

**Fatal error**:
The failure `out.fatal()` throws to end an action with a message. It exits 1 and carries no category prefix. An application subclasses it for its own failures, and a subclass may declare its own exit code.
_Avoid_: Abort, panic, crash

**Internal error**:
A failure core wraps around an unexpected exception no translator answered, a throw from a view, a translator, or an `onFailure`, `onLog`, or `onEnvironment` hook among them, a broken failure view, or a broken destination whose write failure no translator answered, or raises when an action breaks the result contract: a promised result not emitted, or emitted twice. It exits 1.
_Avoid_: Unhandled error, bug (in output)

**Defect**:
A failure only the author can fix: an unexpected exception no translator answered, a broken view, hook, translator, or result contract, or an author fault that reached a run. It is the application's equivalent of an HTTP 500. In a distributed build the operator sees one generic message, `<application>: Something went wrong.`, with no reason, class name, or code detail; in a development build the author sees its Developer Diagnostic. A log record that a logging plugin the author installed writes to the console is not an operator message, and may carry the defect's detail.
_Avoid_: Bug, crash, internal error (for the concept rather than the class)

**Diagnostic**:
The text core writes to stderr for one failure: the prefix the view chooses, which is the application name on every problem line of a usage failure and on a `WorkingDirectoryError`'s line, and nothing for a `FatalError`, whose authored sentence stands alone, then the sentence, its correction, and the hints the view prints. A defect or declaration fault writes the generic defect message or a Developer Diagnostic instead, by build.
_Avoid_: Error message (when the class is meant), log line, log record

**Developer Diagnostic**:
The author-facing report of a declaration fault or a defect: a banner with the rule's headline and identity, the sentence, the findings, an explanation of why the rule exists, the correction, and an optional docs link. It is not a view, and in a development build core renders it before consulting any override. Findings rebuild the declaration from graph facts, and a defect's findings show the author's own source lines.
_Avoid_: Stack trace, error page, debug output, verbose error

**Diagnostic rule**:
One reason a declaration can be wrong, or one kind of defect, declared once with `diagnosticRule` and shared by every site that raises it. Its identity is the declaring package's name and any kebab-case subpath segments that name the part of the package that owns it, which together form an identity, then a kebab-case rule name, joined by `/`, such as `@loomcli/core/spelling-taken` or `@loomcli/plugins/manifest/failure-code-conflict`, and it carries the headline, the explanation, and an optional docs link.
_Avoid_: Error code (for a rule), check

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
The kebab-case name a failure class declares as its static `code`, such as `unknown-option` or `path-not-found`, read from the nearest ancestor that declares one, so a machine reader tells failures apart where many share an exit code. Every defect and declaration fault reads `internal`, in both builds.
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
One rejection returned by a validator or native content preparation, with its message and optional path inside the value. Core keeps every field a validator attached, including issue codes and their parameters, while its native content issues carry no code.
_Avoid_: Validation error, problem (for the schema-level record)

**Issue code**:
The namespaced name of one sentence a validator package prints, such as `@loomcli/validators/integer-range`, carried on an issue with that sentence's parameters, the rule's settings. An author reads it through the package's typed descriptor to reword the sentence.
_Avoid_: Error code, message key, validation code

**Problem**:
One entry in an input error: an omitted required input, a rejected value together with its issues, or a broken option group naming its members.

## Logging

Log, Log event, and Log destination follow the [logging contract](core/logging.md) and the [`onLog` hook](core/lifecycle-hooks.md#observing-log-events); Log record follows the [logging plugin](plugins/logging.md).

**Log**:
The member of the action, middleware, source, and `onFailure` contexts that records what happened for a reader later, with the methods `trace`, `debug`, `info`, `warn`, and `error`. It writes nothing: each call becomes a log event, and with no `onLog` installed it does nothing. It is separate from Out, which renders for the person at the terminal.
_Avoid_: Logger, console, out (for the log)

**Log event**:
The frozen value one `log` call or one failure core reports creates: its time, level, message, fields copied as JSON, application, run id, path, the plugin that logged it, and, on core's failure events, the failure form and a defect's detail. Core hands it to every `onLog` hook.
_Avoid_: Log entry, log message, log line (for the event)

**Log level**:
The severity of a log event: `trace`, `debug`, `info`, `warn`, `error`, or `fatal`, the OpenTelemetry severity names. `fatal` is core's alone, for a defect; `log` has no `fatal`.
_Avoid_: Severity class, verbosity (for the level)

**Log destination**:
The outermost run's `env`, `platform`, and `stderr` that core passes an `onLog` hook beside each event: the parent run's under an action's `invoke`, and a `null` stderr under `app.invoke`. A log record never enters an invocation's captured output.
_Avoid_: Sink, transport, target

**Log record**:
One log event as the logging plugin writes it: one JSON line, the same in a file and on the console.
_Avoid_: Log line, log entry

**Logging plugin**:
The first-party plugin `@loomcli/plugins/logging`, an `onLog` hook that writes each event as a log record, appended to a size-rotated file in the platform's state or log directory or written to stderr.
_Avoid_: Logger, log sink

## Product surface

**Projection**:
A public surface derived from the Command graph, such as help, a manifest, completions, or the MCP tool listing. A projection reads the graph and adds nothing the graph does not hold.
_Avoid_: Export, output format, adapter

**Help page**:
The projection of one routed Command that the help plugin prints: its masthead, usage, visible members with the values each input accepts and the names of the variables and the configuration key bound to each option, never their values, and examples, with meaning independent of styling. It has two variants, compact help and extended help, and the spelling the operator typed selects one.
_Avoid_: Usage text, man page, help screen

**Help section**:
A named set of Command rows or option rows on a help page, under one heading or an outer and an inner heading. A section groups rows for the reader and does not define a routing Group.
_Avoid_: Group (for help grouping), category, plane

**Row set**:
The help page rows that share one left column: an outer heading's direct rows, or the rows under one inner heading. On a terminal a row set whose indent, left column, and floor exceed `columns` stacks, each left cell on its own line with its right cell below it.
_Avoid_: Column group, Group (for help rows)

**Compact help**:
The help page `-h` prints, for a reader who needs the syntax: the extended page without the details and the examples, ending with a pointer to `--help` when the extended page holds more.
_Avoid_: Short help, summary, brief help

**Extended help**:
The help page `--help` prints, for a reader who is learning the Command: the whole page, with the details and the examples. Help prints it whenever the help option was not typed as `-h`.
_Avoid_: Long help, full help, man page

**Details**:
A Command's teaching prose, written in Markdown inline or brought in from a file with a text import, which extended help renders as a stated subset after the masthead, keeping the author's lines off a terminal and reflowing its paragraphs to `columns` on one, and the manifest carries as written.
_Avoid_: Long description, body, help text, Markdown asset

**Help paging**:
The help plugin's opt-in rule, `help({ paging: true })`, under which a help page that holds at least as many lines as the terminal has rows goes to the pager instead of straight to stdout, when stdout is a terminal, `TERM` is set, not empty, and not `dumb`, and the run is not under CI. Compact help and extended help page alike, a paged page holds the bytes help prints unpaged, and nothing else the application prints pages.
_Avoid_: Pagination, paged output, more mode

**Pager**:
The program the operator's `PAGER` names, `less` when it is unset, which help runs through `/bin/sh -c` and `exec` with the page on its standard input and the run's stdout and stderr as its own, ignoring every exit code but the shell's could-not-start codes, 126 and 127, which print the page unpaged, as a shell that cannot start does. Ctrl-C cancels the run and ends the pager with it. A `PAGER` that is empty, holds only whitespace, or holds `cat` with surrounding whitespace alone turns help paging off.
_Avoid_: Viewer, scroller, less (for the pager in general)

**Completion**:
The projection a shell reads while the operator types: a script, printed or installed, that calls back into the application on each Tab and inserts the offered words, the canonical Command names, option spellings, and closed-set values that fit the word under the cursor. It never offers an alias, a hidden member, or a deprecated member, and it never evaluates what was typed.
_Avoid_: Autocomplete, suggestions, candidates (for the offered words), tab completion plugin

**Man page**:
The projection of one Command that the manpage plugin writes as a section-1 roff file for `man`: its name and summary, usage, details, members with their environment and configuration bindings, and examples. Each Command that is neither hidden nor under a hidden Command has one, named for the Command's path, such as `jsonkit-get`, and a page's bytes depend only on the graph.
_Avoid_: Manual page, manpage (outside the plugin's name), roff page, help page

**MCP tool**:
One opted-in Command as the MCP plugin serves it to a Model Context Protocol client: a name that is the Command's path joined with `_`, or the application name for the root, with each `-` written as `_`, a description for an agent, the Command's inputs as one object keyed by declared name, and the effect hints its author set. A Command is a tool only when it carries an `mcpCommand` value, and an alias never is. A call of the tool is an invocation by name of its Command.
_Avoid_: Endpoint, function, MCP command, tool (for a Command that has not opted in)

**MCP registration**:
An entry in one coding agent's own MCP configuration that names the application and the command line that starts its MCP server, made and removed through that agent's own command-line interface. The MCP plugin replaces or removes only the registrations the installation record lists, unless the operator forces an install.
_Avoid_: Installation (for the registration), host configuration, agent target (the agent is one program, not a folder layout), MCP install

**Formatter**:
The first-party plugin, `@loomcli/plugins/format`, that puts `--format` on every Command that declares a result, so a run selects a view by name, and that ships `json()` and `jsonl()` as whole views whose map reshapes the value under `result()` and the collected rows under `rows()`, and failure encoders for their two media types. A result has no encoding outside the view model: a machine view is a view like a table is.
_Avoid_: Format plugin, encoder (for the plugin), serializer, format (for the view), output mode

**Theme**:
The optional plugin that maps semantic tokens to concrete colors, modifiers, resets, or their combinations, or to an adaptive style that holds one for each background. A theme owns no glyphs, layout, or terminal policy, and an absent mapping inherits its surroundings.
_Avoid_: Color scheme, skin, style sheet, palette (for the plugin)

**Plugin pack**:
The one first-party package that ships every first-party plugin as its own separately installable subpath export.
_Avoid_: Bundle, standard library, batteries, default set

**Question**:
One prompt an action asks through `@loomcli/prompts`, of the kind text, secret, confirm, or select, drawn in an input region on stderr and answered from stdin while the interaction decision is on. It is part of the action, never a run stage or an input source.
_Avoid_: Prompt (for one question; the package is prompts), wizard step, input source

**Linked option**:
The local option a question names with `option`. Its raw supplied value prefills the question, and its validated value answers the question when the question is skipped.
_Avoid_: Bound option, backing option

**Progress line**:
One line of work in flight that an action shows through `progress()` from `@loomcli/prompts`, drawn in its own live region: a spinner while the work has no total, and a bar with counts once it has one. It ends as a success line, a failure line, or a cancelled line that stays in scrollback, and when its region is not live it writes one start line and, unless it is cancelled, one end line through the semantic lanes. It reports each change as a progress event.
_Avoid_: Spinner (for the whole line), progress bar (for the whole line), task, step

**Progress style**:
The spinner frames, their interval, and the bar cells every progress line of an application draws with, set by the optional `progressStyle()` plugin in the shape of a cli-spinners entry, `{ frames, interval }`. One call may pass its own spinner, and without the plugin the library's defaults apply.
_Avoid_: Theme (for the style), spinner theme, progress theme

**Manifest**:
The projection that describes the accepted built product to a machine consumer: how to construct inputs and what outputs and failures to expect. The first-party manifest plugin prints it for the routed Command as a self-contained slice. It lists no alias or hidden member, though a hidden Command routed to directly prints its own slice, and it excludes authoring provenance, diagnostics, and implementation history, and nothing depends on it: no projection or plugin reads a fact from it, because a fact a consumer needs enters the Command graph and reaches the manifest from there. A plugin that wants its own facts in the manifest supplies them through the manifest's collecting extension.
_Avoid_: Schema (for the whole document), spec, descriptor, tool listing

**Input schema**:
The JSON Schema an input's validator publishes through the Standard JSON Schema channel, or core publishes for a native content path, carried on the Command graph as a core fact so every projection reads what the input accepts. It describes one supplied value rather than an action's transformed value or content handle, and a multiple option or variadic argument publishes the same schema for each value. It is unknown, not unconstrained, where neither the validator nor core publishes one. A published input schema is sound: every accepted value satisfies it, so it may be looser than validation and never stricter.
_Avoid_: Constraint facts, choices, enum fact, shape (for the graph fact)

**Plugin**:
A frozen, explicitly installed value with a fixed identity that contributes options, one middleware, lifecycle hooks, extensions, views and view overrides, a configuration source, Commands attached to the root, or a slot claim through the same public contract first-party packages use. Its code runs where core calls it, at a hook or inside an invocation. Core installs none by default.
_Avoid_: Extension (for the whole plugin), addon, bundled plugin

**Identity**:
The string that names a plugin, an extension, or a declared view, fixed at the `plugin()`, `extension()`, or `view()` call that declares it. By convention it is an npm package name, scoped or unscoped, then zero or more kebab-case subpath segments joined by `/`, such as `help`, `@acme/config`, or `@loomcli/plugins/help/page`. It keys contributions and prefixes the declaring package's diagnostic rule identities, which add a rule name.
_Avoid_: Name (when the key is meant), id (in prose)

**Plugin identity**:
A plugin's identity. By convention it is the package name, or the package name with a kebab-case subpath when one package ships several plugins, and the plugin's extensions and views take it as their prefix.
_Avoid_: Plugin name (when the key is meant), id (in prose)

**Contribution**:
One thing a plugin adds to an Application: an option, a middleware, a lifecycle hook, an extension, a declared view, a view override, a configuration source, a Command attached to the root, or a slot claim. Contributions compose in installation order.
_Avoid_: Registration, feature

**Lifecycle hook**:
A function on a plugin definition that core calls at one named point of an Application's life, named `on` followed by the event, with the event's subject where it carries meaning. `onCommandAttach` is the first: it receives each Command's declaration at graph build, unlocked with its types erased, and returns the declaration to build. `onFailure` is the second: it receives each failure a run renders after graph build, an invocation by name's included, and returns hints. `onGraphBuilt` is the third: it receives the frozen graph once per build and may reject it, and it never contributes to it. `onLog` is the fourth: it receives each log event and its log destination during a run, and it observes and returns nothing. `onEnvironment` prepares additions to the captured environment before inputs are read, with merging and process writes owned by core. A hook runs in sequence at its point, and middleware is not one. No hook runs before or after an action, or at the start or end of a run: middleware runs around every dispatched action, and core's failure log events report a run that fails before the chain, such as an unknown command.
_Avoid_: Event handler, listener, callback, plugin API

**Slot**:
A core-declared position that exactly one plugin may claim. A second claim is a declaration error. The theme and the configuration source are the slots.
_Avoid_: Singleton, capability (for the position)

**Configuration source**:
The one optional `source` a plugin definition declares, which answers for configuration-bound options: those carrying a value of the plugin's own binding extension. It may also declare `schema`, the configuration's Standard Schema, whose JSON Schema core publishes as the graph's `configuration` fact and never validates with. Core loads it lazily only when such an option is still unfilled after argv and the environment and holds no environment fault, calls it once, and fills each option it answers, with a label core prints in failure messages. A fill the option's validator rejects is dropped and the option falls back as if no tier supplied it. Core holds no store, file format, or path grammar; the plugin owns what the binding means.
_Avoid_: Config loader, config provider, settings store

**Dotenv file**:
The `.env` file in the working directory from which the dotenv plugin imports every variable the process has not set, unless an allow list or a deny list narrows the import. It adds variables before inputs are read and leaves existing values, including empty values, unchanged.
_Avoid_: Configuration file (for this file), env source, input-source tier

**Configuration file**:
The one JSON, TOML, or YAML file the first-party configuration plugin reads in a run, never merged with another: the file `--config` names, or the file the author's variable names, or else the first found by the walk from the start directory up to the home directory, then the home file, then the XDG user file. A run under `--no-config` reads none. A JSON file may hold comments and trailing commas. Only the file `--config` names can fail a run; a broken file found any other way warns and leaves the run with no configuration.
_Avoid_: Config, settings file, rc file, dotfile

**Configuration schema**:
The one Standard Schema an author writes for the whole configuration file, in which every object key outside an array item or a record value is optional so that an empty file passes. Application code reads its output as the configuration's provided value. The configuration plugin passes it to the configuration source with a `$schema` property added, so core publishes the file's JSON Schema as the graph's `configuration` fact, which the manifest prints.
_Avoid_: Section schema, config type, settings schema

**Dropped value**:
A value in the configuration file that is set aside so that its fallback applies: removed from the configuration when the configuration schema rejects it, and kept there but not given to an option that cannot take it or whose validator rejects it. It never fails the run and is named at `-v` alone.
_Avoid_: Invalid config, lenient input, ignored key (for an unknown key, which is never reported)

**Start directory**:
The directory the configuration walk begins in: the value of the configuration plugin's directory option when the author declares one and the operator gives it, and the working directory otherwise. It never changes `host.cwd`.
_Avoid_: Project root, base directory, cwd (for the start directory)

**File pattern**:
The configuration plugin's `file` setting: a file name or relative path whose last segment's extension alone may be `*` or a brace list such as `{toml,yaml}`, naming candidates in order. In each directory the plugin looks in, the first present candidate is the file it finds, and it warns about every other present one. A literal extension locks the file's format.
_Avoid_: Glob (for the whole setting), wildcard path, file mask

**Middleware**:
A plugin's participation in an invocation, wrapping the request after routing, parsing, and validation. It receives every global option's value, which reads `null` while a global option has a structural fault or was rejected, the spellings of its own plugin's options, and in `ownOptions` the validated values of its plugin's own options, local ones included, which hold even while core holds a fault on another input, a structural or input-source one included, the routed node, the request, and the selected view, and it either takes over by returning or continues the chain by calling `next()`; the fault core held is raised at the dispatch boundary, which a takeover never reaches.
_Avoid_: Hook, interceptor, terminal option, handler (for the chain entry)

**Activation**:
A middleware's declared condition for running and loading: a list of its plugin's own option names, any of which being present activates it, or always. Present means supplied as a token or filled by the input-source stage, never by a default.
_Avoid_: Trigger, gate, filter

**Provider**:
A value of its own that hands an action a typed value, such as a database pool, a session, or data derived from validated global options. It has a name, a lifetime, the providers it uses, and an opener, the function its `load` imports, which builds the value from the global options it states, and it may declare a `close`. A Command or the Application's root opts in to a provider through `uses`; no plugin or Application installs one. A provider gives a value, where a middleware wraps a run.
_Avoid_: Context provider, service, resource, contribution, dependency injection

**Provided value**:
The value a provider's opener built, which an action reads under `provided` by its provider's name when its Command opts in. Core builds it at the dispatch boundary and closes it at the end of its lifetime, through the provider's `close` or the disposal protocol.
_Avoid_: Context value, injected value, resource

**Ephemeral**:
The default provider lifetime: the value is built at a run's dispatch boundary and closed when that run's action settles, so each nested `invoke` builds its own.
_Avoid_: Per-request, transient, scoped

**Persistent**:
The provider lifetime of the outermost run, the `run()` or `app.invoke` call that every action's `invoke` nests inside: the value is built the first time a run inside it needs it, shared by every nested `invoke`, and closed when the outermost run's action settles. It never outlives the outermost run, so it is not a process lifetime.
_Avoid_: Singleton, global, process-wide, cached

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
A declaration fact core owns and every projection reads without any plugin installed: description, version, hidden, deprecated, control, option groups, the input schema, native content type, stdin claims and declarations, content collection bounds, and a result's media types. The configuration schema is a graph fact core derives the same way, which only an installed configuration source declares.
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
A change fragment, named `breaking.<slug>.md`, for a change that forces a consumer to change its code or requirements. It carries a migration section, and its minimum bump is the major version from `1.0.0` and the minor below it.
_Avoid_: Major fragment, breaking changeset

**Feature fragment**:
A change fragment, named `feature.<slug>.md`, for a compatible addition. Its minimum bump is the minor version from `1.0.0` and the patch below it.
_Avoid_: Minor fragment, enhancement

**Fix fragment**:
A change fragment, named `<slug>.md` with no kind prefix, for a compatible correction. Its minimum bump is the patch version.
_Avoid_: Patch fragment, bugfix

**Ordinary fragment**:
A change fragment that is not breaking: a feature fragment or a fix fragment. Either kind requires at least a patch bump in this repository's synchronized release under [ADR-0083](decisions/0083-a-synchronized-release-may-select-a-version-above-the-fragment-minimum.md), while a package from `1.0.0` under [ADR-0067](decisions/0067-a-packages-changelog-cuts-its-version-from-three-fragment-kinds.md) bumps them differently.
_Avoid_: Patch fragment, minor fragment

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
The ordinary release cut that follows an abandoned unpublished version or a defective published one. It takes a version above the one it supersedes and never rewrites, republishes, or retags that version.
_Avoid_: Retry, rebuild, republish, repair

**Packed consumer**:
A throwaway package that installs the tarballs a release would publish, compiles against their declarations, and runs what it built as processes under Node and Bun. It is the closest proof of what an author installs from the registry, and it runs on every pull request that changes code and before every publication.
_Avoid_: Smoke test, integration package, runtime fixture

**Release asset**:
One platform's binary on an application's GitHub Release of the tag `v<version>`, named `<name>-<os>-<arch>`, with `-musl` for a musl Linux build, and listed with its digest in the release's `SHA256SUMS`. The installer script and self-update read this shape, and each repository's own release workflow publishes it.
_Avoid_: Artifact, download

**Self-update**:
The plugin Command that replaces the running binary with a verified release asset from the application's GitHub repository, the newest on its release channel or a version the operator names. It replaces only a binary whose installation record reads the method `script` and whose digest still matches, rewrites `install.json` afterwards, and keeps no copy of what it replaced.
_Avoid_: Auto-update, upgrade (for the Command), updater

**Update notice**:
The one `out.info` message the self-update plugin prints on stderr after the action of a run at a terminal, when its cache names a newer release on the running binary's release channel. A detached copy of the application refreshes the cache about once a day, so no run waits on the network, and the author or the operator can turn notices off.
_Avoid_: Update check (for the line), nag, banner

**Service unit**:
The file that has the platform supervise one of the application's own Commands for the user: a systemd user unit on Linux or a launchd user agent on macOS, named by the application's reverse-DNS label. The service plugin writes it through the installation record, runs `host.program` with the declared argument words from home, and starts, stops, restarts, reports, and removes it.
_Avoid_: Daemon (for the file), job, supervisor config

**Agent skill**:
A folder of instructions a coding agent loads to use the application, holding `SKILL.md` and any reference files beside it, named by a skill name of lowercase letters, digits, and hyphens. The application ships its skills inside itself, and the skills plugin writes each one where agents read it as a whole folder, so an installed skill speaks the surface of the binary that installed it.
_Avoid_: Prompt, plugin (for the folder), instructions file

**Agent target**:
One of the folder layouts agents read skills from: `claude`, which Claude Code alone reads, and `agents`, the shared folder that Codex and other agents following the Agent Skills standard read. Each has a global folder under the user's home and a project folder at a repository's root.
_Avoid_: Host (the process environment), agent (for the folder), provider

## Toolchain

**Package directory**:
The directory of the nearest `package.json` at or above where a `loom` command runs. Every command acts on that one package, never on a repository as a set of packages.
_Avoid_: Project root, workspace, repository root

**Entry**:
The module that calls `run()`, by default `src/main.ts`. `loom build` bundles from it, and a test never imports it, because importing it runs the application.
_Avoid_: Main file, bin script

**Application module**:
The module that exports the Application, by default `src/application.ts`. A test imports it and passes the Application to the assembly check, which reads every fault, and a `node` or `bun` bundle carries it beside the entry, so a caller imports the built Application with its baked release facts.
_Avoid_: App file, application entry

**Scaffold file**:
A file or `package.json` key `loom init` writes once, when it is missing, and never overwrites or tracks, because it is the author's code from the moment it is written, such as `src/application.ts`.
_Avoid_: Template, generated file, boilerplate

**Managed file**:
A file `loom init` keeps current, such as the fragment guide, marked by a header that holds a checksum of its content. Init re-renders it while the checksum matches and warns once it drifts; deleting the header makes it the author's file.
_Avoid_: Generated file, owned file, vendored file

**Installer script**:
The managed `install.sh` that `loom init` renders for an application with a GitHub repository. Under POSIX `sh` on Linux and macOS it installs the platform's release asset, verified against the release's `SHA256SUMS`, and writes `install.json` in the installation record with the method `script`, so self-update may later replace the binary, and, when the Application declares them, runs its post-install command and prints its post-install message.
_Avoid_: Installer (alone), bootstrap script, setup script

**Post-install command**:
The one command an Application declares as argument words in `postInstall.command`, such as `setup`, that the installer script runs as the installed binary once the binary is verified, placed, and recorded. The script announces it first, gives it the operator's terminal or `/dev/null` as stdin, warns and still succeeds when it fails, and skips it under `--skip-post-install`; self-update never runs it. What it writes is the application's.
_Avoid_: Post-install hook, setup hook, install script, lifecycle script

**Post-install message**:
The text an Application declares in `postInstall.message` that the installer script prints last, each line opening with the application's name, whether the post-install command ran, failed, or was skipped.
_Avoid_: Caveats, notes, install notice

**Lint rule**:
A check over an application's source, shipped in Loom's lint plugin for ESLint and oxlint, that guides an author where a type cannot express the rule, in the editor and in CI. Unlike a diagnostic rule, it reports source before anything runs, and adding one is a contract change.
_Avoid_: Diagnostic rule (for a lint rule), `loom check`

**Assembly check**:
The check from `@loomcli/testing` that a test runs to prove an Application assembles: it applies every build rule except the validation of declared defaults and implied values, and fails the test with each fault's Developer Diagnostic.
_Avoid_: `loom check`, smoke test, health check

**Built context**:
The context `@loomcli/testing` builds for one author function, an extracted action handler, a middleware, an `onFailure` hook, a provider's opener, or a view, so a unit test calls that function with no Application. The test states the function's input records whole, typed as the context types them, and every member it does not state does nothing, gives an inert answer, or throws a sentence telling the test to state it. Nothing in it comes from core: no host, style, measure, or default.
_Avoid_: Fake context, stub context, mock context (a mock is a process handle)

**Process test**:
A test that starts the application as a child process, kept for behavior only a process has, such as a real signal and its exit status, a pseudo-terminal, a real shell, or stdio framing. Every other test runs the application in the test's own process through `run()` or `invoke` on a process handle, usually a mock, or calls one author function with a built context.
_Avoid_: End-to-end test, integration test, acceptance test
