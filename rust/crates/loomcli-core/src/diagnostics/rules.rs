//! Core's diagnostic rules, one constant per identity, with the headline and explanation the
//! diagnostics reference states.

use super::{DiagnosticRule, diagnostic_rule};

/// `@loomcli/core/argument-after-variadic`: Argument after variadic not a required scalar.
pub(crate) const ARGUMENT_AFTER_VARIADIC: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/argument-after-variadic",
    "Argument after variadic not a required scalar",
    "A variadic argument takes the plain words between the arguments before it and the arguments after it, so each argument after it fills from the end of the line with exactly one word. Only a required scalar argument always takes exactly one word: an optional argument, a second variadic, an argument required only when input is not interactive, or a content argument after a variadic would leave the parser unable to tell where the variadic's words end.",
);

/// `@loomcli/core/argument-declared-twice`: Argument declared twice.
pub(crate) const ARGUMENT_DECLARED_TWICE: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/argument-declared-twice",
    "Argument declared twice",
    "An action reads each argument under its name, so two arguments with one name leave one of them unreadable.",
);

/// `@loomcli/core/background-mark`: Invalid background mark.
pub(crate) const BACKGROUND_MARK: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/background-mark",
    "Invalid background mark",
    "One string global option may carry the operator's background choice. Core reads it from argv right after host capture, beside the color choice and before anything else prints, so it takes no short alias and no second source.",
);

/// `@loomcli/core/broken-attach-hook`: Broken attach hook.
pub(crate) const BROKEN_ATTACH_HOOK: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/broken-attach-hook",
    "Broken attach hook",
    "on_command_attach receives each Command's declaration at graph build and edits it in place, synchronously, returning Ok(()). Core builds the Command the hook leaves, so an Err other than a DeclarationError leaves it nothing to build.",
);

/// `@loomcli/core/broken-destination`: Broken destination.
pub(crate) const BROKEN_DESTINATION: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/broken-destination",
    "Broken destination",
    "Core writes the run's output and its failure reports to the host streams run() captured. A stream that fails a write loses whatever followed it, so the run cannot succeed.",
);

/// `@loomcli/core/broken-failure-encoder`: Broken failure encoder.
pub(crate) const BROKEN_FAILURE_ENCODER: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/broken-failure-encoder",
    "Broken failure encoder",
    "A failure encoder turns a failure's form into the text a machine reader parses, synchronously and without throwing. Core wrote its own text for the failure in the encoder's place.",
);

/// `@loomcli/core/broken-failure-view`: Broken failure view.
pub(crate) const BROKEN_FAILURE_VIEW: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/broken-failure-view",
    "Broken failure view",
    "A failure view turns a failure into the text the operator reads, synchronously and without throwing. Core wrote its own text for the failure in the view's place.",
);

/// `@loomcli/core/broken-graph-hook`: Broken graph hook.
pub(crate) const BROKEN_GRAPH_HOOK: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/broken-graph-hook",
    "Broken graph hook",
    "on_graph_built receives the graph once per build and judges it: it returns Ok(()), and it rejects the graph only by returning a DeclarationError. Any other Err is a defect in the hook.",
);

/// `@loomcli/core/color-mark`: Invalid color mark.
pub(crate) const COLOR_MARK: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/color-mark",
    "Invalid color mark",
    "One Boolean global option may carry the operator's color choice. Core reads it from argv right after host capture, before anything else prints, so it takes no short alias and no second source.",
);

/// `@loomcli/core/command-attached-twice`: Command attached twice.
// Unreachable under a recorded deviation; kept so the rule table stays whole.
#[allow(dead_code)]
pub(crate) const COMMAND_ATTACHED_TWICE: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/command-attached-twice",
    "Command attached twice",
    "A Command value sits at one place in the tree, where its path, its help page, and its parent read it, so one value attached at two places would have two paths.",
);

/// `@loomcli/core/command-without-action`: Nothing to run.
pub(crate) const COMMAND_WITHOUT_ACTION: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/command-without-action",
    "Nothing to run",
    "Routing ends at a Command that runs its action, or passes on to one of a group's children. A Command with neither leaves an invocation that reaches it nothing to run. A group that declares an argument, stdin, the passthrough mode, or that it needs a terminal has the same fault, because those declarations reach no action.",
);

/// `@loomcli/core/declared-name`: Invalid declared name.
pub(crate) const DECLARED_NAME: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/declared-name",
    "Invalid declared name",
    "An action reads each argument and option under its name, and help and diagnostics print it. A leading \"-\" reads as an option, and whitespace or \"=\" splits the name where the parser reads it.",
);

