import { registerRule } from './diagnostic-text.js';

/*
 * Core's rules for the declaration faults of arguments, options, validators, defaults, global
 * options, and environment bindings. Each is declared once here and shared by every site that
 * raises it, as a plugin's rules are.
 */

/** An option declared with a type other than string, Boolean, or count. */
const optionType = registerRule('@loomcli/core/option-type', {
  explanation:
    'The type decides how the parser reads an option: a string option consumes a value, a Boolean option consumes none, and a counted option consumes none and counts its occurrences. Core reads no other kind.',
  headline: 'Invalid option type',
});

/** A short alias that is not one ASCII letter. */
const shortAlias = registerRule('@loomcli/core/short-alias', {
  explanation:
    'An operator types a short alias as a hyphen and one letter, and several combine into one short group such as -tm, so each is one ASCII letter the parser can split apart.',
  headline: 'Invalid short alias',
});

/**
 * A yes-or-no declaration key, such as `required`, `hidden`, or an extension descriptor's
 * `collect`, that holds a value other than a Boolean.
 */
const flagNotBoolean = registerRule('@loomcli/core/flag-not-boolean', {
  explanation:
    'hidden, shortOnly, multiple, required, variadic, validateOmitted, and an extension\'s collect each answer one yes-or-no question about a declaration, so each holds true or false. A value such as the string "false" would read as true.',
  headline: 'Flag not a Boolean',
});

/** `shortOnly` on an option that declares no short alias. */
const shortOnlyWithoutShort = registerRule('@loomcli/core/short-only-without-short', {
  explanation:
    'shortOnly removes every long spelling of an option, so an option with no short alias would leave an operator no spelling to type.',
  headline: 'Short only with no short alias',
});

/** `aliases` on an option that declares `shortOnly`. */
const shortOnlyWithAliases = registerRule('@loomcli/core/short-only-with-aliases', {
  explanation:
    'shortOnly removes every long spelling of an option, and each alias adds a long spelling, so an option cannot declare both.',
  headline: 'Short only with aliases',
});

/** `multiple` on a Boolean option. */
const booleanOptionMultiple = registerRule('@loomcli/core/boolean-option-multiple', {
  explanation:
    'A Boolean option reports whether its spelling was supplied, so a repeat has no second value to collect. multiple collects each occurrence of a string option into an array.',
  headline: 'Boolean option takes one value',
});

/** `multiple` on a counted option. */
const countOptionMultiple = registerRule('@loomcli/core/count-option-multiple', {
  explanation:
    'A counted option already counts every occurrence of every spelling, so it has no values to collect. multiple collects each occurrence of a string option into an array.',
  headline: 'Counted option takes no values',
});

/** `polarity` on a counted option. */
const polarityOnCount = registerRule('@loomcli/core/polarity-on-count', {
  explanation:
    'Polarity chooses which long forms a Boolean option accepts and what its absence means. A counted option reads how many times it was supplied, so it has no negative form and no polarity.',
  headline: 'Polarity on a counted option',
});

/** `implied` on a Boolean or counted option. */
const impliedOnBooleanOrCount = registerRule('@loomcli/core/implied-on-boolean-or-count', {
  explanation:
    'An implied value is the value a bare spelling of a string option supplies. A Boolean option and a counted option take no value, so a bare spelling already says everything they read.',
  headline: 'Implied on a valueless option',
});

/** An `implied` value that is not a string. */
const impliedNotAString = registerRule('@loomcli/core/implied-not-a-string', {
  explanation:
    "An implied value stands in for the string an operator would otherwise attach to the spelling, so it is a string, in the validator's input type.",
  headline: 'Implied value not a string',
});

/** `polarity` on a string option. */
const polarityOnString = registerRule('@loomcli/core/polarity-on-string', {
  explanation:
    'Polarity chooses which long forms a Boolean option accepts and what its absence means. A string option takes its value from the operator, so it has no polarity.',
  headline: 'Polarity on a string option',
});

/** A polarity outside the three settings. */
const optionPolarity = registerRule('@loomcli/core/option-polarity', {
  explanation:
    "Polarity chooses a Boolean option's long forms and its absent value from three settings: positive, both, and negative.",
  headline: 'Invalid polarity',
});

/** `polarity: 'both'` beside `shortOnly`. */
const shortOnlyBothPolarities = registerRule('@loomcli/core/short-only-both-polarities', {
  explanation:
    'Polarity both gives an option one spelling that turns it on and one that turns it off. shortOnly leaves the option its short alias alone, and one spelling sets one value.',
  headline: 'Both polarities with short only',
});

