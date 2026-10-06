import { registerRule } from './diagnostic-text.js';

/*
 * Core's rules for the declaration faults of Commands and their names, aliases, nesting, children,
 * actions, results, and core facts. Each is declared once here and shared by every site that raises
 * it, as a plugin's rules are.
 */

/** An application name, a Command name, or an alias outside the portable name rule. */
const portableName = registerRule('@loomcli/core/portable-name', {
  explanation:
    'An operator types the application name, each Command name, and each alias as a command at a shell prompt. A character outside the POSIX portable filename set needs quoting there, a leading "-" reads as an option, and a leading "." names a file a shell hides.',
  headline: 'Name not portable',
});

/** An argument name outside the declared-name rule. */
const declaredName = registerRule('@loomcli/core/declared-name', {
  explanation:
    'An action reads each argument and option under its name, and help and diagnostics print it. A leading "-" reads as an option, and whitespace or "=" splits the name where the parser reads it.',
  headline: 'Invalid declared name',
});

/** Globals declared on a named Command's options. */
const commandGlobals = registerRule('@loomcli/core/command-globals', {
  explanation:
    "Global options belong to the Application, which declares them with globalOption() and hands their values to every action. A named Command reads their types from the Application's registered environment.",
  headline: 'Globals on a named Command',
});

/** A declaration call a Command's own `action()` already closed. */
const declaredAfterAction = registerRule('@loomcli/core/declared-after-action', {
  explanation:
    "action() finishes a Command's declaration: the handler's types read every argument, option, alias, result, and child declared before it, so a later call would declare what the handler never sees.",
  headline: 'Declared after the action',
});

/** A second `action()` on one Command. */
const multipleActions = registerRule('@loomcli/core/multiple-actions', {
  explanation:
    'Routing runs one handler for the Command it selects, so a second action would leave one of the two unreachable.',
  headline: 'Second action',
});

/** One Command that declares arguments and attaches children. */
const argumentsBesideChildren = registerRule('@loomcli/core/arguments-beside-children', {
  explanation:
    "A Command's first bare token either names a child or fills an argument, so a Command that holds both cannot tell which one an operator meant.",
  headline: 'Arguments beside children',
});

/** Two arguments with one name on one Command. */
const argumentDeclaredTwice = registerRule('@loomcli/core/argument-declared-twice', {
  explanation:
    'An action reads each argument under its name, so two arguments with one name leave one of them unreadable.',
  headline: 'Argument declared twice',
});

/** A variadic argument that another argument follows. */
const variadicArgumentLast = registerRule('@loomcli/core/variadic-argument-last', {
  explanation:
    'A variadic argument takes every positional token that remains, so an argument after it would never receive one.',
  headline: 'Variadic argument not last',
});

/** An optional argument that another argument follows. */
const optionalArgumentLast = registerRule('@loomcli/core/optional-argument-last', {
  explanation:
    'Positional tokens fill the arguments in order, and an operator leaves out an optional argument from the end of the line. An argument after an optional one would take the token the optional one was meant to receive.',
  headline: 'Optional argument not last',
});

/** An `alias()` call that names no alias. */
const aliasWithoutNames = registerRule('@loomcli/core/alias-without-names', {
  explanation:
    'alias() adds each name it receives to the names that route to its Command, so a call with none adds nothing.',
  headline: 'Alias with no names',
});

/** An alias that repeats its own Command's or option's name or another of its aliases. */
const repeatedAlias = registerRule('@loomcli/core/repeated-alias', {
  explanation:
    'A Command or an option answers to its name and to each of its aliases, so an alias that repeats one of them adds nothing new.',
  headline: 'Alias repeats a name',
});

/** A child whose name or alias repeats a sibling's name or alias. */
const siblingNameTaken = registerRule('@loomcli/core/sibling-name-taken', {
  explanation:
    'Every canonical name and alias under one parent routes one token to one child, so a name that two siblings share cannot route.',
  headline: 'Name taken by a sibling',
});

/** A child that would sit more than two levels below the root. */
const nestingDepth = registerRule('@loomcli/core/nesting-depth', {
  explanation:
    'Each level of nesting adds a token an operator types before a Command runs. Loom keeps every Command at most two levels below the root, so every invocation stays short enough to remember.',
  headline: 'Commands nested too deep',
});

/** A value passed to `command()` that is not a Command. */
const notACommand = registerRule('@loomcli/core/not-a-command', {
  explanation:
    'A Command value carries the declaration that routing, parsing, and help read. Any other value carries none.',
  headline: 'Not a Command',
});

/** One Command value attached at two places. */
const commandAttachedTwice = registerRule('@loomcli/core/command-attached-twice', {
  explanation:
    'A Command value sits at one place in the tree, where its path, its help page, and its parent read it, so one value attached at two places would have two paths.',
  headline: 'Command attached twice',
});

