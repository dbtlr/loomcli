import { registerRule } from './diagnostic-text.js';

/*
 * Core's rules for the declaration faults of arguments, options, validators, defaults, global
 * options, and environment bindings. Each is declared once here and shared by every site that
 * raises it, as a plugin's rules are.
 */

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

/** One variable that two options in one invocation's scope bind. */
const variableBoundTwice = registerRule('@loomcli/core/variable-bound-twice', {
  explanation:
    "Within one invocation's scope a variable fills one option, so two options that bind it would both take the value an operator set for one of them.",
  headline: 'Variable bound twice',
});

/** A multiple option whose variable splits at a delimiter that is the empty string. */
const envDelimiterEmpty = registerRule('@loomcli/core/env-delimiter', {
  explanation:
    "A multiple option's variable splits at each occurrence of its envDelimiter into the option's list, and an empty string occurs between every two characters, so it separates no item.",
  headline: 'Empty environment delimiter',
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
  envDelimiterEmpty,
  invalidDefault,
  invalidImplied,
  nameSharedAcrossKinds,
  optionDeclaredTwice,
  schemaConverterFailed,
  spellingTaken,
  variableBoundTwice,
};