/// `@loomcli/core/option-arity`: Invalid option arity.
pub(crate) const OPTION_ARITY: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/option-arity",
    "Invalid option arity",
    "An option with an arity takes exactly that many words per occurrence and gives the action a tuple of them. A count below 2 is the single word an option without arity already takes, and a count that is not whole names no number of words.",
);

/// `@loomcli/core/env-delimiter`: Empty environment delimiter.
pub(crate) const ENV_DELIMITER: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/env-delimiter",
    "Empty environment delimiter",
    "A multiple option's or a scalar arity option's variable splits at each occurrence of its envDelimiter into the option's list, and an empty string occurs between every two characters, so it separates no item.",
);

/// `@loomcli/core/extension-output`: Extension output not plain data.
pub(crate) const EXTENSION_OUTPUT: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/extension-output",
    "Extension output not plain data",
    "Every projection, the manifest included, reads an extension's output as frozen plain data: strings, finite numbers, Booleans, null, arrays, and plain objects.",
);

/// `@loomcli/core/failure-code`: Invalid failure code.
// Unreachable under a recorded deviation; kept so the rule table stays whole.
#[allow(dead_code)]
pub(crate) const FAILURE_CODE: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/failure-code",
    "Invalid failure code",
    "A failure's code tells a script or an agent which failure ended the run, where many failures share one exit code. A machine reader branches on the code, so it follows one grammar: words of lowercase letters and digits joined by single hyphens. A code outside it is rejected where a failure of the class is constructed.",
);

/// `@loomcli/core/failure-encoder-taken`: Failure encoder taken.
pub(crate) const FAILURE_ENCODER_TAKEN: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/failure-encoder-taken",
    "Failure encoder taken",
    "A failed run writes its failure through the one encoder registered for the media type its selected view declares. Two encoders for one media type leave core no way to choose between them.",
);

/// `@loomcli/core/foreign-graph`: Graph not from inspect().
// Unreachable under a recorded deviation; kept so the rule table stays whole.
#[allow(dead_code)]
pub(crate) const FOREIGN_GRAPH: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/foreign-graph",
    "Graph not from inspect()",
    "Core reads a Command graph through the build inspect() rendered it from. A graph inspect() did not return, or one whose nodes do not match that build, leaves core no build to read, so the run stops rather than hand a plugin the wrong Command.",
);

/// `@loomcli/core/foreign-throw`: Unhandled exception.
pub(crate) const FOREIGN_THROW: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/foreign-throw",
    "Unhandled exception",
    "Core reports a value that an action, a middleware, a configuration source, a view, a translator, or a plugin's hook threw, and that no translator answered, as a defect, because only the author knows what it means. A distributed build shows the operator one generic message in its place.",
);

/// `@loomcli/core/foreign-value`: Value from another copy of core.
// Unreachable under a recorded deviation; kept so the rule table stays whole.
#[allow(dead_code)]
pub(crate) const FOREIGN_VALUE: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/foreign-value",
    "Value from another copy of core",
    "Core reads a plugin, an extension value, a declared view, a view override, a translation, a failure encoding, and a provider through facts the copy of @loomcli/core that built it recorded. When two copies of @loomcli/core are installed, a value one copy built carries no facts the other copy can read.",
);

/// `@loomcli/core/interaction-mark`: Invalid interaction mark.
pub(crate) const INTERACTION_MARK: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/interaction-mark",
    "Invalid interaction mark",
    "One Boolean global option may turn questions off, so two options that carry the mark would each claim the decision for the run.",
);

/// `@loomcli/core/invalid-default`: Default rejected.
pub(crate) const INVALID_DEFAULT: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/invalid-default",
    "Default rejected",
    "Each run passes every declared default through its validator before it reads a token, because a default reaches the action as a validated value. A default the validator rejects would reach no action, whatever the operator supplies.",
);

/// `@loomcli/core/invalid-extension-value`: Invalid extension value.
pub(crate) const INVALID_EXTENSION_VALUE: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/invalid-extension-value",
    "Invalid extension value",
    "An extension value passes its descriptor's schema at the call that carries it, synchronously, so every plugin that reads it reads a value the schema accepted.",
);

/// `@loomcli/core/invalid-implied`: Implied value rejected.
pub(crate) const INVALID_IMPLIED: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/invalid-implied",
    "Implied value rejected",
    "Each run passes every implied value through its validator before it reads a token, because a bare spelling supplies it to the action as a validated value. An implied value the validator rejects is the declaration at fault, whatever the operator supplies, so the run reports it whether or not a bare spelling was typed.",
);

