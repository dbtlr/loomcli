import { DeclarationError, Application, FatalError } from '@loomcli/core';

import { ruleText } from './rule-text.mjs';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, stdout: writeStdout } = fixture;

  function declare(build) {
    try {
      return build();
    } catch (error) {
      if (!(error instanceof DeclarationError)) {
        throw error;
      }
      writeStdout(`thrown:${error.exitCode}: ${ruleText(error)}\n`);
      throw fixture.stopped;
    }
  }
  try {
    const scenario = words[0];

    /** The root one scenario declares, whose faulty call throws before anything runs. */
    function build() {
      let app = new Application('fixture');
      switch (scenario) {
        case 'duplicate': {
          app = app
            .argument('files', { required: true, variadic: true })
            .argument('files', { required: true, variadic: true });
          break;
        }
        case 'competing': {
          app = app
            .argument('files', { required: true, variadic: true })
            .argument('extras', { required: true, variadic: true });
          break;
        }
        case 'required': {
          app = app.argument('files', { required: true, variadic: true });
          break;
        }
      }
      if (scenario !== 'actionless') {
        app = app.action(({ out }) => {
          if (scenario === 'fatal') {
            out.fatal('Expected failure.');
          }
          if (scenario === 'throw-fatal') {
            throw new FatalError('Expected failure.');
          }
          if (scenario === 'unexpected') {
            throw new Error('Unexpected failure.');
          }
          if (scenario === 'unknown-throw') {
            throw null;
          }
          if (scenario === 'caught-fatal') {
            try {
              out.fatal('Caught failure.');
            } catch (error) {
              if (!(error instanceof FatalError)) {
                throw error;
              }
            }
          }
          out.print('dispatched');
        });
      }
      return app;
    }

    const app = declare(build);
    writeStdout('assembled\n');
    const code = await app.run({
      process: createProcess({ argv: words.slice(1), release: { build: 'distributed' } }),
    });
    writeStdout(`resolved:${code}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
