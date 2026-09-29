import { diagnosticRule } from '@loomcli/core';
import type { DiagnosticRule } from '@loomcli/core';

/*
 * The catalog's rules for the declaration faults its factories raise. Each is declared once here
 * through the public diagnosticRule(), under the package's own name, as any third-party validator
 * package declares its rules, and shared by every site that raises it.
 */

/** One rule of this package, named under the package as its issue codes are. */
function catalogRule(
  name: string,
  definition: { readonly headline: string; readonly explanation: string },
): DiagnosticRule {
  return diagnosticRule(`@loomcli/validators/${name}`, definition);
}

/** A factory's options that are not a plain object. */
const factoryOptions = catalogRule('factory-options', {
  explanation:
    'A catalog factory reads its settings from one options object, so a value of any other kind leaves it no settings to read.',
  headline: 'Options not an object',
});

/** A `oneOf()` list that is not a list of distinct nonempty strings. */
const oneOfValues = catalogRule('one-of-values', {
  explanation:
    'oneOf() accepts a token equal to one of its values, and help, completion, and the published schema offer each value as a choice, so the list holds at least one value, each a distinct nonempty string.',
  headline: 'Invalid oneOf values',
});

/** A bound that is not a number of the kind its validator reads. */
const boundValue = catalogRule('bound-value', {
  explanation:
    "A bound limits the values or the length a validator accepts, and the published schema carries it, so it is a number of the kind the validator reads: a safe integer for integer(), a finite number for number(), and a non-negative safe integer for text()'s lengths.",
  headline: 'Invalid bound',
});

/** A lower bound above its upper bound. */
const boundsOrder = catalogRule('bounds-order', {
  explanation:
    'A validator accepts what lies between its lower and its upper bound, both inclusive, so a lower bound above the upper one would reject every token.',
  headline: 'Bounds out of order',
});

/** A `url()` protocols list that is not a list of scheme names. */
const urlProtocols = catalogRule('url-protocols', {
  explanation:
    'url() accepts a URL whose scheme the list names and publishes the list as a pattern, so it holds at least one scheme name: a letter followed by letters, digits, +, -, or ., with no trailing colon.',
  headline: 'Invalid url protocols',
});

/** A `path()` access or kind outside its set, or a kind with no access to narrow. */
const pathCheck = catalogRule('path-check', {
  explanation:
    'path() reads the file system only to check an access, read or write, and kind narrows that check to a file, a directory, or any entry, so kind has no meaning without access.',
  headline: 'Invalid path check',
});

/** A `text()` pattern that JSON Schema cannot read as it is. */
const textPattern = catalogRule('invalid-pattern', {
  explanation:
    'text() publishes its pattern in the JSON Schema it serves, which reads a pattern under the u flag alone, so the pattern is a regular expression that compiles under u and carries no other flag.',
  headline: 'Invalid pattern',
});

/** A `text()` pattern without its sentence, or a sentence without a pattern. */
const patternMessage = catalogRule('pattern-message', {
  explanation:
    'Only the author can say what a pattern accepts, so text() takes a pattern together with one sentence that states it, and prints that sentence when a token does not match.',
  headline: 'Pattern and message apart',
});

/** An issue code outside the `<package>/<kebab-case-rule>` grammar. */
const issueCodeName = catalogRule('issue-code-name', {
  explanation:
    'An issue code names the package that declares it and the one sentence it prints, so a view rewords that sentence by its code. It is a package name, /, and a kebab-case rule name.',
  headline: 'Invalid issue code',
});

/** An `issueCode()` config without a Standard Schema and a message function. */
const issueCodeConfig = catalogRule('issue-code-config', {
  explanation:
    "An issue code checks each issue's parameters with its schema and builds the issue's sentence from them with its message function, so its config holds both.",
  headline: 'Invalid issue code config',
});

/** An issue code schema that answers with a promise, throws, or answers with no result. */
const issueCodeSchema = catalogRule('issue-code-schema', {
  explanation:
    "issue() and read() check an issue's parameters with the code's schema synchronously, while a validator builds the issue or a view reads it, so the schema returns its value or its issues, and neither throws nor answers with a promise.",
  headline: 'Broken issue code schema',
});

/** Parameters an issue code's schema rejects. */
const issueParameters = catalogRule('issue-parameters', {
  explanation:
    "An issue carries parameters its code's schema accepts, so every view that reads them through read() gets the shape the code declares.",
  headline: 'Issue parameters rejected',
});

/** A `createValidator()` definition without a parse function. */
const validatorDefinition = catalogRule('validator-definition', {
  explanation:
    'createValidator() builds a Standard Schema value around one parse function that validates a raw string, so its definition is an object that holds that function.',
  headline: 'Invalid validator definition',
});

/** A `createValidator()` input schema that is not a plain object, or declares its own dialect. */
const inputSchema = catalogRule('input-schema', {
  explanation:
    'createValidator() publishes its input schema as draft 2020-12 JSON Schema and adds the $schema dialect itself, so inputSchema is a plain object with no $schema of its own.',
  headline: 'Invalid input schema',
});

/** A validator that read the validation context outside a Loom run. */
const contextOutsideRun = catalogRule('context-outside-run', {
  explanation:
    'Core attaches the validation context to each call it makes to a validator. A call from anywhere else, such as a unit test, carries none, so a validator that reads it runs inside an Application run.',
  headline: 'Context outside a run',
});

export {
  boundsOrder,
  boundValue,
  contextOutsideRun,
  factoryOptions,
  inputSchema,
  issueCodeConfig,
  issueCodeName,
  issueCodeSchema,
  issueParameters,
  oneOfValues,
  pathCheck,
  patternMessage,
  textPattern,
  urlProtocols,
  validatorDefinition,
};