/// `@loomcli/core/invalid-redact-path`: Invalid redact path.
pub(crate) const INVALID_REDACT_PATH: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/invalid-redact-path",
    "Invalid redact path",
    "Core redacts each path log.redact lists from every log event when it copies the fields, so no onLog hook, log line, or record reads the value. A path splits on dots into object keys, so each key is nonempty.",
);

/// `@loomcli/core/invalid-release-facts`: Invalid release facts.
// Unreachable under a recorded deviation; kept so the rule table stays whole.
#[allow(dead_code)]
pub(crate) const INVALID_RELEASE_FACTS: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/invalid-release-facts",
    "Invalid release facts",
    "The build bakes the release facts into __LOOM_RELEASE__: a build of source, development, or distributed, and an optional release group with a semantic version, a repository as owner/name, and an optional asset name. A malformed value leaves the build unknown, so core shows the author this diagnostic in every build.",
);

/// `@loomcli/core/invalid-shutdown-timeout`: Invalid shutdown timeout.
pub(crate) const INVALID_SHUTDOWN_TIMEOUT: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/invalid-shutdown-timeout",
    "Invalid shutdown timeout",
    "After an ending signal, core gives the runs shutdown.timeout milliseconds to unwind and then ends the process. A timer waits a whole number of milliseconds from 0 through 2147483647, so the budget is one of those.",
);

/// `@loomcli/core/missing-input-name`: Unknown missing input.
pub(crate) const MISSING_INPUT_NAME: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/missing-input-name",
    "Unknown missing input",
    "A missing input names a local option or an argument of the routed Command.",
);

/// `@loomcli/core/name-shared-across-kinds`: Argument and option share a name.
pub(crate) const NAME_SHARED_ACROSS_KINDS: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/name-shared-across-kinds",
    "Argument and option share a name",
    "An onCommandAttach hook adds inputs to a Command whose other inputs the plugin did not declare, so each name a hook declares stays apart from every argument and option in the Command's scope, whichever kind holds it. An author who gives an argument and an option one name does so knowingly, but a hook cannot see the Command's inputs, so a shared name there is an accident the author did not choose.",
);

/// `@loomcli/core/next-misuse`: next() misused.
pub(crate) const NEXT_MISUSE: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/next-misuse",
    "next() misused",
    "next() continues the middleware chain once, while the middleware that received it runs. A second call, or a call after the middleware returned, has no chain left to continue.",
);

/// `@loomcli/core/option-declared-twice`: Option declared twice.
pub(crate) const OPTION_DECLARED_TWICE: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/option-declared-twice",
    "Option declared twice",
    "An action reads the global options and its Command's own options from one options object, each under its declared name, and the global options, the application's and every installed plugin's, share every Command's one table of spellings. Two options with one name in either leave one of them unreadable.",
);

/// `@loomcli/core/option-group`: Invalid option group.
pub(crate) const OPTION_GROUP: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/option-group",
    "Invalid option group",
    "An option group relates already-declared local options. Its members must be distinct and its rules must permit those options to be used.",
);

/// `@loomcli/core/optional-argument-last`: Required argument after optional.
pub(crate) const OPTIONAL_ARGUMENT_LAST: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/optional-argument-last",
    "Required argument after optional",
    "Bare words fill the arguments in order, and an operator leaves out optional arguments from the end of the line. A required argument after an optional one would leave the parser unable to tell which of the two a lone bare word fills, and one after an argument required only when input is not interactive would keep that argument's question from ever being asked at a terminal. A content argument whose min is positive counts as required here, because it must receive a source.",
);

/// `@loomcli/core/plain-mark`: Invalid plain mark.
pub(crate) const PLAIN_MARK: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/plain-mark",
    "Invalid plain mark",
    "One Boolean global option may carry the spelling that turns the run's plain switch on. Core reads it from argv right after host capture, before anything else prints, so it takes no second source, and ACCESSIBLE is the environment's word for the switch.",
);

/// `@loomcli/core/plugin-installed-twice`: Plugin installed twice.
pub(crate) const PLUGIN_INSTALLED_TWICE: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/plugin-installed-twice",
    "Plugin installed twice",
    "Core keys each plugin by its identity, and a plugin contributes its options, middleware, hooks, and views once, so a second installation would contribute each of them again.",
);

