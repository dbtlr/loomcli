import { DeclarationError } from '@loomcli/core';
import {
  createValidator,
  dateTime,
  duration,
  integer,
  issueCode,
  oneOf,
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
  'bound-value': () => integer({ min: Number.POSITIVE_INFINITY }),
  'bounds-order': () => integer({ max: 1, min: 5 }),
  'context-outside-run': () =>
    createValidator({ parse: (raw, context) => ({ value: context.host }) })['~standard'].validate(
      'x',
    ),
  'duration-bound-value': () => duration({ min: 'abc' }),
  'duration-bounds-order': () => duration({ max: '30s', min: '1h' }),
  'input-schema': () => createValidator({ inputSchema: { $schema: 'x', type: 'string' }, parse }),
  'issue-code-name': () => issueCode('Bad Code', { message, schema: schema(parse) }),
  'issue-parameters': () =>
    issueCode('@acme/checks/shout', {
      message,
      schema: schema(() => ({ issues: [{ message: 'Expected a string.' }] })),
    }).issue({ word: 7 }),
  'one-of-twice': () => oneOf(['dev', 'prod', 'dev']),
  'text-bounds-order': () => text({ maxLength: 0 }),
  'text-pattern': () => text({ message: 'Expected letters.', pattern: /[a-z]+/g }),
  'time-zone': () => dateTime({ timeZone: 'Mars/Olympus' }),
  'url-protocols': () => url({ protocols: ['https', 'https:'] }),
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
