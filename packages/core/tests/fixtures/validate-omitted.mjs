import { Application, validationContext } from '@loomcli/core';
import { z } from 'zod';

const [scenario, ...argv] = process.argv.slice(2);
const calls = [];

// A declared `undefined` and a missing key both vanish from JSON, so the marker keeps them apart.
const encode = (value) =>
  JSON.stringify(value, (_key, item) => (item === undefined ? '#undefined' : item));

/**
 * One schema for every scenario. It records what each call saw, so an omitted call proves its
 * value, its phase, and the declaration it validated, and returns the source the value names.
 */
const source = (message) => ({
  '~standard': {
    validate: (value, options) => {
      const context = validationContext(options);
      calls.push({
        absent: value === undefined,
        input: context?.input ?? null,
        phase: context?.phase ?? null,
        supplied: context?.supplied ?? null,
      });
      if (value !== undefined) {
        return { value: `file:${value}` };
      }
      return message === undefined ? { value: 'stdin' } : { issues: [{ message }] };
    },
    vendor: 'fixture',
    version: 1,
  },
});

const report = ({ args, options, out }) => out.print(encode({ args, calls, options }));

let app = new Application('omitted');
switch (scenario) {
  case 'option':
  case 'option-issue': {
    app = app.option('file', {
      short: 'f',
      type: 'string',
      validate: source(scenario === 'option' ? undefined : 'Supply a file or pipe JSON to stdin.'),
      validateOmitted: true,
    });
    break;
  }
  case 'argument':
  case 'argument-issue': {
    app = app.argument('path', {
      validate: source(
        scenario === 'argument' ? undefined : 'Supply a path or pipe JSON to stdin.',
      ),
      validateOmitted: true,
    });
    break;
  }
  case 'required': {
    app = app.option('file', {
      required: true,
      type: 'string',
      validate: source(),
      validateOmitted: true,
    });
    break;
  }
  case 'default': {
    app = app.option('file', {
      default: 'doc.json',
      type: 'string',
      validate: source(),
      validateOmitted: true,
    });
    break;
  }
  case 'multiple': {
    app = app.option('file', {
      multiple: true,
      type: 'string',
      validate: z.array(z.string()),
      validateOmitted: true,
    });
    break;
  }
  case 'variadic': {
    app = app.argument('files', {
      validate: z.array(z.string()),
      validateOmitted: true,
      variadic: true,
    });
    break;
  }
  case 'boolean': {
    app = app.option('force', { type: 'boolean', validateOmitted: true });
    break;
  }
  case 'unvalidated': {
    app = app.option('file', { type: 'string', validateOmitted: true });
    break;
  }
  default: {
    throw new Error(`Unknown scenario: ${scenario}`);
  }
}
await app.action(report).run({ host: { argv } });