/// `@loomcli/core/plugin-loader-failed`: Plugin loader failed.
// Unreachable under a recorded deviation; kept so the rule table stays whole.
#[allow(dead_code)]
pub(crate) const PLUGIN_LOADER_FAILED: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/plugin-loader-failed",
    "Plugin loader failed",
    "Core loads a plugin's middleware or source module the first time a run reaches it, and the module owes its function as its default export.",
);

/// `@loomcli/core/portable-name`: Name not portable.
pub(crate) const PORTABLE_NAME: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/portable-name",
    "Name not portable",
    "An operator types the application name, each Command name, and each alias as a command at a shell prompt. A character outside the POSIX portable filename set needs quoting there, a leading \"-\" reads as an option, and a leading \".\" names a file a shell hides.",
);

/// `@loomcli/core/provider-name-taken`: Provider name taken.
pub(crate) const PROVIDER_NAME_TAKEN: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/provider-name-taken",
    "Provider name taken",
    "An action reads each provided value under its provider's name, so two different providers with one name among the providers a uses list reaches would leave one name for two values. A provider is its name, its value type, and its opener's type, so two calls of one factory function name one provider; core rejects two providers with one name and another value type or opener where the list is declared.",
);

/// `@loomcli/core/quiet-mark`: Invalid quiet mark.
pub(crate) const QUIET_MARK: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/quiet-mark",
    "Invalid quiet mark",
    "One counted global option may lower the run's verbosity by one step. Core settles the verbosity right after graph build, before it reads the environment or configuration, so the marked option takes no second source.",
);

/// `@loomcli/core/result-contract`: Result contract broken.
pub(crate) const RESULT_CONTRACT: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/result-contract",
    "Result contract broken",
    "A Command that declares a result promises its consumer one value, or one sequence of rows, that its action emits once through out.results().",
);

/// `@loomcli/core/rule-identity`: Invalid rule identity.
// Unreachable under a recorded deviation; kept so the rule table stays whole.
#[allow(dead_code)]
pub(crate) const RULE_IDENTITY: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/rule-identity",
    "Invalid rule identity",
    "A rule's identity names the package that declares it and the rule inside it, so tooling keys on it and two packages never share one. It is an identity, a package name and any kebab-case subpath segments that name the part of the package that owns the rule, then a kebab-case rule name, joined by /.",
);

/// `@loomcli/core/schema-converter-failed`: Schema converter failed.
// Unreachable under a recorded deviation; kept so the rule table stays whole.
#[allow(dead_code)]
pub(crate) const SCHEMA_CONVERTER_FAILED: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/schema-converter-failed",
    "Schema converter failed",
    "Help, the manifest, and completion read what an input accepts from the JSON Schema its validator publishes. A converter that throws or returns anything but a plain object publishes no shape, so a distributed build reads the input's schema as null.",
);

/// `@loomcli/core/sibling-name-taken`: Name taken by a sibling.
pub(crate) const SIBLING_NAME_TAKEN: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/sibling-name-taken",
    "Name taken by a sibling",
    "Every canonical name and alias under one parent routes one token to one child, so a name that two siblings share cannot route.",
);

/// `@loomcli/core/slot-taken`: Slot already claimed.
pub(crate) const SLOT_TAKEN: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/slot-taken",
    "Slot already claimed",
    "A slot is a position exactly one plugin claims: the theme and the configuration source. A second claim would leave two plugins answering where core asks one.",
);

/// `@loomcli/core/source-answers`: Invalid source answers.
pub(crate) const SOURCE_ANSWERS: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/source-answers",
    "Invalid source answers",
    "A configuration source answers with a record that maps each option core requested to { value, label }, where the value has the raw type the option takes and the label is one line of prose, and an answer may add a directory, the absolute path of the folder holding the file the value came from. Core fills no option from any other answer.",
);

/// `@loomcli/core/spelling-taken`: Spelling used twice.
pub(crate) const SPELLING_TAKEN: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/spelling-taken",
    "Spelling used twice",
    "The parser reads each spelling as one option, and a Command's own options share one invocation with the global options and every installed plugin's options. A spelling two options claim, a short alias, an alias, or a generated negative form included, would reach only one of them.",
);

/// `@loomcli/core/stdin-claimed-twice`: Stdin claimed twice.
pub(crate) const STDIN_CLAIMED_TWICE: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/stdin-claimed-twice",
    "Stdin claimed twice",
    "A Command has one stdin stream, so at most one local content input or stdin-only declaration claims it.",
);

