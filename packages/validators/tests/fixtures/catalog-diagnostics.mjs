import { DeclarationError } from '@loomcli/core';
import {
  createValidator,
  integer,
  issueCode,
  number,
  oneOf,
  path,
  text,
  url,
} from '@loomcli/validators';

const parse = (raw) => ({ value: raw });

/** A Standard Schema that answers each value with the verdict `answer` gives. */
function schema(answer) {
  return { '~standard': { validate: answer, vendor: 'fixture', version: 1 } };
}

const message = ({ word }) => `Expected ${word} in capitals.`;

/**
 * One faulty factory call per scenario, each reachable from JavaScript alone. The fixture prints
 * the Developer Diagnostic its message holds.
 */
const scenarios = {
  'bound-value': () => integer({ min: 1.5 }),
  'bounds-order': () => integer({ max: 1, min: 5 }),
  'context-outside-run': () =>
    createValidator({ parse: (raw, context) => ({ value: context.host }) })['~standard'].validate(
      'x',
    ),
  'factory-options': () => number('5'),
  'input-schema': () => createValidator({ inputSchema: { $schema: 'x', type: 'string' }, parse }),
  'issue-code-config': () =>
    issueCode('@acme/checks/shout', { message: 'x', schema: schema(parse) }),
  'issue-code-name': () => issueCode('Bad Code', { message, schema: schema(parse) }),
  'issue-code-schema': () =>
    issueCode('@acme/checks/shout', {
      message,
      schema: schema(() => {
        throw new Error('broken');
      }),
    }).issue({ word: 'yes' }),
  'issue-parameters': () =>
    issueCode('@acme/checks/shout', {
      message,
      schema: schema(() => ({ issues: [{ message: 'Expected a string.' }] })),
    }).issue({ word: 7 }),
  'one-of-empty': () => oneOf([]),
  'one-of-twice': () => oneOf(['dev', 'prod', 'dev']),
  'path-check': () => path({ kind: 'file' }),
  'pattern-message': () => text({ pattern: /[a-z]+/u }),
  'text-bounds-order': () => text({ maxLength: 0 }),
  'text-pattern': () => text({ message: 'Expected letters.', pattern: /[a-z]+/g }),
  'url-protocols': () => url({ protocols: ['https:'] }),
  'validator-definition': () => createValidator({ parse: 'x' }),
};

try {
  scenarios[process.argv[2]]();
  process.stdout.write('returned\n');
} catch (error) {
  if (!(error instanceof DeclarationError)) {
    throw error;
  }
  process.stdout.write(`${error.message}\n`);
}