/**
 * One spelling that two options in one scope claim, the application's, a plugin's, or one a
 * plugin's hook declared.
 */
const spellingTaken = registerRule('@loomcli/core/spelling-taken', {
  explanation:
    "The parser reads each spelling as one option, and a Command's own options share one invocation with the global options and every installed plugin's options. A spelling two options claim, a short alias, an alias, or a generated negative form included, would reach only one of them.",
  headline: 'Spelling used twice',
});

/**
 * Two options with one declared name in one scope, the application's, a plugin's, or one a
 * plugin's hook declared.
 */
const optionDeclaredTwice = registerRule('@loomcli/core/option-declared-twice', {
  explanation:
    "An action reads the global options and its Command's own options from one options object, each under its declared name, and the global options, the application's and every installed plugin's, share every Command's one table of spellings. Two options with one name in either leave one of them unreadable.",
  headline: 'Option declared twice',
});

/**
 * An input a plugin's `onCommandAttach` hook declares under a name that an input of the other kind
 * already holds in the Command's scope: an argument under an option's name, or an option under an
 * argument's name.
 */
const nameSharedAcrossKinds = registerRule('@loomcli/core/name-shared-across-kinds', {
  explanation:
    "An onCommandAttach hook adds inputs to a Command whose other inputs the plugin did not declare, so each name a hook declares stays apart from every argument and option in the Command's scope, whichever kind holds it. An author who gives an argument and an option one name does so knowingly, but a hook cannot see the Command's inputs, so a shared name there is an accident the author did not choose.",
  headline: 'Argument and option share a name',
});

/** `required` or `validateOmitted` on a global option. */
const globalPresenceRule = registerRule('@loomcli/core/global-presence-rule', {
  explanation:
    'A global option is validated on every Command, the Commands of plugins included, so a rule that its value must exist would fail a Command that never reads it. An omitted global option is absent.',
  headline: 'Presence rule on a global option',
});

/** `globalOption()` after the application's own `command()` or `action()`. */
const globalOptionAfterCommand = registerRule('@loomcli/core/global-option-after-command', {
  explanation:
    'A Command attached with command() and the root action read their types from the global options declared before them, so a global option declared later would reach an action whose types never name it.',
  headline: 'Global option after a Command',
});

/** An environment binding on a multiple option. */
const envOnMultiple = registerRule('@loomcli/core/env-on-multiple', {
  explanation:
    'A variable holds one string, and core never splits it, so it cannot supply the several values a multiple option collects. The configuration source supplies a list.',
  headline: 'Environment binding on a list',
});

/** An environment binding whose name is outside the variable name grammar. */
const envName = registerRule('@loomcli/core/env-name', {
  explanation:
    'The input-source stage reads the variable an option binds by its name, and a shell sets a variable only under a name of letters, digits, and underscores that does not start with a digit.',
  headline: 'Invalid variable name',
});

/** An environment binding on an argument. */
const envOnArgument = registerRule('@loomcli/core/env-on-argument', {
  explanation:
    'An argument is identified by its place among the bare tokens, so no variable can stand in for it. An option names itself on the command line, which lets a variable fill it.',
  headline: 'Environment binding on an argument',
});

/** One variable that two options in one invocation's scope bind. */
const variableBoundTwice = registerRule('@loomcli/core/variable-bound-twice', {
  explanation:
    "Within one invocation's scope a variable fills one option, so two options that bind it would both take the value an operator set for one of them.",
  headline: 'Variable bound twice',
});

/** `validateOmitted` on a declaration whose absence another rule already decides. */
const omissionAlreadyDecided = registerRule('@loomcli/core/omission-already-decided', {
  explanation:
    'validateOmitted sends an omitted value to its validator, which only an input with no other absence rule needs. An omitted required input fails, a default fills an omitted value, and an omitted multiple option or variadic argument receives an empty array.',
  headline: 'Absence already decided',
});

/** `validateOmitted` on a declaration with no validator. */
const omissionWithoutValidator = registerRule('@loomcli/core/omission-without-validator', {
  explanation:
    "validateOmitted sends an omitted value to the input's validator, so an input with no validator has nothing to receive it.",
  headline: 'Omission with no validator',
});

