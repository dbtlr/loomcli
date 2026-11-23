import { Application, validationContext } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    const [scenario, ...argv] = words;
    const calls = [];

    // A declared `undefined` and a missing key both vanish from JSON, so the marker keeps them apart.

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
          validate: source(
            scenario === 'option' ? undefined : 'Supply a file or pipe JSON to stdin.',
          ),
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
      default: {
        throw new Error(`Unknown scenario: ${scenario}`);
      }
    }
    await app.action(report).run({ process: createProcess({ argv }) });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const encode = (value) =>
  JSON.stringify(value, (_key, item) => (item === undefined ? '#undefined' : item));

export { runFixture as run };