/// `@loomcli/core/two-package-copies`: Two copies of one package.
pub(crate) const TWO_PACKAGE_COPIES: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/two-package-copies",
    "Two copies of one package",
    "Core keys each extension and each declared view by its identity and compares its value type. Two value types under one identity mean two copies of the crate that defines it are linked, and a value one copy made cannot be read through the other.",
);

/// `@loomcli/core/validator-failed`: Validator failed.
// Unreachable under a recorded deviation; kept so the rule table stays whole.
#[allow(dead_code)]
pub(crate) const VALIDATOR_FAILED: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/validator-failed",
    "Validator failed",
    "Only an issue a validator returns states a validation verdict. A validator that throws, rejects, or returns anything but a Standard Schema result leaves core no verdict to report, so validation stops and the action does not run.",
);

/// `@loomcli/core/variable-bound-twice`: Variable bound twice.
pub(crate) const VARIABLE_BOUND_TWICE: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/variable-bound-twice",
    "Variable bound twice",
    "Within one invocation's scope a variable fills one option, so two options that bind it would both take the value an operator set for one of them.",
);

/// `@loomcli/core/verbose-mark`: Invalid verbose mark.
pub(crate) const VERBOSE_MARK: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/verbose-mark",
    "Invalid verbose mark",
    "One counted global option may raise the run's verbosity. Core settles the verbosity right after graph build, before it reads the environment or configuration, so the marked option takes no second source.",
);

/// `@loomcli/core/view-selection`: Invalid view selection.
pub(crate) const VIEW_SELECTION: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/view-selection",
    "Invalid view selection",
    "A middleware, or the caller of invoke(), selects one of the views the routed Command's result declares, by name, before the action runs. A Command that declares no result has no view to select, and a name its result does not declare has no view to render. A middleware states the run's media type only on a Command that declares no result, because on one that declares a result the selected view states it.",
);

pub(crate) const MEDIA_TYPE_CORRECTION: &str = "Assign mediaType only on a Command that declares no result; select a view by name on one that does.";

/// The fix for an incompatible result transform.
pub(crate) const RESULT_TRANSFORM_CORRECTION: &str = "Assign a transform that accepts the result's value or row type, or select a view over JSON data.";

// Rules this port adds for checks moved to runtime and for Rust-specific behavior. The result
// transform check follows from type erasure. The deviations register lists the port's rules.

/// `@loomcli/core/result-transform`: Incompatible result transform.
pub(crate) const RESULT_TRANSFORM: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/result-transform",
    "Incompatible result transform",
    "A result transform receives the declared value or row type. A JSON transform serves a hook-added view or a result whose value or row type is serde_json::Value.",
);

/// `@loomcli/core/option-config`: Option configuration conflict.
pub(crate) const OPTION_CONFIG: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/option-config",
    "Option configuration conflict",
    "Each option kind takes a fixed set of facts, and some facts exclude each other: a required input has no default, a short-only option has no aliases, a global option declares no presence rule, and only a global option carries a run-wide mark. A builder combination outside that set would leave core two readings of one declaration.",
);

/// `@loomcli/core/plugin-option-name`: A plugin names an option it does not declare.
pub(crate) const PLUGIN_OPTION_NAME: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/plugin-option-name",
    "A plugin names an option it does not declare",
    "A plugin's middleware activation and its short and env settings name the plugin's own options, declared before the call that names them. A name the plugin does not declare can never be present and has no declaration to adjust, so the middleware would never run or the setting would change nothing.",
);

/// `@loomcli/core/handler-registered-twice`: Plugin handler registered twice.
pub(crate) const HANDLER_REGISTERED_TWICE: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/handler-registered-twice",
    "Plugin handler registered twice",
    "A plugin holds one middleware and one handler for each lifecycle hook, as a plugin definition holds one key for each. A second registration would replace the first, so the first handler's work would be lost without a word.",
);

/// `@loomcli/core/input-read`: Typed read does not match the declarations.
pub(crate) const INPUT_READ: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/input-read",
    "Typed read does not match the declarations",
    "An action reads its inputs, globals, and provided values by declared name and type. A read that names nothing the routed Command declares, asks for another type than the declaration produces, or reads a provider the Command did not opt in to cannot be answered.",
);

/// `@loomcli/core/entry-point`: Entry point inside a runtime.
pub(crate) const ENTRY_POINT: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/entry-point",
    "Entry point inside a runtime",
    "Application::main builds a tokio runtime of its own and blocks its thread on the run, and tokio cannot block a thread that already drives a runtime. An application that runs on a runtime of its own awaits main_async, which runs the invocation on that runtime and still calls the process's exit listeners as the run returns.",
);