/** `validate`, `default`, `required`, or `validateOmitted` on a Boolean option. */
const booleanOptionValueRule = registerRule('@loomcli/core/boolean-option-value-rule', {
  explanation:
    'A Boolean option consumes no value, so there is nothing to validate, and its polarity decides the value an absent option reads. validate, default, required, and validateOmitted belong to inputs that take a value.',
  headline: 'Value rule on a Boolean option',
});

/** `validate`, `default`, `required`, or `validateOmitted` on a counted option. */
const countOptionValueRule = registerRule('@loomcli/core/count-option-value-rule', {
  explanation:
    'A counted option consumes no value and reads how many times it was supplied, 0 when nothing supplied it, so there is nothing to validate and no absence to decide. validate, default, required, and validateOmitted belong to inputs that take a value.',
  headline: 'Value rule on a counted option',
});

/** A required input that also declares a default. */
const requiredWithDefault = registerRule('@loomcli/core/required-with-default', {
  explanation:
    'A default fills an omitted value, and a required input fails when it is omitted, so a required input never reads its default.',
  headline: 'Default on a required input',
});

/** A `validate` value that is not a Standard Schema v1 object. */
const notAValidator = registerRule('@loomcli/core/not-a-validator', {
  explanation:
    "Core validates every value through the Standard Schema v1 interface: the object's ~standard property, with version 1, a vendor, and a validate function. It calls nothing else.",
  headline: 'Not a Standard Schema',
});

/** A default of the wrong raw shape for its declaration. */
const defaultShape = registerRule('@loomcli/core/default-shape', {
  explanation:
    "A default stands in for the value an operator would supply. Without a validator it is that raw value, a string or, for an input that takes several values, an array of strings; with one, it is the validator's input, and an input that takes several values still takes an array of them.",
  headline: 'Default of the wrong shape',
});

/** The most arrays and plain objects any path through a declared default may hold. */
const defaultLevels = 10;

/** A declared default nested deeper than `defaultLevels`. */
const defaultDepth = registerRule('@loomcli/core/default-depth', {
  explanation: `A default stands in for the value an operator would supply, and every reader of the graph, help and the manifest included, walks it. Core keeps every path through a default within ${String(defaultLevels)} levels of arrays and plain objects, and a default that holds itself nests without end, so every reader stays far inside the call stack on every runtime.`,
  headline: 'Default nested too deep',
});

/** A declared default its validator rejected. */
const invalidDefault = registerRule('@loomcli/core/invalid-default', {
  explanation:
    'Each run passes every declared default through its validator before it reads a token, because a default reaches the action as a validated value. A default the validator rejects would reach no action, whatever the operator supplies.',
  headline: 'Default rejected',
});

/** A declared implied value its validator rejected. */
const invalidImplied = registerRule('@loomcli/core/invalid-implied', {
  explanation:
    'Each run passes every implied value through its validator before it reads a token, because a bare spelling supplies it to the action as a validated value. An implied value the validator rejects is the declaration at fault, whatever the operator supplies, so the run reports it whether or not a bare spelling was typed.',
  headline: 'Implied value rejected',
});

/** A validator's JSON Schema converter that threw or returned a value that is not a plain object. */
const schemaConverterFailed = registerRule('@loomcli/core/schema-converter-failed', {
  explanation:
    "Help, the manifest, and completion read what an input accepts from the JSON Schema its validator publishes. A converter that throws or returns anything but a plain object publishes no shape, so a distributed build reads the input's schema as null.",
  headline: 'Schema converter failed',
});

export {
  booleanOptionMultiple,
  booleanOptionValueRule,
  countOptionMultiple,
  countOptionValueRule,
  defaultDepth,
  defaultLevels,
  defaultShape,
  envName,
  envOnArgument,
  envOnMultiple,
  flagNotBoolean,
  globalOptionAfterCommand,
  globalPresenceRule,
  impliedNotAString,
  impliedOnBooleanOrCount,
  invalidDefault,
  invalidImplied,
  notAValidator,
  omissionAlreadyDecided,
  nameSharedAcrossKinds,
  omissionWithoutValidator,
  optionDeclaredTwice,
  optionPolarity,
  optionType,
  polarityOnCount,
  polarityOnString,
  requiredWithDefault,
  schemaConverterFailed,
  shortAlias,
  shortOnlyBothPolarities,
  shortOnlyWithAliases,
  shortOnlyWithoutShort,
  spellingTaken,
  variableBoundTwice,
};
