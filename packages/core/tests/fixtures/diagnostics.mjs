import { Application, DeclarationError, diagnosticRule, InternalError } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    const scenario = words[0];

    const retryLimit = diagnosticRule('@acme/retry/retry-limit', {
      explanation:
        'Each retry repeats the request against the service, so a large limit can hold the terminal for minutes. The plugin accepts from 0 through 10 retries.',
      headline: 'Retry limit out of range',
    });

    /** The fixture plugin factory core's reference shows, which checks its own argument. */
    function retry(limit) {
      if (!Number.isInteger(limit) || limit < 0 || limit > 10) {
        throw new DeclarationError(retryLimit, {
          correction: 'Pass a whole number from 0 through 10.',
          findings: [{ arguments: [limit], call: 'retry', mark: '0', note: 'from 0 through 10' }],
          sentence: `retry() received ${String(limit)} retries.`,
        });
      }
      return limit;
    }

    const collision = diagnosticRule('@acme/trace/option-collision', {
      docs: 'https://example.com/rules/option-collision',
      explanation:
        'One key names one option, so two declarations of it leave a run unable to tell them apart.',
      headline: 'Option declared twice',
    });

    /** What one call threw, printed as the fields a test reads. */
    function report(call) {
      try {
        call();
        writeStdout('returned\n');
      } catch (error) {
        writeStdout(`${error.message}\n`);
      }
    }

    switch (scenario) {
      case 'retry': {
        report(() => retry(50));
        break;
      }
      case 'fields': {
        try {
          retry(50);
        } catch (error) {
          writeStdout(
            `${JSON.stringify({
              correction: error.correction,
              exitCode: error.exitCode,
              findings: error.findings,
              name: error.name,
              rule: error.rule.identity,
              same: error.rule === retryLimit,
              sentence: error.sentence,
            })}\n`,
          );
        }
        break;
      }
      case 'sentence-only': {
        report(() => {
          throw new DeclarationError(
            'Plugin "@acme/trace" received a level of 9. Pass a level from 0 through 3.',
          );
        });
        break;
      }
      case 'sentence-only-fields': {
        const error = new DeclarationError('One sentence.', { cause: 'why' });
        writeStdout(
          `${JSON.stringify({
            cause: error.cause,
            correction: error.correction ?? null,
            findings: error.findings,
            rule: error.rule ?? null,
            sentence: error.sentence,
          })}\n`,
        );
        break;
      }
      case 'collision': {
        report(() => {
          throw new DeclarationError(collision, {
            correction: [
              'Rename the local option.',
              'Install the plugin without its verbose option.',
            ],
            findings: [
              {
                arguments: [{ options: { verbose: { type: 'boolean' } } }],
                call: 'trace',
                mark: '0.options.verbose',
                note: "the plugin's global option",
              },
              {
                arguments: ['verbose', { type: 'string', validate: { '~standard': {} } }],
                call: 'option',
                mark: '0',
                note: 'the local option',
                path: ['get'],
              },
            ],
            sentence:
              'Option "verbose" is declared by plugin "@acme/trace" and as a local option on Command "get".',
          });
        });
        break;
      }
      case 'escaped': {
        report(() => {
          throw new DeclarationError(retryLimit, {
            findings: [{ arguments: ['a\u202eb\nc'], call: 'retry' }],
            sentence: 'retry() received "a\u202eb\nc".',
          });
        });
        break;
      }
      case 'internal': {
        const cause = new TypeError('Nope.');
        const error = new InternalError(retryLimit, {
          cause,
          correction: 'Fix the loop.',
          sentence: 'The retry loop broke.',
        });
        writeStdout(
          `${JSON.stringify({
            cause: error.cause === cause,
            correction: error.correction,
            message: error.message,
            rule: error.rule.identity,
            sentence: error.sentence,
          })}\n`,
        );
        const plain = new InternalError('Plain.', cause);
        writeStdout(
          `${JSON.stringify({ message: plain.message, rule: plain.rule ?? null, sentence: plain.sentence })}\n`,
        );
        break;
      }
      case 'frozen': {
        writeStdout(
          `${JSON.stringify({
            docs: collision.docs,
            frozen: Object.isFrozen(collision),
            headline: collision.headline,
            identity: collision.identity,
            none: retryLimit.docs ?? null,
          })}\n`,
        );
        break;
      }
      case 'bad-identity': {
        report(() => diagnosticRule('Retry Limit', { explanation: 'E.', headline: 'H' }));
        break;
      }
      case 'subpath-identity': {
        writeStdout(
          `${diagnosticRule('@acme/retry/backoff/retry-limit', { explanation: 'E.', headline: 'H' }).identity}\n`,
        );
        break;
      }
      case 'empty-segment': {
        report(() =>
          diagnosticRule('@acme/retry//retry-limit', { explanation: 'E.', headline: 'H' }),
        );
        break;
      }
      case 'uppercase-segment': {
        report(() =>
          diagnosticRule('@acme/retry/Backoff/retry-limit', { explanation: 'E.', headline: 'H' }),
        );
        break;
      }
      case 'trailing-slash': {
        report(() => diagnosticRule('@acme/retry/backoff/', { explanation: 'E.', headline: 'H' }));
        break;
      }
      case 'uppercase-rule': {
        report(() =>
          diagnosticRule('@acme/retry/Retry-Limit', { explanation: 'E.', headline: 'H' }),
        );
        break;
      }
      case 'no-package': {
        report(() => diagnosticRule('retry-limit', { explanation: 'E.', headline: 'H' }));
        break;
      }
      case 'run-width': {
        // A development run that meets the fault, on the terminal and environment the test names.
        const input = JSON.parse(words[1]);
        const wide = diagnosticRule('@acme/wide/wide-words', {
          explanation: '界界界界界 界界界界界 界界界界界',
          headline: 'Wide words',
        });
        await new Application('width', { description: 'Meet a fault.' })
          .action(() => {
            if (input.wide) {
              throw new DeclarationError(wide, { sentence: 'The words are wide.' });
            }
            retry(50);
          })
          .run({
            process: createProcess({
              argv: [],
              env: input.env ?? {},
              release: { build: 'source' },
              terminal: input.terminal,
            }),
          });
        break;
      }
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