/** A Command with neither an action nor children. */
const commandWithoutAction = registerRule('@loomcli/core/command-without-action', {
  explanation:
    "Routing ends at a Command that runs its action, or passes on to one of a group's children. A Command with neither leaves an invocation that reaches it nothing to run.",
  headline: 'Nothing to run',
});

/** A group, a Command with no action, that declares a local option. */
const groupOption = registerRule('@loomcli/core/group-option', {
  explanation:
    'A Command with no action is a group, which passes an invocation on to one of its children. A local option is never inherited, so no action reads an option a group declares.',
  headline: 'Option on a group',
});

/** A second `result()` or `rows()` on one Command. */
const multipleResults = registerRule('@loomcli/core/multiple-results', {
  explanation:
    "A Command's action emits one result through out.results(), declared once, as a value with result() or as rows with rows(), so its consumers read one declaration.",
  headline: 'Second result',
});

/** A `views()` call on a Command that declares no result. */
const viewsWithoutResult = registerRule('@loomcli/core/views-without-result', {
  explanation:
    'views() reshapes the views a declared result renders through. A Command that declares no result emits nothing for a view to render.',
  headline: 'Views with no result',
});

/** A views entry that is not exactly one view. */
const viewShape = registerRule('@loomcli/core/view-shape', {
  explanation:
    'A views entry is a view with render, which receives the whole result, or a row view with row, which receives one row at a time. Core reads which function it holds to decide how to feed it.',
  headline: 'Not one view',
});

/** A row view under a result declared with `result()`. */
const rowViewOnValue = registerRule('@loomcli/core/row-view-on-value', {
  explanation:
    'A row view renders one row at a time, which only a result declared with rows() emits. A value result arrives whole, so a view with render reads it.',
  headline: 'Row view on a value result',
});

/** A view's `mediaType` that is not a string, on a result view or on a declared view. */
const viewMediaType = registerRule('@loomcli/core/media-type', {
  explanation:
    "A view's media type tells a reader how to parse the text the view writes, such as application/json, so it is a string. Core stores it as declared and never checks it against the text.",
  headline: 'Invalid media type',
});

/** A view name outside the declared-name rule, or one that is integer-like. */
const viewName = registerRule('@loomcli/core/view-name', {
  explanation:
    'An operator and a middleware select a view by its name, so it is a bare token. It is not integer-like either, because an object moves such a key ahead of every other and the views lose the order they were declared in.',
  headline: 'Invalid view name',
});

/** A result on a Command with no action. */
const resultWithoutAction = registerRule('@loomcli/core/result-without-action', {
  explanation:
    'A declared result is a promise the action keeps by emitting through out.results(). A Command with no action has nothing to keep it.',
  headline: 'Result with no action',
});

/** A result whose merged views record holds no view. */
const resultWithoutViews = registerRule('@loomcli/core/result-without-views', {
  explanation:
    'A result prints through one of its views: the default one, or the one an operator or a middleware selects. A result with none has no way to print.',
  headline: 'Result with no views',
});

/** A default view that the merged views record does not hold. */
const unknownDefaultView = registerRule('@loomcli/core/unknown-default-view', {
  explanation:
    'The default view renders a result when nothing selects another, so it names one of the views the result declares.',
  headline: 'Default view not declared',
});

/** A description, a deprecated message, or an Application version that is not one line of prose. */
const notOneLine = registerRule('@loomcli/core/not-one-line', {
  explanation:
    'Help, --version, the manifest, and every other listing print a description, a deprecated message, and a version on one line beside what each names, so each holds prose and no line break. An operator or an agent follows a deprecated message to the replacement, so a bare true names none, and a version is a string as the package manifest spells it.',
  headline: 'Text not one line',
});

/** `hidden` or `deprecated` on the Application or on an argument, or `control` on an argument. */
const misplacedListingFact = registerRule('@loomcli/core/misplaced-listing-fact', {
  explanation:
    "hidden and deprecated keep a named Command or an option off a listing, or mark it retired, and control marks an option that controls the invocation rather than feeding the Command's work. The root is the entry point of every page, and an argument cannot leave the grammar it sits in and is always the Command's input, so neither carries them.",
  headline: 'Listing fact out of place',
});

export {
  aliasWithoutNames,
  argumentDeclaredTwice,
  argumentsBesideChildren,
  commandAttachedTwice,
  commandGlobals,
  commandWithoutAction,
  declaredAfterAction,
  declaredName,
  groupOption,
  misplacedListingFact,
  multipleActions,
  multipleResults,
  nestingDepth,
  notOneLine,
  notACommand,
  optionalArgumentLast,
  portableName,
  repeatedAlias,
  resultWithoutAction,
  resultWithoutViews,
  rowViewOnValue,
  siblingNameTaken,
  unknownDefaultView,
  variadicArgumentLast,
  viewMediaType,
  viewName,
  viewShape,
  viewsWithoutResult,
};
