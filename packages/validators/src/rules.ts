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

/** A `oneOf()` list that holds one value twice. */
const oneOfValues = catalogRule('one-of-values', {
  explanation:
    'oneOf() accepts a token equal to one of its values, and help, completion, and the published schema offer each value as a choice, and a JSON Schema enum lists each value once, so each value is distinct.',
  headline: 'Invalid oneOf values',
});

/** A bound that is not a value of the kind its validator reads. */
const boundValue = catalogRule('bound-value', {
  explanation:
    "A bound limits the values or the length a validator accepts, and the published schema carries it, so it is a value the schema can hold: a finite number for integer() and number(), a whole number of 0 or more for text()'s lengths, and a duration in the operator's grammar for duration().",
  headline: 'Invalid bound',
});

/** A lower bound above its upper bound. */
const boundsOrder = catalogRule('bounds-order', {
  explanation:
    'A validator accepts what lies between its lower and its upper bound, both inclusive, so a lower bound above the upper one would reject every token.',
  headline: 'Bounds out of order',
});

/** A `dateTime()` time zone that is not an IANA time zone name the runtime knows. */
const timeZone = catalogRule('time-zone', {
  explanation:
    'dateTime() reads a token with no offset in the time zone it names, so the name is an IANA time zone the runtime knows, such as America/New_York.',
  headline: 'Invalid time zone',
});

/** A `url()` protocols list that is not a list of scheme names. */
const urlProtocols = catalogRule('url-protocols', {
  explanation:
    'url() accepts a URL whose scheme the list names and publishes the list as a pattern, so it holds at least one scheme name: a letter followed by letters, digits, +, -, or ., with no trailing colon.',
  headline: 'Invalid url protocols',
});

/** A `text()` pattern that JSON Schema cannot read as it is. */
const textPattern = catalogRule('invalid-pattern', {
  explanation:
    'text() publishes its pattern in the JSON Schema it serves, which reads a pattern under the u flag alone, so the pattern is a regular expression that compiles under u and carries no other flag.',
  headline: 'Invalid pattern',
});

/** An issue code outside the `<package>[/<subpath>...]/<kebab-case-rule>` grammar. */
const issueCodeName = catalogRule('issue-code-name', {
  explanation:
    'An issue code names the package that declares it and the one sentence it prints, so a view rewords that sentence by its code. It is a package name, any kebab-case subpath segments, and a kebab-case rule name, joined by /.',
  headline: 'Invalid issue code',
});

/** Parameters an issue code's schema rejects. */
const issueParameters = catalogRule('issue-parameters', {
  explanation:
    "An issue carries parameters its code's schema accepts, so every view that reads them through read() gets the shape the code declares.",
  headline: 'Issue parameters rejected',
});

/** A `createValidator()` input schema that declares its own dialect. */
const inputSchema = catalogRule('input-schema', {
  explanation:
    'createValidator() publishes its input schema as draft 2020-12 JSON Schema and adds the $schema dialect itself, so inputSchema holds no $schema of its own.',
  headline: 'Invalid input schema',
});

/** A validator that read the validation context outside a Loom run. */
const contextOutsideRun = catalogRule('context-outside-run', {
  explanation:
    'Core attaches the validation context to each call it makes to a validator. A call from anywhere else, such as a unit test, carries none, so a validator that reads it runs inside an Application run, or a test passes it the options validationOptions builds.',
  headline: 'Context outside a run',
});

export {
  boundsOrder,
  boundValue,
  contextOutsideRun,
  inputSchema,
  issueCodeName,
  issueParameters,
  oneOfValues,
  textPattern,
  timeZone,
  urlProtocols,
};