// The corrections several sites of one rule share, as the reference declares them beside the rules.

/// The fix every foreign throw shares.
pub(crate) const FOREIGN_THROW_CORRECTION: &str = "Catch the error where it is thrown and throw a failure class, such as FatalError, with a sentence the operator can act on.";

/// The fix a broken failure view states.
pub(crate) const VIEW_CORRECTION: &str =
    "Return a string from the view's render function, and throw nothing from it.";

/// The fix every invalid view selection a middleware made shares.
pub(crate) const VIEW_SELECTION_CORRECTION: &str = "Assign view one of the view names the routed Command's result declares, and only on a Command that declares a result.";

/// The fix every invalid starting view an `invoke()` caller selected shares.
pub(crate) const INVOKE_VIEW_CORRECTION: &str = "Supply a view name the Command's result declares.";

/// The fix every source answers fault shares.
pub(crate) const SOURCE_ANSWERS_CORRECTION: &str = "Return a record that maps each requested option's name to { value, label }, with a value of the option's raw type.";

/// The fix every foreign graph shares.
// Unreachable under a recorded deviation; kept so the rule table stays whole.
#[allow(dead_code)]
pub(crate) const FOREIGN_GRAPH_CORRECTION: &str = "Pass the graph inspect() returned, unchanged.";

/// A second passthrough declaration.
pub(crate) const PASSTHROUGH_DECLARED_TWICE: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/passthrough-declared-twice",
    "Passthrough declared twice",
    "A Command declares one passthrough mode for the words after the first bare delimiter.",
);

/// A second terminal need declaration.
pub(crate) const TERMINAL_NEED_DECLARED_TWICE: DiagnosticRule = diagnostic_rule(
    "@loomcli/core/terminal-need-declared-twice",
    "Terminal need declared twice",
    "A Command declares once that its action needs a terminal.",
);

/// Every rule core declares, in identity order, the port's own rules last.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const ALL: &[DiagnosticRule] = &[
    ARGUMENT_AFTER_VARIADIC,
    ARGUMENT_DECLARED_TWICE,
    BACKGROUND_MARK,
    BROKEN_ATTACH_HOOK,
    BROKEN_DESTINATION,
    BROKEN_FAILURE_ENCODER,
    BROKEN_FAILURE_VIEW,
    BROKEN_GRAPH_HOOK,
    COLOR_MARK,
    COMMAND_ATTACHED_TWICE,
    COMMAND_WITHOUT_ACTION,
    DECLARED_NAME,
    ENV_DELIMITER,
    EXTENSION_OUTPUT,
    FAILURE_CODE,
    FAILURE_ENCODER_TAKEN,
    FOREIGN_GRAPH,
    FOREIGN_THROW,
    FOREIGN_VALUE,
    INTERACTION_MARK,
    INVALID_DEFAULT,
    INVALID_EXTENSION_VALUE,
    INVALID_IMPLIED,
    INVALID_REDACT_PATH,
    INVALID_RELEASE_FACTS,
    INVALID_SHUTDOWN_TIMEOUT,
    MISSING_INPUT_NAME,
    NAME_SHARED_ACROSS_KINDS,
    NEXT_MISUSE,
    OPTION_ARITY,
    OPTION_DECLARED_TWICE,
    OPTION_GROUP,
    OPTIONAL_ARGUMENT_LAST,
    PLAIN_MARK,
    PLUGIN_INSTALLED_TWICE,
    PLUGIN_LOADER_FAILED,
    PORTABLE_NAME,
    PROVIDER_NAME_TAKEN,
    QUIET_MARK,
    RESULT_CONTRACT,
    RULE_IDENTITY,
    SCHEMA_CONVERTER_FAILED,
    SIBLING_NAME_TAKEN,
    SLOT_TAKEN,
    SOURCE_ANSWERS,
    SPELLING_TAKEN,
    STDIN_CLAIMED_TWICE,
    TWO_PACKAGE_COPIES,
    VALIDATOR_FAILED,
    VARIABLE_BOUND_TWICE,
    VERBOSE_MARK,
    VIEW_SELECTION,
    PASSTHROUGH_DECLARED_TWICE,
    TERMINAL_NEED_DECLARED_TWICE,
    OPTION_CONFIG,
    PLUGIN_OPTION_NAME,
    INPUT_READ,
    HANDLER_REGISTERED_TWICE,
    ENTRY_POINT,
    RESULT_TRANSFORM,
];
